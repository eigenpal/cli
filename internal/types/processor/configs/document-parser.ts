import { z } from 'zod';
import {
  FilePathDescriptorSchema,
  LegacyFileIdInputSchema,
  ResolvedProcessorFileSchema,
  isFilePathDescriptor,
  type FilePathDescriptor,
  type InlineFileRef,
  type LocalFileRef,
  type S3FileRef,
} from '../../files/runtime-file-ref';
import { ParseResultSchema } from '../../parser/parser';

/**
 * Document Parser Processor Schemas
 *
 * Parses documents from blob storage using intelligent content-type routing.
 * Users can select OCR and/or LLM models for PDF/image parsing.
 * Plaintext and office documents are auto-detected and use native parsers.
 */

export const FileIdInputSchema = LegacyFileIdInputSchema;

/**
 * Legacy descriptor exports remain available for migration adapters, but the
 * document-parser processor itself accepts only `ResolvedProcessorFileSchema`.
 * Public `$file`, `$fileId`, legacy `{ fileId }`, local, S3, and inline shapes
 * are normalized before processor invocation.
 */
export {
  FilePathDescriptorSchema,
  isFilePathDescriptor,
  type FilePathDescriptor,
  type InlineFileRef,
  type LocalFileRef,
  type S3FileRef,
};

export const DocumentParserInputSchema = ResolvedProcessorFileSchema;

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
