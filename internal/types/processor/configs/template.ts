import { z } from 'zod';
import { TemplateIdSchema, TemplateRevisionIdSchema } from '../../core/common';

/**
 * Template Processor Schemas
 *
 * Renders DOCX and XLSX templates with data (docxtemplater and xlsx-template).
 * DOCX supports {placeholder} syntax, loops, and missing-value highlighting.
 * XLSX uses {placeholder} and {table:array.prop} row syntax; highlighting is DOCX-only.
 */

export const TemplateInputSchema = z.object({
  data: z.record(z.string(), z.unknown()).describe('Data to merge into the template'),
});

export const TemplateOutputSchema = z.object({
  fileId: z.string().describe('File ID from files table'),
});

export const TemplateConfigSchema = z.object({
  // Runtime compatibility only: old published workflows may still contain a
  // files-table id. New authoring uses TransformTemplateConfigSchema, which
  // accepts only tmpl_ identities.
  templateId: z
    .union([TemplateIdSchema, z.string().regex(/^file_[A-Za-z0-9_-]{21}$/)])
    .describe('Workspace template ID. Legacy file ids are runtime-only compatibility.'),
  templateRevisionId: TemplateRevisionIdSchema.optional().describe(
    'Optional immutable template revision ID (tmpr_...).'
  ),
  outputFilename: z
    .string()
    .optional()
    .describe('Output filename - supports LiquidJS syntax e.g. "{{invoice_id}}-report.docx"'),
  highlightNotFound: z
    .boolean()
    .default(true)
    .optional()
    .describe(
      'Highlight missing variables with red-colored text in the output document (DOCX only; ignored for XLSX)'
    ),
  notFoundText: z
    .string()
    .default('NOT FOUND')
    .optional()
    .describe(
      'Text to display for missing variables when highlightNotFound is enabled (DOCX only; ignored for XLSX)'
    ),
});

export type TemplateInput = z.infer<typeof TemplateInputSchema>;
export type TemplateOutput = z.infer<typeof TemplateOutputSchema>;
export type TemplateConfig = z.infer<typeof TemplateConfigSchema>;
