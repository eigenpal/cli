import { z } from 'zod';
import { compileTypedScript } from '../typed-script';
import {
  DEFAULT_EXACT_DIFF_NUMERIC_TOLERANCE,
  MAX_UNORDERED_ARRAY_ITEMS,
  MAX_UNORDERED_COMPARISON_OPERATIONS,
  MAX_UNORDERED_PAIR_COMPARISONS,
  evalPathIsDescendant,
  selectExactDiffRulePaths,
  type ExactDiffPathRule,
  type ExactDiffRules,
} from './compare-output';

/**
 * Evaluator configuration — stored in `automations.eval_config_yaml` as YAML, parsed into this shape.
 * Every evaluator returns a normalized score in [0, 1]; multiple evaluators combine into a
 * weighted mean per execution.
 */

export const EvaluatorTypeSchema = z.enum(['exact-diff', 'llm-judge', 'custom-script']);
export type EvaluatorType = z.infer<typeof EvaluatorTypeSchema>;

const ScoreInUnitInterval = z
  .number()
  .min(0, { message: 'score must be >= 0' })
  .max(1, { message: 'score must be <= 1' });

/**
 * Workflow-level pass threshold used when a config sets neither a workflow-level
 * threshold nor any legacy per-evaluator thresholds to derive one from.
 */
export const DEFAULT_PASS_THRESHOLD = 0.7;

/**
 * Description shared by the legacy per-evaluator `passThreshold` fields. Pass/fail
 * now uses the single workflow-level threshold; this value is retained only so
 * configs authored before that change keep their original run gate (see
 * `resolveWorkflowPassThreshold`).
 */
const LEGACY_EVALUATOR_THRESHOLD_DESCRIPTION =
  'Legacy per-evaluator pass threshold. Pass/fail now uses the single workflow-level pass threshold; this is read only to preserve the run gate of configs authored before the single-threshold model.';

/** Minimum prompt-extension length for an `llm-judge` evaluator. Below this
 *  the prompt has no useful criteria and the LLM invents its own rubric. */
export const LLM_JUDGE_PROMPT_MIN_LENGTH = 10;

// ------- exact-diff config -------

const LEGACY_EXACT_DIFF_COMPARISON_KEYS = [
  'paths',
  'unorderedPaths',
  'numericTolerance',
  'allowExtraFields',
] as const;

const UnorderedArrayPathSchema = z
  .string()
  .trim()
  .min(1)
  .regex(
    /^[^.[\]\s]+(?:(?:\[\])?\.[^.[\]\s]+)*$/,
    'must name the array field itself with dot-path syntax such as `subjects` or `groups[].members` (not `subjects[]`); numeric indexes are not supported'
  );

export const ExactDiffRulePathSchema = z
  .string()
  .trim()
  .min(1)
  .regex(
    /^(\$|(?:[^.[\]\s$]+)(?:\[\])?(?:\.(?:[^.[\]\s$]+)(?:\[\])?)*)$/,
    'must be `$` or a dot-path such as `total`, `lineItems`, `lineItems[]`, or `lineItems[].unitPrice` (numeric indexes are not allowed)'
  );

export const ExactDiffArrayItemsSchema = z.enum(['at-least', 'at-most', 'exactly']);

export const ExactDiffMatchByPathSchema = z
  .string()
  .trim()
  .min(1)
  .regex(
    /^[^.[\]\s$,]+(?:\.[^.[\]\s$,]+)*$/,
    'must be a relative object field path such as `sku` or `meta.sku` (array indexes, commas, and wildcards are not supported)'
  );

export const ExactDiffMatchBySchema = z
  .union([ExactDiffMatchByPathSchema, z.array(ExactDiffMatchByPathSchema).min(1)])
  .superRefine((value, ctx) => {
    if (!Array.isArray(value)) return;
    const seen = new Set<string>();
    for (let index = 0; index < value.length; index++) {
      const path = value[index]!;
      if (seen.has(path)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index],
          message: 'matchBy paths must be unique',
        });
      }
      seen.add(path);
    }
  });

