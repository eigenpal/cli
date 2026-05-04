import { z } from 'zod';
import { TimestampSchema } from '../core/common';
import {
  StepExecutionStatusSchema as ProcessorStepExecutionStatusSchema,
  StepExecutionStatusValue as ProcessorStepExecutionStatusValue,
  WorkflowExecutionStatusSchema as ProcessorWorkflowExecutionStatusSchema,
  WorkflowExecutionStatusValue as ProcessorWorkflowExecutionStatusValue,
  type StepExecutionStatus as ProcessorStepExecutionStatus,
  type WorkflowExecutionStatus as ProcessorWorkflowExecutionStatus,
} from '../processor/execution';
import { WorkflowDefinitionSchema } from './workflow';

/**
 * Workflow execution status - re-exported from processor for consistency
 * Values: pending, running, waiting, completed, failed, cancelled
 */
export const WorkflowExecutionStatusSchema = ProcessorWorkflowExecutionStatusSchema;
export type WorkflowExecutionStatus = ProcessorWorkflowExecutionStatus;
export const WorkflowExecutionStatusValue = ProcessorWorkflowExecutionStatusValue;

/**
 * Step execution status - re-exported from processor for consistency
 * Values: pending, running, success, failure, waiting, skipped
 */
export const StepExecutionStatusSchema = ProcessorStepExecutionStatusSchema;
export type StepExecutionStatus = ProcessorStepExecutionStatus;
export const StepExecutionStatusValue = ProcessorStepExecutionStatusValue;

/**
 * Scope entry type - tracks nested execution context
 */
export const ScopeEntryTypeSchema = z.enum([
  'root',
  'if-then',
  'if-else',
  'parallel-branch',
  'foreach-iteration',
  'parallel-map-iteration',
  'block',
]);
export type ScopeEntryType = z.infer<typeof ScopeEntryTypeSchema>;

/**
 * Scope stack entry - one level of nesting
 */
export const ScopeEntrySchema = z.object({
  /** Scope type */
  type: ScopeEntryTypeSchema,
  /** Step name that created this scope */
  stepName: z.string(),
  /** For parallel: branch name */
  branchName: z.string().optional(),
  /** For foreach: iteration index */
  iterationIndex: z.number().optional(),
  /** For foreach: current item value */
  iterationItem: z.unknown().optional(),
  /** For foreach: custom variable name for item (from 'as' config) */
  itemVarName: z.string().optional(),
  /** For foreach: custom variable name for index (from 'indexAs' config) */
  indexVarName: z.string().optional(),
});
export type ScopeEntry = z.infer<typeof ScopeEntrySchema>;

/**
 * Scope stack - list of nested scopes
 */
export const ScopeStackSchema = z.array(ScopeEntrySchema);
export type ScopeStack = z.infer<typeof ScopeStackSchema>;

/**
 * Step result in context
 */
export const StepResultSchema = z.object({
  output: z.unknown(),
  status: StepExecutionStatusSchema,
});
export type StepResult = z.infer<typeof StepResultSchema>;

/**
 * Execution context - available to steps during execution
 */
export const ExecutionContextSchema = z.object({
  /** Original workflow input */
  input: z.record(z.string(), z.unknown()),
  /** Step outputs: { stepName: { output, status } } */
  steps: z.record(z.string(), StepResultSchema),
  /** Current scope stack */
  scope: ScopeStackSchema,
  /** For foreach: current item */
  item: z.unknown().optional(),
  /** For foreach: current index */
  index: z.number().optional(),
  /** Environment variables */
  env: z.record(z.string(), z.string()).optional(),
});
export type ExecutionContext = z.infer<typeof ExecutionContextSchema>;

/**
 * Minimal input reference stored per step execution
 * Contains references to available context, not full step outputs
 * Full step outputs can be retrieved from step_executions.outputData when needed
 */
export const StepInputReferenceSchema = z.object({
  /** Original workflow input */
  input: z.record(z.string(), z.unknown()),
  /** Step names that were available in context (not full outputs) */
  availableSteps: z.array(z.string()),
  /** Current scope stack */
  scope: ScopeStackSchema,
  /** For foreach: current item */
  item: z.unknown().optional(),
  /** For foreach: current index */
  index: z.number().optional(),
  /** Environment variables */
  env: z.record(z.string(), z.string()).optional(),
});
export type StepInputReference = z.infer<typeof StepInputReferenceSchema>;

/**
 * Workflow execution record
 */
