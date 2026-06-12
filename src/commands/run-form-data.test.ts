import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildRunFormData } from './run-form-data';

describe('buildRunFormData', () => {
  test('uses canonical multipart envelope fields', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'run-form-data-'));
    try {
      const filePath = join(dir, 'contract.pdf');
      await writeFile(filePath, Buffer.from('%PDF-1.4'));

      const form = await buildRunFormData({
        target: 'workflows.invoice',
        inputFile: `document=${filePath}`,
        inputJson: '{"language":"en"}',
        overrides: { steps: { extract: { output: { ok: true } } } },
      });

      const file = form.get('files.document') as File;
      expect(file.type).toBe('application/pdf');
      expect(file.name).toBe('contract.pdf');
      expect(JSON.parse(form.get('input') as string)).toEqual({ language: 'en' });
      expect(JSON.parse(form.get('overrides') as string)).toEqual({
        steps: { extract: { output: { ok: true } } },
      });
      expect(form.get('_json')).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
