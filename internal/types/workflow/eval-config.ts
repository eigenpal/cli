import { z } from 'zod';

/** Judge model options. */
export const JUDGE_MODEL_IDS = ['gpt-4o', 'gpt-4o-mini', 'gpt-5.2'] as const;
export type JudgeModelId = (typeof JUDGE_MODEL_IDS)[number];

export const JudgeModelSchema = z.enum(JUDGE_MODEL_IDS);
const DEFAULT_JUDGE_MODEL: JudgeModelId = 'gpt-5.2';
export const DEFAULT_CONCURRENCY = 3;

const ConcurrencySchema = z.union([
  z.number().int().min(1),
  z.object({
    executions: z.number().int().min(1),
    judge: z.number().int().min(1),
  }),
]);

const JudgeConfigSchema = z.object({
  /** Instructions for the LLM judge when comparing expected vs actual output. */
  prompt: z.string().default(''),
  /** Model for judge (same options as chatbot). */
  model: JudgeModelSchema.default(DEFAULT_JUDGE_MODEL),
  /** When true, run LLM judge after all example executions (eval). */
  run: z.boolean().default(true),
});

/** Permissive judge config for form: model is any string so invalid DB values are preserved. */
const JudgeConfigFormSchema = z.object({
  prompt: z.string().default(''),
  model: z.string().default(DEFAULT_JUDGE_MODEL),
  run: z.boolean().default(true),
});

/**
 * Schema for workflow-level eval config (eval/index.yaml).
 * Used by the app UI and CLI; synced via push/pull.
 * All fields have defaults so partial or empty config is valid.
 * Invalid input throws ZodError; caller should return 400 with error details.
 */
export const EvalConfigSchema = z.object({
  /** Concurrency: number (same for executions and judge) or { executions, judge }. */
  concurrency: ConcurrencySchema.default(DEFAULT_CONCURRENCY),
  /** Judge settings (prompt, model, run). */
  judge: JudgeConfigSchema.prefault({}),
  /** Step names to pre-check as overrides when adding eval rows from the UI. */
  defaultOverrides: z.array(z.string()).default([]),
});

export type EvalConfig = z.infer<typeof EvalConfigSchema>;

/** Form state: same as EvalConfig but judge.model can be any string (invalid from DB preserved). */
const EvalConfigFormSchema = z.object({
  concurrency: ConcurrencySchema.default(DEFAULT_CONCURRENCY),
  judge: JudgeConfigFormSchema.prefault({}),
  defaultOverrides: z.array(z.string()).default([]),
});
export type EvalConfigForm = z.infer<typeof EvalConfigFormSchema>;

/** Parse raw eval config (e.g. from YAML). Throws ZodError on invalid input. */
export function parseEvalConfig(raw: unknown): EvalConfig {
  return EvalConfigSchema.parse(raw ?? {});
}

/** Parse for form: never fails on judge.model, so invalid values from DB are preserved. */
export function parseEvalConfigForForm(raw: unknown): EvalConfigForm {
  return EvalConfigFormSchema.parse(raw ?? {});
}

/** Returns true if model is one of the allowed judge model IDs. */
export function isValidJudgeModel(model: string): model is JudgeModelId {
  return JUDGE_MODEL_IDS.includes(model as JudgeModelId);
}

/** Normalized concurrency: always { executions, judge }. */
export type ConcurrencyResolved = { executions: number; judge: number };

const MAX_CONCURRENCY = 50;

export function resolveConcurrency(
  value: z.infer<typeof ConcurrencySchema> | undefined,
  defaultNum: number
): ConcurrencyResolved {
  const clamp = (n: number) => Math.min(MAX_CONCURRENCY, Math.max(1, n));
  if (value == null) {
    const d = clamp(defaultNum);
    return { executions: d, judge: d };
  }
  if (typeof value === 'number') {
    const d = clamp(value);
    return { executions: d, judge: d };
  }
  return {
    executions: clamp(value.executions ?? defaultNum),
    judge: clamp(value.judge ?? defaultNum),
  };
}

/** Keys of EvalConfig that are defined in the schema (for form iteration). */
export const EVAL_CONFIG_FORM_KEYS = ['judge'] as const satisfies ReadonlyArray<
  keyof z.infer<typeof EvalConfigSchema>
>;

/** Field metadata for the eval config form (label + description). */
export const EVAL_CONFIG_FIELD_DEFINITIONS: Record<
  (typeof EVAL_CONFIG_FORM_KEYS)[number],
  { label: string; description: string }
> = {
  judge: {
    label: 'AI review',
    description:
      'Optional automated check: an AI compares each run to the expected result using your instructions.',
  },
};