export const WorkflowExecutionSchema = z.object({
  /** Execution ID */
  id: z.string(),
  /** Tenant ID */
  tenantId: z.string(),

  /** OTEL trace context */
  traceId: z.string().nullable(),
  spanId: z.string().nullable(),

  /** Reference to workflow definition */
  definitionId: z.string(),
  /** Frozen snapshot of definition at execution time */
  definitionSnapshot: WorkflowDefinitionSchema,

  /** Trigger type that started this execution */
  triggerType: z.string(),
  /** Input provided to the workflow */
  triggerInput: z.record(z.string(), z.unknown()).nullable(),
  /** Overrides from table row when execution is from a row: { steps: { [stepName]: outputObject } } */
  overrides: z
    .object({ steps: z.record(z.string(), z.record(z.string(), z.unknown())).optional() })
    .nullable()
    .optional(),

  /** Current status */
  status: WorkflowExecutionStatusSchema,

  /** For pause/resume: current scope stack */
  scopeStack: ScopeStackSchema,
  /** For pause/resume: current step index within scope */
  currentStepIndex: z.number(),
  /** For pause/resume: accumulated step results */
  stepResults: z.record(z.string(), StepResultSchema).optional(),

  /** Final result (on completion) */
  result: z.unknown().nullable(),
  /** Error message (on failure) */
  error: z.string().nullable(),

  /** Queue management */
  priority: z.number().default(50),
  leaseId: z.string().nullable(),
  leaseExpiresAt: TimestampSchema.nullable(),
  workerId: z.string().nullable(),

  /** Retry management */
  retryCount: z.number().default(0),
  maxRetries: z.number().default(0),

  /** Retry chain tracking */
  originalExecutionId: z.string().nullable().optional(),
  previousExecutionId: z.string().nullable().optional(),
  retryNumber: z.number().default(0),

  /** Timestamps */
  createdAt: TimestampSchema,
  startedAt: TimestampSchema.nullable(),
  completedAt: TimestampSchema.nullable(),

  /** Audit */
  createdBy: z.string().nullable(),
});
export type WorkflowExecution = z.infer<typeof WorkflowExecutionSchema>;

/**
 * Step execution record
 */
export const StepExecutionSchema = z.object({
  /** Step execution ID: {executionId}:{stepName}:{scopeHash} */
  id: z.string(),
  /** Parent execution ID */
  executionId: z.string(),
  /** Tenant ID */
  tenantId: z.string(),

  /** OTEL span ID */
  spanId: z.string().nullable(),

  /** Step name from definition */
  stepName: z.string(),
  /** Step type */
  stepType: z.string(),
  /** For action steps: the action type */
  stepAction: z.string().nullable(),

  /** Scope context at execution time */
  scopeStack: ScopeStackSchema,
  /** Hash of scope stack for ID generation */
  scopeHash: z.string(),

  /** Order within this execution */
  executionOrder: z.number(),

  /** Retry tracking for step-level retries */
  stepAttempt: z.number().default(0),

  /** Input data */
  inputData: z.unknown().nullable(),
  /** Output data */
  outputData: z.unknown().nullable(),

  /** Status */
  status: StepExecutionStatusSchema,
  /** Error message */
  error: z.string().nullable(),

  /** 'skipped' = step skipped (full override), 'partial' = overrides merged onto output, null = normal */
  overrideMode: z.enum(['skipped', 'partial']).nullable().optional(),

  /** Timing */
  durationMs: z.number().nullable(),
  startedAt: TimestampSchema.nullable(),
  completedAt: TimestampSchema.nullable(),
});
export type StepExecution = z.infer<typeof StepExecutionSchema>;

/**
 * Connector definition
 */
export const ConnectorSchema = z.object({
  /** Connector ID */
  id: z.string(),
  /** Tenant ID */
  tenantId: z.string(),
  /** Connector name */
  name: z.string(),
  /** Connector type: http, slack, email, etc. */
  type: z.string(),
  /** Description */
  description: z.string().optional(),
  /** Connection configuration */
  config: z.record(z.string(), z.unknown()),
  /** Input schema for validation */
  inputSchema: z.unknown().optional(),
  /** Output schema */
  outputSchema: z.unknown().optional(),
  /** Timestamps */
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema.optional(),
  createdBy: z.string(),
});
export type Connector = z.infer<typeof ConnectorSchema>;

/**
 * Workflow file output - represents a file generated during workflow execution
 * This is the standard format for any step that produces a file (template, merge, etc.)
 * Files are tracked in the files table - only the fileId is needed to reference them.
 */
export const WorkflowFileOutputSchema = z.object({
  /** File ID from files table */
  fileId: z.string(),
  /** Step that generated this file */
  stepName: z.string(),
});
export type WorkflowFileOutput = z.infer<typeof WorkflowFileOutputSchema>;

/**
 * Check if a value is a WorkflowFileOutput (file reference)
 *
 * File outputs have the shape: { fileId: string } where fileId starts with:
 * - 'file_' (DB-stored files and execution output files)
 * - 'input-file-' (inline-uploaded inputs from CLI/API)
 */
export function isFileOutput(value: unknown): value is WorkflowFileOutput {
  if (
    value == null ||
    typeof value !== 'object' ||
    !('fileId' in value) ||
    typeof (value as Record<string, unknown>).fileId !== 'string'
  ) {
    return false;
  }
  const fileId = String((value as Record<string, unknown>).fileId);
  return fileId.startsWith('file_') || fileId.startsWith('input-file-');
}

/**
 * Check if value is a WorkflowResult
 */
export function isWorkflowResult(value: unknown): value is WorkflowResult {
  return (
    value != null &&
    typeof value === 'object' &&
    'files' in value &&
    Array.isArray((value as WorkflowResult).files)
  );
}

/**
 * Workflow result - the final output of a completed workflow
 * Always includes files array, plus user-defined data
 */
export const WorkflowResultSchema = z.object({
  /** Files generated during workflow execution (automatically collected) */
  files: z.array(WorkflowFileOutputSchema),
  /** User-defined output data (from workflow's output expression) */
  data: z.unknown(),
});
export type WorkflowResult = z.infer<typeof WorkflowResultSchema>;
