import { z } from 'zod';

/**
 * JSON to XLSX Processor Schemas
 *
 * Converts ordered columns + array-of-object rows into an XLSX workbook.
 * Writes the file to run output storage and returns file metadata.
 */

export const EXCEL_SHEET_NAME_MAX_LENGTH = 31;
export const EXCEL_RESERVED_SHEET_NAME = 'History';
const INVALID_SHEET_NAME_CHARS = /[:\\/?*[\]]/;

/** Default hard limits for transform.json-to-xlsx workbook generation. */
export const JSON_TO_XLSX_DEFAULT_LIMITS = {
  /** Maximum number of worksheets in one workbook. */
  maxSheets: 50,
  /** Maximum data rows (excluding header) per sheet. */
  maxRowsPerSheet: 100_000,
  /** Maximum data rows summed across all sheets. */
  maxTotalRows: 250_000,
  /** Maximum columns per sheet. */
  maxColumns: 256,
  /** Maximum populated cells across the workbook (header + data). */
  maxTotalCells: 5_000_000,
  /** Maximum serialized .xlsx size in bytes (50 MiB). */
  maxOutputBytes: 50 * 1024 * 1024,
} as const;

export type JsonToXlsxLimits = {
  maxSheets?: number;
  maxRowsPerSheet?: number;
  maxTotalRows?: number;
  maxColumns?: number;
  maxTotalCells?: number;
  maxOutputBytes?: number;
};

export type JsonToXlsxResolvedLimits = {
  [K in keyof typeof JSON_TO_XLSX_DEFAULT_LIMITS]: number;
};

function resolveJsonToXlsxLimit(workflowValue: number | undefined, ceiling: number): number {
  if (workflowValue === undefined) {
    return ceiling;
  }
  return Math.min(workflowValue, ceiling);
}

/**
 * Resolve effective workload limits for transform.json-to-xlsx.
 * Workflow-provided values may only lower server ceilings; they cannot raise them.
 */
export function resolveJsonToXlsxLimits(
  limits?: JsonToXlsxLimits,
  ceilings: JsonToXlsxResolvedLimits = JSON_TO_XLSX_DEFAULT_LIMITS
): JsonToXlsxResolvedLimits {
  return {
    maxSheets: resolveJsonToXlsxLimit(limits?.maxSheets, ceilings.maxSheets),
    maxRowsPerSheet: resolveJsonToXlsxLimit(limits?.maxRowsPerSheet, ceilings.maxRowsPerSheet),
    maxTotalRows: resolveJsonToXlsxLimit(limits?.maxTotalRows, ceilings.maxTotalRows),
    maxColumns: resolveJsonToXlsxLimit(limits?.maxColumns, ceilings.maxColumns),
    maxTotalCells: resolveJsonToXlsxLimit(limits?.maxTotalCells, ceilings.maxTotalCells),
    maxOutputBytes: resolveJsonToXlsxLimit(limits?.maxOutputBytes, ceilings.maxOutputBytes),
  };
}

export interface JsonToXlsxSheetWorkload {
  name: string;
  columnCount: number;
  rowCount: number;
}

export function validateJsonToXlsxWorkload(
  sheets: JsonToXlsxSheetWorkload[],
  limits: JsonToXlsxResolvedLimits
): void {
  if (sheets.length > limits.maxSheets) {
    throw new Error(
      `Workbook exceeds maxSheets limit (${limits.maxSheets}): ${sheets.length} sheets`
    );
  }

  let totalRows = 0;
  let totalCells = 0;

  for (const sheet of sheets) {
    if (sheet.columnCount > limits.maxColumns) {
      throw new Error(
        `Sheet "${sheet.name}" exceeds maxColumns limit (${limits.maxColumns}): ${sheet.columnCount} columns`
      );
    }
    if (sheet.rowCount > limits.maxRowsPerSheet) {
      throw new Error(
        `Sheet "${sheet.name}" exceeds maxRowsPerSheet limit (${limits.maxRowsPerSheet}): ${sheet.rowCount} rows`
      );
    }

    totalRows += sheet.rowCount;
    totalCells += sheet.columnCount * (sheet.rowCount + 1);
  }

  if (totalRows > limits.maxTotalRows) {
    throw new Error(
      `Workbook exceeds maxTotalRows limit (${limits.maxTotalRows}): ${totalRows} rows`
    );
  }
  if (totalCells > limits.maxTotalCells) {
    throw new Error(
      `Workbook exceeds maxTotalCells limit (${limits.maxTotalCells}): ${totalCells} cells`
    );
  }
}