export const ExactDiffPathRuleSchema = z
  .object({
    order: z
      .enum(['ordered', 'unordered'])
      .optional()
      .describe(
        `Array matching mode at this path. Independent of \`items\`. Set on the array path (\`lineItems\`), not the item path (\`lineItems[]\`). \`unordered\` matches distinct items in any order. Arrays stay ordered when omitted. Unordered matching is limited to ${MAX_UNORDERED_ARRAY_ITEMS} items, ${MAX_UNORDERED_PAIR_COMPARISONS} candidate pairs, and ${MAX_UNORDERED_COMPARISON_OPERATIONS} recursive operations per comparison.`
      ),
    items: ExactDiffArrayItemsSchema.optional().describe(
      'How expected and actual array items relate. Set on the array path (`lineItems`), not the item path (`lineItems[]`). Independent of `order`. Ordered arrays use positional prefix matching: `at-least` (default) requires expected to match actual from index 0 and allows trailing actual extras; `at-most` requires actual to match expected from index 0 and allows trailing expected extras; `exactly` is equal-cardinality positional comparison. Unordered arrays match distinct items in any order: `at-least` requires every expected item and allows extra actual items (including extras with missing or duplicate identities); `at-most` requires every actual item and allows missing expected items (every actual item being checked needs a valid unique identity); `exactly` is a bijection (both sides need valid unique identities).'
    ),
    matchBy: ExactDiffMatchBySchema.optional().describe(
      "Identity fields for unordered arrays of objects. Requires `order: unordered` on the same rule. Set on the array path (`lineItems`), not the item path (`lineItems[]`). A relative path (`sku`) or unique paths (`[country, sku]`) inside each item. Pairs expected and actual objects by exact identity, then diffs the paired objects with inherited nested rules. Identity type and value must both match: numeric `10` differs from string `'10'`; no coercion or numeric tolerance. Omitted = structural matching. Applies only at the array path where it is set and is not inherited by descendants. Nested object fields are allowed; array indexes, commas, and wildcards are not. Empty or comma-only values are rejected; composite paths must be unique."
    ),
    allowExtraFields: z
      .boolean()
      .optional()
      .describe(
        'When false, extra actual keys at this object fail the diff. When omitted, extra keys are allowed. Applies only to objects.'
      ),
    numericTolerance: z
      .number()
      .min(0)
      .optional()
      .describe(
        'Maximum absolute difference for numeric leaves at or under this path. Omitted = inherit, then historical relative epsilon. Explicit `0` is exact.'
      ),
  })
  .strict()
  .superRefine((rule, ctx) => {
    if (rule.matchBy === undefined) return;
    if (rule.order !== 'unordered') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['matchBy'],
        message: 'matchBy requires `order: unordered` on the same rule',
      });
    }
  });

const MIXED_EXACT_DIFF_MESSAGE =
  'cannot mix `rules` with legacy comparison fields (`paths`, `unorderedPaths`, `numericTolerance`, `allowExtraFields`)';

export const ExactDiffConfigSchema = z
  .object({
    rules: z
      .record(z.string(), ExactDiffPathRuleSchema)
      .optional()
      .describe(
        'Per-path comparison rules. Keys select compared paths (`$` = full output). More-specific keys inherit then override parent rules. `{}` selects a path using inherited platform defaults. Do not mix with legacy `paths`, `unorderedPaths`, `numericTolerance`, or `allowExtraFields`.'
      ),
    numericTolerance: z
      .number()
      .min(0)
      .optional()
      .describe(
        'Legacy global numeric tolerance (absolute). When omitted, comparison uses historical relative epsilon. Prefer `rules.<path>.numericTolerance`. Accepted only when `rules` is omitted.'
      ),
    allowExtraFields: z
      .boolean()
      .optional()
      .describe(
        'Legacy global extra-field/extra-item flag. Prefer `rules.<path>.allowExtraFields` and `rules.<path>.items`. `true` normalizes to object extras allowed and array `items: at-least`; `false` normalizes to object extras rejected and array `items: exactly`. Accepted only when `rules` is omitted.'
      ),
    passThreshold: ScoreInUnitInterval.optional().describe(LEGACY_EVALUATOR_THRESHOLD_DESCRIPTION),
    paths: z
      .array(z.string().min(1))
      .optional()
      .describe(
        'Legacy scoped paths. Prefer selecting those paths as `rules` keys. Syntax: `header.id`, `lineItems[].total`, `lineItems[0].sku`.'
      ),
    unorderedPaths: z
      .array(UnorderedArrayPathSchema)
      .optional()
      .describe(
        'Legacy unordered array paths. Prefer `rules.<path>.order: unordered`. Name the array field itself (`subjects`, not `subjects[]`).'
      ),
  })
  .superRefine((config, ctx) => {
    const hasRules = config.rules !== undefined;
    const mixedLegacy = LEGACY_EXACT_DIFF_COMPARISON_KEYS.filter(
      (key) => config[key] !== undefined
    );
    if (hasRules && mixedLegacy.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rules'],
        message: MIXED_EXACT_DIFF_MESSAGE,
      });
    }
    for (const [path, rule] of Object.entries(config.rules ?? {})) {
      const parsed = ExactDiffRulePathSchema.safeParse(path);
      if (!parsed.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['rules', path],
          message:
            parsed.error.issues[0]?.message ??
            'must be `$` or a dot-path such as `total`, `lineItems`, `lineItems[]`, or `lineItems[].unitPrice` (numeric indexes are not allowed)',
        });
        continue;
      }
      if (!path.endsWith('[]')) continue;
      const arrayPath = path.slice(0, -2);
      const itemScopeMessage = (field: string) =>
        `\`${field}\` belongs on the array path (\`${arrayPath}\`), not the item path (\`${path}\`); \`${path}\` is item scope`;
      if (rule.order !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['rules', path, 'order'],
          message: itemScopeMessage('order'),
        });
      }
      if (rule.items !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['rules', path, 'items'],
          message: itemScopeMessage('items'),
        });
      }
      if (rule.matchBy !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['rules', path, 'matchBy'],
          message: itemScopeMessage('matchBy'),
        });
      }
    }
  })
  .default({});
