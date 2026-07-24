import { z } from 'zod';
import { StepRetryPolicySchema } from './retry';

/**
 * Compound step types - format: "category.operation"
 *
 * Categories:
 * - ai.*       - AI-powered operations
 * - transform.* - Deterministic data manipulation
 * - action.*    - External service integrations
 * - control.*   - Workflow control flow
 */

// AI step types
export const AI_STEP_TYPES = [
  'ai.parse',
  'ai.extract',
  'ai.split',
  'ai.segment',
  'ai.classify',
  'ai.classify-pages',
  'ai.vision',
] as const;

// Transform step types
export const TRANSFORM_STEP_TYPES = [
  'transform.set',
  'transform.remove',
  'transform.combine',
  'transform.split',
  'transform.merge',
  'transform.template',
  'transform.pdf-embed',
  'transform.xlsx-to-json',
  'transform.script',
  'transform.text-chunker',
  'transform.regex-extract',
] as const;

// Action step types
export const ACTION_STEP_TYPES = [
  'action.http',
  'action.invoke-workflow',
  'action.website-reader',
] as const;

// Control step types
export const CONTROL_STEP_TYPES = [
  'control.if',
  'control.switch',
  'control.foreach',
  'control.parallel',
  'control.parallel_map',
  'control.wait',
  'control.fail',
] as const;

// All step types combined
export const STEP_TYPES = [
  ...AI_STEP_TYPES,
  ...TRANSFORM_STEP_TYPES,
  ...ACTION_STEP_TYPES,
  ...CONTROL_STEP_TYPES,
] as const;

export type StepType = (typeof STEP_TYPES)[number];

/**
 * Step type value constants for type-safe comparisons
 */
export const StepTypeValue = {
  // AI
  AI_PARSE: 'ai.parse',
  AI_EXTRACT: 'ai.extract',
  AI_SPLIT: 'ai.split',
  AI_SEGMENT: 'ai.segment',
  AI_CLASSIFY: 'ai.classify',
  AI_CLASSIFY_PAGES: 'ai.classify-pages',
  AI_VISION: 'ai.vision',
  // Transform
  TRANSFORM_SET: 'transform.set',
  TRANSFORM_REMOVE: 'transform.remove',
  TRANSFORM_COMBINE: 'transform.combine',
  TRANSFORM_SPLIT: 'transform.split',
  TRANSFORM_MERGE: 'transform.merge',
  TRANSFORM_TEMPLATE: 'transform.template',
  TRANSFORM_PDF_EMBED: 'transform.pdf-embed',
  TRANSFORM_XLSX_TO_JSON: 'transform.xlsx-to-json',
  TRANSFORM_SCRIPT: 'transform.script',
  TRANSFORM_TEXT_CHUNKER: 'transform.text-chunker',
  TRANSFORM_REGEX_EXTRACT: 'transform.regex-extract',
  // Action
  ACTION_HTTP: 'action.http',
  ACTION_INVOKE_WORKFLOW: 'action.invoke-workflow',
  ACTION_WEBSITE_READER: 'action.website-reader',
  // Control
  CONTROL_IF: 'control.if',
  CONTROL_SWITCH: 'control.switch',
  CONTROL_FOREACH: 'control.foreach',
  CONTROL_PARALLEL: 'control.parallel',
  CONTROL_PARALLEL_MAP: 'control.parallel_map',
  CONTROL_WAIT: 'control.wait',
  CONTROL_FAIL: 'control.fail',
} as const;

/**
 * Step type schema for validation
 */
export const StepTypeSchema = z.enum(STEP_TYPES);

/**
 * Base step properties shared by all step types
 */
