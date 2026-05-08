import { z } from 'zod';
import {
  extractScoreFunctionBody,
  getScoreFunctionRuntimeIssue,
  hasValidScoreSignature,
  isParseableScoreFunction,
} from './score-function';

/**
 * Evaluator configuration — stored in `workflows.evalConfigYaml` as YAML, parsed into this shape.
 * Every evaluator returns a normalized score in [0, 1]; multiple evaluators combine into a
 * weighted mean per execution.
 */

export const EvaluatorTypeSchema = z.enum(['exact-diff', 'llm-judge', 'custom-script']);
export type EvaluatorType = z.infer<typeof EvaluatorTypeSchema>;

const ScoreInUnitInterval = z
  .number()
  .min(0, { message: 'score must be >= 0' })
  .max(1, { message: 'score must be <= 1' });

/** Minimum prompt-extension length for an `llm-judge` evaluator. Below this
 *  the prompt has no useful criteria and the LLM invents its own rubric. */
export const LLM_JUDGE_PROMPT_MIN_LENGTH = 10;

// ------- exact-diff config -------

export const ExactDiffConfigSchema = z
  .object({
    numericTolerance: z
      .number()
      .min(0)
      .default(1e-6)
      .describe(
        'Maximum absolute difference between numeric values that still counts as equal. Use 1e-6 for floats, 0 for exact integer match.'
      ),
    allowExtraFields: z
      .boolean()
      .default(true)
      .describe(
        "When on, extra fields in the actual output don't fail the diff. Off = actual must match expected exactly."
      ),
    passThreshold: ScoreInUnitInterval.default(1.0).describe(
      'Minimum diff score this evaluator must reach for a run to pass. 1.0 = perfect match required.'
    ),
    paths: z
      .array(z.string().min(1))
      .optional()
      .describe(
        "Dot-paths to scope the diff to a subset of the expected tree. Empty = diff entire expected. Syntax: `header.id`, `lineItems[].total`, `lineItems[0].sku`. Use this when expected has noisy sections you don't want to score."
      ),
  })
  .default({ numericTolerance: 1e-6, allowExtraFields: true, passThreshold: 1.0 });
export type ExactDiffConfig = z.infer<typeof ExactDiffConfigSchema>;

// ------- llm-judge config -------

export const JudgeModeSchema = z.enum(['continuous', 'discrete']);
export type JudgeMode = z.infer<typeof JudgeModeSchema>;

const LabelsRecord = z.record(z.string().min(1), ScoreInUnitInterval);

export const LlmJudgeConfigSchema = z
  .object({
    model: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Which LLM grades the output. Falls back to the workspace's default LLM provider when unset."
      ),
    mode: JudgeModeSchema.default('continuous').describe(
      'Continuous = the LLM returns a free-form score in [0, 1]. Discrete = the LLM picks one of your labels and the score is looked up from the table.'
    ),
    labels: LabelsRecord.optional().describe(
      'Allowed labels and the score each maps to. Required in discrete mode. The judge MUST return one of these labels; each score must be in [0, 1].'
    ),
    passThreshold: ScoreInUnitInterval.default(0.7).describe(
      'Minimum judge score this evaluator must reach for a run to pass.'
    ),
    promptExtension: z
      .string()
      .trim()
      .min(
        LLM_JUDGE_PROMPT_MIN_LENGTH,
        `judge prompt is required — describe what makes a good answer for this workflow (≥${LLM_JUDGE_PROMPT_MIN_LENGTH} chars). An empty prompt makes the model invent its own scoring criteria.`
      )
      .describe(
        'Required. Evaluation criteria appended to the judge prompt — describe what makes a good answer for this workflow (tone, completeness, edge cases). Cannot be empty: an empty prompt yields the model inventing its own criteria.'
      ),
    docLabel: z
      .string()
      .default('output')
      .describe(
        "Name the judge uses to refer to the output in its prompt (e.g. 'invoice', 'extraction'). Default is 'output'."
      ),
  })
  .superRefine((val, ctx) => {
    if (val.mode === 'discrete') {
      if (!val.labels || Object.keys(val.labels).length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'discrete mode requires at least one label in `labels`',
          path: ['labels'],
        });
      }
    }
  });
