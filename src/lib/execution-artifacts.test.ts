import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ApiClient } from './client';
import { writeExecutionArtifacts } from './execution-artifacts';

describe('writeExecutionArtifacts legacy file fallback', () => {
  test('downloads via /v1/files/{id}/content not metadata', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'exec-artifacts-'));
    const paths: string[] = [];
    const client = {
      get: async () => {
        throw new Error('artifacts list unavailable');
      },
      getStream: async (path: string) => {
        paths.push(path);
        return new Response(Buffer.from('pdf-bytes'), {
          headers: {
            'content-type': 'application/pdf',
            'content-disposition': 'attachment; filename="report.pdf"',
          },
        });
      },
    } as unknown as ApiClient;

    try {
      const outDir = await writeExecutionArtifacts(client, dir, {
        executionId: 'exec_1',
        status: 'completed',
        createdAt: '2026-08-04T09:00:00.000Z',
        completedAt: '2026-08-04T09:01:00.000Z',
        error: null,
        output: { files: [{ fileId: 'file_out', stepName: 'render' }] },
        stepExecutions: [],
      });

      expect(paths).toEqual(['/v1/files/file_out/content']);
      const saved = await readFile(join(outDir, 'files', 'report.pdf'));
      expect(saved.toString()).toBe('pdf-bytes');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
