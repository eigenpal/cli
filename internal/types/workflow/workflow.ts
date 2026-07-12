import { z } from 'zod';
import { JsonSchemaSchema, TimestampSchema } from '../core/common';
import {
  TriggerTypeSchema as ProcessorTriggerTypeSchema,
  TriggerTypeValue as ProcessorTriggerTypeValue,
} from '../processor/execution';
import { WorkflowRetryPolicySchema } from './retry';
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
export const WorkflowInputDefSchema = z
  .object({
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
    /**
     * Closed set of allowed values for `type: 'enum'`. Renders as a `<Select>`
     * in the run form and is enforced by the input validator on the /run path.
     * Internally converted to the JSON Schema `{ type: 'string', enum: [...] }`
     * shape, but workflow YAML uses the more natural `type: enum, values: [...]`.
     */
    values: z.array(z.string()).optional(),
    /** For array types: describes the element type (e.g. { type: 'file' }) */
    items: z
      .object({
        type: z.string(),
        /** Closed set of allowed values for `items.type: 'enum'` (array of enum). */
        values: z.array(z.string()).optional(),
      })
      .optional(),
    /**
     * External file source (single-tenant only). When set on a `type: 'file'`
     * input, the run is started with a plain string **id** for this field and the
     * worker resolves that id to a file artifact via the named `FileSourceResolver`
     * before the workflow executes. The name must match a registered resolver
     * (e.g. `'gpfs'`). See `@eigenpal/types/file-source`.
     */
    source: z.string().min(1).optional(),
    /**
     * Optional author hint for the resolved file's type when `source` is set.
     * The resolver response Content-Type and magic-byte detection are used as
     * fallbacks; this hint wins when present. Provide either an extension
     * (`'pdf'`, `'jpg'`) or a full MIME type.
     */
    mimeType: z.string().min(1).optional(),
    extension: z.string().min(1).optional(),
  })
  .superRefine((def, ctx) => {
    // `source` only makes sense on a `type: 'file'` input — the worker resolves a
    // string id to a file artifact. On any other type the id would be silently
    // skipped (arrays) or overwrite a scalar with a file descriptor (strings), so
    // reject it at authoring/push time instead.
    if (def.source && def.type !== 'file') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['source'],
        message: `"source" is only valid on a file input; input "${def.name}" has type "${def.type}"`,
      });
    }

    // `mimeType` / `extension` are resolver type-hints — they only do anything on
    // a sourced file input, where the worker uses them to name the materialized
    // artifact. Accepting them on any other input silently does nothing, so flag
    // it. At most one may be set (runtime uses `mimeType ?? extension`; setting
    // both is ambiguous). Validate their basic shape so a typo is caught here.
    const hasHint = def.mimeType !== undefined || def.extension !== undefined;
    if (hasHint && !(def.type === 'file' && def.source)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [def.mimeType !== undefined ? 'mimeType' : 'extension'],
        message: `"mimeType"/"extension" hints are only valid on a file input with a "source"; input "${def.name}" is not.`,
      });
    }
    if (def.mimeType !== undefined && def.extension !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['extension'],
        message: `Set at most one of "mimeType" or "extension" on input "${def.name}".`,
      });
    }
    if (def.mimeType !== undefined && !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(def.mimeType.trim())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['mimeType'],
        message: `"mimeType" on input "${def.name}" must look like "application/pdf".`,
      });
    }
    if (def.extension !== undefined && !/^\.?[a-z0-9]+$/i.test(def.extension.trim())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['extension'],
        message: `"extension" on input "${def.name}" must be a bare extension like "pdf".`,
      });
    }
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
  /**
   * Whether dashboard runs are allowed. Manual is ON by default — omit this
   * field (or set `true`) to keep it enabled. Set `false` to disable manual
   * runs while keeping the workflow's other triggers. Absence of a manual
   * entry in `triggerMethods` ALSO means enabled (default on).
   */
  enabled: z.boolean().optional(),
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
export const WorkflowSettingsSchema = z
  .object({
    /** Default timeout for all steps (ms) */
    timeout: z.number().positive().optional(),
    /** Default retry behavior inherited by executable leaf steps. */
    retry: WorkflowRetryPolicySchema.optional(),
    /** @deprecated Parsed for compatibility; no longer drives execution. */
    retries: z.number().int().min(0).optional(),
    /** @deprecated Parsed for compatibility; no longer drives execution. */
    retryDelay: z.number().positive().optional(),
  })
  .strict();
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
 * Whether the manual (dashboard) trigger is enabled.
 *
 * Manual is ON by default: it is enabled unless `triggerMethods` contains an
 * explicit manual entry with `enabled: false`. A missing manual entry (e.g. an
 * API-only `triggerMethods`) still counts as enabled — only an explicit opt-out
 * disables it. This mirrors agents, which always allow manual runs, while still
 * letting authors turn it off via YAML/CLI/API/UI.
 */
export function isManualTriggerEnabled(definition: WorkflowDefinition): boolean {
  const manual = getTriggerMethods(definition).find((m) => m.type === 'manual');
  return manual?.enabled !== false;
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
  /** @deprecated Use triggerMethods / automation_triggers instead of kind. */
  kind: z.enum(['workflow']).default('workflow').optional(),
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

  /**
   * Workflow output. Either:
   * - a map of field name -> template expression (named fields), or
   * - a single template expression that resolves to the whole output object
   *   (passthrough, e.g. "{{ steps.invoke.output }}").
   */
  output: z.union([z.record(z.string(), z.string()), z.string()]).optional(),

  /** Global workflow settings */
  settings: WorkflowSettingsSchema.optional(),

  /**
   * Default LLM provider id for AI steps (`ai.parse` / `ai.extract` /
   * `ai.split`). The id refers to a provider configured in the workspace's
   * `eigenpal.config.yaml`.
   *
   * Resolution chain (most specific wins):
   *   step.with.model  >  workflow.defaultModel  >  tenant.defaultLlmProvider  >  worker default
   *
   * Per-step `model:` continues to take precedence; this only fills in the
   * gap when a step doesn't specify one.
   */
  defaultModel: z.string().optional(),
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
