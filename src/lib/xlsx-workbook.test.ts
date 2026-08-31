import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import {
  computeXlsxWorkbookComparisonDigest,
  DEFAULT_XLSX_LIMITS,
  extractXlsxComparableText,
  parseSheetSelectionList,
  parseXlsxWorkbook,
  serializeXlsxWorkbookForComparison,
  XLSX_COMPARE_LIMITS,
} from './xlsx-workbook';

const tempDirPromise = mkdtemp(join(tmpdir(), 'cli-xlsx-workbook-'));

function createWorkbookBuffer(
  sheets: Array<{ name: string; rows: unknown[][]; origin?: string }>,
  mutate?: (workbook: XLSX.WorkBook) => void
): Buffer {
  const workbook = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const worksheet = XLSX.utils.aoa_to_sheet(
      sheet.rows,
      sheet.origin ? ({ origin: sheet.origin } as XLSX.AOA2SheetOpts) : undefined
    );
    XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name);
  }
  mutate?.(workbook);
  return Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
}

function digestHex(buffer: Buffer): string {
  const result = computeXlsxWorkbookComparisonDigest(buffer);
  expect(result.status).toBe('ok');
  if (result.status !== 'ok') throw new Error('expected ok digest');
  return result.digest;
}

describe('parseXlsxWorkbook', () => {
  test('returns sheet names, ordered headers, and typed rows', () => {
    const buffer = createWorkbookBuffer([
      {
        name: 'Data',
        rows: [
          ['Name', 'Score', 'Active'],
          ['Alice', 100, true],
          ['Bob', 85, false],
        ],
      },
    ]);

    const inspect = parseXlsxWorkbook(buffer);
    expect(inspect.format).toBe('xlsx-workbook-v1');
    expect(inspect.sheetNames).toEqual(['Data']);
    expect(inspect.sheets).toHaveLength(1);
    expect(inspect.sheets[0]?.headers).toEqual(['Name', 'Score', 'Active']);
    expect(inspect.sheets[0]?.rows).toEqual([
      { Name: 'Alice', Score: 100, Active: true },
      { Name: 'Bob', Score: 85, Active: false },
    ]);
    expect(inspect.sheets[0]?.dimensions).toMatchObject({ rows: 3, cols: 3, dataRows: 2 });
  });

  test('selects sheets by name or index', () => {
    const buffer = createWorkbookBuffer([
      { name: 'First', rows: [['A'], [1]] },
      { name: 'Second', rows: [['B'], [2]] },
    ]);

    const byName = parseXlsxWorkbook(buffer, { sheets: ['Second'] });
    expect(byName.sheets.map((sheet) => sheet.name)).toEqual(['Second']);

    const byIndex = parseXlsxWorkbook(buffer, { sheets: [1] });
    expect(byIndex.sheets.map((sheet) => sheet.name)).toEqual(['Second']);
  });

  test('applies row and column limits with truncation markers', () => {
    const buffer = createWorkbookBuffer([
      {
        name: 'Wide',
        rows: [
          ['c1', 'c2', 'c3'],
          [1, 2, 3],
          [4, 5, 6],
        ],
      },
    ]);

    const inspect = parseXlsxWorkbook(buffer, {
      limits: { maxRowsPerSheet: 1, maxColsPerSheet: 2 },
    });
    expect(inspect.sheets[0]?.headers).toEqual(['c1', 'c2']);
    expect(inspect.sheets[0]?.rows).toHaveLength(1);
    expect(inspect.sheets[0]?.truncated).toEqual({ rows: true, cols: true });
  });

  test('parseSheetSelectionList accepts comma-separated names and indices', () => {
    expect(parseSheetSelectionList('Summary,2,Data')).toEqual(['Summary', 2, 'Data']);
  });
});

