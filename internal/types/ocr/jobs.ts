import { z } from 'zod';
import { ExtractionTerminalResultSchema } from './extraction';
import { ParsedDocumentSchema } from './parsed-document';
import { OcrOutputFormatSchema, RawParseResultSchema } from './raw-result';
import { SuggestSchemaTerminalResultSchema } from './suggest-schema';

/**
 * Public OCR job/batch/error wire envelopes.
 * Normative companion: docs/OCR_API_OPENAPI.yaml
 */

/** Repo-relative path to the normative OpenAPI document. */
export const OCR_OPENAPI_RELATIVE_PATH = 'docs/OCR_API_OPENAPI.yaml' as const;

export const OCR_JOB_STATUSES = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'indeterminate',
] as const;
export const JobStatusSchema = z.enum(OCR_JOB_STATUSES);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const OCR_JOB_OPERATIONS = [
  'parse',
  'extract',
  'suggest_schema',
  'parse_batch',
  'extract_batch',
] as const;
export const JobOperationSchema = z.enum(OCR_JOB_OPERATIONS);
export type JobOperation = z.infer<typeof JobOperationSchema>;

export const JobIdSchema = z.string().uuid();
export type JobId = z.infer<typeof JobIdSchema>;

export const JobFailureSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
    retryable: z.boolean(),
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type JobFailure = z.infer<typeof JobFailureSchema>;

export const JobAcceptedSchema = z
  .object({
    id: JobIdSchema,
    operation: z.enum(['parse', 'extract', 'suggest_schema']),
    status: JobStatusSchema,
    output_format: OcrOutputFormatSchema,
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
  })
  .strict();

export type JobAccepted = z.infer<typeof JobAcceptedSchema>;

export const BatchJobAcceptedSchema = z
  .object({
    id: JobIdSchema,
    operation: z.enum(['parse_batch', 'extract_batch']),
    status: JobStatusSchema,
    output_format: OcrOutputFormatSchema,
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
    child_count: z.number().int().min(1).max(20),
  })
  .strict();

export type BatchJobAccepted = z.infer<typeof BatchJobAcceptedSchema>;

export const BatchChildSummarySchema = z
  .object({
    client_item_id: z.string().min(1).max(128),
    job_id: JobIdSchema,
    file_index: z.number().int().min(0),
    status: JobStatusSchema,
    output_format: OcrOutputFormatSchema,
    error: JobFailureSchema.optional(),
    result: z
      .union([ParsedDocumentSchema, RawParseResultSchema, ExtractionTerminalResultSchema])
      .optional(),
  })
  .strict();

export type BatchChildSummary = z.infer<typeof BatchChildSummarySchema>;

export const BatchChildPageSchema = z
  .object({
    items: z.array(BatchChildSummarySchema),
    next_cursor: z.string().nullable().optional(),
  })
  .strict();

export type BatchChildPage = z.infer<typeof BatchChildPageSchema>;

export const BatchSummaryCountsSchema = z
  .object({
    total: z.number().int().min(0),
    queued: z.number().int().min(0),
    running: z.number().int().min(0),
    succeeded: z.number().int().min(0),
    failed: z.number().int().min(0),
    indeterminate: z.number().int().min(0),
  })
  .strict();

export type BatchSummaryCounts = z.infer<typeof BatchSummaryCountsSchema>;

export const JobProgressSchema = z
  .object({
    completed: z.number().int().min(0).optional(),
    total: z.number().int().min(0).optional(),
  })
  .strict();

export type JobProgress = z.infer<typeof JobProgressSchema>;

export const JobSchema = z
  .object({
    id: JobIdSchema,
    operation: JobOperationSchema,
    status: JobStatusSchema,
    output_format: OcrOutputFormatSchema,
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
    progress: JobProgressSchema.optional(),
    error: JobFailureSchema.optional(),
    result: z
      .union([
        ParsedDocumentSchema,
        RawParseResultSchema,
        ExtractionTerminalResultSchema,
        SuggestSchemaTerminalResultSchema,
      ])
      .optional(),
    summary: BatchSummaryCountsSchema.optional(),
    children: BatchChildPageSchema.optional(),
  })
  .strict();

export type Job = z.infer<typeof JobSchema>;

/** Default / max page size for `GET /jobs` list. */
export const OCR_JOB_LIST_DEFAULT_LIMIT = 25;
export const OCR_JOB_LIST_MAX_LIMIT = 100;

/**
 * Lightweight tenant-scoped job row for `GET /jobs`.
 * Intentionally omits result bodies, idempotency material, storage keys, and costs.
 */
export const JobSummarySchema = z
  .object({
    id: JobIdSchema,
    operation: JobOperationSchema,
    status: JobStatusSchema,
    output_format: OcrOutputFormatSchema,
    ocr_model: z.string().min(1).nullable().optional(),
    llm_model: z.string().min(1).nullable().optional(),
    page_count: z.number().int().min(0),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
    error: JobFailureSchema.optional(),
    /** True when a terminal result is available via `GET /jobs/{id}`. */
    has_result: z.boolean(),
    /** Job resource URL (path-absolute) for `GET /jobs/{id}`. */
    url: z.string().min(1),
  })
  .strict();

export type JobSummary = z.infer<typeof JobSummarySchema>;

export const JobListResponseSchema = z
  .object({
    data: z.array(JobSummarySchema),
    next_cursor: z.string().nullable(),
  })
  .strict();

export type JobListResponse = z.infer<typeof JobListResponseSchema>;

/** Query string for `GET /jobs` (validated after parsing). */
export const JobListQuerySchema = z
  .object({
    cursor: z.string().min(1).optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(OCR_JOB_LIST_MAX_LIMIT)
      .optional()
      .default(OCR_JOB_LIST_DEFAULT_LIMIT),
    status: JobStatusSchema.optional(),
    operation: JobOperationSchema.optional(),
  })
  .strict();

export type JobListQuery = z.infer<typeof JobListQuerySchema>;

export const ErrorBodySchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
    request_id: z.string().min(1),
    retryable: z.boolean(),
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type ErrorBody = z.infer<typeof ErrorBodySchema>;

export const ErrorResponseSchema = z
  .object({
    error: ErrorBodySchema,
  })
  .strict();

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

/** Sync status matrix essentials mirrored from OpenAPI. */
export const OCR_SYNC_STATUS_CODES = {
  success: 200,
  accepted: 202,
  failed: 422,
  indeterminate: 504,
} as const;
