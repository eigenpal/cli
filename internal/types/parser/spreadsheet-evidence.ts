import { z } from 'zod';

export const SpreadsheetCellEvidenceSchema = z.object({
  address: z.string().describe('Original A1 cell address'),
  type: z
    .string()
    .describe(
      'Excel storage type: n=number, s=string, b=boolean, e=error, d=date, z=blank. A numeric date remains type n.'
    ),
  rawValue: z
    .union([z.string(), z.number(), z.boolean(), z.null()])
    .optional()
    .describe('Stored cached value; formulas are never evaluated'),
  displayedValue: z
    .string()
    .describe('Value formatted using the workbook number format and date system'),
  numberFormat: z.string().optional(),
  formula: z.string().optional(),
  dateValue: z
    .string()
    .optional()
    .describe(
      'Calendar rendering for a valid date-formatted serial, without a timezone. Evidence of Excel formatting, not a business classification.'
    ),
  excelLeapDay: z
    .boolean()
    .optional()
    .describe('True for the fictitious 1900-02-29 in the Excel 1900 date system'),
});
export const SpreadsheetPageEvidenceSchema = z.object({
  dateSystem: z.enum(['1900', '1904']),
  declaredRange: z.string().optional(),
  cells: z.array(SpreadsheetCellEvidenceSchema),
});
export type SpreadsheetCellEvidence = z.infer<typeof SpreadsheetCellEvidenceSchema>;
export type SpreadsheetPageEvidence = z.infer<typeof SpreadsheetPageEvidenceSchema>;
