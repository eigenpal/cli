import { assertSafeOfficeZip } from '@eigenpal/common';
import { unzipSync } from 'fflate';
import { createHash, type Hash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';

/** Default caps for agent-safe XLSX inspection output. */
export const DEFAULT_XLSX_LIMITS = {
  maxSheets: 20,
  maxRowsPerSheet: 500,
  maxColsPerSheet: 50,
} as const;

/**
 * Hard safety ceilings for semantic XLSX comparison in `runs compare`.
 * Inspect caps stay lower; comparison scans the full workbook within these bounds.
 */
export const XLSX_COMPARE_LIMITS = {
  maxSheets: 50,
  maxRowsPerSheet: 100_000,
  maxTotalRows: 250_000,
  maxColumns: 256,
  maxTotalCells: 5_000_000,
  maxFileBytes: 50 * 1024 * 1024,
} as const;

const XLSX_PARSE_MAX_FILE_BYTES = XLSX_COMPARE_LIMITS.maxFileBytes;
const WORKSHEET_PATH_RE = /^xl\/worksheets\/[^/]+\.xml$/i;
const DIMENSION_REF_RE = /<dimension\b[^>]*\bref="([^"]+)"/i;

export type XlsxComparisonDigestResult =
  | { status: 'ok'; digest: string }
  | { status: 'inconclusive'; reason: string }
  | { status: 'error'; reason: string };

export type XlsxComparableTextResult = {
  /** SHA-256 hex digest of canonical workbook content when comparison is conclusive. */
  text: string | null;
  /** True when the workbook exceeds compare safety limits — never treated as a match. */
  inconclusive?: boolean;
  reason?: string;
};

export type XlsxInspectLimits = {
  maxSheets?: number;
  maxRowsPerSheet?: number;
  maxColsPerSheet?: number;
};

export type XlsxSheetSelection = string | number;

export interface XlsxSheetInspect {
  name: string;
  dimensions: {
    rows: number;
    cols: number;
    headerRow: number;
    dataRows: number;
  };
  headers: string[];
  rows: Record<string, unknown>[];
  truncated?: {
    rows?: boolean;
    cols?: boolean;
  };
}

export interface XlsxWorkbookInspect {
  format: 'xlsx-workbook-v1';
  sheetNames: string[];
  sheets: XlsxSheetInspect[];
  limits: {
    maxSheets: number;
    maxRowsPerSheet: number;
    maxColsPerSheet: number;
  };
  truncated?: {
    sheets?: boolean;
  };
}

function resolvedLimits(limits?: XlsxInspectLimits): Required<XlsxInspectLimits> {
  return {
    maxSheets: limits?.maxSheets ?? DEFAULT_XLSX_LIMITS.maxSheets,
    maxRowsPerSheet: limits?.maxRowsPerSheet ?? DEFAULT_XLSX_LIMITS.maxRowsPerSheet,
    maxColsPerSheet: limits?.maxColsPerSheet ?? DEFAULT_XLSX_LIMITS.maxColsPerSheet,
  };
}

function normalizeCell(value: unknown): unknown {
  if (value === undefined || value === null) return '';
  return value;
}

function headerLabel(value: unknown, index: number): string {
  if (value === undefined || value === null || value === '') return `__col_${index}`;
  return String(value);
}

function sheetRangeDimensions(worksheet: XLSX.WorkSheet): { rows: number; cols: number } {
  const ref = worksheet['!ref'];
  if (!ref) return { rows: 0, cols: 0 };
  const range = XLSX.utils.decode_range(ref);
  return {
    rows: range.e.r - range.s.r + 1,
    cols: range.e.c - range.s.c + 1,
  };
}

function isZipContainer(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer.readUInt32LE(0) === 0x04034b50;
}

/**
 * Reject hostile XLSX containers and sparse dimensions before SheetJS builds
 * worksheet objects. Legacy binary XLS files skip ZIP-specific checks.
 */