export type LlmJudgeConfig = z.infer<typeof LlmJudgeConfigSchema>;

// ------- custom-script config -------

/**
 * Single source of truth for the custom-script function contract. Surfaced
 * verbatim in (a) the schema's `function.describe()` (so JSON Schema consumers
 * and `eigenpal workflow evaluator-type get custom-script` see it), and
 * (b) the dashboard help blurb above the editor.
 */
export const CUSTOM_SCRIPT_CONTRACT = {
  expected: "the example's expected output",
  actual: "the workflow's actual output",
  returns: 'a number in [0, 1]',
  throws: 'caught and scored as 0',
} as const;

/**
 * Hard cap on the `function` string length. Server-side this avoids spending
 * V8 parse time on multi-MB attacker-controlled JS during YAML load + form
 * save (each fires `new Function(text)` and a body-extraction scan). Any
 * legitimate scoring function fits comfortably under 10 KB; if you need
 * more, the logic belongs in a workflow step, not an evaluator.
 */
export const CUSTOM_SCRIPT_MAX_BYTES = 10_000;

/** Hard caps on user-tunable sandbox limits. Match the worker's
 *  `SCRIPT_MAX_TIMEOUT_MS` (30 s) and `SCRIPT_MAX_MEMORY_BYTES` (50 MB)
 *  defaults so a YAML config that the runtime would clamp gets rejected
 *  at parse time instead. Single-source-of-truth invariant: bumping these
 *  in the worker env without bumping here is a config drift bug. */
export const CUSTOM_SCRIPT_MAX_TIMEOUT_MS = 30_000;
export const CUSTOM_SCRIPT_MAX_MEMORY_MB = 50;

const CUSTOM_SCRIPT_FUNCTION_DESCRIPTION =
  `Full JavaScript declaration of \`function scoreScript(expected, actual) { ... }\`. ` +
  `Receives \`expected\` (${CUSTOM_SCRIPT_CONTRACT.expected}) ` +
  `and \`actual\` (${CUSTOM_SCRIPT_CONTRACT.actual}), returns ${CUSTOM_SCRIPT_CONTRACT.returns}. ` +
  `Throws are ${CUSTOM_SCRIPT_CONTRACT.throws}.`;

export const CustomScriptConfigSchema = z.object({
  // Stored as the full `function scoreScript(expected, actual) { ... }`
  // declaration — including signature — so the YAML reads the same as the
  // dashboard editor (no implicit wrapping). Three layered checks: (a) the
  // text actually parses as JS, (b) the `function scoreScript(expected,
  // actual)` signature is present at the top level, (c) the body contains
  // a `return` or `throw`. Each fires server-side at YAML-parse time AND
  // client-side at form-save time so hand-edited configs surface errors
  // before they hit the worker.
  function: z
    .string()
    .min(1, { message: 'required' })
    .max(CUSTOM_SCRIPT_MAX_BYTES, {
      message: `must be ≤ ${CUSTOM_SCRIPT_MAX_BYTES} bytes`,
    })
    .describe(CUSTOM_SCRIPT_FUNCTION_DESCRIPTION)
    .refine(isParseableScoreFunction, {
      message: 'must parse as JavaScript',
    })
    .refine(hasValidScoreSignature, {
      message:
        'must declare `function scoreScript(expected, actual) { ... }` (parameter names + order matter)',
    })
    .refine(
      (fn) => {
        const { body, wrapperOk } = extractScoreFunctionBody(fn);
        return wrapperOk && /\b(return|throw)\b/.test(body);
      },
      {
        message: 'function body must `return` a number in [0, 1] (or `throw` to score 0)',
      }
    )
    // Catch sandbox-incompatible patterns (async, dynamic import, require) so
    // authors get a clear validation message instead of a confused score=0
    // with a runtime "X is not a function" / unresolved-promise error.
    .superRefine((fn, ctx) => {
      const issue = getScoreFunctionRuntimeIssue(fn);
      if (issue) ctx.addIssue({ code: z.ZodIssueCode.custom, message: issue });
    }),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .max(CUSTOM_SCRIPT_MAX_TIMEOUT_MS, {
      message: `must be ≤ ${CUSTOM_SCRIPT_MAX_TIMEOUT_MS} ms`,
    })
    .default(5000)
    .describe(
      "Maximum wall-clock time the script can run before it's killed and the run is marked failed."
    ),
  memoryLimitMb: z
    .number()
    .int()
    .positive()
    .max(CUSTOM_SCRIPT_MAX_MEMORY_MB, {
      message: `must be ≤ ${CUSTOM_SCRIPT_MAX_MEMORY_MB} MB`,
    })
    .default(10)
    .describe(
      'Maximum memory the sandbox may allocate. Increase if the script processes large arrays or strings.'
    ),
  passThreshold: ScoreInUnitInterval.default(1.0).describe(
    'Minimum script score this evaluator must reach for a run to pass.'
  ),
});
export type CustomScriptConfig = z.infer<typeof CustomScriptConfigSchema>;

