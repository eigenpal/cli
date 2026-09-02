import PizZip from 'pizzip';
import {
  inspectSafeOfficeZip,
  isOfficeZipContainer,
  type OfficeZipInspection,
} from './office-zip-safety';

export const OLE_COMPOUND_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] as const;

/** Excel worksheet grid: rows 1–1,048,576, columns A–XFD (16,384). */
export const EXCEL_WORKSHEET_MAX_ROWS = 1_048_576;
export const EXCEL_WORKSHEET_MAX_COLUMNS = 16_384;

export const SPREADSHEET_WORKSHEET_PATH_RE = /^xl\/worksheets\/[^/]+\.xml$/i;
const DIMENSION_REF_RE = /<dimension\b[^>]*\bref="([^"]+)"/i;
const WORKSHEET_ROOT_RE = /<(?:[A-Za-z][\w.-]*:)?worksheet\b/i;
const CELL_REF_RE = /<(?:[A-Za-z][\w.-]*:)?c\b[^>]*\br="(\$?[A-Za-z]+\$?\d+)"/gi;
const ROW_INDEX_RE = /<(?:[A-Za-z][\w.-]*:)?row\b[^>]*\br="(\d+)"/gi;

export const SPREADSHEET_ZIP_STRUCTURE_DEFAULTS = {
  maxSheets: 256,
  maxRowsPerSheet: EXCEL_WORKSHEET_MAX_ROWS,
  maxColumns: EXCEL_WORKSHEET_MAX_COLUMNS,
} as const;

export type SpreadsheetZipStructureLimits = {
  maxSheets: number;
  maxRowsPerSheet: number;
  maxColumns: number;
  maxCellsPerSheet?: number;
  maxTotalRows?: number;
  maxTotalCells?: number;
};

export type SpreadsheetZipClassification =
  | { kind: 'xlsx' }
  | { kind: 'unsupported'; format: 'ods' | 'xlsm' | 'xlsb' | 'other'; message: string };

export type SpreadsheetWorksheetDimension = {
  path: string;
  ref: string;
  rows: number;
  cols: number;
};

export type SafeSpreadsheetZip = {
  inspection: OfficeZipInspection;
  worksheets: SpreadsheetWorksheetDimension[];
  dimensionedWorksheets: number;
};

export function isOleCompoundFile(bytes: Buffer): boolean {
  return (
    bytes.length >= OLE_COMPOUND_MAGIC.length &&
    OLE_COMPOUND_MAGIC.every((byte, i) => bytes[i] === byte)
  );
}

export function decodeA1RangeDimensions(ref: string): { rows: number; cols: number } {
  const range = decodeA1Range(ref);
  return {
    rows: range.e.r - range.s.r + 1,
    cols: range.e.c - range.s.c + 1,
  };
}

function decodeA1Range(ref: string): { s: { r: number; c: number }; e: { r: number; c: number } } {
  const trimmed = ref.trim();
  const parts = trimmed.split(':');
  const start = decodeA1Cell(parts[0] ?? '');
  const end = parts[1] ? decodeA1Cell(parts[1]) : start;
  return {
    s: { r: Math.min(start.r, end.r), c: Math.min(start.c, end.c) },
    e: { r: Math.max(start.r, end.r), c: Math.max(start.c, end.c) },
  };
}

function decodeA1Cell(ref: string): { r: number; c: number } {
  const match = /^\$?([A-Za-z]+)\$?(\d+)$/.exec(ref.trim());
  if (!match) {
    throw new Error(`Invalid A1 reference: ${ref}`);
  }
  let col = 0;
  for (const ch of match[1]!.toUpperCase()) {
    col = col * 26 + (ch.charCodeAt(0) - 64);
  }
  return { r: Number(match[2]) - 1, c: col - 1 };
}

function entryPaths(inspection: OfficeZipInspection): string[] {
  return inspection.entries.map((entry) => entry.path.replace(/\\/g, '/'));
}

function hasPath(paths: string[], suffix: string): boolean {
  const needle = suffix.toLowerCase();
  return paths.some(
    (path) => path.toLowerCase() === needle || path.toLowerCase().endsWith(`/${needle}`)
  );
}