export type ExactDiffConfig = z.infer<typeof ExactDiffConfigSchema>;

export interface NormalizedExactDiffConfig {
  rules: ExactDiffRules;
  /** Compared roots, or `null` when `$` / empty rules means the full output. */
  scopedPaths: string[] | null;
  passThreshold?: number;
}

function legacyUnorderedPathApplies(unorderedPath: string, selected: readonly string[]): boolean {
  if (selected.includes('$')) return true;
  return selected.some((path) => {
    if (path === unorderedPath) return true;
    // Narrow leaf scopes such as `lineItems[].sku` project fixed indexes before
    // comparison, so ancestor unordered array mode does not apply at runtime.
    if (evalPathIsDescendant(path, unorderedPath) && path.includes('[]')) return false;
    return evalPathIsDescendant(path, unorderedPath) || evalPathIsDescendant(unorderedPath, path);
  });
}

function legacyExactDiffToRules(config: ExactDiffConfig): ExactDiffRules {
  const numericTolerance = config.numericTolerance ?? DEFAULT_EXACT_DIFF_NUMERIC_TOLERANCE;
  const allowExtra = config.allowExtraFields ?? true;
  const base: ExactDiffPathRule = {
    numericTolerance,
    allowExtraFields: allowExtra,
    items: allowExtra ? 'at-least' : 'exactly',
  };
  const selected = config.paths && config.paths.length > 0 ? config.paths : ['$'];
  const rules: Record<string, ExactDiffPathRule> = {};
  for (const path of selected) {
    rules[path] = { ...base };
  }
  for (const unorderedPath of config.unorderedPaths ?? []) {
    if (!legacyUnorderedPathApplies(unorderedPath, selected)) continue;
    rules[unorderedPath] = { ...base, ...rules[unorderedPath], order: 'unordered' };
  }
  return rules;
}

/**
 * Translate parsed exact-diff config into the rules used at comparison time.
 * Legacy globals become an equivalent `$` / path rule set; `rules` is passed through.
 */
export function normalizeExactDiffConfig(config: ExactDiffConfig): NormalizedExactDiffConfig {
  const rules = config.rules !== undefined ? config.rules : legacyExactDiffToRules(config);
  const scopedPaths =
    config.rules !== undefined
      ? selectExactDiffRulePaths(rules)
      : config.paths && config.paths.length > 0
        ? config.paths
        : null;
  return {
    rules,
    scopedPaths,
    ...(typeof config.passThreshold === 'number' ? { passThreshold: config.passThreshold } : {}),
  };
}

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
    passThreshold: ScoreInUnitInterval.optional().describe(LEGACY_EVALUATOR_THRESHOLD_DESCRIPTION),
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
  expected: "the example's expected-output envelope (`{ data: ... }`)",
  actual: 'the workflow result envelope (`{ data: ..., files?: ... }`)',
  returns: 'a number in [0, 1] (the `: number` annotation is required)',
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
  `Full TypeScript source for optional \`type\` aliases plus \`function scoreScript(expected, actual): number { ... }\`. ` +
  `Receives \`expected\` (${CUSTOM_SCRIPT_CONTRACT.expected}) ` +
  `and \`actual\` (${CUSTOM_SCRIPT_CONTRACT.actual}), returns ${CUSTOM_SCRIPT_CONTRACT.returns}. ` +
  `The \`: number\` return-type annotation is required and enforced at parse time. ` +
  `Throws are ${CUSTOM_SCRIPT_CONTRACT.throws}.`;

