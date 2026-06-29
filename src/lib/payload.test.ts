import { describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildExamplePayload } from './payload';

describe('buildExamplePayload', () => {
  test('converts canonical input $file refs into multipart file uploads', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eigenpal-cli-payload-'));
    try {
      const exampleDir = join(root, 'example');
      mkdirSync(join(exampleDir, 'input', 'contract'), { recursive: true });
      writeFileSync(
        join(exampleDir, 'input.json'),
        JSON.stringify({
          language: 'sk',
          contract_document: { $file: 'input/contract/contract.pdf' },
        })
      );
      writeFileSync(join(exampleDir, 'input', 'contract', 'contract.pdf'), Buffer.from('%PDF-1.4'));

      const payload = buildExamplePayload(exampleDir);

      expect(payload.scalars).toEqual({ language: 'sk' });
      expect(payload.files).toHaveLength(1);
      expect(payload.files[0]).toMatchObject({
        argument: 'contract_document',
        filename: 'contract.pdf',
        mimeType: 'application/pdf',
      });
      expect(payload.files[0]?.content.toString()).toBe('%PDF-1.4');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('rejects $file refs with sibling keys', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eigenpal-cli-payload-'));
    try {
      const exampleDir = join(root, 'example');
      mkdirSync(exampleDir, { recursive: true });
      writeFileSync(
        join(exampleDir, 'input.json'),
        JSON.stringify({ document: { $file: 'input/document.pdf', filename: 'document.pdf' } })
      );

      expect(() => buildExamplePayload(exampleDir)).toThrow(/exact/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('materializes nested $file refs as inline ingress refs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eigenpal-cli-payload-'));
    try {
      const exampleDir = join(root, 'example');
      mkdirSync(join(exampleDir, 'input', 'attachments'), { recursive: true });
      writeFileSync(
        join(exampleDir, 'input.json'),
        JSON.stringify({
          package: {
            attachments: [{ $file: 'input/attachments/contract.pdf' }],
          },
        })
      );
      writeFileSync(
        join(exampleDir, 'input', 'attachments', 'contract.pdf'),
        Buffer.from('%PDF-1.4')
      );

      const payload = buildExamplePayload(exampleDir);

      expect(payload.files).toEqual([]);
      expect(payload.scalars).toEqual({
        package: {
          attachments: [
            {
              $inline: {
                filename: 'contract.pdf',
                mimeType: 'application/pdf',
                base64: Buffer.from('%PDF-1.4').toString('base64'),
              },
            },
          ],
        },
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
