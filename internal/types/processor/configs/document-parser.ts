import { z } from 'zod';
import { ParseResultSchema } from '../../parser/parser';

/**
 * Document Parser Processor Schemas
 *
 * Parses documents from blob storage using intelligent content-type routing.
 * Users can select OCR and/or LLM models for PDF/image parsing.
 * Plaintext and office documents are auto-detected and use native parsers.
 */

export const FileIdInputSchema = z.object({
  fileId: z.string().describe('File ID from files table'),
  filename: z.string().optional().describe('Original filename (for inline files)'),
  mimeType: z.string().optional().describe('MIME type (for inline files)'),
});

/**
 * FilePathDescriptor — used when a step input refers to a file that is NOT
 * tracked by the `files` table. Three flavours:
 *
 *   - `kind: 'local'` — emitted by `bun eigenpal exec` (CLI) and the headless
 *     server. The worker reads from the local disk path. CLI keeps working
 *     without R2 credentials for the dev loop.
 *
 *   - `kind: 's3'` — emitted by an internal step output → input chain when the
 *     producer hasn't created a `files` row (rare; most outputs do). The
 *     worker downloads from tenant storage using `ref` directly.
 *
 *   - `kind: 'inline'` — base64-encoded bytes embedded directly in the input.
 *     Used by ad-hoc API `workflow run` calls and by the eval expected-output
 *     `_inline` shape after CLI normalisation. Capped at 5 MB on the wire.
 *
 * For DB-tracked files, prefer `FileIdInputSchema` instead — the worker
 * resolves through `files.key` and benefits from row-level audit/RLS.
 */
const LocalFileRefSchema = z.object({
  kind: z.literal('local'),
  path: z.string().describe('Absolute path to a file on disk'),
  filename: z.string().describe('Original filename'),
  mimeType: z.string().describe('MIME type of the file'),
});

const S3FileRefSchema = z.object({
  kind: z.literal('s3'),
  ref: z.string().describe('Storage key (suffix-only, prefix added by adapter)'),
  filename: z.string().describe('Original filename'),
  mimeType: z.string().describe('MIME type of the file'),
});

const InlineFileRefSchema = z.object({
  kind: z.literal('inline'),
  base64: z.string().describe('Base64-encoded file bytes'),
  filename: z.string().describe('Original filename'),
  mimeType: z.string().describe('MIME type of the file'),
});

export const FilePathDescriptorSchema = z.discriminatedUnion('kind', [
  LocalFileRefSchema,
  S3FileRefSchema,
  InlineFileRefSchema,
]);

export const DocumentParserInputSchema = z.union([FileIdInputSchema, FilePathDescriptorSchema]);

export type FilePathDescriptor = z.infer<typeof FilePathDescriptorSchema>;
export type LocalFileRef = z.infer<typeof LocalFileRefSchema>;
export type S3FileRef = z.infer<typeof S3FileRefSchema>;
export type InlineFileRef = z.infer<typeof InlineFileRefSchema>;

export function isFilePathDescriptor(input: unknown): input is FilePathDescriptor {
  return FilePathDescriptorSchema.safeParse(input).success;
}

export const DocumentParserOutputSchema = ParseResultSchema;

export const DocumentParserConfigSchema = z
  .object({
    // Model selection for PDF/image parsing
    ocrModel: z.string().optional().describe('OCR provider ID for PDF/image parsing'),
    llmModel: z.string().optional().describe('LLM provider ID for vision-based parsing'),

    // VLM options
    maxConcurrency: z
      .number()
      .min(1)
      .max(10)
      .default(3)
      .describe('Max concurrent VLM batch requests'),
    pagesPerBatch: z
      .number()
      .min(1)
      .max(20)
      .default(5)
      .describe('Number of page images per VLM request'),
    prompt: z.string().optional().describe('Custom extraction prompt'),

    // Native text extraction
    nativeText: z
      .boolean()
      .default(false)
      .optional()
      .describe('Use native text extraction for PDFs with embedded text (no OCR/VLM)'),

    // OCR options
    languages: z.array(z.string()).optional().describe('OCR language hints (e.g., ["en", "de"])'),

    // Output format
    outputFormat: z
      .enum(['plain', 'markdown', 'djot', 'html'])
      .default('markdown')
      .optional()
      .describe(
        'Format for extracted text. Only the native (Kreuzberg) parser uses this — OCR/VLM always emit markdown.'
      ),
  })
  .prefault({});

export type DocumentParserInput = z.infer<typeof DocumentParserInputSchema>;
export type DocumentParserOutput = z.infer<typeof DocumentParserOutputSchema>;
export type DocumentParserConfig = z.infer<typeof DocumentParserConfigSchema>;