const BaseStepSchema = z
  .object({
    /** Step type in format "category.operation" */
    type: StepTypeSchema,
    /** Unique step name within the workflow */
    name: z.string().min(1),
    /** Optional human-readable description of what this step does */
    description: z.string().optional(),
    /** Optional condition - step runs only if this evaluates to true */
    if: z.string().optional(),
    /** Step timeout in milliseconds */
    timeout: z.number().positive().optional(),
    /** Retry policy for this executable leaf step. Omit to inherit workflow defaults. */
    retry: StepRetryPolicySchema.optional(),
    /** @deprecated Parsed for compatibility; no longer drives execution. */
    retries: z.number().int().min(0).optional(),
    /** @deprecated Parsed for compatibility; no longer drives execution. */
    retryDelay: z.number().positive().optional(),
    /** Step configuration with template expressions */
    with: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const ControlContainerBaseStepSchema = BaseStepSchema.omit({ retry: true });

/**
 * AI step - AI-powered operations
 */
export const AIStepSchema = BaseStepSchema.extend({
  type: z.enum(AI_STEP_TYPES),
});
export type AIStep = z.infer<typeof AIStepSchema>;

/**
 * Transform step - data manipulation
 */
export const TransformStepSchema = BaseStepSchema.extend({
  type: z.enum(TRANSFORM_STEP_TYPES),
});
export type TransformStep = z.infer<typeof TransformStepSchema>;

/**
 * HTTP method for action steps
 */
export const HttpMethodSchema = z.enum(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);
export type HttpMethod = z.infer<typeof HttpMethodSchema>;

/**
 * Action step - external service integrations
 */
export const ActionStepSchema = BaseStepSchema.extend({
  type: z.enum(ACTION_STEP_TYPES),
});
export type ActionStep = z.infer<typeof ActionStepSchema>;

/**
 * Wait step - pause for duration
 */
export const WaitStepSchema = BaseStepSchema.extend({
  type: z.literal('control.wait'),
  /** Duration in milliseconds */
  duration: z.number().positive().optional(),
});
export type WaitStep = z.infer<typeof WaitStepSchema>;

/**
 * Fail step - terminate the workflow with a typed status code and message.
 *
 * Config is step-level (not in `step.with`), matching every other
 * `control.*` step: `condition` / `statusCode` / `message` live directly on
 * the step node. When `condition` is set, the step only fails if the
 * LiquidJS expression evaluates truthy. When omitted, the step always
 * fails when reached. The worker throws `WorkflowFailedError`; the executor
 * catches it and persists `JSON.stringify({code, message, step})` in
 * `executions.error`.
 */
export const FailStepSchema = BaseStepSchema.extend({
  type: z.literal('control.fail'),
  /** Optional template expression that gates the fail. Empty = always fail. */
  condition: z.string().optional(),
  /** HTTP-style status code returned to callers. Defaults to 422. */
  statusCode: z.number().int().min(400).max(599).optional(),
  /** Human-readable failure message. Supports template expressions. */
  message: z.string().min(1),
});
export type FailStep = z.infer<typeof FailStepSchema>;

/**
 * Step type - discriminated union of all step types
 * Note: Control flow steps (if, parallel, foreach) use nested steps arrays
 * which require lazy evaluation for recursive types.
 */
export type Step =
  | AIStep
  | TransformStep
  | ActionStep
  | WaitStep
  | FailStep
  | IfStep
  | SwitchStep
  | ParallelStep
  | ForeachStep
  | ParallelMapStep
  | LegacyBlockStep;

/**
 * If/else control flow step
 */
export interface IfStep {
  type: 'control.if';
  name: string;
  /** Optional human-readable description of what this step does */
  description?: string;
  if?: string;
  timeout?: number;
  with?: Record<string, unknown>;
  /** Condition expression (LiquidJS) */
  condition: string;
  /** Steps to execute if condition is true */
  then: Step[];
  /** Steps to execute if condition is false */
  else?: Step[];
}

/**
 * Switch control flow step — multi-way routing.
 *
 * Resolves `on` to a value and runs the first case whose `when` equals it
 * (string-compared), else `default`. The matched branch's last step output is
 * exposed as `result`, mirroring control.if. Cleaner than a nested control.if
 * chain for routing an item to one of N pipelines by a discriminator field.
 */
export interface SwitchCase {
  /** Value matched (string-compared) against the resolved `on` expression. */
  when: string | number | boolean;
  /** Steps to run when this case matches. */
  steps: Step[];
}
export interface SwitchStep {
  type: 'control.switch';
  name: string;
  description?: string;
  if?: string;
  timeout?: number;
  with?: Record<string, unknown>;
  /** Template expression whose resolved value selects the case, e.g. "{{ doc.type }}". */
  on: string;
  cases: SwitchCase[];
  /** Steps to run when no case matches. */
  default?: Step[];
}

/**
 * Parallel branch definition
 */
export interface ParallelBranch {
  name: string;
  steps: Step[];
}

/**
 * Parallel execution step
 */
export interface ParallelStep {
  type: 'control.parallel';
  name: string;
  /** Optional human-readable description of what this step does */
  description?: string;
  if?: string;
  timeout?: number;
  with?: Record<string, unknown>;
  /** Named branches to execute concurrently */
  branches: ParallelBranch[];
}

/**
 * Foreach iteration step
 */
export interface ForeachStep {
  type: 'control.foreach';
  name: string;
  /** Optional human-readable description of what this step does */
  description?: string;
  if?: string;
  timeout?: number;
  with?: Record<string, unknown>;
  /** Expression returning array to iterate */
  items: string;
  /** Variable name for current item */
  as: string;
  /** Variable name for current index */
  indexAs?: string;
  /** Steps to execute for each item */
  steps: Step[];
}

/**
 * Parallel map step - concurrent iteration with limited parallelism
 * Combines foreach iteration with p-limit style concurrency control
 */
export interface ParallelMapStep {
  type: 'control.parallel_map';
  name: string;
  /** Optional human-readable description of what this step does */
  description?: string;
  if?: string;
  timeout?: number;
  with?: Record<string, unknown>;
  /** Expression returning array to iterate */
  items: string;
  /** Variable name for current item */
  as: string;
  /** Variable name for current index */
  indexAs?: string;
  /** Maximum concurrent executions (1-50, default 5) */
  concurrency?: number;
  /** Steps to execute for each item */
  steps: Step[];
}

/**
 * @deprecated Removed — use `action.invoke-workflow` with `execution: inline`.
 * Retained only for in-flight definition snapshots until the compatibility shim is removed.
 */
export interface LegacyBlockStep {
  type: 'control.block';
  name: string;
  description?: string;
  if?: string;
  timeout?: number;
  retries?: number;
  retryDelay?: number;
  with?: Record<string, unknown>;
  blockName: string;
  inputs?: Record<string, unknown>;
}

// Schema for legacy block step (parse-only for in-flight snapshots)
const LegacyBlockStepSchemaInner = BaseStepSchema.extend({
  type: z.literal('control.block'),
  retries: z.number().int().min(0).optional(),
  retryDelay: z.number().positive().optional(),
  blockName: z.string().min(1),
  inputs: z.record(z.string(), z.unknown()).optional(),
});

// Schema for if step
const IfStepSchemaInner = ControlContainerBaseStepSchema.extend({
  type: z.literal('control.if'),
  condition: z.string(),
  then: z.lazy((): z.ZodType<Step[]> => z.array(StepSchema)),
  else: z.lazy((): z.ZodType<Step[]> => z.array(StepSchema)).optional(),
});

// Schema for switch step
const SwitchCaseSchemaInner = z.object({
  when: z.union([z.string(), z.number(), z.boolean()]),
  steps: z.lazy((): z.ZodType<Step[]> => z.array(StepSchema)),
});
const SwitchStepSchemaInner = ControlContainerBaseStepSchema.extend({
  type: z.literal('control.switch'),
  on: z.string(),
  cases: z.array(SwitchCaseSchemaInner),
  default: z.lazy((): z.ZodType<Step[]> => z.array(StepSchema)).optional(),
});

// Schema for parallel branch
const ParallelBranchSchemaInner = z.object({
  name: z.string().min(1),
  steps: z.lazy((): z.ZodType<Step[]> => z.array(StepSchema)),
});

// Schema for parallel step
const ParallelStepSchemaInner = ControlContainerBaseStepSchema.extend({
  type: z.literal('control.parallel'),
  branches: z.array(ParallelBranchSchemaInner),
});

// Schema for foreach step
const ForeachStepSchemaInner = ControlContainerBaseStepSchema.extend({
  type: z.literal('control.foreach'),
  items: z.string(),
  as: z.string(),
  indexAs: z.string().optional(),
  steps: z.lazy((): z.ZodType<Step[]> => z.array(StepSchema)),
});

// Schema for parallel_map step
const ParallelMapStepSchemaInner = ControlContainerBaseStepSchema.extend({
  type: z.literal('control.parallel_map'),
  items: z.string(),
  as: z.string(),
  indexAs: z.string().optional(),
  concurrency: z.number().int().min(1).max(50).default(5).optional(),
  steps: z.lazy((): z.ZodType<Step[]> => z.array(StepSchema)),
});

/**
 * Zod schema for Step (with lazy evaluation for recursion)
 * Use this for parsing/validation. The type Step is the inferred type.
 */
export const StepSchema: z.ZodType<Step> = z.lazy(() =>
  z.union([
    AIStepSchema,
    TransformStepSchema,
    ActionStepSchema,
    WaitStepSchema,
    FailStepSchema,
    LegacyBlockStepSchemaInner,
    IfStepSchemaInner,
    SwitchStepSchemaInner,
    ParallelStepSchemaInner,
    ForeachStepSchemaInner,
    ParallelMapStepSchemaInner,
  ])
) as z.ZodType<Step>;

// Re-export schemas for the control flow steps (for external use)
export const LegacyBlockStepSchema = LegacyBlockStepSchemaInner;
export const IfStepSchema = IfStepSchemaInner;
export const SwitchStepSchema = SwitchStepSchemaInner;
export const ParallelBranchSchema = ParallelBranchSchemaInner;
export const ParallelStepSchema = ParallelStepSchemaInner;
export const ForeachStepSchema = ForeachStepSchemaInner;
export const ParallelMapStepSchema = ParallelMapStepSchemaInner;

/**
 * Parse step type into category and operation
 */
export function parseStepType(type: string): { category: string; operation: string } {
  const [category, operation] = type.split('.');
  return { category, operation };
}

/**
 * Check if step type is in a category
 */
export function isStepCategory(
  type: string,
  category: 'ai' | 'transform' | 'action' | 'control'
): boolean {
  return type.startsWith(`${category}.`);
}
