import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ApiClient } from '../lib/client';
import { multipartFileByteBudget } from '../lib/upload-limits';
import { buildPreparedRunRequest, buildRunFormData } from './run-form-data';

function createMockUploadClient(ids: string[]): ApiClient & { createSessionBodies: unknown[] } {
  let nextId = 0;
  const createSessionBodies: unknown[] = [];
  return {
    createSessionBodies,
    post: async (path: string, body?: unknown) => {
      if (path.endsWith('/files/uploads')) {
        createSessionBodies.push(body);
        return {
          transport: 'multipart',
          url: '/v1/files',
          maxFileSizeBytes: 100 * 1024 * 1024,
        };
      }
      throw new Error(`unexpected post: ${path}`);
    },
    postFormData: async () => ({
      id: ids[nextId++] ?? `file_${nextId}`,
      filename: 'upload.bin',
      contentType: 'application/octet-stream',
      size: 1,
      purpose: 'run-input',
      createdAt: '2026-08-04T09:00:00.000Z',
    }),
    get: async () => {
      throw new Error('unexpected get');
    },
    delete: async () => undefined,
    put: async () => {
      throw new Error('unexpected put');
    },
  } as unknown as ApiClient & { createSessionBodies: unknown[] };
}

function multipartFileParts(form: FormData, fieldName: string): File[] {
  return [...form.entries()]
    .filter(([key]) => key === `files.${fieldName}`)
    .map(([, value]) => value as unknown as File);
}

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

  test('repeats files.<field> parts for repeated same-field multipart files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'run-form-data-repeat-'));
    try {
      const firstPath = join(dir, 'a.pdf');
      const secondPath = join(dir, 'b.pdf');
      await writeFile(firstPath, Buffer.from('%PDF-a'));
      await writeFile(secondPath, Buffer.from('%PDF-b'));

      const form = await buildRunFormData({
        target: 'workflows.invoice',
        inputFile: [`document=${firstPath}`, `document=${secondPath}`],
      });

      const parts = multipartFileParts(form, 'document');
      expect(parts).toHaveLength(2);
      expect(parts.map((file) => file.name)).toEqual(['a.pdf', 'b.pdf']);
      expect(JSON.parse(form.get('input') as string)).toEqual({});
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('buildPreparedRunRequest', () => {
  test('keeps a single small file on multipart with scalar input shape', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'run-prepared-single-'));
    try {
      const filePath = join(dir, 'contract.pdf');
      await writeFile(filePath, Buffer.from('%PDF-1.4'));

      const prepared = await buildPreparedRunRequest(createMockUploadClient([]), {
        target: 'workflows.invoice',
        inputFile: `document=${filePath}`,
        inputJson: '{"language":"en"}',
      });

      expect(prepared.hasMultipartFiles).toBe(true);
      expect(multipartFileParts(prepared.form, 'document')).toHaveLength(1);
      expect(JSON.parse(String(prepared.form.get('input')))).toEqual({ language: 'en' });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('pre-uploads two same-field files when both exceed the budget', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'run-prepared-both-'));
    const over = multipartFileByteBudget()! + 1;
    try {
      const firstPath = join(dir, 'big-a.bin');
      const secondPath = join(dir, 'big-b.bin');
      await writeFile(firstPath, Buffer.alloc(over, 1));
      await writeFile(secondPath, Buffer.alloc(over, 2));

      const client = createMockUploadClient(['file_a', 'file_b']);
      const prepared = await buildPreparedRunRequest(client, {
        target: 'workflows.invoice',
        inputFile: [`document=${firstPath}`, `document=${secondPath}`],
      });

      expect(prepared.hasMultipartFiles).toBe(false);
      expect(JSON.parse(String(prepared.form.get('input')))).toEqual({
        document: [{ $fileId: 'file_a' }, { $fileId: 'file_b' }],
      });
      expect(client.createSessionBodies).toHaveLength(2);
      for (const body of client.createSessionBodies) {
        expect(body).toMatchObject({
          purpose: 'run-input',
          idempotencyKey: expect.any(String),
        });
      }
      const keys = client.createSessionBodies.map(
        (body) => (body as { idempotencyKey: string }).idempotencyKey
      );
      expect(new Set(keys).size).toBe(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('sends a stable idempotency key on each pre-upload create-session', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'run-prepared-idem-'));
    const over = multipartFileByteBudget()! + 1;
    try {
      const filePath = join(dir, 'big.bin');
      await writeFile(filePath, Buffer.alloc(over, 1));

      const client = createMockUploadClient(['file_large']);
      await buildPreparedRunRequest(client, {
        target: 'workflows.invoice',
        inputFile: `document=${filePath}`,
      });

      expect(client.createSessionBodies).toHaveLength(1);
      const body = client.createSessionBodies[0] as { idempotencyKey: string };
      expect(body.idempotencyKey).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('pre-uploads both same-field files when only one exceeds the budget', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'run-prepared-mixed-same-field-'));
    const over = multipartFileByteBudget()! + 1;
    try {
      const largePath = join(dir, 'big.bin');
      const smallPath = join(dir, 'small.bin');
      await writeFile(largePath, Buffer.alloc(over, 1));
      await writeFile(smallPath, Buffer.from('small'));

      const prepared = await buildPreparedRunRequest(
        createMockUploadClient(['file_large', 'file_small']),
        {
          target: 'workflows.invoice',
          inputFile: [`document=${largePath}`, `document=${smallPath}`],
        }
      );

      expect(prepared.hasMultipartFiles).toBe(false);
      expect(JSON.parse(String(prepared.form.get('input')))).toEqual({
        document: [{ $fileId: 'file_large' }, { $fileId: 'file_small' }],
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('handles mixed fields with ordered scalar and array file refs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'run-prepared-mixed-fields-'));
    const over = multipartFileByteBudget()! + 1;
    try {
      const contractPath = join(dir, 'contract.pdf');
      const firstAttachmentPath = join(dir, 'a.bin');
      const secondAttachmentPath = join(dir, 'b.bin');
      await writeFile(contractPath, Buffer.from('%PDF-1.4'));
      await writeFile(firstAttachmentPath, Buffer.alloc(over, 1));
      await writeFile(secondAttachmentPath, Buffer.alloc(over, 2));

      const prepared = await buildPreparedRunRequest(createMockUploadClient(['file_a', 'file_b']), {
        target: 'workflows.invoice',
        inputFile: [
          `contract=${contractPath}`,
          `attachments=${firstAttachmentPath}`,
          `attachments=${secondAttachmentPath}`,
        ],
      });

      expect(prepared.hasMultipartFiles).toBe(true);
      expect(multipartFileParts(prepared.form, 'contract')).toHaveLength(1);
      expect(JSON.parse(String(prepared.form.get('input')))).toEqual({
        attachments: [{ $fileId: 'file_a' }, { $fileId: 'file_b' }],
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('keeps two same-field small files on repeated multipart parts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'run-prepared-repeat-multipart-'));
    try {
      const firstPath = join(dir, 'a.pdf');
      const secondPath = join(dir, 'b.pdf');
      await writeFile(firstPath, Buffer.from('%PDF-a'));
      await writeFile(secondPath, Buffer.from('%PDF-b'));

      const prepared = await buildPreparedRunRequest(createMockUploadClient([]), {
        target: 'workflows.invoice',
        inputFile: [`document=${firstPath}`, `document=${secondPath}`],
      });

      expect(prepared.hasMultipartFiles).toBe(true);
      expect(multipartFileParts(prepared.form, 'document')).toHaveLength(2);
      expect(JSON.parse(String(prepared.form.get('input')))).toEqual({});
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