function preflightWorkbookBuffer(
  buffer: Buffer,
  limits: typeof XLSX_COMPARE_LIMITS = XLSX_COMPARE_LIMITS
): void {
  if (buffer.byteLength > XLSX_PARSE_MAX_FILE_BYTES) {
    throw new Error(
      `Workbook exceeds file-size limit (${XLSX_PARSE_MAX_FILE_BYTES} bytes): ${buffer.byteLength} bytes`
    );
  }
  if (!isZipContainer(buffer)) return;

  assertSafeOfficeZip(buffer);
  const archive = unzipSync(buffer);
  const worksheetEntries = Object.entries(archive).filter(([path]) => WORKSHEET_PATH_RE.test(path));
  if (worksheetEntries.length > limits.maxSheets) {
    throw new Error(
      `Workbook exceeds maxSheets limit (${limits.maxSheets}): ${worksheetEntries.length} sheets`
    );
  }
  let totalRows = 0;
  let totalCells = 0;
  for (const [path, bytes] of worksheetEntries) {
    const match = DIMENSION_REF_RE.exec(new TextDecoder().decode(bytes));
    if (!match?.[1]) continue;
    const range = XLSX.utils.decode_range(match[1]);
    const rows = range.e.r - range.s.r + 1;
    const cols = range.e.c - range.s.c + 1;
    totalRows += rows;
    totalCells += rows * cols;
    if (rows > limits.maxRowsPerSheet || cols > limits.maxColumns) {
      throw new Error(
        `Worksheet "${path}" exceeds safe dimensions (maxRowsPerSheet=${limits.maxRowsPerSheet}, maxColumns=${limits.maxColumns}): ${rows}x${cols}`
      );
    }
    if (rows * cols > limits.maxTotalCells) {
      throw new Error(
        `Worksheet "${path}" exceeds maxTotalCells limit (${limits.maxTotalCells}): ${rows * cols} cells`
      );
    }
  }
  if (totalRows > limits.maxTotalRows || totalCells > limits.maxTotalCells) {
    throw new Error(
      `Workbook exceeds aggregate safe dimensions (${limits.maxTotalRows} rows, ${limits.maxTotalCells} cells): ${totalRows} rows, ${totalCells} cells`
    );
  }
}

function parseSheetSelection(raw: string): XlsxSheetSelection {
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10);
  return trimmed;
}

function sheetIncluded(
  sheetName: string,
  index: number,
  selection: XlsxSheetSelection[] | undefined
): boolean {
  if (!selection || selection.length === 0) return true;
  return selection.some((entry) => {
    if (typeof entry === 'number') return entry === index;
    return entry === sheetName;
  });
}

function inspectWorksheet(
  worksheet: XLSX.WorkSheet,
  sheetName: string,
  limits: Required<XlsxInspectLimits>
): XlsxSheetInspect {
  const dimensions = sheetRangeDimensions(worksheet);
  const decodedRange = decodeWorksheetRange(worksheet);
  const cappedRange = decodedRange
    ? {
        s: decodedRange.s,
        e: {
          r: Math.min(decodedRange.e.r, decodedRange.s.r + limits.maxRowsPerSheet),
          c: Math.min(decodedRange.e.c, decodedRange.s.c + limits.maxColsPerSheet - 1),
        },
      }
    : undefined;
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    defval: '',
    raw: true,
    ...(cappedRange ? { range: cappedRange } : {}),
  }) as unknown[][];

  const headerRow = matrix[0] ?? [];
  const colCap = Math.min(headerRow.length, limits.maxColsPerSheet);
  const headers = headerRow.slice(0, colCap).map((cell, index) => headerLabel(cell, index));
  const colsTruncated = dimensions.cols > colCap;

  const dataMatrix = matrix.slice(1);
  const rowCap = Math.min(dataMatrix.length, limits.maxRowsPerSheet);
  const rows = dataMatrix.slice(0, rowCap).map((row) => {
    const record: Record<string, unknown> = {};
    for (let col = 0; col < headers.length; col += 1) {
      record[headers[col]] = normalizeCell(row[col]);
    }
    return record;
  });

  return {
    name: sheetName,
    dimensions: {
      rows: dimensions.rows,
      cols: dimensions.cols,
      headerRow: matrix.length > 0 ? 1 : 0,
      dataRows: Math.max(0, dimensions.rows - (matrix.length > 0 ? 1 : 0)),
    },
    headers,
    rows,
    ...(colsTruncated || dataMatrix.length > rowCap
      ? {
          truncated: {
            ...(colsTruncated ? { cols: true } : {}),
            ...(dimensions.rows > rowCap + (matrix.length > 0 ? 1 : 0) ? { rows: true } : {}),
          },
        }
      : {}),
  };
}