// ------- evaluator entry (discriminated union on `type`) -------

export const EvaluatorBaseEntrySchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/, 'name must be lowercase kebab-case')
    .describe(
      'Identifier used in eval results and the weighted-mean formula. Use a short kebab-case slug like header-exact or covenants-recall.'
    ),
  description: z
    .string()
    .trim()
    .max(500)
    .optional()
    .describe(
      'One-sentence explanation, in business language, of what this evaluator measures and why a stakeholder should care. Shown in the dashboard to non-technical reviewers (legal, ops, finance) who never see the YAML or judge prompt. Skip implementation detail (model names, thresholds, dot-paths); those live in `config`.'
    ),
  weight: z
    .number()
    .min(0)
    .default(1)
    .describe(
      'Relative importance in the weighted mean. The overall score is Σ(weightᵢ × scoreᵢ) / Σweight. Set to 0 to score-only without affecting overall.'
    ),
});

export const EvaluatorConfigSchema = z.discriminatedUnion('type', [
  EvaluatorBaseEntrySchema.extend({ type: z.literal('exact-diff'), config: ExactDiffConfigSchema }),
  EvaluatorBaseEntrySchema.extend({ type: z.literal('llm-judge'), config: LlmJudgeConfigSchema }),
  EvaluatorBaseEntrySchema.extend({
    type: z.literal('custom-script'),
    config: CustomScriptConfigSchema,
  }),
]);
export type EvaluatorConfig = z.infer<typeof EvaluatorConfigSchema>;

export const EvalConfigYamlSchema = z.object({
  evaluators: z.array(EvaluatorConfigSchema).default([]),
  /**
   * Single workflow-level pass threshold in [0, 1]. A run passes when its
   * weighted-mean score across evaluators clears this number. When omitted,
   * the worker falls back to the weighted-mean of per-evaluator
   * `passThreshold` values for backward compatibility.
   */
  passThreshold: ScoreInUnitInterval.default(0.7),
});
export type EvalConfigYaml = z.infer<typeof EvalConfigYamlSchema>;

// ------- evaluator result (what evaluators return; what the dispatcher persists) -------

export const EvaluatorResultSchema = z.object({
  score: ScoreInUnitInterval,
  passed: z.boolean(),
  label: z.string().optional(),
  details: z.unknown(),
});
export type EvaluatorResult = z.infer<typeof EvaluatorResultSchema>;

/**
 * Weighted mean of scores, skipping weight-zero entries from the denominator.
 * Returns null if there are no contributing evaluators.
 */
export function combineEvalScores(
  results: Array<{ score: number; weight: number }>
): number | null {
  let numerator = 0;
  let denominator = 0;
  for (const r of results) {
    if (r.weight <= 0) continue;
    numerator += r.score * r.weight;
    denominator += r.weight;
  }
  if (denominator === 0) return null;
  return numerator / denominator;
}
