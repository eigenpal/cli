import { z } from 'zod';

/**
 * Wire shapes for dataset/evaluator/results export-import.
 *
 * HTTP route handlers (`/api/v1/workflows/:id/{evaluators,dataset,eval-results}/...`)
 * parse the schemas defined here.
 *
 * `formatZodError` converts a `ZodError`/issue array into the shared
 * `{ field, message, code, severity }[]` shape carried inside the
 * `ApiErrorEnvelope`.
 */

// ---------------------------------------------------------------------------
// Dataset archive — folder convention (no top-level manifest)
// ---------------------------------------------------------------------------

/**
 * Canonical automation dataset archive layout:
 *
 *   examples/<name>/input.json                REQUIRED, full run input object
 *   examples/<name>/input/<file>              OPTIONAL, files referenced from input.json
 *   examples/<name>/expected.json             OPTIONAL, expected output object
 *   examples/<name>/expected/<file>           OPTIONAL, files referenced from expected.json
 *   examples/<name>/meta.json                 OPTIONAL, see DatasetMetaSchema
 *
 * The folder structure itself is the manifest. Importers reject any archive
 * containing a top-level `manifest.json` (legacy layout) with a structured
 * error pointing at the new convention.
 */

/**
 * Lowercase kebab/snake-case identifier, used both for the example folder
 * name and for argument folder names under `input/`.
 */
export const DATASET_NAME_PATTERN = /^[a-z0-9][a-z0-9-_]*$/;
export const DatasetNameSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(DATASET_NAME_PATTERN, 'name must be lowercase kebab/snake-case');

/**
 * `examples/<name>/meta.json` — entirely optional. Omit the file when no
 * fields are present. `overrides` carries per-step output overrides for
 * eval execution; `rowOrder` is a UI hint; `annotation` is free-form notes.
 */
export const DatasetMetaSchema = z.object({
  rowOrder: z.number().int().min(0).optional(),
  annotation: z.string().max(2000).optional(),
  overrides: z.record(z.string(), z.unknown()).optional(),
});
export type DatasetMeta = z.infer<typeof DatasetMetaSchema>;

// ---------------------------------------------------------------------------
// Dataset import request
// ---------------------------------------------------------------------------

export const DatasetImportModeSchema = z.enum(['append', 'replace']);
export type DatasetImportMode = z.infer<typeof DatasetImportModeSchema>;

/**
 * Body of `POST /api/v1/automations/:id/dataset/import` (the multipart form's
 * `mode` field). The ZIP itself rides on the multipart `file` part — only
 * `mode` lives in the JSON body.
 */
export const DatasetImportRequestSchema = z.object({
  mode: DatasetImportModeSchema,
});
export type DatasetImportRequest = z.infer<typeof DatasetImportRequestSchema>;

// ---------------------------------------------------------------------------
// Evaluators import request
// ---------------------------------------------------------------------------

/**
 * Body of `PUT /api/v1/automations/:id/evaluators`. The YAML string
 * is parsed server-side with `js-yaml CORE_SCHEMA` (no `!!js/function`)
 * and validated against `EvalConfigYamlSchema` from `./evaluator-config`.
 */
export const EvaluatorsImportRequestSchema = z.object({
  yaml: z.string().min(1, 'yaml content is required').max(1_048_576, 'evaluator YAML exceeds 1 MB'),
});
export type EvaluatorsImportRequest = z.infer<typeof EvaluatorsImportRequestSchema>;

// ---------------------------------------------------------------------------
// Eval results export
// ---------------------------------------------------------------------------

export const EvalResultsExportFormatSchema = z.enum(['csv', 'json']);
export type EvalResultsExportFormat = z.infer<typeof EvalResultsExportFormatSchema>;

// NOTE: URLSearchParams.get() yields null for absent params; callers must
// coerce null to undefined before parsing (.optional() rejects null). Keeping
// the schema .optional() keeps the generated OpenAPI spec free of null unions.
const BooleanQueryFlagSchema = z
  .enum(['true', 'false', '1', '0'])
  .optional()
  .transform((value) => value === 'true' || value === '1');

const ExperimentExportBaseQuerySchema = z.object({
  format: EvalResultsExportFormatSchema,
});

/**
 * Query string for all-experiment result exports:
 * `GET /api/v1/automations/:id/experiments/export`.
 */
export const ExperimentExportAllQuerySchema = ExperimentExportBaseQuerySchema;
export type ExperimentExportAllQuery = z.infer<typeof ExperimentExportAllQuerySchema>;

/**
 * Query string for single-experiment result exports:
 * `GET /api/v1/automations/:id/experiments/:experimentId/export`.
 */
export const ExperimentExportQuerySchema = ExperimentExportBaseQuerySchema.extend({
  includeTrace: BooleanQueryFlagSchema,
});
export type ExperimentExportQuery = z.infer<typeof ExperimentExportQuerySchema>;

