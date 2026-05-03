import { z } from 'zod';

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

export const CustomScriptConfigSchema = z.object({
  code: z
    .string()
    .min(1, { message: 'code required' })
    .describe(
      'Sandboxed JavaScript. Receives `actual`, `expected`, `input` as variables and must return { score, label? } where score is in [0, 1].'
    ),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .default(5000)
    .describe(
      "Maximum wall-clock time the script can run before it's killed and the run is marked failed."
    ),
  memoryLimitMb: z
    .number()
    .int()
    .positive()
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
