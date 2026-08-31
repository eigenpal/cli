import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';

import { ApiError, type ApiClient } from '../../lib/client';
import { ensureWorkspaceTemplate } from '../../lib/local-templates';
import { sha256Hex } from '../../lib/office-template';
import { diagnoseTemplateSteps } from '../../lib/template-diagnostics';
import type { PublicTemplate } from '../../lib/templates-api';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'cli.ts');

function createWorkbook(rows: unknown[][]): Buffer {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  return Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', bookSST: true }));
}

describe('diagnoseTemplateSteps', () => {
  test('offline: missing local template is an error; extra data keys are warnings', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eig-diag-'));
    try {
      const workflowFile = join(dir, 'workflow.yaml');
      const templatePath = join(dir, 'templates', 'roster.xlsx');
      mkdirSync(join(dir, 'templates'), { recursive: true });
      writeFileSync(templatePath, createWorkbook([['Name', '{table:subjects.first_name}']]));
      writeFileSync(workflowFile, 'name: demo\n');
      const diagnostics = await diagnoseTemplateSteps({
        workflowFile,
        steps: [
          {
            name: 'fill',
            type: 'transform.template',
            with: {
              template: './templates/roster.xlsx',
              data: { extra: '1' },
              outputFilename: 'out.docx',
            },
          },
        ],
      });
      expect(
        diagnostics.some((item) => item.severity === 'error' && item.message.includes('.docx'))
      ).toBe(true);
      expect(
        diagnostics.some((item) => item.severity === 'warning' && item.message.includes('subjects'))
      ).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('offline: XLSX double-brace placeholders are errors', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eig-diag-brace-'));
    try {
      const workflowFile = join(dir, 'workflow.yaml');
      writeFileSync(join(dir, 'bad.xlsx'), createWorkbook([['{{client}}']]));
      writeFileSync(workflowFile, 'name: demo\n');
      const diagnostics = await diagnoseTemplateSteps({
        workflowFile,
        steps: [
          {
            name: 'fill',
            type: 'transform.template',
            with: { template: './bad.xlsx', data: { client: 'Ada' } },
          },
        ],
      });
      expect(
        diagnostics.some((item) => item.severity === 'error' && item.message.includes('{{'))
      ).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('online: missing tmpl_ id is an error', async () => {
    const client = {
      get: async () => {
        throw new ApiError(404, { error: 'not found' });
      },
    };
    const diagnostics = await diagnoseTemplateSteps({
      workflowFile: '/tmp/workflow.yaml',
      steps: [
        {
          name: 'fill',
          type: 'transform.template',
          with: {
            templateId: 'tmpl_123456789012345678901',
            data: { name: 'Ada' },
          },
        },
      ],
      client: client as unknown as ApiClient,
    });
    expect(diagnostics.some((item) => item.message.includes('not found'))).toBe(true);
  });

  test('online: live tokens vs data are warnings; output extension mismatch is an error', async () => {
    const bytes = createWorkbook([['{title}', '{table:subjects.first_name}']]);
    const client = {
      get: async () => ({
        id: 'tmpl_123456789012345678901',
        name: 'roster',
        filename: 'roster.xlsx',
        format: 'xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        tokens: [{ name: 'title' }, { name: 'table:subjects.first_name' }],
        grammar: { syntax: '{field}', tokenDiscovery: true, capabilities: [] },
        currentRevision: {
          id: 'tmpr_123456789012345678901',
          number: 1,
          sha256: 'ab',
          createdAt: '2026-08-28T00:00:00.000Z',
        },
        createdAt: '2026-08-28T00:00:00.000Z',
      }),
      getStream: async () =>
        new Response(new Uint8Array(bytes), {
          headers: {
            'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'content-disposition': 'attachment; filename="roster.xlsx"',
          },
        }),
    };
    const diagnostics = await diagnoseTemplateSteps({
      workflowFile: '/tmp/workflow.yaml',
      steps: [
        {
          name: 'fill',
          type: 'transform.template',
          with: {
            templateId: 'tmpl_123456789012345678901',
            data: { extra: '1' },
            outputFilename: 'out.docx',
          },
        },
      ],
      client: client as unknown as ApiClient,
    });
    expect(
      diagnostics.some((item) => item.severity === 'error' && item.message.includes('.docx'))
    ).toBe(true);
    expect(
      diagnostics.some((item) => item.severity === 'warning' && item.message.includes('subjects'))
    ).toBe(true);
  });
});

describe('ensureWorkspaceTemplate checksum reuse', () => {
  test('reuses tmpl/tmpr when the current revision checksum matches', async () => {
    const bytes = createWorkbook([['{title}']]);
    const sha256 = sha256Hex(bytes);
    const existing: PublicTemplate[] = [
      {
        id: 'tmpl_123456789012345678901',
        name: 'roster',
        filename: 'roster.xlsx',
        format: 'xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        sha256,
        tokens: [],
        grammar: { syntax: '{field}', tokenDiscovery: true, capabilities: [] },
        currentRevision: {
          id: 'tmpr_123456789012345678901',
          number: 2,
          sha256,
          createdAt: '2026-08-28T00:00:00.000Z',
        },
        createdAt: '2026-08-28T00:00:00.000Z',
      },
    ];
    const result = await ensureWorkspaceTemplate({} as ApiClient, {
      bytes,
      filename: 'roster.xlsx',
      existing,
    });
    expect(result.action).toBe('reused');
    expect(result.checksumMatched).toBe(true);
    expect(result.template.id).toBe('tmpl_123456789012345678901');
    expect(result.template.currentRevision?.id).toBe('tmpr_123456789012345678901');
  });
});

describe('workflow validate --online help', () => {
  test('documents template metadata checks', () => {
    const result = spawnSync('bun', [CLI, 'workflow', 'validate', '--help'], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('transform.template');
    expect(result.stdout).toContain('--online');
  });
});