/**
 * Excel worksheet name rules shared by authoring, Studio, and the workbook builder.
 * Duplicate names are checked separately because they need the full workbook context.
 */
export function excelSheetNameIssue(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) {
    return 'Sheet name cannot be empty';
  }
  if (trimmed.length > EXCEL_SHEET_NAME_MAX_LENGTH) {
    return `Sheet name exceeds Excel's 31-character limit: "${trimmed}"`;
  }
  if (INVALID_SHEET_NAME_CHARS.test(trimmed)) {
    return `Invalid sheet name "${trimmed}". Excel sheet names cannot contain : \\ / ? * [ ]`;
  }
  if (trimmed.startsWith("'") || trimmed.endsWith("'")) {
    return `Invalid sheet name "${trimmed}". Excel sheet names cannot start or end with a single quote`;
  }
  if (trimmed.toLowerCase() === EXCEL_RESERVED_SHEET_NAME.toLowerCase()) {
    return `Sheet name "${trimmed}" is reserved by Excel`;
  }
  return null;
}

export const JsonToXlsxColumnTypeSchema = z
  .enum(['string', 'number', 'boolean', 'date'])
  .describe(
    'Cell type. Omit to infer from the JSON value. YYYY-MM-DD strings stay text unless type is date.'
  );

export const JsonToXlsxColumnSchema = z.object({
  key: z.string().min(1).describe('Row object key to read for this column'),
  header: z.string().optional().describe('Header cell text. Defaults to key.'),
  type: JsonToXlsxColumnTypeSchema.optional(),
});

export const JsonToXlsxSheetNameSchema = z
  .string()
  .superRefine((name, ctx) => {
    const issue = excelSheetNameIssue(name);
    if (issue) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: issue });
    }
  })
  .describe(
    'Sheet name. Defaults to Sheet1, Sheet2, …. Excel limit: 31 characters. Cannot contain : \\ / ? * [ ], cannot start or end with a single quote, and History is reserved.'
  );

export const JsonToXlsxResolvedRowsSchema = z
  .array(z.record(z.string(), z.unknown()))
  .describe('Array of row objects');

export const JsonToXlsxSheetSchema = z.object({
  name: JsonToXlsxSheetNameSchema.optional(),
  columns: z.array(JsonToXlsxColumnSchema).min(1).describe('Ordered columns for this sheet'),
  rows: JsonToXlsxResolvedRowsSchema,
});

export const JsonToXlsxInputSchema = z.object({});

export const JsonToXlsxSheetResultSchema = z.object({
  name: z.string().describe('Written sheet name'),
  rowCount: z.number().int().min(0).describe('Number of data rows written (excludes header)'),
});

export const JsonToXlsxOutputSchema = z.object({
  fileId: z.string().describe('File ID from the files table'),
  filename: z.string().describe('Sanitized output filename including .xlsx'),
  sheetCount: z.number().int().min(1).describe('Number of sheets in the workbook'),
  sheets: z.array(JsonToXlsxSheetResultSchema).describe('Per-sheet name and row count'),
});

export function refineJsonToXlsxLayout(
  cfg: { sheets?: unknown; columns?: unknown; rows?: unknown },
  ctx: z.RefinementCtx
): void {
  const hasSheets = Array.isArray(cfg.sheets) && cfg.sheets.length > 0;
  const hasShorthand = cfg.columns !== undefined || cfg.rows !== undefined;
  if (hasSheets && hasShorthand) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Use either sheets or top-level columns/rows, not both',
      path: ['sheets'],
    });
  }
  if (!hasSheets) {
    if (!Array.isArray(cfg.columns) || cfg.columns.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide columns and rows, or a sheets array',
        path: ['columns'],
      });
    }
    if (cfg.rows === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide columns and rows, or a sheets array',
        path: ['rows'],
      });
    }
  }
}

