import { z } from 'zod';
import {
  ExtractionAttemptKindSchema,
  ExtractionAttemptSchema,
  ExtractionAttemptStatusSchema,
  ExtractionTerminalResultSchema,
  ExtractionUsageTotalsSchema,
  LlmModelSchema,
} from './extraction';
import {
  BatchChildPageSchema,
  BatchChildSummarySchema,
  BatchJobAcceptedSchema,
  BatchSummaryCountsSchema,
  ErrorBodySchema,
  ErrorResponseSchema,
  JobAcceptedSchema,
  JobFailureSchema,
  JobIdSchema,
  JobOperationSchema,
  JobSchema,
  JobStatusSchema,
} from './jobs';
import {
  BoundingBoxSchema,
  ChunkProvenanceSpanSchema,
  ContentKindSchema,
  ExtractionChunkSchema,
  PageBlockSchema,
  ParsedDocumentSchema,
  RegionContentSchema,
  RegionSchema,
  RegionTypeSchema,
} from './parsed-document';
import { OcrOutputFormatSchema, PaddleRawProfileSchema, RawParseResultSchema } from './raw-result';

export const OCR_MODELS = ['paddleocr-vl-1.6'] as const;
/**
 * Request parsing accepts a syntactically valid registry name first so the
 * model registry can return the stable `unsupported_ocr_model` API error.
 */
export const OcrModelSchema = z.string().min(1).max(128);
export type OcrModel = z.infer<typeof OcrModelSchema>;

/** Eigenpal reusable file-pool id (`POST /files`). */
export const OcrFileIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, 'file_id must be a valid Eigenpal file id');
export type OcrFileId = z.infer<typeof OcrFileIdSchema>;

export const RepairAttemptsSchema = z.number().int().min(0).max(2).default(0);
export const ExtractionJsonSchemaObjectSchema = z.record(z.string(), z.unknown());

export const ParseRequestSchema = z
  .object({
    ocr_model: OcrModelSchema,
    file_id: OcrFileIdSchema.optional(),
    output_format: OcrOutputFormatSchema.default('openparser@1'),
  })
  .strict();
export type ParseRequest = z.infer<typeof ParseRequestSchema>;

export const ExtractRequestSchema = z
  .object({
    ocr_model: OcrModelSchema,
    llm_model: LlmModelSchema,
    schema: ExtractionJsonSchemaObjectSchema,
    repair_attempts: RepairAttemptsSchema,
    file_id: OcrFileIdSchema.optional(),
    output_format: OcrOutputFormatSchema.default('openparser@1'),
  })
  .strict();
export type ExtractRequest = z.infer<typeof ExtractRequestSchema>;

function requireExactlyOneSource(
  item: { file_index?: number; file_id?: string },
  ctx: z.RefinementCtx
): void {
  const hasIndex = item.file_index !== undefined;
  const hasFileId = item.file_id !== undefined;
  if (hasIndex === hasFileId) {
    ctx.addIssue({
      code: 'custom',
      message: 'each batch item requires exactly one of file_index or file_id',
      path: hasIndex ? ['file_id'] : ['file_index'],
    });
  }
}

export const ParseBatchItemSchema = z
  .object({
    client_item_id: z.string().min(1).max(128),
    file_index: z.number().int().min(0).optional(),
    file_id: OcrFileIdSchema.optional(),
    ocr_model: OcrModelSchema,
  })
  .strict()
  .superRefine(requireExactlyOneSource);
export type ParseBatchItem = z.infer<typeof ParseBatchItemSchema>;

export const ExtractBatchItemSchema = z
  .object({
    client_item_id: z.string().min(1).max(128),
    file_index: z.number().int().min(0).optional(),
    file_id: OcrFileIdSchema.optional(),
    ocr_model: OcrModelSchema,
    llm_model: LlmModelSchema,
    schema: ExtractionJsonSchemaObjectSchema,
    repair_attempts: RepairAttemptsSchema,
  })
  .strict()
  .superRefine(requireExactlyOneSource);
export type ExtractBatchItem = z.infer<typeof ExtractBatchItemSchema>;

export const ParseBatchRequestSchema = z
  .object({
    items: z.array(ParseBatchItemSchema).min(1).max(20),
    output_format: OcrOutputFormatSchema.default('openparser@1'),
  })
  .strict();
export type ParseBatchRequest = z.infer<typeof ParseBatchRequestSchema>;

export const ExtractBatchRequestSchema = z
  .object({
    items: z.array(ExtractBatchItemSchema).min(1).max(20),
    output_format: OcrOutputFormatSchema.default('openparser@1'),
  })
  .strict();
export type ExtractBatchRequest = z.infer<typeof ExtractBatchRequestSchema>;

export const PublicFileSchema = z
  .object({
    id: z.string(),
    filename: z.string(),
    contentType: z.string().nullable(),
    size: z.number().int().min(0).nullable(),
    purpose: z.null(),
    createdAt: z.string().datetime(),
  })
  .strict();
