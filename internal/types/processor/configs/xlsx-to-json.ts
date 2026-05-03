import { z } from 'zod';
import { FileIdInputSchema, FilePathDescriptorSchema } from './document-parser';

/**
 * XLSX to JSON Processor Schemas
 *
 * Converts an XLSX file to a JSON array of row objects (first row = headers).
 * Optionally writes CSV to storage and returns fileId.
 */

export const XlsxToJsonInputSchema = z.union([FileIdInputSchema, FilePathDescriptorSchema]);

export const XlsxToJsonOutputSchema = z.object({
  rows: z
    .array(z.record(z.string(), z.unknown()))
    .describe('Array of row objects (header row = keys)'),
  fileId: z.string().optional().describe('File ID of stored CSV when outputCsv is true'),
});

export const XlsxToJsonConfigSchema = z.object({
  sheet: z
    .union([z.number().int().min(0), z.string()])
    .optional()
    .describe('Sheet to read: 0-based index or sheet name'),
  outputCsv: z.boolean().default(false).optional(),
  outputFilename: z.string().optional().describe('Output CSV filename when outputCsv is true'),
});

export type XlsxToJsonInput = z.infer<typeof XlsxToJsonInputSchema>;
export type XlsxToJsonOutput = z.infer<typeof XlsxToJsonOutputSchema>;
export type XlsxToJsonConfig = z.infer<typeof XlsxToJsonConfigSchema>;
