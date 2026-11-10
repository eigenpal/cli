import { z } from 'zod';
import { StepExecutionStatusSchema } from '../processor/execution';

// Status schemas live in processor/execution; re-exported here for the workflow barrel.
export {
  StepExecutionStatusSchema,
  StepExecutionStatusValue,
  WorkflowExecutionStatusSchema,
  WorkflowExecutionStatusValue,
  type StepExecutionStatus,
  type WorkflowExecutionStatus,
} from '../processor/execution';

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
  'inline-invoke',
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
  /** Environment variables the run resolved, typed (`{{ env.NAME }}`) */
  env: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
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
  /** Environment variables the run resolved, typed (`{{ env.NAME }}`) */
  env: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});
export type StepInputReference = z.infer<typeof StepInputReferenceSchema>;

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
  /** Files generated during workflow execution (automatically collected; excludes run inputs) */
  files: z.array(WorkflowFileOutputSchema),
  /** User-defined output data (from workflow's output expression) */
  data: z.unknown(),
});
export type WorkflowResult = z.infer<typeof WorkflowResultSchema>;