export type PublicFile = z.infer<typeof PublicFileSchema>;

export const DeleteFileResponseSchema = z.object({ deleted: z.literal(true) }).strict();
export type DeleteFileResponse = z.infer<typeof DeleteFileResponseSchema>;

export const OpenParserParseResultSchema = z.union([ParsedDocumentSchema, RawParseResultSchema]);
export type OpenParserParseResult = z.infer<typeof OpenParserParseResultSchema>;

export const OPENPARSER_COMPONENT_SCHEMAS = {
  PublicFile: PublicFileSchema,
  JobId: JobIdSchema,
  OcrModel: OcrModelSchema,
  LlmModel: LlmModelSchema,
  RepairAttempts: RepairAttemptsSchema,
  JsonSchemaObject: ExtractionJsonSchemaObjectSchema,
  FileId: OcrFileIdSchema,
  ParseRequest: ParseRequestSchema,
  ExtractRequest: ExtractRequestSchema,
  ParseBatchItem: ParseBatchItemSchema,
  ExtractBatchItem: ExtractBatchItemSchema,
  ParseBatchRequest: ParseBatchRequestSchema,
  ExtractBatchRequest: ExtractBatchRequestSchema,
  OcrOutputFormat: OcrOutputFormatSchema,
  PaddleRawProfile: PaddleRawProfileSchema,
  RawParseResult: RawParseResultSchema,
  ParseResult: OpenParserParseResultSchema,
  JobStatus: JobStatusSchema,
  JobOperation: JobOperationSchema,
  JobAccepted: JobAcceptedSchema,
  BatchJobAccepted: BatchJobAcceptedSchema,
  BoundingBox: BoundingBoxSchema,
  PageBlock: PageBlockSchema,
  RegionType: RegionTypeSchema,
  Region: RegionSchema,
  ContentKind: ContentKindSchema,
  RegionContent: RegionContentSchema,
  ChunkProvenanceSpan: ChunkProvenanceSpanSchema,
  ExtractionChunk: ExtractionChunkSchema,
  ParsedDocument: ParsedDocumentSchema,
  ExtractionAttemptKind: ExtractionAttemptKindSchema,
  ExtractionAttemptStatus: ExtractionAttemptStatusSchema,
  ExtractionAttempt: ExtractionAttemptSchema,
  ExtractionUsageTotals: ExtractionUsageTotalsSchema,
  ExtractionTerminalResult: ExtractionTerminalResultSchema,
  JobFailure: JobFailureSchema,
  BatchChildSummary: BatchChildSummarySchema,
  BatchChildPage: BatchChildPageSchema,
  BatchSummaryCounts: BatchSummaryCountsSchema,
  Job: JobSchema,
  ErrorBody: ErrorBodySchema,
  ErrorResponse: ErrorResponseSchema,
  DeleteFileResponse: DeleteFileResponseSchema,
} as const satisfies Record<string, z.ZodType>;

export type OpenParserComponentSchemaName = keyof typeof OPENPARSER_COMPONENT_SCHEMAS;

type ResponseTarget =
  | { schema: OpenParserComponentSchemaName }
  | { binary: true }
  | {
      component:
        | 'JobAccepted'
        | 'BatchJobAccepted'
        | 'MalformedRequest'
        | 'Unauthorized'
        | 'Forbidden'
        | 'FileNotFound'
        | 'InsufficientCredits'
        | 'IdempotencyConflict'
        | 'LimitExceeded'
        | 'UnsupportedMediaType'
        | 'UnprocessableConfig'
        | 'UnprocessableOrSyncFailed'
        | 'SyncTerminalIndeterminate'
        | 'RateLimited'
        | 'ServiceUnavailable'
        | 'JobNotFound';
    };

type OpenParserRouteDefinition = {
  operationId: string;
  method: 'get' | 'post' | 'delete';
  path: string;
  tag: 'parse' | 'extract' | 'jobs' | 'files';
  requestBody?:
    | 'ParseSingleUpload'
    | 'ExtractSingleUpload'
    | 'ParseBatchUpload'
    | 'ExtractBatchUpload'
    | 'CreateFileUpload';
  parameters?: readonly ('IdempotencyKey' | 'JobId' | 'FileId' | 'ChildCursor' | 'ChildLimit')[];
  responses: Readonly<Record<number, ResponseTarget>>;
};

const admissionErrors = {
  400: { component: 'MalformedRequest' },
  401: { component: 'Unauthorized' },
  402: { component: 'InsufficientCredits' },
  403: { component: 'Forbidden' },
  409: { component: 'IdempotencyConflict' },
  413: { component: 'LimitExceeded' },
  415: { component: 'UnsupportedMediaType' },
  429: { component: 'RateLimited' },
  503: { component: 'ServiceUnavailable' },
} as const;

