import { z } from 'zod';

/**
 * Workflow execution status constants for comparisons
 * Use these instead of hardcoded strings: WorkflowExecutionStatusValue.RUNNING
 */
export const WorkflowExecutionStatusValue = {
  CREATED: 'created',
  PENDING: 'pending',
  RUNNING: 'running',
  WAITING: 'waiting',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const;

/**
 * Workflow execution status schema.
 * Matches the database schema in packages/db/src/schema/workflow.ts
 */
export const WorkflowExecutionStatusSchema = z.enum([
  WorkflowExecutionStatusValue.CREATED, // Row exists, files uploading; not yet enqueued
  WorkflowExecutionStatusValue.PENDING, // Waiting to be picked up by a worker
  WorkflowExecutionStatusValue.RUNNING, // Currently being processed
  WorkflowExecutionStatusValue.WAITING, // Waiting (e.g., awaiting approval)
  WorkflowExecutionStatusValue.COMPLETED, // Successfully finished
  WorkflowExecutionStatusValue.FAILED, // Failed with error
  WorkflowExecutionStatusValue.CANCELLED, // Manually cancelled
]);
export type WorkflowExecutionStatus = z.infer<typeof WorkflowExecutionStatusSchema>;

/**
 * Step execution status constants for comparisons
 * Use these instead of hardcoded strings: StepExecutionStatusValue.SUCCESS
 */
export const StepExecutionStatusValue = {
  PENDING: 'pending',
  RUNNING: 'running',
  SUCCESS: 'success',
  FAILURE: 'failure',
  WAITING: 'waiting',
  SKIPPED: 'skipped',
} as const;

/**
 * Step execution status values.
 * Matches the database schema in packages/db/src/schema/workflow.ts
 */
export const StepExecutionStatusSchema = z.enum([
  StepExecutionStatusValue.PENDING, // Not yet started
  StepExecutionStatusValue.RUNNING, // Currently executing
  StepExecutionStatusValue.SUCCESS, // Completed successfully
  StepExecutionStatusValue.FAILURE, // Failed with error
  StepExecutionStatusValue.WAITING, // Waiting (e.g., approval)
  StepExecutionStatusValue.SKIPPED, // Skipped (e.g., condition false)
]);
export type StepExecutionStatus = z.infer<typeof StepExecutionStatusSchema>;

/**
 * Trigger type constants - how a workflow is invoked
 */
export const TriggerTypeValue = {
  MANUAL: 'manual',
  API: 'api',
  WEBHOOK: 'webhook',
  SCHEDULE: 'schedule',
  EMAIL: 'email',
  EVAL: 'eval',
  CLI: 'cli',
} as const;

/**
 * Trigger type schema - how workflows are triggered
 */
export const TriggerTypeSchema = z.enum([
  TriggerTypeValue.MANUAL,
  TriggerTypeValue.API,
  TriggerTypeValue.WEBHOOK,
  TriggerTypeValue.SCHEDULE,
  TriggerTypeValue.EMAIL,
  TriggerTypeValue.EVAL,
  TriggerTypeValue.CLI,
]);
export type TriggerType = z.infer<typeof TriggerTypeSchema>;

/**
 * Execution type constants - execution mode/context
 */
export const ExecutionTypeValue = {
  PROD: 'prod',
  EVAL: 'eval',
  PLAYGROUND: 'playground',
} as const;

/**
 * Execution type - determines execution context and visibility.
 * - prod: Production executions
 * - eval: Evaluation/testing executions
 * - playground: Development/testing executions in the UI
 */
export const ExecutionTypeSchema = z.enum([
  ExecutionTypeValue.PROD,
  ExecutionTypeValue.EVAL,
  ExecutionTypeValue.PLAYGROUND,
]);
export type ExecutionType = z.infer<typeof ExecutionTypeSchema>;

/**
 * Array of all statuses for iteration/UI rendering.
 *
 * Drizzle's `text(..., { enum })` wants a non-empty tuple `[T, ...T[]]`; v4's
 * `ZodEnum.options` is `T[]`. `asTuple` narrows the type at zero runtime cost.
 */
function asTuple<T>(values: readonly T[]): [T, ...T[]] {
  return values as [T, ...T[]];
}

export const WORKFLOW_EXECUTION_STATUSES = asTuple(WorkflowExecutionStatusSchema.options);
export const STEP_EXECUTION_STATUSES = asTuple(StepExecutionStatusSchema.options);
export const TRIGGER_TYPES = TriggerTypeSchema.options;
export const EXECUTION_TYPES = ExecutionTypeSchema.options;
