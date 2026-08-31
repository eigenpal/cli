import { resolveJsonToXlsxLimits, type JsonToXlsxResolvedLimits } from '@eigenpal/types';
import PizZip from 'pizzip';
import {
  collectXlsxSharedStringItems,
  collectXlsxTextFromXml,
  inspectXlsxTemplatePlaceholders,
  parseXlsxPlaceholderInner,
  type ParsedXlsxPlaceholder,
} from './office-placeholder-inspect';

const ROW_RE = /<row\b([^>]*)>([\s\S]*?)<\/row>/gi;
const CELL_RE = /<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/gi;
const SHEET_TAG_RE = /<sheet\b[^>]*>/gi;
const RELATIONSHIP_TAG_RE = /<Relationship\b[^>]*>/gi;

export type XlsxTemplateRenderLimits = JsonToXlsxResolvedLimits;

export type XlsxTemplateSheetWorkload = {
  name: string;
  columnCount: number;
  rowCount: number;
};

/**
 * Hard ceilings for XLSX `{table:...}` expansion. Same numbers as
 * `transform.json-to-xlsx`; not caller-overridable at render time.
 */
export function xlsxTemplateRenderLimits(): XlsxTemplateRenderLimits {
  return resolveJsonToXlsxLimits();
}

function xmlAttr(tag: string, name: string): string | undefined {
  const match = new RegExp(`(?:^|[\\s:])${name}="([^"]*)"`, 'i').exec(tag);
  return match?.[1];
}

function colNumberFromRef(ref: string): number {
  const match = /^[A-Z]+/i.exec(ref);
  if (!match) return 0;
  let n = 0;
  for (const ch of match[0].toUpperCase()) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n;
}