describe('semantic XLSX comparison text', () => {
  let tempDir = '';

  beforeAll(async () => {
    tempDir = await tempDirPromise;
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test('matches workbooks with identical sheet content but different ZIP metadata', async () => {
    const rows = [
      ['Item', 'Qty'],
      ['Widget', 3],
    ];
    const left = createWorkbookBuffer([{ name: 'Sheet1', rows }], (workbook) => {
      workbook.Props = { Title: 'left-version' };
    });
    const right = createWorkbookBuffer([{ name: 'Sheet1', rows }], (workbook) => {
      workbook.Props = { Title: 'right-version' };
    });

    const leftText = serializeXlsxWorkbookForComparison(parseXlsxWorkbook(left));
    const rightText = serializeXlsxWorkbookForComparison(parseXlsxWorkbook(right));
    expect(leftText).toBe(rightText);
  });

  test('extractXlsxComparableText returns a stable digest for a local workbook path', async () => {
    const filePath = join(tempDir, 'report.xlsx');
    await writeFile(filePath, createWorkbookBuffer([{ name: 'Totals', rows: [['Total'], [42]] }]));

    const extracted = extractXlsxComparableText(filePath);
    expect(extracted.text).toMatch(/^[a-f0-9]{64}$/);
    expect(extracted.inconclusive).toBeUndefined();
    expect(extracted.reason).toBeUndefined();
    expect(extractXlsxComparableText(filePath).text).toBe(extracted.text);
  });

  test('detects structured content differences via digest', async () => {
    const base = join(tempDir, 'base.xlsx');
    const changed = join(tempDir, 'changed.xlsx');
    await writeFile(base, createWorkbookBuffer([{ name: 'Sheet1', rows: [['Value'], [1]] }]));
    await writeFile(changed, createWorkbookBuffer([{ name: 'Sheet1', rows: [['Value'], [2]] }]));

    const baseText = extractXlsxComparableText(base).text;
    const changedText = extractXlsxComparableText(changed).text;
    expect(baseText).not.toBe(changedText);
  });

  test('detects changed formulas even when cached values are equal', () => {
    const left = createWorkbookBuffer([{ name: 'Sheet1', rows: [['Value'], [2]] }], (workbook) => {
      workbook.Sheets.Sheet1!.A2 = { t: 'n', v: 2, f: '1+1' };
    });
    const right = createWorkbookBuffer([{ name: 'Sheet1', rows: [['Value'], [2]] }], (workbook) => {
      workbook.Sheets.Sheet1!.A2 = { t: 'n', v: 2, f: '4/2' };
    });

    expect(digestHex(left)).not.toBe(digestHex(right));
  });

  test('rejects sparse hostile worksheet dimensions before materializing rows', () => {
    const archive = unzipSync(createWorkbookBuffer([{ name: 'Sparse', rows: [['Value']] }]));
    const worksheetPath = 'xl/worksheets/sheet1.xml';
    const worksheet = new TextDecoder().decode(archive[worksheetPath]);
    archive[worksheetPath] = strToU8(
      worksheet.replace(/<dimension ref="[^"]+"\s*\/>/, '<dimension ref="A1:XFD1048576"/>')
    );
    const sparse = Buffer.from(zipSync(archive));
    expect(() => parseXlsxWorkbook(sparse)).toThrow(/safe dimensions/);
    const comparison = computeXlsxWorkbookComparisonDigest(sparse);
    expect(comparison.status).toBe('inconclusive');
    if (comparison.status === 'inconclusive')
      expect(comparison.reason).toContain('safe dimensions');
  });

  test('compare digest matches identical workbooks beyond inspect row cap', () => {
    const rows: unknown[][] = [['Value']];
    for (let row = 1; row <= DEFAULT_XLSX_LIMITS.maxRowsPerSheet + 1; row += 1) {
      rows.push([row]);
    }
    const left = createWorkbookBuffer([{ name: 'Sheet1', rows }]);
    const right = createWorkbookBuffer([{ name: 'Sheet1', rows: rows.map((r) => [...r]) }]);
    const leftDigest = computeXlsxWorkbookComparisonDigest(left);
    const rightDigest = computeXlsxWorkbookComparisonDigest(right);
    expect(leftDigest.status).toBe('ok');
    expect(rightDigest.status).toBe('ok');
    if (leftDigest.status === 'ok' && rightDigest.status === 'ok') {
      expect(leftDigest.digest).toBe(rightDigest.digest);
    }
  });

  test('compare digest detects differences beyond inspect row cap', () => {
    const baseRows: unknown[][] = [['Value']];
    const changedRows: unknown[][] = [['Value']];
    for (let row = 1; row <= DEFAULT_XLSX_LIMITS.maxRowsPerSheet + 1; row += 1) {
      baseRows.push([row]);
      changedRows.push([row === DEFAULT_XLSX_LIMITS.maxRowsPerSheet + 1 ? 999 : row]);
    }
    const baseDigest = computeXlsxWorkbookComparisonDigest(
      createWorkbookBuffer([{ name: 'Sheet1', rows: baseRows }])
    );
    const changedDigest = computeXlsxWorkbookComparisonDigest(
      createWorkbookBuffer([{ name: 'Sheet1', rows: changedRows }])
    );
    expect(baseDigest.status).toBe('ok');
    expect(changedDigest.status).toBe('ok');
    if (baseDigest.status === 'ok' && changedDigest.status === 'ok') {
      expect(baseDigest.digest).not.toBe(changedDigest.digest);
    }
  });

  test('compare digest detects differences beyond inspect column cap', () => {
    const headers = Array.from(
      { length: DEFAULT_XLSX_LIMITS.maxColsPerSheet + 1 },
      (_, index) => `c${index + 1}`
    );
    const leftRow = headers.map((_, index) => (index === headers.length - 1 ? 1 : 0));
    const rightRow = headers.map((_, index) => (index === headers.length - 1 ? 2 : 0));
    const leftDigest = computeXlsxWorkbookComparisonDigest(
      createWorkbookBuffer([{ name: 'Wide', rows: [headers, leftRow] }])
    );
    const rightDigest = computeXlsxWorkbookComparisonDigest(
      createWorkbookBuffer([{ name: 'Wide', rows: [headers, rightRow] }])
    );
    expect(leftDigest.status).toBe('ok');
    expect(rightDigest.status).toBe('ok');
    if (leftDigest.status === 'ok' && rightDigest.status === 'ok') {
      expect(leftDigest.digest).not.toBe(rightDigest.digest);
    }
  });

  test('compare digest detects differences beyond inspect sheet cap', () => {
    const sheets = Array.from({ length: DEFAULT_XLSX_LIMITS.maxSheets + 1 }, (_, index) => ({
      name: `Sheet${index + 1}`,
      rows: [['Value'], [index + 1]],
    }));
    const leftDigest = computeXlsxWorkbookComparisonDigest(createWorkbookBuffer(sheets));
    const changedSheets = sheets.map((sheet, index) =>
      index === sheets.length - 1 ? { ...sheet, rows: [['Value'], [999]] as unknown[][] } : sheet
    );
    const rightDigest = computeXlsxWorkbookComparisonDigest(createWorkbookBuffer(changedSheets));
    expect(leftDigest.status).toBe('ok');
    expect(rightDigest.status).toBe('ok');
    if (leftDigest.status === 'ok' && rightDigest.status === 'ok') {
      expect(leftDigest.digest).not.toBe(rightDigest.digest);
    }
  });

  test('returns inconclusive when compare safety limits are exceeded', () => {
    const rows: unknown[][] = [['Value']];
    for (let row = 1; row <= XLSX_COMPARE_LIMITS.maxRowsPerSheet + 1; row += 1) {
      rows.push([row]);
    }
    const result = computeXlsxWorkbookComparisonDigest(
      createWorkbookBuffer([{ name: 'Huge', rows }])
    );
    expect(result.status).toBe('inconclusive');
    if (result.status === 'inconclusive') {
      expect(result.reason).toContain('maxRowsPerSheet');
    }
  });

  test('does not collapse single-column rows into a wide header row', () => {
    const columnLayout = digestHex(
      createWorkbookBuffer([{ name: 'S', rows: [['a'], ['b'], ['c']] }])
    );
    const wideLayout = digestHex(createWorkbookBuffer([{ name: 'S', rows: [['a', 'b'], ['c']] }]));
    expect(columnLayout).not.toBe(wideLayout);
  });

  test('hashes values in later columns when the first row is blank or narrow', () => {
    const narrowHeader = digestHex(
      createWorkbookBuffer([
        {
          name: 'S',
          rows: [[''], ['', 'keep'], ['', 'tail']],
        },
      ])
    );
    const changedLaterColumn = digestHex(
      createWorkbookBuffer([
        {
          name: 'S',
          rows: [[''], ['', 'keep'], ['', 'changed']],
        },
      ])
    );
    const missingLaterColumn = digestHex(
      createWorkbookBuffer([
        {
          name: 'S',
          rows: [[''], ['', 'keep']],
        },
      ])
    );
    expect(narrowHeader).not.toBe(changedLaterColumn);
    expect(narrowHeader).not.toBe(missingLaterColumn);
  });

  test('includes shifted range origins in the digest', () => {
    const atOrigin = digestHex(createWorkbookBuffer([{ name: 'S', rows: [['x', 'y']] }]));
    const shifted = digestHex(
      createWorkbookBuffer([{ name: 'S', rows: [['x', 'y']], origin: 'B2' }])
    );
    expect(atOrigin).not.toBe(shifted);
  });

  test('distinguishes trailing blank rows and cells inside the sheet range', () => {
    const compact = digestHex(createWorkbookBuffer([{ name: 'S', rows: [['a'], ['b'], ['c']] }]));
    const trailingBlankRow = digestHex(
      createWorkbookBuffer([{ name: 'S', rows: [['a'], ['b'], ['c'], ['']] }])
    );
    const trailingBlankCell = digestHex(
      createWorkbookBuffer([
        {
          name: 'S',
          rows: [
            ['a', ''],
            ['b', ''],
            ['c', ''],
          ],
        },
      ])
    );
    expect(compact).not.toBe(trailingBlankRow);
    expect(compact).not.toBe(trailingBlankCell);
  });
});

describe('DEFAULT_XLSX_LIMITS', () => {
  test('documents agent-safe defaults', () => {
    expect(DEFAULT_XLSX_LIMITS).toEqual({
      maxSheets: 20,
      maxRowsPerSheet: 500,
      maxColsPerSheet: 50,
    });
  });
});
