import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildRunFormData } from './run-form-data';

describe('buildRunFormData', () => {
  test('infers MIME type from file extension on uploaded blobs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'run-form-data-'));
    try {
      const filePath = join(dir, 'contract.pdf');
      await writeFile(filePath, Buffer.from('%PDF-1.4'));

      const form = await buildRunFormData({
        inputFile: `document=${filePath}`,
        inputJson: '{"language":"en"}',
      });

      const file = form.get('document') as File;
      expect(file.type).toBe('application/pdf');
      expect(file.name).toBe('contract.pdf');
      expect(JSON.parse(form.get('_json') as string)).toEqual({ language: 'en' });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
