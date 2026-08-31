import { describe, expect, test } from 'bun:test';
import { zipSync } from 'fflate';
import * as XLSX from 'xlsx';

import { inspectOfficeTemplateBytes } from './office-template';

function createWorkbook(rows: unknown[][]): Buffer {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  return Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', bookSST: true }));
}

describe('inspectOfficeTemplateBytes', () => {
  test('detects format from Office bytes when the filename has no extension', () => {
    const bytes = createWorkbook([['{title}']]);
    const inspection = inspectOfficeTemplateBytes(bytes, 'tmpl_123456789012345678901.bin');
    expect(inspection.format).toBe('xlsx');
    expect(inspection.tokens.map((token) => token.name)).toContain('title');
  });

  test('rejects Office ZIP archives that exceed inflated-size bounds', () => {
    const bytes = Buffer.from(zipSync({ 'xl/sharedStrings.xml': new Uint8Array(2 * 1024 * 1024) }));
    expect(() => inspectOfficeTemplateBytes(bytes, 'bomb.xlsx')).toThrow('inflated-size');
  });
});