/**
 * Parse an XLSX/XLS buffer into a structured, size-capped workbook snapshot.
 * Ignores ZIP/container metadata — only sheet cell content is represented.
 */
export function parseXlsxWorkbook(
  buffer: Buffer,
  options?: {
    limits?: XlsxInspectLimits;
    sheets?: XlsxSheetSelection[];
  }
): XlsxWorkbookInspect {
  const limits = resolvedLimits(options?.limits);
  preflightWorkbookBuffer(buffer);
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const selectedSheets: XlsxSheetInspect[] = [];
  let sheetsTruncated = false;

  for (let index = 0; index < workbook.SheetNames.length; index += 1) {
    if (selectedSheets.length >= limits.maxSheets) {
      sheetsTruncated = true;
      break;
    }
    const sheetName = workbook.SheetNames[index];
    if (!sheetIncluded(sheetName, index, options?.sheets)) continue;
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) continue;
    selectedSheets.push(inspectWorksheet(worksheet, sheetName, limits));
  }

  return {
    format: 'xlsx-workbook-v1',
    sheetNames: [...workbook.SheetNames],
    sheets: selectedSheets,
    limits,
    ...(sheetsTruncated ? { truncated: { sheets: true } } : {}),
  };
}

/** Stable JSON text for capped inspect snapshots (not used by `runs compare`). */
export function serializeXlsxWorkbookForComparison(inspect: XlsxWorkbookInspect): string {
  return JSON.stringify(inspect);
}

const COMPARISON_DIGEST_FORMAT = 'xlsx-workbook-compare-v2';
const CANONICAL_FIELD_SEPARATOR = '\x1e';

function hashPart(hash: Hash, part: string): void {
  hash.update(part);
  hash.update(CANONICAL_FIELD_SEPARATOR);
}

function decodeWorksheetRange(worksheet: XLSX.WorkSheet): XLSX.Range | null {
  const ref = worksheet['!ref'];
  if (!ref) return null;
  return XLSX.utils.decode_range(ref);
}

function cellComparisonType(cell: XLSX.CellObject): string {
  if (cell.t) return cell.t;
  if (cell.f) return 'f';
  return 'z';
}

/** Raw displayed semantic value; formulas/styles are ignored — cached result only. */
function cellComparisonValue(cell: XLSX.CellObject): unknown {
  if (cell.v !== undefined && cell.v !== null) return cell.v;
  if (cell.w !== undefined && cell.w !== null) return cell.w;
  return '';
}

function canonicalCellValue(value: unknown): string {
  const normalized = normalizeCell(value);
  return JSON.stringify(normalized);
}

function canonicalCellFormula(formula: string | undefined): string {
  return (formula ?? '').replace(/\r\n?/g, '\n').trim().replace(/^=/, '');
}

function sheetRangeCellCount(range: XLSX.Range): number {
  return (range.e.r - range.s.r + 1) * (range.e.c - range.s.c + 1);
}

function validateWorkbookForComparison(
  workbook: XLSX.WorkBook,
  fileBytes: number
): { ok: true } | { ok: false; reason: string } {
  const limits = XLSX_COMPARE_LIMITS;
  if (fileBytes > limits.maxFileBytes) {
    return {
      ok: false,
      reason: `Workbook exceeds compare file-size limit (${limits.maxFileBytes} bytes): ${fileBytes} bytes`,
    };
  }
  if (workbook.SheetNames.length > limits.maxSheets) {
    return {
      ok: false,
      reason: `Workbook exceeds compare maxSheets limit (${limits.maxSheets}): ${workbook.SheetNames.length} sheets`,
    };
  }

  let totalRows = 0;
  let totalCells = 0;
  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) continue;
    const range = decodeWorksheetRange(worksheet);
    if (!range) continue;
    const rows = range.e.r - range.s.r + 1;
    const cols = range.e.c - range.s.c + 1;
    if (cols > limits.maxColumns) {
      return {
        ok: false,
        reason: `Sheet "${sheetName}" exceeds compare maxColumns limit (${limits.maxColumns}): ${cols} columns`,
      };
    }
    if (rows > limits.maxRowsPerSheet) {
      return {
        ok: false,
        reason: `Sheet "${sheetName}" exceeds compare maxRowsPerSheet limit (${limits.maxRowsPerSheet}): ${rows} rows`,
      };
    }
    totalRows += rows;
    totalCells += sheetRangeCellCount(range);
  }

  if (totalRows > limits.maxTotalRows) {
    return {
      ok: false,
      reason: `Workbook exceeds compare maxTotalRows limit (${limits.maxTotalRows}): ${totalRows} rows`,
    };
  }
  if (totalCells > limits.maxTotalCells) {
    return {
      ok: false,
      reason: `Workbook exceeds compare maxTotalCells limit (${limits.maxTotalCells}): ${totalCells} cells`,
    };
  }

  return { ok: true };
}

