import { nanoid } from 'nanoid';
import { z } from 'zod';

/**
 * Standard ID prefixes for all entities
 */
export const ID_PREFIXES = {
  WORKFLOW: 'wf',
  WORKFLOW_VERSION: 'wfv',
  WORKFLOW_HISTORY: 'wfh',
  JOB: 'job',
  EXECUTION: 'exec',
  STEP_EXECUTION: 'step',
  FILE: 'file',
  TEMPLATE: 'tmpl',
  USER: 'user',
  TENANT: 'org',
  TENANT_INVITE: 'inv',
  API_KEY: 'eig',
  PROCESSOR: 'proc',
  AI_PROVIDER: 'aip',
  // Auth
  ACCOUNT: 'acct',
  SESSION: 'sess',
  VERIFICATION: 'vrf',
  // Datasets & Evaluations
  DATASET: 'ds',
  DATASET_EXAMPLE: 'dex',
  EXPERIMENT: 'exp',
  EXPERIMENT_RUN: 'exr',
  EXPERIMENT_EVALUATION: 'evl',
  EVAL_EXAMPLE: 'evx',
  EVAL_RESULT: 'evr',
  EVAL_BATCH: 'evb',
  RUN_REVIEW: 'rev',
  RUN_REVIEW_CORRECTION: 'rvc',
  // Table view (legacy — eval examples used to live in workflow_table_rows)
  TABLE_ROW: 'row',
  // Folders
  FOLDER: 'fldr',
  // Agent workflows
  AGENT_WORKFLOW: 'awf',
  AGENT_EXECUTION: 'aex',
  AGENT_EXAMPLE: 'aeg',
  AGENT_VERSION: 'avr',
  AGENT_TRAINING_SESSION: 'ats',
  AGENT_EXPERIMENT: 'aexp',
  // Email triggers
  AGENT_EMAIL_ALIAS: 'aea',
  AGENT_EMAIL_INVOCATION: 'aei',
  // Automation trigger projection (runtime gate)
  AUTOMATION_TRIGGER: 'atr',
  // External file-source resolver instance config (single-tenant)
  FILE_SOURCE_CONFIG: 'fsc',
  // Storage-direct reusable file upload sessions (`fup_…`)
  FILE_UPLOAD: 'fup',
  // Outbound webhooks
  WEBHOOK_ENDPOINT: 'whep',
  WEBHOOK_EVENT: 'whev',
  WEBHOOK_DELIVERY: 'whdl',
  WEBHOOK_ATTEMPT: 'what',
  // Billing — prepaid paid-allowance grants (OpenParser top-ups)
  PAID_ALLOWANCE_GRANT: 'pag',
  PAID_ALLOWANCE_ADJUSTMENT: 'paa',
  // OpenParser API — tenant-scoped saved extraction pipelines (`oppl_…`)
  OCR_EXTRACTION_PIPELINE: 'oppl',
  // OpenParser API — public OCR job / batch parent / child IDs (`opj_…`)
  OCR_JOB: 'opj',
  // Token prefixes (not IDs, but follow the same registry)
  SANDBOX_WS_TOKEN: 'sws',
} as const;

export type IdPrefix = (typeof ID_PREFIXES)[keyof typeof ID_PREFIXES];

/**
 * Generate a unique ID with optional prefix.
 * Uses nanoid (21 chars) for compact, URL-safe IDs.
 *
 * @example
 * generateId() // "V1StGXR8_Z5jdHi6B-myT"
 * generateId('wf') // "wf_V1StGXR8_Z5jdHi6B-myT"
 * generateId(ID_PREFIXES.WORKFLOW) // "wf_V1StGXR8_Z5jdHi6B-myT"
 */
export function generateId(prefix?: string): string {
  const id = nanoid();
  return prefix ? `${prefix}_${id}` : id;
}

/**
 * Timestamp schema - accepts Date or ISO string
 */
export const TimestampSchema = z.union([z.date(), z.string().datetime()]).transform((val) => {
  return typeof val === 'string' ? new Date(val) : val;
});

/**
 * JSON Schema representation (for storing in DB)
 */
export const JsonSchemaSchema = z.record(z.string(), z.unknown());
export type JsonSchema = z.infer<typeof JsonSchemaSchema>;

/**
 * Base entity with common fields
 */
export const BaseEntitySchema = z.object({
  id: z.string(),
  createdAt: TimestampSchema.optional(),
  updatedAt: TimestampSchema.optional(),
});

export type BaseEntity = z.infer<typeof BaseEntitySchema>;

/**
 * Plain JSON Schema object — emitted by `z.toJSONSchema()` and consumed by
 * the worker registry, agent tools, and the CLI skill reference.
 * Equivalent to the old `zod-to-json-schema`'s `JsonSchema7Type` for our use.
 */
export type JsonSchema7Type = Record<string, unknown>;

/**
 * Convert a Zod schema to JSON Schema (draft-07).
 * Use this for storing in DB, JSON Schema form generators, or LLM consumption.
 */
export function toJsonSchema(schema: z.ZodType): JsonSchema7Type {
  return z.toJSONSchema(schema, { target: 'draft-7' }) as JsonSchema7Type;
}

/**
 * Template placeholder definition for DOCX templates
 */
export interface TemplatePlaceholder {
  name: string; // e.g., "items.title" for nested
  path?: string[]; // e.g., ["items", "title"]
  kind?: 'variable' | 'loop'; // Simple var or loop section
  type?: 'string' | 'number' | 'date' | 'boolean' | 'array' | 'object';
  required?: boolean;
  description?: string;
}