/** Runtime and OpenAPI source of truth for the public OpenParser HTTP surface. */
export const OPENPARSER_ROUTE_MANIFEST = [
  {
    operationId: 'parseSync',
    method: 'post',
    path: '/parse',
    tag: 'parse',
    requestBody: 'ParseSingleUpload',
    parameters: ['IdempotencyKey'],
    responses: {
      200: { schema: 'ParseResult' },
      202: { component: 'JobAccepted' },
      ...admissionErrors,
      422: { component: 'UnprocessableOrSyncFailed' },
      504: { component: 'SyncTerminalIndeterminate' },
    },
  },
  {
    operationId: 'parseAsync',
    method: 'post',
    path: '/parse/async',
    tag: 'parse',
    requestBody: 'ParseSingleUpload',
    parameters: ['IdempotencyKey'],
    responses: {
      202: { component: 'JobAccepted' },
      ...admissionErrors,
      422: { component: 'UnprocessableConfig' },
    },
  },
  {
    operationId: 'parseBatch',
    method: 'post',
    path: '/parse/batch',
    tag: 'parse',
    requestBody: 'ParseBatchUpload',
    parameters: ['IdempotencyKey'],
    responses: {
      202: { component: 'BatchJobAccepted' },
      ...admissionErrors,
      422: { component: 'UnprocessableConfig' },
    },
  },
  {
    operationId: 'extractSync',
    method: 'post',
    path: '/extract',
    tag: 'extract',
    requestBody: 'ExtractSingleUpload',
    parameters: ['IdempotencyKey'],
    responses: {
      200: { schema: 'ExtractionTerminalResult' },
      202: { component: 'JobAccepted' },
      ...admissionErrors,
      422: { component: 'UnprocessableOrSyncFailed' },
      504: { component: 'SyncTerminalIndeterminate' },
    },
  },
  {
    operationId: 'extractAsync',
    method: 'post',
    path: '/extract/async',
    tag: 'extract',
    requestBody: 'ExtractSingleUpload',
    parameters: ['IdempotencyKey'],
    responses: {
      202: { component: 'JobAccepted' },
      ...admissionErrors,
      422: { component: 'UnprocessableConfig' },
    },
  },
  {
    operationId: 'extractBatch',
    method: 'post',
    path: '/extract/batch',
    tag: 'extract',
    requestBody: 'ExtractBatchUpload',
    parameters: ['IdempotencyKey'],
    responses: {
      202: { component: 'BatchJobAccepted' },
      ...admissionErrors,
      422: { component: 'UnprocessableConfig' },
    },
  },
  {
    operationId: 'getJob',
    method: 'get',
    path: '/jobs/{id}',
    tag: 'jobs',
    parameters: ['JobId', 'ChildCursor', 'ChildLimit'],
    responses: {
      200: { schema: 'Job' },
      401: { component: 'Unauthorized' },
      403: { component: 'Forbidden' },
      404: { component: 'JobNotFound' },
    },
  },
  {
    operationId: 'createFile',
    method: 'post',
    path: '/files',
    tag: 'files',
    requestBody: 'CreateFileUpload',
    responses: {
      200: { schema: 'PublicFile' },
      400: { component: 'MalformedRequest' },
      401: { component: 'Unauthorized' },
      403: { component: 'Forbidden' },
      413: { component: 'LimitExceeded' },
      415: { component: 'UnsupportedMediaType' },
    },
  },
  {
    operationId: 'getFile',
    method: 'get',
    path: '/files/{id}',
    tag: 'files',
    parameters: ['FileId'],
    responses: {
      200: { schema: 'PublicFile' },
      401: { component: 'Unauthorized' },
      403: { component: 'Forbidden' },
      404: { component: 'FileNotFound' },
    },
  },
  {
    operationId: 'deleteFile',
    method: 'delete',
    path: '/files/{id}',
    tag: 'files',
    parameters: ['FileId'],
    responses: {
      200: { schema: 'DeleteFileResponse' },
      401: { component: 'Unauthorized' },
      403: { component: 'Forbidden' },
      404: { component: 'FileNotFound' },
    },
  },
  {
    operationId: 'getFileContent',
    method: 'get',
    path: '/files/{id}/content',
    tag: 'files',
    parameters: ['FileId'],
    responses: {
      200: { binary: true },
      401: { component: 'Unauthorized' },
      403: { component: 'Forbidden' },
      404: { component: 'FileNotFound' },
    },
  },
] as const satisfies readonly OpenParserRouteDefinition[];

export type OpenParserRoute = (typeof OPENPARSER_ROUTE_MANIFEST)[number];
export type OpenParserOperationId = OpenParserRoute['operationId'];

export function getOpenParserRoute(method: string, path: string): OpenParserRoute | undefined {
  const normalizedMethod = method.toLowerCase();
  return OPENPARSER_ROUTE_MANIFEST.find((route) => {
    if (route.method !== normalizedMethod) return false;
    const pattern = route.path.replace(/\{[^/]+\}/g, '[^/]+');
    return new RegExp(`^${pattern}$`).test(path);
  });
}