/**
 * Classify an Office ZIP from central-directory entry names — never from
 * compressed file bytes or cell text.
 */
export function classifyOfficeSpreadsheetZip(
  inspection: OfficeZipInspection
): SpreadsheetZipClassification {
  const paths = entryPaths(inspection);
  if (hasPath(paths, 'xl/workbook.bin')) {
    return {
      kind: 'unsupported',
      format: 'xlsb',
      message: 'Unsupported spreadsheet: .xlsb is not supported. Use .xls or .xlsx.',
    };
  }
  if (hasPath(paths, 'xl/vbaProject.bin')) {
    return {
      kind: 'unsupported',
      format: 'xlsm',
      message: 'Unsupported spreadsheet: .xlsm is not supported. Use .xls or .xlsx.',
    };
  }
  const hasWorkbookXml = hasPath(paths, 'xl/workbook.xml');
  const looksOds =
    hasPath(paths, 'mimetype') ||
    (hasPath(paths, 'content.xml') && hasPath(paths, 'META-INF/manifest.xml'));
  if (looksOds && !hasWorkbookXml) {
    return {
      kind: 'unsupported',
      format: 'ods',
      message: 'Unsupported spreadsheet: ODS is not supported. Use .xls or .xlsx.',
    };
  }
  if (hasWorkbookXml) {
    return { kind: 'xlsx' };
  }
  return {
    kind: 'unsupported',
    format: 'other',
    message: 'Unsupported spreadsheet: expected an .xls or .xlsx workbook',
  };
}

export function assertExcelGridRange(label: string, ref: string): void {
  let range: { s: { r: number; c: number }; e: { r: number; c: number } };
  try {
    range = decodeA1Range(ref);
  } catch {
    throw new Error(
      `Corrupt or unreadable spreadsheet: worksheet "${label}" has an invalid dimension`
    );
  }
  assertExcelGridCell(label, range.s.r, range.s.c);
  assertExcelGridCell(label, range.e.r, range.e.c);
}

function assertExcelGridCell(label: string, r: number, c: number): void {
  if (r < 0 || c < 0 || r >= EXCEL_WORKSHEET_MAX_ROWS || c >= EXCEL_WORKSHEET_MAX_COLUMNS) {
    throw new Error(
      `Worksheet "${label}" is outside the Excel grid (max ${EXCEL_WORKSHEET_MAX_ROWS} rows × ${EXCEL_WORKSHEET_MAX_COLUMNS} columns)`
    );
  }
}

function assertOptionalCountLimits(
  label: string,
  rows: number,
  cols: number,
  limits: SpreadsheetZipStructureLimits
): void {
  const cells = rows * cols;
  if (rows > limits.maxRowsPerSheet || cols > limits.maxColumns) {
    throw new Error(
      `Worksheet "${label}" exceeds safe dimensions (maxRowsPerSheet=${limits.maxRowsPerSheet}, maxColumns=${limits.maxColumns}): ${rows}x${cols}`
    );
  }
  if (limits.maxCellsPerSheet !== undefined && cells > limits.maxCellsPerSheet) {
    throw new Error(
      `Worksheet "${label}" exceeds maxTotalCells limit (${limits.maxCellsPerSheet}): ${cells} cells`
    );
  }
}

function assertSheetRange(
  label: string,
  ref: string,
  limits: SpreadsheetZipStructureLimits
): { rows: number; cols: number } {
  assertExcelGridRange(label, ref);
  const { rows, cols } = decodeA1RangeDimensions(ref);
  assertOptionalCountLimits(label, rows, cols, limits);
  return { rows, cols };
}

/**
 * Cheap scan of cell/row refs when `<dimension>` is missing. Rejects Excel-grid
 * (and optional caller count) overflows only — empty or undimensioned sheets with
 * in-grid cells are allowed.
 */
