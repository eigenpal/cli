import { z } from 'zod';
import { ResolvedProcessorFileSchema } from '../../files/runtime-file-ref';
import { PageResultSchema } from '../../parser/parser';

/**
 * PDF Embedder Processor Schemas
 *
 * Embeds text layer into scanned PDFs/images to make them searchable.
 * Uses word positions from a prior ai.parse step.
 *
 * Workflow pattern:
 * 1. ai.parse step (with OCR) → extracts text + word bounding boxes
 * 2. transform.pdf-embed step → uses those positions to embed invisible text layer
 *
 * This design:
 * - Runs OCR only once (in parse step)
 * - Allows preview of OCR text before embedding
 * - Keeps concerns separated (parsing vs embedding)
 */

export const PdfEmbedderInputSchema = z.object({
  // Required: source file
  file: ResolvedProcessorFileSchema.describe('Resolved source file handle'),

  // Required: parse result from ai.parse step
  parseResult: z
    .object({
      pages: z.array(PageResultSchema),
      text: z.string().optional(),
    })
    .describe('Parse result from ai.parse step (must include word positions)'),
});

export const PdfEmbedderOutputSchema = z.object({
  fileId: z.string().describe('File ID from files table'),
  pageCount: z.number().describe('Number of pages in the output PDF'),
  wordCount: z.number().describe('Number of words embedded'),
  text: z.string().describe('Extracted text (from parse step)'),
});

export const PdfEmbedderConfigSchema = z
  .object({
    // Output options
    outputFilename: z
      .string()
      .optional()
      .describe('Output filename - supports LiquidJS syntax e.g. "{{filename}}-searchable.pdf"'),

    // Word filtering
    confidenceThreshold: z
      .number()
      .min(0)
      .max(1)
      .default(0.7)
      .describe(
        'Minimum OCR confidence (0-1) to include a word. Lower = more words but more errors'
      ),
  })
  .prefault({});

export type PdfEmbedderInput = z.infer<typeof PdfEmbedderInputSchema>;
export type PdfEmbedderOutput = z.infer<typeof PdfEmbedderOutputSchema>;
export type PdfEmbedderConfig = z.infer<typeof PdfEmbedderConfigSchema>;