function getByPath(data: unknown, path: string): unknown {
  if (!path) return undefined;
  let current = data;
  for (const part of path.split('.')) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function placeholdersInText(text: string): ParsedXlsxPlaceholder[] {
  const found: ParsedXlsxPlaceholder[] = [];
  const re = /\{([^{}]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const parsed = parseXlsxPlaceholderInner(match[1]);
    if (parsed) found.push(parsed);
  }
  return found;
}

function worksheetTargetPath(target: string): string {
  const trimmed = target.replace(/^\//, '');
  if (trimmed.startsWith('xl/')) return trimmed;
  return `xl/${trimmed}`;
}

function listWorksheets(zip: PizZip): Array<{ name: string; path: string }> {
  const workbook = zip.file('xl/workbook.xml');
  const rels = zip.file('xl/_rels/workbook.xml.rels');
  const fallback = Object.keys(zip.files)
    .filter((name) => /^xl\/worksheets\/[^/]+\.xml$/i.test(name))
    .sort()
    .map((path, index) => ({ name: `Sheet${index + 1}`, path }));
  if (!workbook) return fallback;

  const idToPath = new Map<string, string>();
  if (rels) {
    RELATIONSHIP_TAG_RE.lastIndex = 0;
    let rel: RegExpExecArray | null;
    const relXml = rels.asText();
    while ((rel = RELATIONSHIP_TAG_RE.exec(relXml))) {
      const tag = rel[0];
      const id = xmlAttr(tag, 'Id');
      const target = xmlAttr(tag, 'Target');
      const type = xmlAttr(tag, 'Type') ?? '';
      if (id && target && type.includes('worksheet')) {
        idToPath.set(id, worksheetTargetPath(target));
      }
    }
  }

  const sheets: Array<{ name: string; path: string }> = [];
  SHEET_TAG_RE.lastIndex = 0;
  const workbookXml = workbook.asText();
  let sheetTag: RegExpExecArray | null;
  while ((sheetTag = SHEET_TAG_RE.exec(workbookXml))) {
    const tag = sheetTag[0];
    const name = xmlAttr(tag, 'name') ?? `Sheet${sheets.length + 1}`;
    const rId = xmlAttr(tag, 'id');
    const path = rId ? idToPath.get(rId) : undefined;
    if (path && zip.file(path)) {
      sheets.push({ name, path });
    }
  }
  return sheets.length > 0 ? sheets : fallback;
}

/**
 * Scan every table element that the engine can expand (up to the row ceiling).
 * Short-circuit only after a width already cannot pass maxColumns — never a
 * prefix sample.
 */
function maxArrayFieldWidth(
  rows: unknown[],
  field: string,
  rowCeiling: number,
  stopAtWidth: number
): number {
  let maxWidth = 1;
  const limit = Math.min(rows.length, rowCeiling);
  for (let i = 0; i < limit; i++) {
    const element = rows[i];
    if (element == null || typeof element !== 'object') continue;
    const value = getByPath(element, field);
    if (Array.isArray(value)) {
      maxWidth = Math.max(maxWidth, value.length);
      if (maxWidth > stopAtWidth) return maxWidth;
    }
  }
  return maxWidth;
}

/**
 * Estimate row/column counts after `{table:...}` expansion, matching the
 * engine: placeholders on one prototype row share `newTableRows`, so extra
 * rows are max(array lengths) − 1. Distinct prototype rows add. Unattributed
 * table arrays still count toward totals.
 */
export function estimateXlsxTemplateExpansion(
  buffer: Buffer,
  data: Record<string, unknown>,
  limits: XlsxTemplateRenderLimits = xlsxTemplateRenderLimits()
): XlsxTemplateSheetWorkload[] {
  const zip = new PizZip(buffer);
  const sharedFile = zip.file('xl/sharedStrings.xml');
  const sharedStrings = sharedFile ? collectXlsxSharedStringItems(sharedFile.asText()) : [];
  const attributedArrays = new Set<string>();
  const sheets: XlsxTemplateSheetWorkload[] = [];

  for (const sheet of listWorksheets(zip)) {
    const xml = zip.file(sheet.path)?.asText() ?? '';
    let originalRows = 0;
    let originalCols = 0;
    let extraRows = 0;
    let extraCols = 0;

    ROW_RE.lastIndex = 0;
    let rowMatch: RegExpExecArray | null;
    while ((rowMatch = ROW_RE.exec(xml))) {
      originalRows += 1;
      const rowXml = rowMatch[2] ?? '';
      const lengthsByArray = new Map<string, number>();
      let rowExtraCols = 0;

      CELL_RE.lastIndex = 0;
      let cellMatch: RegExpExecArray | null;
      while ((cellMatch = CELL_RE.exec(rowXml))) {
        const attrs = cellMatch[1] ?? '';
        const body = cellMatch[2] ?? '';
        const ref = xmlAttr(attrs, 'r');
        if (ref) originalCols = Math.max(originalCols, colNumberFromRef(ref));
        const type = xmlAttr(attrs, 't');
        let text = '';
        if (type === 's') {
          const valueMatch = /<v\b[^>]*>([\s\S]*?)<\/v>/i.exec(body);
          const index = Number(valueMatch?.[1]);
          if (Number.isInteger(index) && index >= 0) {
            text = sharedStrings[index] ?? '';
          }
        } else if (type === 'inlineStr' || body.includes('<is')) {
          text = collectXlsxTextFromXml(body).join('');
        }
        for (const placeholder of placeholdersInText(text)) {
          if (placeholder.type === 'normal') {
            const raw = getByPath(data, placeholder.name);
            if (Array.isArray(raw)) {
              attributedArrays.add(placeholder.name);
              rowExtraCols += Math.max(0, raw.length - 1);
            }
            continue;
          }
          if (!placeholder.key) continue;
          attributedArrays.add(placeholder.name);
          const raw = getByPath(data, placeholder.name);
          const length = Array.isArray(raw) ? raw.length : 0;
          lengthsByArray.set(
            placeholder.name,
            Math.max(lengthsByArray.get(placeholder.name) ?? 0, length)
          );
          if (Array.isArray(raw) && placeholder.key && raw.length <= limits.maxRowsPerSheet) {
            const width = maxArrayFieldWidth(
              raw,
              placeholder.key,
              limits.maxRowsPerSheet,
              limits.maxColumns
            );
            rowExtraCols += Math.max(0, width - 1);
          }
        }
      }

      const maxLen = Math.max(0, ...lengthsByArray.values());
      extraRows += Math.max(0, maxLen - 1);
      extraCols = Math.max(extraCols, rowExtraCols);
    }

    sheets.push({
      name: sheet.name,
      rowCount: originalRows + extraRows,
      columnCount: Math.max(originalCols + extraCols, originalCols, 1),
    });
  }

  const inspection = inspectXlsxTemplatePlaceholders(buffer);
  let unattributedRows = 0;
  let unattributedCols = 1;
  for (const name of inspection.placeholders) {
    const parsed = parseXlsxPlaceholderInner(name);
    if (!parsed) continue;
    if (attributedArrays.has(parsed.name)) continue;
    const raw = getByPath(data, parsed.name);
    if (!Array.isArray(raw)) continue;
    if (parsed.type === 'normal') {
      unattributedCols = Math.max(unattributedCols, raw.length);
      continue;
    }
    if (!parsed.key) continue;
    unattributedRows += raw.length;
    if (raw.length <= limits.maxRowsPerSheet) {
      unattributedCols = Math.max(
        unattributedCols,
        maxArrayFieldWidth(raw, parsed.key, limits.maxRowsPerSheet, limits.maxColumns)
      );
    }
  }
  if (unattributedRows > 0 || unattributedCols > 1) {
    sheets.push({
      name: '(unattributed array expansion)',
      rowCount: Math.max(unattributedRows, 1),
      columnCount: unattributedCols,
    });
  }

  if (sheets.length === 0) {
    sheets.push({ name: 'Sheet1', rowCount: 0, columnCount: 1 });
  }
  return sheets;
}

export function assertXlsxTemplateExpansionWithinLimits(
  sheets: XlsxTemplateSheetWorkload[],
  limits: XlsxTemplateRenderLimits = xlsxTemplateRenderLimits()
): void {
  if (sheets.length > limits.maxSheets) {
    throw new Error(
      `XLSX template expansion exceeds maxSheets limit (${limits.maxSheets}): ${sheets.length} sheets`
    );
  }

  let totalRows = 0;
  let totalCells = 0;

  for (const sheet of sheets) {
    if (sheet.columnCount > limits.maxColumns) {
      throw new Error(
        `XLSX template expansion on sheet "${sheet.name}" exceeds maxColumns limit (${limits.maxColumns}): ${sheet.columnCount} columns. Reduce array-valued {table:...} fields or split columns.`
      );
    }
    if (sheet.rowCount > limits.maxRowsPerSheet) {
      throw new Error(
        `XLSX template expansion on sheet "${sheet.name}" exceeds maxRowsPerSheet limit (${limits.maxRowsPerSheet}): ${sheet.rowCount} rows. Reduce the {table:...} array or split across sheets.`
      );
    }
    totalRows += sheet.rowCount;
    totalCells += sheet.columnCount * sheet.rowCount;
  }

  if (totalRows > limits.maxTotalRows) {
    throw new Error(
      `XLSX template expansion exceeds maxTotalRows limit (${limits.maxTotalRows}): ${totalRows} rows. Reduce {table:...} arrays or split across workbooks.`
    );
  }
  if (totalCells > limits.maxTotalCells) {
    throw new Error(
      `XLSX template expansion exceeds maxTotalCells limit (${limits.maxTotalCells}): ${totalCells} cells. Reduce rows, columns, or {table:...} arrays.`
    );
  }
}

export function assertXlsxTemplateOutputBytes(
  buffer: Buffer,
  maxOutputBytes: number = xlsxTemplateRenderLimits().maxOutputBytes
): void {
  if (buffer.length > maxOutputBytes) {
    throw new Error(
      `Generated XLSX exceeds maxOutputBytes limit (${maxOutputBytes}): ${buffer.length} bytes. Reduce {table:...} rows or template size.`
    );
  }
}

export function assertXlsxTemplateWorkload(
  buffer: Buffer,
  data: Record<string, unknown>,
  limits: XlsxTemplateRenderLimits = xlsxTemplateRenderLimits()
): void {
  const sheets = estimateXlsxTemplateExpansion(buffer, data, limits);
  assertXlsxTemplateExpansionWithinLimits(sheets, limits);
}