function assertMissingDimensionCellRefs(
  path: string,
  xml: string,
  limits: SpreadsheetZipStructureLimits
): void {
  CELL_REF_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  let maxRow = 0;
  let maxCol = 0;
  let sawCell = false;
  while ((match = CELL_REF_RE.exec(xml)) !== null) {
    sawCell = true;
    let cell: { r: number; c: number };
    try {
      cell = decodeA1Cell(match[1]!);
    } catch {
      throw new Error(
        `Corrupt or unreadable spreadsheet: worksheet "${path}" has an invalid cell reference`
      );
    }
    assertExcelGridCell(path, cell.r, cell.c);
    maxRow = Math.max(maxRow, cell.r + 1);
    maxCol = Math.max(maxCol, cell.c + 1);
  }

  ROW_INDEX_RE.lastIndex = 0;
  while ((match = ROW_INDEX_RE.exec(xml)) !== null) {
    const row = Number(match[1]);
    if (!Number.isFinite(row) || row < 1) {
      throw new Error(
        `Corrupt or unreadable spreadsheet: worksheet "${path}" has an invalid row reference`
      );
    }
    assertExcelGridCell(path, row - 1, 0);
    maxRow = Math.max(maxRow, row);
  }

  if (sawCell) {
    assertOptionalCountLimits(path, maxRow, maxCol, limits);
  }
}

/**
 * Safety + format + Excel-grid preflight for OOXML workbooks.
 * Call before SheetJS reads a ZIP. Legacy OLE/.xls files must not use this.
 *
 * Default limits are the Excel grid (and a sheet-count cap), not conversion
 * row/column/cell ceilings. Callers such as CLI compare may pass tighter count
 * limits. Missing `<dimension>` is allowed; a cheap cell-ref scan still rejects
 * out-of-grid addresses.
 */
export function assertSafeSpreadsheetZip(
  bytes: Buffer,
  limits: SpreadsheetZipStructureLimits = SPREADSHEET_ZIP_STRUCTURE_DEFAULTS
): SafeSpreadsheetZip {
  if (!isOfficeZipContainer(bytes)) {
    throw new Error('Unsupported spreadsheet: expected an .xls or .xlsx workbook');
  }
  const inspection = inspectSafeOfficeZip(bytes);
  const classified = classifyOfficeSpreadsheetZip(inspection);
  if (classified.kind !== 'xlsx') {
    throw new Error(classified.message);
  }

  const worksheetEntries = inspection.entries.filter((entry) =>
    SPREADSHEET_WORKSHEET_PATH_RE.test(entry.path)
  );
  if (worksheetEntries.length > limits.maxSheets) {
    throw new Error(
      `Workbook exceeds maxSheets limit (${limits.maxSheets}): ${worksheetEntries.length} sheets`
    );
  }

  let zip: PizZip;
  try {
    zip = new PizZip(bytes);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Corrupt or unreadable spreadsheet: ${message}`);
  }

  const worksheets: SpreadsheetWorksheetDimension[] = [];
  let totalRows = 0;
  let totalCells = 0;

  for (const entry of worksheetEntries) {
    const file = zip.file(entry.path);
    if (!file) {
      throw new Error(`Corrupt or unreadable spreadsheet: missing worksheet ${entry.path}`);
    }
    const xml = file.asText();
    if (!WORKSHEET_ROOT_RE.test(xml)) {
      throw new Error(
        `Corrupt or unreadable spreadsheet: worksheet "${entry.path}" is not valid worksheet XML`
      );
    }
    const match = DIMENSION_REF_RE.exec(xml);
    if (!match?.[1]) {
      assertMissingDimensionCellRefs(entry.path, xml, limits);
      continue;
    }
    const { rows, cols } = assertSheetRange(entry.path, match[1], limits);
    totalRows += rows;
    totalCells += rows * cols;
    worksheets.push({ path: entry.path, ref: match[1], rows, cols });
  }

  if (limits.maxTotalRows !== undefined && totalRows > limits.maxTotalRows) {
    throw new Error(
      `Workbook exceeds aggregate safe dimensions (${limits.maxTotalRows} rows, ${limits.maxTotalCells ?? 'n/a'} cells): ${totalRows} rows, ${totalCells} cells`
    );
  }
  if (limits.maxTotalCells !== undefined && totalCells > limits.maxTotalCells) {
    throw new Error(
      `Workbook exceeds aggregate safe dimensions (${limits.maxTotalRows ?? 'n/a'} rows, ${limits.maxTotalCells} cells): ${totalRows} rows, ${totalCells} cells`
    );
  }

  return {
    inspection,
    worksheets,
    dimensionedWorksheets: worksheets.length,
  };
}
