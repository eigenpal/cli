import { z } from 'zod';
import { JsonSchemaSchema, TimestampSchema } from '../core/common';
import {
  TriggerTypeSchema as ProcessorTriggerTypeSchema,
  TriggerTypeValue as ProcessorTriggerTypeValue,
} from '../processor/execution';
import { StepSchema } from './steps';

/**
 * Workflow `name:` is the human-readable slug. Must be URL-safe and
 * shell-safe so it can stand in for the workflow id in CLI commands and
 * URL paths without quoting or percent-encoding. The shape mirrors
 * `DATASET_NAME_PATTERN` (in `eval/dataset-archive.ts`) — same constraint
 * for the same kind of identifier.
 *
 * Valid:   `my-agent`, `my_agent`, `parse-invoices-v2`, `agent_2`
 * Invalid: `My Agent`, `My-Agent`, `_leading`, `-leading`, `agent!`
 */
export const WORKFLOW_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

/**
 * Best-effort canonicalization of a free-form string into a valid workflow
 * name. Lowercases ASCII, replaces every run of non-alphanumeric characters
 * with `-`, strips leading/trailing `-`/`_`, and clamps to 64 chars. Used
 * only for the "did you mean" hint — the validator still rejects the
 * original string.
 *
 *   suggestWorkflowName('My Agent')          === 'my-agent'
 *   suggestWorkflowName('Parse Invoices v2') === 'parse-invoices-v2'
 *   suggestWorkflowName('--')                === ''   (caller must guard)
 */
export function suggestWorkflowName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[_-]+|[_-]+$/g, '')
    .slice(0, 64);
}

export const WorkflowNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(
    WORKFLOW_NAME_PATTERN,
    'Workflow name must start with a lowercase letter or digit and contain only lowercase letters, digits, "_" or "-".'
  );

/**
 * Trigger type - re-exported from processor for consistency
 */
export const TriggerTypeSchema = ProcessorTriggerTypeSchema;
export type TriggerType = z.infer<typeof TriggerTypeSchema>;
export const TriggerTypeValue = ProcessorTriggerTypeValue;

/**
 * Input definition for workflow inputs
 */
export const WorkflowInputDefSchema = z.object({
  /** Input variable name */
  name: z.string().min(1),
  /** JSON Schema type */
  type: z.string(),
  /** Human-readable description */
  description: z.string().optional(),
  /** Whether this input is required */
  required: z.boolean().default(true),
  /** Default value if not provided */
  default: z.unknown().optional(),
  /** For array types: describes the element type (e.g. { type: 'file' }) */
  items: z.object({ type: z.string() }).optional(),
});
export type WorkflowInputDef = z.infer<typeof WorkflowInputDefSchema>;

// ==================
// Trigger Method Schemas (new array-based approach)
// ==================

/**
 * Manual trigger method - invoked via UI
 */
export const ManualTriggerMethodSchema = z.object({
  type: z.literal('manual'),
  /** Input schema for validation */
  inputSchema: JsonSchemaSchema.optional(),
});
export type ManualTriggerMethod = z.infer<typeof ManualTriggerMethodSchema>;

/**
 * API trigger method - invoked via REST API with API key
 */
export const ApiTriggerMethodSchema = z.object({
  type: z.literal('api'),
  /** Input schema for validation */
  inputSchema: JsonSchemaSchema.optional(),
});
export type ApiTriggerMethod = z.infer<typeof ApiTriggerMethodSchema>;

/**
 * Email trigger method - invoked via email
 */
export const EmailTriggerMethodSchema = z.object({
  type: z.literal('email'),
  /** Whitelist for allowed senders */
  whitelist: z
    .object({
      domains: z.array(z.string()).optional(),
      emails: z.array(z.string()).optional(),
    })
    .optional(),
});
export type EmailTriggerMethod = z.infer<typeof EmailTriggerMethodSchema>;

/**
 * Discriminated union of all trigger method types
 */
