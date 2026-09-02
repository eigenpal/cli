import { z } from 'zod';
import { ResolvedProcessorFileSchema } from '../../files/runtime-file-ref';

/**
 * Spreadsheet to JSON processor schemas (`transform.xlsx-to-json`).
 *
 * Reads one worksheet from a content-detected .xls or .xlsx file into an
 * array of row objects. Default public output is `rows` (plus `fileId` when
 * CSV is stored). Metadata is opt-in.
 */

/** Default hard limits for transform.xlsx-to-json. Workflow values may only lower these. */
export const XLSX_TO_JSON_DEFAULT_LIMITS = {
  /** Maximum input file size in bytes (50 MiB). */
  maxInputBytes: 50 * 1024 * 1024,
  /** Maximum rows in the effective rectangular range (header + data). */
  maxRows: 100_000,
  /** Maximum columns in the effective rectangular range. */
  maxColumns: 256,
  /** Maximum cells in the effective rectangular range (rows × columns). */
  maxCells: 5_000_000,
} as const;

/** Successful conversion warnings kept on output; one truncation diagnostic may follow. */
export const XLSX_TO_JSON_DIAGNOSTIC_CAP = 100;

export type XlsxToJsonLimits = {
  maxInputBytes?: number;
  maxRows?: number;
  maxColumns?: number;
  maxCells?: number;
};

export type XlsxToJsonResolvedLimits = {
  [K in keyof typeof XLSX_TO_JSON_DEFAULT_LIMITS]: number;
};

function resolveXlsxToJsonLimit(workflowValue: number | undefined, ceiling: number): number {
  if (workflowValue === undefined) {
    return ceiling;
  }
  return Math.min(workflowValue, ceiling);
}

/**
 * Resolve effective workload limits. Workflow-provided values may only lower
 * server ceilings; they cannot raise them.
 */
export function resolveXlsxToJsonLimits(
  limits?: XlsxToJsonLimits,
  ceilings: XlsxToJsonResolvedLimits = XLSX_TO_JSON_DEFAULT_LIMITS
): XlsxToJsonResolvedLimits {
  return {
    maxInputBytes: resolveXlsxToJsonLimit(limits?.maxInputBytes, ceilings.maxInputBytes),
    maxRows: resolveXlsxToJsonLimit(limits?.maxRows, ceilings.maxRows),
    maxColumns: resolveXlsxToJsonLimit(limits?.maxColumns, ceilings.maxColumns),
    maxCells: resolveXlsxToJsonLimit(limits?.maxCells, ceilings.maxCells),
  };
}

export interface XlsxToJsonSheetWorkload {
  byteLength: number;
  rowCount: number;
  columnCount: number;
}

export function validateXlsxToJsonWorkload(
  sheet: XlsxToJsonSheetWorkload,
  limits: XlsxToJsonResolvedLimits
): void {
  if (sheet.byteLength > limits.maxInputBytes) {
    throw new Error(
      `Spreadsheet exceeds maxInputBytes limit (${limits.maxInputBytes}): ${sheet.byteLength} bytes`
    );
  }
  if (sheet.columnCount > limits.maxColumns) {
    throw new Error(
      `Spreadsheet exceeds maxColumns limit (${limits.maxColumns}): ${sheet.columnCount} columns`
    );
  }
  if (sheet.rowCount > limits.maxRows) {
    throw new Error(
      `Spreadsheet exceeds maxRows limit (${limits.maxRows}): ${sheet.rowCount} rows`
    );
  }
  const cells = sheet.rowCount * sheet.columnCount;
  if (cells > limits.maxCells) {
    throw new Error(`Spreadsheet exceeds maxCells limit (${limits.maxCells}): ${cells} cells`);
  }
}

/** Rectangular A1 range without a sheet qualifier, e.g. A1:D20 or B2. */
const A1_RANGE_RE = /^\$?[A-Za-z]+\$?\d+(?::\$?[A-Za-z]+\$?\d+)?$/;

export function xlsxToJsonRangeIssue(range: string): string | null {
  const trimmed = range.trim();
  if (!trimmed) {
    return 'Range cannot be empty';
  }
  if (/[!,]/.test(trimmed) || /\s/.test(trimmed)) {
    return 'Range must be a single rectangular A1 area without a sheet qualifier (e.g. A1:D20)';
  }
  if (!A1_RANGE_RE.test(trimmed)) {
    return 'Range must be a rectangular A1 reference such as A1:D20 or B2';
  }
  return null;
}