/** @deprecated Use {@link ExperimentExportQuerySchema} — batch scoping is a path param now. */
export const EvalResultsExportQuerySchema = ExperimentExportQuerySchema;
export type EvalResultsExportQuery = ExperimentExportQuery;

/**
 * One row of the exported results — same shape for CSV (column order
 * matches field order) and JSON (`results[]` array entries). Any field
 * whose source column is nullable comes through as `null` in JSON or
 * empty in CSV.
 */
export const EvalResultExportRowSchema = z.object({
  executionId: z.string().min(1),
  exampleId: z.string().min(1).nullable(),
  exampleName: z.string().nullable(),
  batchId: z.string().min(1).nullable(),
  evaluatorName: z.string().min(1),
  evaluatorType: z.enum(['exact-diff', 'llm-judge', 'custom-script']),
  score: z.number().nullable(),
  passed: z.boolean().nullable(),
  label: z.string().nullable(),
  weight: z.number(),
  createdAt: z.string().datetime({ offset: true }),
  error: z.string().nullable(),
});
export type EvalResultExportRow = z.infer<typeof EvalResultExportRowSchema>;

/**
 * `?format=json` response body. CSV format is documented separately
 * (header row matches the field order of `EvalResultExportRowSchema`).
 */
export const EvalResultsExportJsonSchema = z.object({
  workflowId: z.string().min(1),
  exportedAt: z.string().datetime({ offset: true }),
  results: z.array(EvalResultExportRowSchema),
});
export type EvalResultsExportJson = z.infer<typeof EvalResultsExportJsonSchema>;

// ---------------------------------------------------------------------------
// Shared error envelope + Zod issue formatting
// ---------------------------------------------------------------------------

/**
 * One field-scoped error message. `field` is a dotted path into the request
 * body (`evaluators.0.config.passThreshold`); `message` is a single sentence
 * suitable for direct display in CLI/UI. `code` is a stable machine-readable
 * identifier; `severity` defaults to `'error'`.
 */
export interface ValidationIssue {
  field: string;
  message: string;
  code?: string;
  severity?: 'error' | 'warning';
}

/**
 * Hint catalog — keys map to actionable strings. Routes/tools call
 * `errorHintFor(...)` to attach a `hint` that closes the loop without
 * sending the user to docs for a one-line answer (see design §27).
 */
export type ErrorHintKey =
  | 'dataset-too-large'
  | 'artifacts-zip-too-large'
  | 'execution-in-flight'
  | 'download-token-expired'
  | 'legacy-dataset-format';

export const ERROR_HINTS: Readonly<Record<ErrorHintKey, string>> = {
  'dataset-too-large': 'Datasets are capped at 500 MB. Split into multiple Append imports.',
  'artifacts-zip-too-large':
    'Download artifacts individually via GET /runs/{id}/artifacts/{path}, or select a smaller files= subset.',
  'execution-in-flight':
    'Wait for the in-flight execution to complete, or cancel it from the Experiments tab.',
  'download-token-expired': 'Re-request the resource to mint a new URL.',
  'legacy-dataset-format':
    'Re-export the dataset using the canonical automation convention (examples/<name>/input.json + input/<file> refs + expected.json).',
};

export function errorHintFor(key: ErrorHintKey): string {
  return ERROR_HINTS[key];
}

/**
 * Wire shape for every 4xx/5xx response from the v1 routes.
 */
export interface ApiErrorEnvelope {
  issues: ValidationIssue[];
  requestId: string;
  hint?: string;
  docsUrl?: string;
  /** Present on 409 workflow_name_conflict responses. */
  conflictingWorkflowId?: string;
}

/**
 * Convert Zod issues into the shared `{ field, message, code, severity }[]`
 * shape.
 *
 * Compatible with both `ZodError.issues` (v3 + v4) and a raw issue array.
 * Joins the `path` array with `.` (numeric segments stay numeric, e.g.
 * `evaluators.0.config.labels`) so callers can address into nested arrays.
 * Empty paths fall back to `<root>` so the message is never field-less.
 *
 * Never throws; returns `[]` for empty inputs.
 */
type ZodIssueShape = { path: ReadonlyArray<PropertyKey>; message: string };

type ZodIssueShapeWithCode = ZodIssueShape & { code?: string };

export function formatZodError(
  source: { issues: ReadonlyArray<ZodIssueShapeWithCode> } | ReadonlyArray<ZodIssueShapeWithCode>
): ValidationIssue[] {
  const issues: ReadonlyArray<ZodIssueShapeWithCode> = Array.isArray(source)
    ? (source as ReadonlyArray<ZodIssueShapeWithCode>)
    : (source as { issues: ReadonlyArray<ZodIssueShapeWithCode> }).issues;
  return issues.map((issue) => ({
    field: issue.path.length === 0 ? '<root>' : issue.path.map((p) => String(p)).join('.'),
    message: issue.message,
    code: issue.code ?? 'invalid_value',
    severity: 'error' as const,
  }));
}