export const TriggerMethodSchema = z.discriminatedUnion('type', [
  ManualTriggerMethodSchema,
  ApiTriggerMethodSchema,
  EmailTriggerMethodSchema,
]);
export type TriggerMethod = z.infer<typeof TriggerMethodSchema>;

/**
 * Array of trigger methods with default to manual
 */
export const TriggerMethodsSchema = z.array(TriggerMethodSchema).default([{ type: 'manual' }]);
export type TriggerMethods = z.infer<typeof TriggerMethodsSchema>;

/**
 * Workflow settings
 */
export const WorkflowSettingsSchema = z.object({
  /** Default timeout for all steps (ms) */
  timeout: z.number().positive().optional(),
  /** Default retries for all steps */
  retries: z.number().int().min(0).optional(),
  /** Retry delay (ms) */
  retryDelay: z.number().positive().optional(),
});
export type WorkflowSettings = z.infer<typeof WorkflowSettingsSchema>;

/**
 * Get triggerMethods from a workflow definition
 */
export function getTriggerMethods(definition: WorkflowDefinition): TriggerMethod[] {
  if (definition.triggerMethods && definition.triggerMethods.length > 0) {
    return definition.triggerMethods;
  }
  return [{ type: 'manual' }];
}

/**
 * Check if a workflow has a specific trigger method enabled
 */
export function hasTriggerMethod(
  definition: WorkflowDefinition,
  type: TriggerMethod['type']
): boolean {
  const methods = getTriggerMethods(definition);
  return methods.some((m) => m.type === type);
}

/**
 * Workflow definition - the complete YAML structure
 */
export const WorkflowDefinitionSchema = z.object({
  /**
   * Workflow name — also serves as the URL-safe slug. Must match
   * `WORKFLOW_NAME_PATTERN` (lowercase letters/digits/`_`/`-`, 1–64 chars).
   */
  name: WorkflowNameSchema,
  /** Kind: 'workflow' (default) or 'block' (reusable block) */
  kind: z.enum(['workflow', 'block']).default('workflow').optional(),
  /** Semantic version */
  version: z.string().default('1.0.0'),
  /** Human-readable description */
  description: z.string().optional(),
  /** Whether the workflow is enabled */
  enabled: z.boolean().default(true),

  /**
   * Array of trigger methods - ways to invoke this workflow
   * Available types: manual, api, email
   */
  triggerMethods: z.array(TriggerMethodSchema).default([{ type: 'manual' }]),

  /** Input variable definitions */
  inputs: z.array(WorkflowInputDefSchema).optional(),

  /** Steps execute sequentially unless control flow changes order */
  steps: z.array(StepSchema),

  /** Output fields - object with field names as keys and template expressions as values */
  output: z.record(z.string(), z.string()).optional(),

  /** Global workflow settings */
  settings: WorkflowSettingsSchema.optional(),
});

export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;

/**
 * Stored workflow definition (with metadata)
 */
export const StoredWorkflowDefinitionSchema = z.object({
  /** Database ID */
  id: z.string(),
  /** Tenant ID */
  tenantId: z.string(),
  /** Original YAML content */
  yamlContent: z.string(),
  /** Parsed definition */
  definition: WorkflowDefinitionSchema,
  /** Whether this is the current version */
  isCurrent: z.boolean().default(true),
  /** Creation timestamp */
  createdAt: TimestampSchema,
  /** Last update timestamp */
  updatedAt: TimestampSchema.optional(),
  /** Creator user ID */
  createdBy: z.string(),
});
export type StoredWorkflowDefinition = z.infer<typeof StoredWorkflowDefinitionSchema>;

/**
 * Create workflow definition input
 */
export const CreateWorkflowDefinitionSchema = z.object({
  tenantId: z.string(),
  yamlContent: z.string(),
  createdBy: z.string(),
});
export type CreateWorkflowDefinition = z.infer<typeof CreateWorkflowDefinitionSchema>;
