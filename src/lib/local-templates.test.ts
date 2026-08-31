import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as XLSX from 'xlsx';

import { ApiError, type ApiClient } from './client';
import {
  cleanupCreatedWorkspaceTemplates,
  loadLocalTemplatesForPush,
  matchWorkspaceTemplate,
  resolveWorkflowTemplatePath,
  rewriteLocalTemplateYaml,
  stageWorkspaceTemplatesForPush,
  type LoadedLocalTemplate,
} from './local-templates';
import { compareTemplateDataKeys, sha256Hex, tokenDataKey } from './office-template';
import type { PublicTemplate } from './templates-api';

function createWorkbook(rows: unknown[][]): Buffer {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  return Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', bookSST: true }));
}

function writeXlsx(path: string): Buffer {
  const bytes = createWorkbook([['{title}']]);
  writeFileSync(path, bytes);
  return bytes;
}

describe('resolveWorkflowTemplatePath', () => {
  test('resolves relative to the workflow file directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eig-tmpl-path-'));
    try {
      const workflowFile = join(dir, 'workflow.yaml');
      mkdirSync(join(dir, 'templates'));
      const xlsx = join(dir, 'templates', 'foo.xlsx');
      const docx = join(dir, 'templates', 'foo.docx');
      writeFileSync(workflowFile, 'name: demo\n');
      writeXlsx(xlsx);
      writeFileSync(docx, writeXlsx(xlsx));
      expect(resolveWorkflowTemplatePath(workflowFile, './templates/foo.xlsx')).toBe(
        realpathSync(xlsx)
      );
      expect(resolveWorkflowTemplatePath(workflowFile, 'templates/foo.docx')).toBe(
        realpathSync(docx)
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('rejects tmpl ids and absolute paths', () => {
    expect(() => resolveWorkflowTemplatePath('/tmp/workflow.yaml', 'tmpl_abc')).toThrow();
    expect(() => resolveWorkflowTemplatePath('/tmp/workflow.yaml', '/etc/passwd.xlsx')).toThrow();
  });

  test('rejects ../ escapes without --allow-external-templates', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eig-tmpl-dotdot-'));
    try {
      const project = join(dir, 'project');
      mkdirSync(project);
      const workflowFile = join(project, 'workflow.yaml');
      writeFileSync(workflowFile, 'name: demo\n');
      writeXlsx(join(dir, 'secret.xlsx'));
      expect(() => resolveWorkflowTemplatePath(workflowFile, '../secret.xlsx')).toThrow(
        /outside the workflow project/
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('rejects a symlink that points outside the project', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eig-tmpl-symlink-'));
    try {
      const project = join(dir, 'project');
      mkdirSync(join(project, 'templates'), { recursive: true });
      const workflowFile = join(project, 'workflow.yaml');
      writeFileSync(workflowFile, 'name: demo\n');
      const outside = join(dir, 'outside.xlsx');
      writeXlsx(outside);
      symlinkSync(outside, join(project, 'templates', 'link.xlsx'));
      expect(() => resolveWorkflowTemplatePath(workflowFile, './templates/link.xlsx')).toThrow(
        /outside the workflow project/
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('allows an external real path when opted in', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eig-tmpl-allow-'));
    try {
      const project = join(dir, 'project');
      mkdirSync(project);
      const workflowFile = join(project, 'workflow.yaml');
      writeFileSync(workflowFile, 'name: demo\n');
      const outside = join(dir, 'shared.xlsx');
      writeXlsx(outside);
      expect(
        resolveWorkflowTemplatePath(workflowFile, '../shared.xlsx', { allowExternal: true })
      ).toBe(realpathSync(outside));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('rewriteLocalTemplateYaml', () => {
  test('replaces template paths with ids and does not require rewriting source layout', () => {
    const yaml = `name: demo
version: 1.0.0
steps:
  - name: fill
    type: transform.template
    with:
      template: ./templates/roster.xlsx
      data:
        subjects: "{{ steps.extract.output.subjects }}"
`;
    const next = rewriteLocalTemplateYaml(yaml, [
      {
        path: './templates/roster.xlsx',
        templateId: 'tmpl_123456789012345678901',
        templateRevisionId: 'tmpr_123456789012345678901',
      },
    ]);
    expect(next).toContain('templateId: tmpl_123456789012345678901');
    expect(next).toContain('templateRevisionId: tmpr_123456789012345678901');
    expect(next).not.toContain('template: ./templates/roster.xlsx');
    expect(yaml).toContain('template: ./templates/roster.xlsx');
  });
});

describe('tokenDataKey', () => {
  test('maps XLSX table tokens to the array data key', () => {
    expect(tokenDataKey('table:subjects.first_name')).toBe('subjects');
    expect(tokenDataKey('customer.name')).toBe('customer');
    expect(tokenDataKey('#items')).toBe('items');
  });
});

describe('compareTemplateDataKeys', () => {
  test('reports unresolved tokens and unused keys', () => {
    const result = compareTemplateDataKeys(
      [{ name: 'table:subjects.first_name' }, { name: 'title' }],
      ['title', 'extra']
    );
    expect(result.unresolved).toEqual(['subjects']);
    expect(result.unusedDataKeys).toEqual(['extra']);
  });
});

describe('matchWorkspaceTemplate', () => {
  const row = (overrides: Partial<PublicTemplate> = {}): PublicTemplate => ({
    id: 'tmpl_123456789012345678901',
    name: 'roster',
    filename: 'roster.xlsx',
    format: 'xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    tokens: [],
    grammar: { syntax: '{field}', tokenDiscovery: true, capabilities: [] },
    currentRevision: {
      id: 'tmpr_123456789012345678901',
      number: 1,
      sha256: 'aa'.repeat(32),
      createdAt: '2026-08-28T00:00:00.000Z',
    },
    createdAt: '2026-08-28T00:00:00.000Z',
    ...overrides,
  });

  test('reuses when checksum matches', () => {
    const existing = [row()];
    const match = matchWorkspaceTemplate(existing, 'aa'.repeat(32), 'roster.xlsx');
    expect(match.action).toBe('reused');
  });

  test('creates when the name matches but checksum differs (does not replace)', () => {
    const match = matchWorkspaceTemplate([row()], 'bb'.repeat(32), 'roster.xlsx');
    expect(match.action).toBe('created');
  });

  test('creates when neither checksum nor name matches', () => {
    const match = matchWorkspaceTemplate([row()], 'bb'.repeat(32), 'letter.docx');
    expect(match.action).toBe('created');
  });
});

function publicTemplate(overrides: Partial<PublicTemplate> = {}): PublicTemplate {
  return {
    id: 'tmpl_123456789012345678901',
    name: 'roster',
    filename: 'roster.xlsx',
    format: 'xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    tokens: [],
    grammar: { syntax: '{field}', tokenDiscovery: true, capabilities: [] },
    currentRevision: {
      id: 'tmpr_123456789012345678901',
      number: 1,
      sha256: 'aa'.repeat(32),
      createdAt: '2026-08-28T00:00:00.000Z',
    },
    createdAt: '2026-08-28T00:00:00.000Z',
    ...overrides,
  };
}

function recordingClient(opts: {
  existing?: PublicTemplate[];
  failCreateAt?: number;
  failDelete?: boolean;
  failCleanupNotFound?: boolean;
}): { client: ApiClient; calls: string[]; created: PublicTemplate[] } {
  const calls: string[] = [];
  const created: PublicTemplate[] = [];
  let createCount = 0;
  let fileSeq = 0;
  const existing = [...(opts.existing ?? [])];
  const client = {
    get: async (path: string) => {
      calls.push(`GET ${path}`);
      if (path === '/v1/templates' || path.startsWith('/v1/templates?')) {
        return { items: [...existing, ...created], total: existing.length + created.length };
      }
      throw new Error(`unexpected GET ${path}`);
    },
    post: async (path: string, body?: unknown) => {
      calls.push(`POST ${path}`);
      if (path === '/v1/files/uploads') {
        return { transport: 'multipart', url: '/v1/files', maxFileSizeBytes: 50 * 1024 * 1024 };
      }
      if (path === '/v1/templates') {
        createCount += 1;
        if (opts.failCreateAt === createCount) {
          throw new ApiError(500, { error: 'create failed' });
        }
        const payload = body as { name?: string; fileId?: string; staged?: boolean };
        expect(payload.staged).toBe(true);
        const id = `tmpl_created${String(createCount).padStart(18, '0')}`;
        const revisionId = `tmpr_created${String(createCount).padStart(18, '0')}`;
        const row = publicTemplate({
          id,
          name: payload.name ?? 'roster',
          filename: `${payload.name ?? 'roster'}.xlsx`,
          currentRevision: {
            id: revisionId,
            number: 1,
            sha256: 'cc'.repeat(32),
            createdAt: '2026-08-28T00:00:00.000Z',
          },
          cleanupProof: `stp_${'a'.repeat(43)}`,
        });
        created.push(row);
        return row;
      }
      const staging = /^\/v1\/templates\/([^/]+)\/staging$/.exec(path);
      if (staging) {
        if (opts.failDelete) throw new ApiError(500, { error: 'delete failed' });
        const payload = body as { proof?: string; action?: string };
        if (opts.failCleanupNotFound) {
          throw new ApiError(404, { error: 'not found' });
        }
        if (payload.action === 'finalize') return { finalized: true };
        return { cleaned: true };
      }
      throw new Error(`unexpected POST ${path}`);
    },
    postFormData: async (path: string) => {
      calls.push(`POST-FORM ${path}`);
      fileSeq += 1;
      return { id: `file_${fileSeq}` };
    },
    put: async (path: string) => {
      calls.push(`PUT ${path}`);
      throw new Error(`PUT must not advance a shared template pointer (${path})`);
    },
    delete: async (path: string) => {
      calls.push(`DELETE ${path}`);
      if (opts.failDelete) throw new ApiError(500, { error: 'delete failed' });
      return { deleted: true };
    },
  };
  return { client: client as unknown as ApiClient, calls, created };
}

describe('stageWorkspaceTemplatesForPush', () => {
  test('reuses a checksum match and does not upload', async () => {
    const bytes = createWorkbook([['{title}']]);
    const sha256 = sha256Hex(bytes);
    const existing = [
      publicTemplate({
        sha256,
        currentRevision: {
          id: 'tmpr_123456789012345678901',
          number: 2,
          sha256,
          createdAt: '2026-08-28T00:00:00.000Z',
        },
      }),
    ];
    const { client, calls } = recordingClient({ existing });
    const loaded: LoadedLocalTemplate[] = [
      {
        path: './templates/roster.xlsx',
        fieldPath: 'steps.0.with.template',
        absolutePath: '/tmp/roster.xlsx',
        filename: 'roster.xlsx',
        bytes,
        sha256,
      },
    ];
    const staged = await stageWorkspaceTemplatesForPush(client, loaded);
    expect(staged.created).toEqual([]);
    expect(staged.resolved[0]?.action).toBe('reused');
    expect(staged.resolved[0]?.templateId).toBe(existing[0]?.id);
    expect(calls.some((call) => call.startsWith('PUT '))).toBe(false);
    expect(calls.some((call) => call === 'POST /v1/templates')).toBe(false);
  });

  test('creates a new tmpl_ when the name matches but checksum differs (no pointer mutation)', async () => {
    const bytes = createWorkbook([['{title}']]);
    const existing = [publicTemplate()];
    const { client, calls, created } = recordingClient({ existing });
    const staged = await stageWorkspaceTemplatesForPush(client, [
      {
        path: './templates/roster.xlsx',
        fieldPath: 'steps.0.with.template',
        absolutePath: '/tmp/roster.xlsx',
        filename: 'roster.xlsx',
        bytes,
        sha256: sha256Hex(bytes),
      },
    ]);
    expect(staged.created.map((row) => row.id)).toEqual([created[0]?.id]);
    expect(staged.created[0]?.cleanupProof).toMatch(/^stp_/);
    expect(staged.resolved[0]?.action).toBe('created');
    expect(staged.resolved[0]?.templateId).not.toBe(existing[0]?.id);
    expect(calls.some((call) => call.startsWith('PUT /v1/templates/'))).toBe(false);
    expect(calls).toContain('POST /v1/templates');
  });

  test('cleans up earlier creates when a later template fails', async () => {
    const first = createWorkbook([['{one}']]);
    const second = createWorkbook([['{two}']]);
    const { client, calls, created } = recordingClient({ failCreateAt: 2 });
    await expect(
      stageWorkspaceTemplatesForPush(client, [
        {
          path: './templates/one.xlsx',
          fieldPath: 'steps.0.with.template',
          absolutePath: '/tmp/one.xlsx',
          filename: 'one.xlsx',
          bytes: first,
          sha256: sha256Hex(first),
        },
        {
          path: './templates/two.xlsx',
          fieldPath: 'steps.1.with.template',
          absolutePath: '/tmp/two.xlsx',
          filename: 'two.xlsx',
          bytes: second,
          sha256: sha256Hex(second),
        },
      ])
    ).rejects.toThrow(/create failed/);
    expect(created).toHaveLength(1);
    expect(calls).toContain(`POST /v1/templates/${created[0]?.id}/staging`);
    expect(calls.some((call) => call === `DELETE /v1/templates/${created[0]?.id}`)).toBe(false);
    expect(calls.filter((call) => call === 'POST /v1/templates')).toHaveLength(2);
  });
});

describe('cleanupCreatedWorkspaceTemplates', () => {
  test('hard-cleans staged ids with the create proof and treats 404 as success', async () => {
    const { client, calls } = recordingClient({});
    const ok = await cleanupCreatedWorkspaceTemplates(client, [
      { id: 'tmpl_ok', cleanupProof: `stp_${'b'.repeat(43)}` },
    ]);
    expect(ok.deleted).toEqual(['tmpl_ok']);
    expect(ok.failed).toEqual([]);
    expect(calls).toContain('POST /v1/templates/tmpl_ok/staging');
    expect(calls.some((call) => call === 'DELETE /v1/templates/tmpl_ok')).toBe(false);

    const { client: missing } = recordingClient({ failCleanupNotFound: true });
    const idempotent = await cleanupCreatedWorkspaceTemplates(missing, [
      { id: 'tmpl_gone', cleanupProof: `stp_${'c'.repeat(43)}` },
    ]);
    expect(idempotent.deleted).toEqual(['tmpl_gone']);

    const { client: failing } = recordingClient({ failDelete: true });
    const failed = await cleanupCreatedWorkspaceTemplates(failing, [
      { id: 'tmpl_bad', cleanupProof: `stp_${'d'.repeat(43)}` },
    ]);
    expect(failed.deleted).toEqual([]);
    expect(failed.failed[0]?.id).toBe('tmpl_bad');
  });
});

describe('loadLocalTemplatesForPush', () => {
  test('fails loudly on a missing local template', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eig-tmpl-missing-'));
    try {
      const workflowFile = join(dir, 'workflow.yaml');
      writeFileSync(workflowFile, 'name: demo\n');
      await expect(
        loadLocalTemplatesForPush(workflowFile, [
          {
            name: 'fill',
            type: 'transform.template',
            with: { template: './templates/missing.xlsx', data: {} },
          },
        ])
      ).rejects.toThrow(/not found|outside the workflow project/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
