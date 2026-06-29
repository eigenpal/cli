import { z } from 'zod';

export const DbFileRefSchema = z.object({
  kind: z.literal('file'),
  fileId: z.string().describe('File ID from files table'),
  filename: z.string().optional().describe('Original filename'),
  mimeType: z.string().optional().describe('MIME type'),
});

export const LegacyFileIdInputSchema = z.object({
  kind: z.never().optional(),
  fileId: z.string().describe('File ID from files table'),
  filename: z.string().optional().describe('Original filename'),
  mimeType: z.string().optional().describe('MIME type'),
});

export const LocalFileRefSchema = z.object({
  kind: z.literal('local'),
  path: z.string().describe('Absolute path to a file on disk'),
  filename: z.string().describe('Original filename'),
  mimeType: z.string().describe('MIME type of the file'),
});

export const S3FileRefSchema = z.object({
  kind: z.literal('s3'),
  ref: z.string().describe('Storage key (suffix-only, prefix added by adapter)'),
  filename: z.string().describe('Original filename'),
  mimeType: z.string().describe('MIME type of the file'),
});

export const InlineFileRefSchema = z.object({
  kind: z.literal('inline'),
  base64: z.string().describe('Base64-encoded file bytes'),
  filename: z.string().describe('Original filename'),
  mimeType: z.string().describe('MIME type of the file'),
});

/**
 * Runtime file references all processors and workflow execution paths can consume.
 *
 * Archive-only shapes such as `{ "$file": "input/..." }` are intentionally not part
 * of this contract; dataset import/export resolves them before execution.
 */
export const RuntimeFileRefSchema = z.discriminatedUnion('kind', [
  DbFileRefSchema,
  LocalFileRefSchema,
  S3FileRefSchema,
  InlineFileRefSchema,
]);

/**
 * File path descriptors are runtime file refs that do not have a `files` table row.
 * Kept as a named subtype because existing processors branch on direct path/storage
 * reads separately from DB-backed file refs.
 */
export const FilePathDescriptorSchema = z.discriminatedUnion('kind', [
  LocalFileRefSchema,
  S3FileRefSchema,
  InlineFileRefSchema,
]);

export const ResolvedProcessorFileSchema = z
  .object({
    __eigenpalFile: z.literal(true),
    source: z.enum(['db', 'tenant-s3', 'local', 'inline']),
    filename: z.string().describe('Display filename for processor logs and parser routing'),
    mimeType: z.string().describe('MIME type for processor routing'),
    fileId: z.string().optional().describe('Legacy files-table id for db-backed handles'),
    ref: z.string().optional().describe('Tenant-scoped storage key suffix for S3-backed handles'),
    path: z.string().optional().describe('Local filesystem path for headless/CLI handles'),
    base64: z.string().optional().describe('Base64 bytes for inline handles'),
  })
  .strict();

export type DbFileRef = z.infer<typeof DbFileRefSchema>;
export type LegacyFileIdInput = z.infer<typeof LegacyFileIdInputSchema>;
export type LocalFileRef = z.infer<typeof LocalFileRefSchema>;
export type S3FileRef = z.infer<typeof S3FileRefSchema>;
export type InlineFileRef = z.infer<typeof InlineFileRefSchema>;
export type RuntimeFileRef = z.infer<typeof RuntimeFileRefSchema>;
export type FilePathDescriptor = z.infer<typeof FilePathDescriptorSchema>;
export type ResolvedProcessorFile = z.infer<typeof ResolvedProcessorFileSchema>;

export function isRuntimeFileRef(input: unknown): input is RuntimeFileRef {
  return RuntimeFileRefSchema.safeParse(input).success;
}

export function isFilePathDescriptor(input: unknown): input is FilePathDescriptor {
  return FilePathDescriptorSchema.safeParse(input).success;
}

export function isResolvedProcessorFile(input: unknown): input is ResolvedProcessorFile {
  return ResolvedProcessorFileSchema.safeParse(input).success;
}

export function normalizeLegacyFileIdInput(input: LegacyFileIdInput): DbFileRef {
  return {
    kind: 'file',
    fileId: input.fileId,
    ...(input.filename ? { filename: input.filename } : {}),
    ...(input.mimeType ? { mimeType: input.mimeType } : {}),
  };
}

const STRING_SCHEMA = { type: 'string' } as const;

/**
 * JSON Schema form used by public workflow input validation and the execution gate.
 * New writes use reserved sentinel refs:
 *   - { "$file": "input/..." } for scoped artifacts
 *   - { "$fileId": "file_..." } for reusable file-pool ingress
 *   - { "$inline": { filename, mimeType, base64 } } for explicit inline ingress
 */
export const WORKFLOW_FILE_REF_JSON_SCHEMA = {
  'x-eigenpal-type': 'file',
  type: 'object',
  anyOf: [
    {
      type: 'object',
      required: ['$file'],
      additionalProperties: false,
      properties: {
        $file: STRING_SCHEMA,
      },
    },
    {
      type: 'object',
      required: ['$fileId'],
      additionalProperties: false,
      properties: {
        $fileId: STRING_SCHEMA,
      },
    },
    {
      type: 'object',
      required: ['$inline'],
      additionalProperties: false,
      properties: {
        $inline: {
          type: 'object',
          required: ['filename', 'mimeType', 'base64'],
          additionalProperties: false,
          properties: {
            filename: STRING_SCHEMA,
            mimeType: STRING_SCHEMA,
            base64: STRING_SCHEMA,
          },
        },
      },
    },
  ],
} as const;
