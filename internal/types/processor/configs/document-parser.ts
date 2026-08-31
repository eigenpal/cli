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
import {
  ParseModeSchema,
  ParseResultSchema,
  refineNativeParseModeConflicts,
} from '../../parser/parser';

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
    parseMode: ParseModeSchema.optional().describe(
      'Base parser for PDF/image inputs. OCR is the default. `native` extracts PDF text only (never OCR/vision). `native-or-ocr` requests OCR when pages have detectable native-text anomalies (empty, U+FFFD, lone surrogates, forbidden controls, unassigned/noncharacter, heavy PUA). Page selection, subset egress, and billing are provider-dependent. Valid-looking wrong text and literal "?" are not flagged.'
    ),
    ocrModel: z.string().optional().describe('OCR provider ID for PDF/image parsing'),
    llmModel: z.string().optional().describe('LLM provider ID for vision-based parsing'),
    figureModel: z
      .string()
      .optional()
      .describe('Vision model used only for the optional figure-description pass'),

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
    pdfRenderScale: z
      .number()
      .min(1)
      .max(4)
      .default(1)
      .optional()
      .describe('Scale factor used when rendering PDF pages for VLM parsing'),
    imageQuality: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(85)
      .optional()
      .describe('JPEG quality used for PDF page images sent to VLM parsing'),
    prompt: z.string().optional().describe('Custom extraction prompt'),

    // Native text extraction
    nativeText: z
      .boolean()
      .default(false)
      .optional()
      .describe('Use native text extraction for PDFs with embedded text (no OCR/VLM)'),

    // Figure description (orthogonal vision caption pass)
    describeFigures: z
      .boolean()
      .optional()
      .describe(
        'Opt-in (default off). After text extraction, detect figure pages with a layout model and caption them with a vision model, appending `<figure>description</figure>` to their text. Skipped for plaintext. The caption vision calls are billed.'
      ),
    figureInstructions: z
      .string()
      .optional()
      .describe('Custom instruction for the figure-description pass.'),

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
  .superRefine(refineNativeParseModeConflicts)
  .prefault({});

export type DocumentParserInput = z.infer<typeof DocumentParserInputSchema>;
export type DocumentParserOutput = z.infer<typeof DocumentParserOutputSchema>;
export type DocumentParserConfig = z.infer<typeof DocumentParserConfigSchema>;