export const XlsxToJsonColumnSchema = z
  .object({
    key: z.string().min(1).describe('Output object key for this column'),
    index: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('0-based absolute worksheet column. Use instead of header.'),
    header: z
      .string()
      .min(1)
      .optional()
      .describe('Exact displayed header text. Use instead of index. Requires a header row.'),
    occurrence: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe(
        '1-based occurrence of header when the same displayed header appears more than once. Only valid with header.'
      ),
  })
  .superRefine((col, ctx) => {
    const hasIndex = col.index !== undefined;
    const hasHeader = col.header !== undefined;
    if (hasIndex === hasHeader) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Each column must have exactly one source: index or header',
      });
    }
    if (col.occurrence !== undefined && !hasHeader) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'occurrence is only valid with header',
        path: ['occurrence'],
      });
    }
  });

function refineUniqueOutputKeys(
  columns: Array<{ key: string }> | undefined,
  ctx: z.RefinementCtx
): void {
  if (!columns) return;
  const seen = new Set<string>();
  for (let i = 0; i < columns.length; i++) {
    const key = columns[i]!.key;
    if (seen.has(key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate output key "${key}"`,
        path: [i, 'key'],
      });
    }
    seen.add(key);
  }
}

export const XlsxToJsonLimitsSchema = z
  .object({
    maxInputBytes: z
      .number()
      .int()
      .min(1)
      .max(XLSX_TO_JSON_DEFAULT_LIMITS.maxInputBytes)
      .optional()
      .describe(
        `Maximum input file size in bytes. Omitted uses the server default (${XLSX_TO_JSON_DEFAULT_LIMITS.maxInputBytes.toLocaleString('en-US')}, 50 MiB). Cannot exceed it.`
      ),
    maxRows: z
      .number()
      .int()
      .min(1)
      .max(XLSX_TO_JSON_DEFAULT_LIMITS.maxRows)
      .optional()
      .describe(
        `Maximum rows in the selected range. Omitted uses the server default (${XLSX_TO_JSON_DEFAULT_LIMITS.maxRows.toLocaleString('en-US')}). Cannot exceed it.`
      ),
    maxColumns: z
      .number()
      .int()
      .min(1)
      .max(XLSX_TO_JSON_DEFAULT_LIMITS.maxColumns)
      .optional()
      .describe(
        `Maximum columns in the selected range. Omitted uses the server default (${XLSX_TO_JSON_DEFAULT_LIMITS.maxColumns}). Cannot exceed it.`
      ),
    maxCells: z
      .number()
      .int()
      .min(1)
      .max(XLSX_TO_JSON_DEFAULT_LIMITS.maxCells)
      .optional()
      .describe(
        `Maximum cells in the selected range. Omitted uses the server default (${XLSX_TO_JSON_DEFAULT_LIMITS.maxCells.toLocaleString('en-US')}). Cannot exceed it.`
      ),
  })
  .describe(
    'Optional workload caps that can only lower the server defaults. Omitted fields use the server defaults.'
  );

export const XlsxToJsonInputSchema = ResolvedProcessorFileSchema;

export const XlsxToJsonSheetMetaSchema = z.object({
  name: z.string().describe('Selected sheet name'),
  index: z.number().int().min(0).describe('0-based sheet index in the workbook'),
  range: z.string().describe('Effective rectangular A1 range that was read'),
  rowCount: z.number().int().min(0).describe('Number of data rows returned in rows'),
  columns: z.array(z.string()).describe('Output keys in order'),
});

export const XlsxToJsonDiagnosticSchema = z.object({
  severity: z.literal('warning').describe('Diagnostic severity'),
  code: z.string().min(1).describe('Stable diagnostic code'),
  message: z.string().min(1).describe('Human-readable diagnostic message'),
  cell: z.string().optional().describe('A1 address of the related cell when applicable'),
  row: z.number().int().optional().describe('1-based Excel row when applicable'),
  column: z.number().int().optional().describe('0-based worksheet column when applicable'),
});

export const XlsxToJsonOutputSchema = z.object({
  rows: z
    .array(z.record(z.string(), z.unknown()))
    .describe('Array of row objects (first row = headers as keys unless headerRow is false)'),
  fileId: z.string().optional().describe('File ID of stored CSV when outputCsv is true'),
  sheet: XlsxToJsonSheetMetaSchema.optional().describe(
    'Selected sheet metadata after projection. Present only when includeMetadata is true.'
  ),
  diagnostics: z
    .array(XlsxToJsonDiagnosticSchema)
    .optional()
    .describe(
      'Non-fatal warnings collected while reading the sheet. Present only when includeMetadata is true. Warnings are still logged when metadata is omitted.'
    ),
});

export function refineXlsxToJsonHeaderRowColumns(
  config: { headerRow?: false | number; columns?: Array<{ header?: string }> },
  ctx: z.RefinementCtx
): void {
  if (config.headerRow !== false || !config.columns) return;
  for (let i = 0; i < config.columns.length; i++) {
    if (config.columns[i]!.header !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Named column source requires a header row',
        path: ['columns', i, 'header'],
      });
    }
  }
}

export const XlsxToJsonConfigSchema = z
  .object({
    sheet: z
      .union([z.number().int().min(0), z.string()])
      .optional()
      .describe('Sheet to read: 0-based index or exact sheet name. Omit for the first sheet.'),
    outputCsv: z
      .boolean()
      .default(false)
      .optional()
      .describe(
        'If true, also write CSV to storage and include fileId. Zero-config uses the historical full-sheet SheetJS CSV. When columns, range, headerRow, valueMode, blankCells, or blankRows are set, CSV matches that projection.'
      ),
    includeMetadata: z
      .boolean()
      .default(false)
      .optional()
      .describe(
        'If true, include sheet metadata and diagnostics in the step output. Omit to keep output as rows (and fileId when outputCsv is true). Warnings are still logged when this is false.'
      ),
    outputFilename: z.string().optional().describe('Output CSV filename when outputCsv is true'),
    headerRow: z
      .union([z.literal(false), z.number().int().min(1)])
      .optional()
      .describe(
        'Header row: a positive 1-based Excel row, or false to keep the first effective row as data. Omit to use the first effective row as the header. When range is set and this is omitted, the first range row is the header.'
      ),
    columns: z
      .array(XlsxToJsonColumnSchema)
      .min(1)
      .optional()
      .superRefine(refineUniqueOutputKeys)
      .describe(
        'Ordered output columns. Each item needs a key and exactly one source: index (0-based absolute column) or header (exact displayed header text). Named header sources require a header row. Omit to keep every column in the effective range.'
      ),
    valueMode: z
      .enum(['raw', 'displayed'])
      .default('raw')
      .optional()
      .describe(
        'raw (default) returns typed cached cell values. displayed returns formatted cell text (dates, leading zeros, punctuation, diacritics, embedded newlines). Formulas are never calculated.'
      ),
    range: z
      .string()
      .min(1)
      .optional()
      .superRefine((value, ctx) => {
        if (value === undefined) return;
        const issue = xlsxToJsonRangeIssue(value);
        if (issue) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: issue });
        }
      })
      .describe(
        'Optional rectangular A1 range without a sheet qualifier, e.g. A1:D20. Disjoint ranges are rejected.'
      ),
    blankCells: z
      .enum(['empty-string', 'null', 'omit'])
      .default('empty-string')
      .optional()
      .describe(
        'How truly empty cells appear in each row object. Default empty-string. 0, false, and a formula that cached an empty string are not empty cells.'
      ),
    blankRows: z
      .enum(['skip', 'keep'])
      .default('skip')
      .optional()
      .describe(
        'skip (default) drops rows whose projected columns are all truly empty. keep retains them. Detection uses projected columns only.'
      ),
    limits: XlsxToJsonLimitsSchema.optional(),
  })
  .superRefine(refineXlsxToJsonHeaderRowColumns);

export type XlsxToJsonInput = z.infer<typeof XlsxToJsonInputSchema>;
export type XlsxToJsonOutput = z.infer<typeof XlsxToJsonOutputSchema>;
export type XlsxToJsonConfig = z.infer<typeof XlsxToJsonConfigSchema>;
export type XlsxToJsonColumn = z.infer<typeof XlsxToJsonColumnSchema>;
export type XlsxToJsonLimitsConfig = z.infer<typeof XlsxToJsonLimitsSchema>;
export type XlsxToJsonDiagnostic = z.infer<typeof XlsxToJsonDiagnosticSchema>;
export type XlsxToJsonSheetMeta = z.infer<typeof XlsxToJsonSheetMetaSchema>;