export const CustomScriptConfigSchema = z.object({
  // Stored as the full typed score source: optional type aliases plus
  // `function scoreScript(expected, actual): number { ... }`. Compiled via
  // the shared `compileTypedScript({ kind: 'evaluator' })` pipeline — same
  // module the worker uses at runtime, so push-time and run-time enforcement
  // are byte-identical. Wrong name, wrong params, missing or non-`number`
  // return annotation, async/import/require, all rejected here.
  function: z
    .string()
    .min(1, { message: 'required' })
    .max(CUSTOM_SCRIPT_MAX_BYTES, {
      message: `must be ≤ ${CUSTOM_SCRIPT_MAX_BYTES} bytes`,
    })
    .describe(CUSTOM_SCRIPT_FUNCTION_DESCRIPTION)
    .superRefine((fn, ctx) => {
      const result = compileTypedScript({ kind: 'evaluator', source: fn });
      if (result.ok) return;
      for (const issue of result.issues) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: issue.message });
      }
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
      'Maximum wall-clock time the script can run before it is killed and the run is marked failed.'
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
  passThreshold: ScoreInUnitInterval.optional().describe(LEGACY_EVALUATOR_THRESHOLD_DESCRIPTION),
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
   * Single workflow-level pass threshold in [0, 1] and the source of truth for
   * pass/fail across the worker and the dashboards: a run passes when its
   * weighted-mean score across evaluators clears this number, and every
   * evaluator's own pass display is decided against it too. Optional on disk —
   * when omitted, `resolveWorkflowPassThreshold` derives it (preserving the run
   * gate of older per-evaluator configs), so always resolve through that helper
   * rather than reading this field directly.
   */
  passThreshold: ScoreInUnitInterval.optional(),
});
export type EvalConfigYaml = z.infer<typeof EvalConfigYamlSchema>;

/**
 * Resolve the single workflow-level pass threshold that governs both the
 * run-level gate and every evaluator's pass display.
 *
 *   1. An explicit workflow-level `passThreshold` always wins.
 *   2. Otherwise, for configs authored before the single-threshold model (which
 *      baked a `passThreshold` on every evaluator but never a workflow-level
 *      one), derive the weighted mean of those per-evaluator thresholds — this
 *      preserves the exact run gate those configs ran under, with no migration.
 *   3. Otherwise fall back to {@link DEFAULT_PASS_THRESHOLD}.
 *
 * This is the one place "what is the pass threshold" is decided, so the worker,
 * the dashboards, and the API all agree on a single number.
 */
export function resolveWorkflowPassThreshold(config: {
  passThreshold?: number | null;
  evaluators: ReadonlyArray<{ weight?: number; config: { passThreshold?: number | null } }>;
}): number {
  if (typeof config.passThreshold === 'number') return config.passThreshold;
  let weightedSum = 0;
  let totalWeight = 0;
  for (const evaluator of config.evaluators) {
    const threshold = evaluator.config?.passThreshold;
    const weight = evaluator.weight ?? 1;
    if (typeof threshold === 'number' && weight > 0) {
      weightedSum += threshold * weight;
      totalWeight += weight;
    }
  }
  return totalWeight > 0 ? weightedSum / totalWeight : DEFAULT_PASS_THRESHOLD;
}

// ------- evaluator result (what evaluators return; what the dispatcher persists) -------

export const EvaluatorResultSchema = z.object({
  // Null means the evaluator was not applicable for this example and should
  // not contribute to weighted aggregate scoring.
  score: ScoreInUnitInterval.nullable(),
  passed: z.boolean().nullable(),
  label: z.string().optional(),
  details: z.unknown(),
});
export type EvaluatorResult = z.infer<typeof EvaluatorResultSchema>;

/**
 * Weighted mean of scores, skipping weight-zero and null-score entries from the denominator.
 * Returns null if there are no contributing evaluators.
 */
export function combineEvalScores(
  results: Array<{ score: number | null; weight: number }>
): number | null {
  let numerator = 0;
  let denominator = 0;
  for (const r of results) {
    if (r.weight <= 0 || r.score === null) continue;
    numerator += r.score * r.weight;
    denominator += r.weight;
  }
  if (denominator === 0) return null;
  return numerator / denominator;
}
