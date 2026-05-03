import { z } from 'zod';

/**
 * Template Processor Schemas
 *
 * Renders DOCX templates with data using docxtemplater.
 * Supports {{placeholder}} syntax with format preservation.
 */

export const TemplateInputSchema = z.object({
  data: z.record(z.string(), z.unknown()).describe('Data to merge into the template'),
});

export const TemplateOutputSchema = z.object({
  fileId: z.string().describe('File ID from files table'),
});

export const TemplateConfigSchema = z.object({
  templateId: z.string().describe('ID of the template from templates table'),
  outputFilename: z
    .string()
    .optional()
    .describe('Output filename - supports LiquidJS syntax e.g. "{{invoice_id}}-report.docx"'),
  highlightNotFound: z
    .boolean()
    .default(true)
    .optional()
    .describe('Highlight missing variables with red-colored text in the output document'),
  notFoundText: z
    .string()
    .default('NOT FOUND')
    .optional()
    .describe('Text to display for missing variables when highlightNotFound is enabled'),
});

export type TemplateInput = z.infer<typeof TemplateInputSchema>;
export type TemplateOutput = z.infer<typeof TemplateOutputSchema>;
export type TemplateConfig = z.infer<typeof TemplateConfigSchema>;
