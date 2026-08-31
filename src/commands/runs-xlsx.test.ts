import { describe, expect, test } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import { DEFAULT_XLSX_LIMITS, extractXlsxComparableText } from '../lib/xlsx-workbook';

function createWorkbookFile(
  path: string,
  sheets: Array<{ name: string; rows: unknown[][] }>,
  mutate?: (workbook: XLSX.WorkBook) => void
): Promise<void> {
  const workbook = XLSX.utils.book_new();
  for (const sheet of sheets) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(sheet.rows), sheet.name);
  }
  mutate?.(workbook);
  return writeFile(path, Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })));
}

describe('runs compare XLSX semantics', () => {
  test('structured workbook digest matches across metadata-only XLSX rewrites', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'runs-xlsx-compare-'));
    const leftPath = join(dir, 'left.xlsx');
    const rightPath = join(dir, 'right.xlsx');

    const rows = [
      ['SKU', 'Count'],
      ['A-1', 10],
    ];
    await createWorkbookFile(leftPath, [{ name: 'Inventory', rows }], (workbook) => {
      workbook.Props = { Author: 'agent-left' };
    });
    await createWorkbookFile(rightPath, [{ name: 'Inventory', rows }], (workbook) => {
      workbook.Props = { Author: 'agent-right' };
    });

    const leftText = extractXlsxComparableText(leftPath).text;
    const rightText = extractXlsxComparableText(rightPath).text;
    expect(leftText).toBe(rightText);
  });

  test('detects cell differences beyond inspect caps that capped snapshots would miss', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'runs-xlsx-compare-'));
    const leftPath = join(dir, 'left.xlsx');
    const rightPath = join(dir, 'right.xlsx');

    const rows: unknown[][] = [['Value']];
    for (let row = 1; row <= DEFAULT_XLSX_LIMITS.maxRowsPerSheet + 1; row += 1) {
      rows.push([row]);
    }
    const changedRows = rows.map((row, index) =>
      index === rows.length - 1 ? [999] : [...(row as unknown[])]
    );

    await createWorkbookFile(leftPath, [{ name: 'Sheet1', rows }]);
    await createWorkbookFile(rightPath, [{ name: 'Sheet1', rows: changedRows }]);

    const leftText = extractXlsxComparableText(leftPath).text;
    const rightText = extractXlsxComparableText(rightPath).text;
    expect(leftText).toMatch(/^[a-f0-9]{64}$/);
    expect(rightText).toMatch(/^[a-f0-9]{64}$/);
    expect(leftText).not.toBe(rightText);
  });
});
