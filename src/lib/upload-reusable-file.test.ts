import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ApiClient } from './client';
import { asFetchMock, isNodeReadableStream } from './fetch-body';
import {
  expectedPartByteLength,
  partIsAuthoritativelyComplete,
  shouldAbortMultipartUploadSession,
} from './upload-presigned-multipart';
import { shouldAbortPresignedPutUploadSession, uploadReusableFile } from './upload-reusable-file';

const originalFetch = globalThis.fetch;
const FIVE_GIB = 5 * 1024 * 1024 * 1024;
const FIVE_MIB = 5 * 1024 * 1024;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function createClient(handlers: {
  post: (path: string, body?: unknown) => Promise<unknown>;
  get?: (path: string) => Promise<unknown>;
  postFormData?: (path: string) => Promise<unknown>;
  deleted?: string[];
}): ApiClient {
  const deleted: string[] = handlers.deleted ?? [];
  return {
    post: handlers.post,
    get: handlers.get ?? (async () => ({ parts: [] })),
    postFormData: handlers.postFormData ?? (async () => ({ id: 'file_form' })),
    delete: async (path: string) => {
      deleted.push(path);
    },
  } as unknown as ApiClient;
}

describe('uploadReusableFile presigned-multipart', () => {
  test('aborts leftover MPU state only before parts are authoritative', () => {
    expect(shouldAbortMultipartUploadSession({ partsReady: false })).toBe(true);
    expect(shouldAbortMultipartUploadSession({ partsReady: true })).toBe(false);
  });

  test('aborts leftover presigned-PUT state only before storage PUT succeeds', () => {
    expect(shouldAbortPresignedPutUploadSession({ putReady: false })).toBe(true);
    expect(shouldAbortPresignedPutUploadSession({ putReady: true })).toBe(false);
  });

  test('5 GiB part math stays exact without allocating the object', () => {
    expect(expectedPartByteLength(FIVE_GIB, FIVE_MIB, 1, 1024)).toBe(FIVE_MIB);
    expect(expectedPartByteLength(FIVE_GIB, FIVE_MIB, 1024, 1024)).toBe(FIVE_MIB);
  });

  test('treats a listed part with missing size as incomplete', () => {
    expect(partIsAuthoritativelyComplete([{ partNumber: 1, etag: '"e1"' }], 1, 4)).toBe(false);
    expect(partIsAuthoritativelyComplete([{ partNumber: 1, size: 4, etag: '"e1"' }], 1, 4)).toBe(
      true
    );
  });

  test('streams a disk path one part at a time and does not call readFile', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cli-mpu-'));
    const filePath = join(dir, 'doc.bin');
    await writeFile(filePath, Buffer.from('abcdefghijkl'));
    const uploaded = new Set<number>();
    const partPuts: number[] = [];
    const source = await Bun.file(new URL('./upload-reusable-file.ts', import.meta.url)).text();
    expect(source).toContain('createReadStream');
    expect(source).not.toMatch(/import \{[^}]*\breadFile\b/);

    globalThis.fetch = asFetchMock(async (input) => {
      const url = String(input);
      const partNumber = Number(url.slice('https://storage.test/part-'.length));
      uploaded.add(partNumber);
      partPuts.push(partNumber);
      return new Response(null, { status: 200 });
    });

    try {
      const result = await uploadReusableFile(
        createClient({
          post: async (path, body) => {
            if (path.endsWith('/files/uploads')) {
              expect((body as { size: number }).size).toBe(12);
              return {
                transport: 'presigned-multipart',
                uploadId: 'upl_path',
                fileId: 'file_path',
                partSizeBytes: 5,
                partCount: 3,
                partsUrl: '/api/v1/files/uploads/upl_path/parts',
                completeUrl: '/api/v1/files/uploads/upl_path/complete',
                maxFileSizeBytes: FIVE_GIB,
              };
            }
            if (path.endsWith('/parts')) {
              const partNumber = (body as { partNumber: number }).partNumber;
              return {
                url: `https://storage.test/part-${partNumber}`,
                headers: { 'content-length': String(partNumber === 3 ? 2 : 5) },
                partSizeBytes: partNumber === 3 ? 2 : 5,
              };
            }
            if (path.endsWith('/complete')) {
              return { id: 'file_path', filename: 'doc.bin', size: 12 };
            }
            throw new Error(path);
          },
          get: async () => ({
            parts: [...uploaded].map((partNumber) => ({
              partNumber,
              size: partNumber === 3 ? 2 : 5,
              etag: `"e${partNumber}"`,
            })),
          }),
        }),
        { filePath, filename: 'doc.bin', mimeType: 'application/octet-stream' }
      );

      expect(result.id).toBe('file_path');
      expect(partPuts.sort((a, b) => a - b)).toEqual([1, 2, 3]);
      expect((await stat(filePath)).size).toBe(12);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('keeps small Buffer PUT on presigned-put unchanged', async () => {
    const urls: string[] = [];
    globalThis.fetch = asFetchMock(async (input) => {
      urls.push(String(input));
      return new Response(null, { status: 200 });
    });

    const result = await uploadReusableFile(
      createClient({
        post: async (path) => {
          if (path.endsWith('/files/uploads')) {
            return {
              transport: 'presigned-put',
              uploadId: 'upl_put',
              fileId: 'file_put',
              url: 'https://storage.test/pending',
              headers: { 'content-type': 'text/plain' },
              maxFileSizeBytes: 100 * 1024 * 1024,
            };
          }
          if (path.endsWith('/complete')) {
            return { id: 'file_put', filename: 'note.txt', size: 4 };
          }
          throw new Error(path);
        },
      }),
      { content: Buffer.from('note'), filename: 'note.txt', mimeType: 'text/plain' }
    );

    expect(result.id).toBe('file_put');
    expect(urls).toEqual(['https://storage.test/pending']);
  });

  test('drains Node readables when fetch resolves before the body is consumed', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cli-put-drain-'));
    const filePath = join(dir, 'chunky.bin');
    await writeFile(filePath, Buffer.from('abcdefghij'));
    let destroyCalledBeforeEnd = false;

    globalThis.fetch = asFetchMock(async (_input, init) => {
      const body = init?.body;
      if (body != null && isNodeReadableStream(body)) {
        const readable = body as NodeJS.ReadableStream & {
          readableEnded?: boolean;
          destroyed?: boolean;
          destroy?: (error?: Error) => void;
        };
        const originalDestroy = readable.destroy?.bind(readable);
        if (typeof originalDestroy === 'function') {
          readable.destroy = (...args) => {
            if (!readable.readableEnded && !readable.destroyed) {
              destroyCalledBeforeEnd = true;
            }
            return originalDestroy(...args);
          };
        }
      }
      return new Response(null, { status: 200 });
    });

    try {
      const result = await uploadReusableFile(
        createClient({
          post: async (path) => {
            if (path.endsWith('/files/uploads')) {
              return {
                transport: 'presigned-put',
                uploadId: 'upl_early_fetch',
                fileId: 'file_early_fetch',
                url: 'https://storage.test/pending',
                headers: {},
                maxFileSizeBytes: 100 * 1024 * 1024,
              };
            }
            if (path.endsWith('/complete')) {
              return { id: 'file_early_fetch', filename: 'chunky.bin', size: 10 };
            }
            throw new Error(path);
          },
        }),
        { filePath, filename: 'chunky.bin', mimeType: 'application/octet-stream' }
      );

      expect(result.id).toBe('file_early_fetch');
      expect(destroyCalledBeforeEnd).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('aborts a presigned-PUT session after a thrown storage PUT failure', async () => {
    const deleted: string[] = [];
    globalThis.fetch = asFetchMock(async () => {
      throw new TypeError('network failed');
    });

    await expect(
      uploadReusableFile(
        createClient({
          deleted,
          post: async (path) => {
            if (path.endsWith('/files/uploads')) {
              return {
                transport: 'presigned-put',
                uploadId: 'upl_put_fail',
                fileId: 'file_put_fail',
                url: 'https://storage.test/pending',
                headers: {},
                maxFileSizeBytes: 100 * 1024 * 1024,
              };
            }
            throw new Error(path);
          },
        }),
        { content: Buffer.from('note'), filename: 'note.txt' }
      )
    ).rejects.toThrow('network failed');
    expect(deleted.some((path) => path.includes('upl_put_fail'))).toBe(true);
  });

  test('does not abort after presigned-PUT complete fails once storage PUT succeeded', async () => {
    const deleted: string[] = [];
    globalThis.fetch = asFetchMock(async () => new Response(null, { status: 200 }));

    await expect(
      uploadReusableFile(
        createClient({
          deleted,
          post: async (path) => {
            if (path.endsWith('/files/uploads')) {
              return {
                transport: 'presigned-put',
                uploadId: 'upl_put_complete_fail',
                fileId: 'file_put_complete_fail',
                url: 'https://storage.test/pending',
                headers: {},
                maxFileSizeBytes: 100 * 1024 * 1024,
              };
            }
            if (path.endsWith('/complete')) {
              const err = Object.assign(new Error('HTTP 429'), { status: 429 });
              throw err;
            }
            throw new Error(path);
          },
        }),
        { content: Buffer.from('note'), filename: 'note.txt' }
      )
    ).rejects.toThrow(/stored for upl_put_complete_fail.*retry complete/);
    expect(deleted).toEqual([]);
  });

  test('does not abort after complete fails once every part is stored', async () => {
    const deleted: string[] = [];
    const uploaded = new Set<number>();
    globalThis.fetch = asFetchMock(async (input) => {
      const url = String(input);
      uploaded.add(Number(url.slice('https://storage.test/part-'.length)));
      return new Response(null, { status: 200 });
    });

    await expect(
      uploadReusableFile(
        createClient({
          deleted,
          post: async (path) => {
            if (path.endsWith('/files/uploads')) {
              return {
                transport: 'presigned-multipart',
                uploadId: 'upl_complete_fail',
                fileId: 'file_complete_fail',
                partSizeBytes: 4,
                partCount: 1,
                partsUrl: '/api/v1/files/uploads/upl_complete_fail/parts',
                completeUrl: '/api/v1/files/uploads/upl_complete_fail/complete',
                maxFileSizeBytes: 100 * 1024 * 1024,
              };
            }
            if (path.endsWith('/parts')) {
              return {
                url: 'https://storage.test/part-1',
                headers: {},
                partSizeBytes: 4,
              };
            }
            if (path.endsWith('/complete')) {
              const err = Object.assign(new Error('HTTP 429'), { status: 429 });
              throw err;
            }
            throw new Error(path);
          },
          get: async () => ({
            parts: [...uploaded].map((partNumber) => ({
              partNumber,
              size: 4,
              etag: `"e${partNumber}"`,
            })),
          }),
        }),
        { content: Buffer.from('note'), filename: 'note.txt' }
      )
    ).rejects.toThrow(/remain stored for upl_complete_fail.*retry complete/);
    expect(deleted).toEqual([]);
    expect(uploaded.has(1)).toBe(true);
  });

  test('aborts the session after an unrecoverable part failure', async () => {
    const deleted: string[] = [];
    globalThis.fetch = asFetchMock(async () => new Response(null, { status: 403 }));

    await expect(
      uploadReusableFile(
        createClient({
          deleted,
          post: async (path) => {
            if (path.endsWith('/files/uploads')) {
              return {
                transport: 'presigned-multipart',
                uploadId: 'upl_abort',
                fileId: 'file_abort',
                partSizeBytes: 4,
                partCount: 1,
                partsUrl: '/api/v1/files/uploads/upl_abort/parts',
                completeUrl: '/api/v1/files/uploads/upl_abort/complete',
                maxFileSizeBytes: 100 * 1024 * 1024,
              };
            }
            if (path.endsWith('/parts')) {
              return {
                url: 'https://storage.test/forbidden',
                headers: {},
                partSizeBytes: 4,
              };
            }
            throw new Error(path);
          },
        }),
        { content: Buffer.from('note'), filename: 'note.txt' }
      )
    ).rejects.toThrow();
    expect(deleted.some((path) => path.includes('upl_abort'))).toBe(true);
  });

  test('re-uploads a listed part when ListParts omits size', async () => {
    const uploaded = new Set<number>();
    const partPuts: number[] = [];
    globalThis.fetch = asFetchMock(async (input) => {
      const url = String(input);
      const partNumber = Number(url.slice('https://storage.test/part-'.length));
      uploaded.add(partNumber);
      partPuts.push(partNumber);
      return new Response(null, { status: 200 });
    });

    const result = await uploadReusableFile(
      createClient({
        post: async (path) => {
          if (path.endsWith('/files/uploads')) {
            return {
              transport: 'presigned-multipart',
              uploadId: 'upl_nosize',
              fileId: 'file_nosize',
              partSizeBytes: 4,
              partCount: 1,
              partsUrl: '/api/v1/files/uploads/upl_nosize/parts',
              completeUrl: '/api/v1/files/uploads/upl_nosize/complete',
              maxFileSizeBytes: 100 * 1024 * 1024,
            };
          }
          if (path.endsWith('/parts')) {
            return {
              url: 'https://storage.test/part-1',
              headers: {},
              partSizeBytes: 4,
            };
          }
          if (path.endsWith('/complete')) {
            return { id: 'file_nosize', filename: 'note.txt', size: 4 };
          }
          throw new Error(path);
        },
        get: async () => ({
          parts: uploaded.has(1)
            ? [{ partNumber: 1, size: 4, etag: '"e1"' }]
            : [{ partNumber: 1, etag: '"e1"' }],
        }),
      }),
      { content: Buffer.from('note'), filename: 'note.txt' }
    );

    expect(result.id).toBe('file_nosize');
    expect(partPuts).toEqual([1]);
  });
});