export const JsonToXlsxLimitsSchema = z
  .object({
    maxSheets: z
      .number()
      .int()
      .min(1)
      .max(JSON_TO_XLSX_DEFAULT_LIMITS.maxSheets)
      .optional()
      .describe(
        `Maximum worksheets. Omitted uses the server default (${JSON_TO_XLSX_DEFAULT_LIMITS.maxSheets}). Cannot exceed it.`
      ),
    maxRowsPerSheet: z
      .number()
      .int()
      .min(1)
      .max(JSON_TO_XLSX_DEFAULT_LIMITS.maxRowsPerSheet)
      .optional()
      .describe(
        `Maximum data rows per sheet. Omitted uses the server default (${JSON_TO_XLSX_DEFAULT_LIMITS.maxRowsPerSheet.toLocaleString('en-US')}). Cannot exceed it.`
      ),
    maxTotalRows: z
      .number()
      .int()
      .min(1)
      .max(JSON_TO_XLSX_DEFAULT_LIMITS.maxTotalRows)
      .optional()
      .describe(
        `Maximum data rows summed across all sheets. Omitted uses the server default (${JSON_TO_XLSX_DEFAULT_LIMITS.maxTotalRows.toLocaleString('en-US')}). Cannot exceed it.`
      ),
    maxColumns: z
      .number()
      .int()
      .min(1)
      .max(JSON_TO_XLSX_DEFAULT_LIMITS.maxColumns)
      .optional()
      .describe(
        `Maximum columns per sheet. Omitted uses the server default (${JSON_TO_XLSX_DEFAULT_LIMITS.maxColumns}). Cannot exceed it.`
      ),
    maxTotalCells: z
      .number()
      .int()
      .min(1)
      .max(JSON_TO_XLSX_DEFAULT_LIMITS.maxTotalCells)
      .optional()
      .describe(
        `Maximum populated cells across the workbook. Omitted uses the server default (${JSON_TO_XLSX_DEFAULT_LIMITS.maxTotalCells.toLocaleString('en-US')}). Cannot exceed it.`
      ),
    maxOutputBytes: z
      .number()
      .int()
      .min(1)
      .max(JSON_TO_XLSX_DEFAULT_LIMITS.maxOutputBytes)
      .optional()
      .describe(
        `Maximum serialized .xlsx size in bytes. Omitted uses the server default (${JSON_TO_XLSX_DEFAULT_LIMITS.maxOutputBytes.toLocaleString('en-US')}, 50 MiB). Cannot exceed it.`
      ),
  })
  .describe(
    'Optional workload caps that can only lower the server defaults. Omitted fields use the server defaults.'
  );

export const JsonToXlsxConfigSchema = z
  .object({
    filename: z.string().optional().describe('Output filename. .xlsx is added if omitted.'),
    columns: z
      .array(JsonToXlsxColumnSchema)
      .min(1)
      .optional()
      .describe('Ordered columns for a single-sheet workbook. Use sheets for multiple sheets.'),
    rows: JsonToXlsxResolvedRowsSchema.optional(),
    sheets: z
      .array(JsonToXlsxSheetSchema)
      .min(1)
      .optional()
      .describe('Multiple sheets. Do not combine with top-level columns/rows.'),
    limits: JsonToXlsxLimitsSchema.optional(),
  })
  .superRefine(refineJsonToXlsxLayout);

export type JsonToXlsxColumnType = z.infer<typeof JsonToXlsxColumnTypeSchema>;
export type JsonToXlsxColumn = z.infer<typeof JsonToXlsxColumnSchema>;
export type JsonToXlsxSheet = z.infer<typeof JsonToXlsxSheetSchema>;
export type JsonToXlsxInput = z.infer<typeof JsonToXlsxInputSchema>;
export type JsonToXlsxOutput = z.infer<typeof JsonToXlsxOutputSchema>;
export type JsonToXlsxConfig = z.infer<typeof JsonToXlsxConfigSchema>;
export type JsonToXlsxLimitsConfig = z.infer<typeof JsonToXlsxLimitsSchema>;