function hashWorksheetForComparison(
  hash: Hash,
  worksheet: XLSX.WorkSheet,
  sheetName: string
): void {
  hashPart(hash, 'sheet');
  hashPart(hash, sheetName);

  const range = decodeWorksheetRange(worksheet);
  if (!range) {
    hashPart(hash, 'empty-sheet');
    return;
  }

  hashPart(hash, 'range');
  hashPart(hash, String(range.s.r));
  hashPart(hash, String(range.s.c));
  hashPart(hash, String(range.e.r));
  hashPart(hash, String(range.e.c));

  for (let row = range.s.r; row <= range.e.r; row += 1) {
    hashPart(hash, 'row');
    hashPart(hash, String(row));
    for (let col = range.s.c; col <= range.e.c; col += 1) {
      const address = XLSX.utils.encode_cell({ r: row, c: col });
      hashPart(hash, 'cell');
      hashPart(hash, address);
      const cell = worksheet[address] as XLSX.CellObject | undefined;
      if (!cell) {
        hashPart(hash, 'empty');
        continue;
      }
      hashPart(hash, cellComparisonType(cell));
      hashPart(hash, 'formula');
      hashPart(hash, canonicalCellFormula(cell.f));
      hashPart(hash, canonicalCellValue(cellComparisonValue(cell)));
    }
  }

  hashPart(hash, 'end-sheet');
}

/**
 * Compute a stable SHA-256 digest of full workbook cell content for semantic comparison.
 * Ignores ZIP/container metadata. Returns inconclusive when safety limits are exceeded.
 */
export function computeXlsxWorkbookComparisonDigest(buffer: Buffer): XlsxComparisonDigestResult {
  try {
    preflightWorkbookBuffer(buffer);
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const validation = validateWorkbookForComparison(workbook, buffer.byteLength);
    if (!validation.ok) {
      return { status: 'inconclusive', reason: validation.reason };
    }

    const hash = createHash('sha256');
    hashPart(hash, COMPARISON_DIGEST_FORMAT);
    for (const sheetName of workbook.SheetNames) {
      const worksheet = workbook.Sheets[sheetName];
      if (!worksheet) continue;
      hashWorksheetForComparison(hash, worksheet, sheetName);
    }

    return { status: 'ok', digest: hash.digest('hex') };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/exceeds|safe (?:archive|inflated-size|dimensions)/i.test(message)) {
      return { status: 'inconclusive', reason: message };
    }
    return { status: 'error', reason: `XLSX parse failed (${message})` };
  }
}

export function parseSheetSelectionList(raw: string | undefined): XlsxSheetSelection[] | undefined {
  if (!raw?.trim()) return undefined;
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map(parseSheetSelection);
}

/** Extract a comparable workbook digest from a local XLSX/XLS artifact path. */
export function extractXlsxComparableText(filePath: string): XlsxComparableTextResult {
  try {
    const buffer = readFileSync(filePath);
    const result = computeXlsxWorkbookComparisonDigest(buffer);
    if (result.status === 'ok') {
      return { text: result.digest };
    }
    if (result.status === 'inconclusive') {
      return { text: null, inconclusive: true, reason: result.reason };
    }
    return {
      text: null,
      reason: `${result.reason}; compared bytes instead`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { text: null, reason: `XLSX parse failed (${message}); compared bytes instead` };
  }
}
