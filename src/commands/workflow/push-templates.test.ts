import { describe, expect, test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'cli.ts');

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
}

function createWorkbook(rows: unknown[][]): Buffer {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  return Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', bookSST: true }));
}

function workflowYaml(templatePath: string, extraStep = ''): string {
  return `name: demo
version: 1.0.0
triggerMethods:
  - type: manual
steps:
  - name: fill
    type: transform.template
    with:
      template: ${templatePath}
      data:
        title: Hello
${extraStep}output:
  fileId: '{{ steps.fill.output.fileId }}'
`;
}

async function withApiServer(
  handler: (request: Request) => Response | Promise<Response>,
  fn: (baseUrl: string) => void | Promise<void>
): Promise<void> {
  const server = Bun.serve({ port: 0, fetch: handler });
  try {
    await fn(`http://127.0.0.1:${server.port}`);
  } finally {
    await server.stop(true);
  }
}

function runCli(
  args: string[],
  baseUrl: string
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('bun', [CLI, ...args], {
      env: {
        ...process.env,
        EIGENPAL_API_KEY: 'eig_test_key',
        EIGENPAL_BASE_URL: baseUrl,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (status) => {
      resolvePromise({ status, stdout, stderr });
    });
  });
}

function createdTemplate(id = 'tmpl_created0000000000001') {
  return {
    id,
    name: 'roster',
    filename: 'roster.xlsx',
    format: 'xlsx' as const,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    tokens: [],
    grammar: { syntax: '{field}', tokenDiscovery: true, capabilities: [] },
    currentRevision: {
      id: id.replace('tmpl_', 'tmpr_'),
      number: 1,
      sha256: 'cd'.repeat(32),
      createdAt: '2026-08-28T00:00:00.000Z',
    },
    createdAt: '2026-08-28T00:00:00.000Z',
    cleanupProof: `stp_${'e'.repeat(43)}`,
  };
}

describe('workflow push local templates', () => {
  test('help documents --allow-external-templates', () => {
    const result = spawnSync('bun', [CLI, 'workflow', 'push', '--help'], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('--allow-external-templates');
    expect(result.stdout).toContain('realpath');
  });

  test('rejects ../ before contacting the template API', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eig-push-dotdot-'));
    try {
      const project = join(dir, 'project');
      mkdirSync(project);
      writeFileSync(join(project, 'workflow.yaml'), workflowYaml('../secret.xlsx'));
      writeFileSync(join(dir, 'secret.xlsx'), createWorkbook([['{title}']]));
      const result = await runCli(
        ['workflow', 'push', '--file', join(project, 'workflow.yaml'), '--json'],
        'http://127.0.0.1:9'
      );
      expect(result.status).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`).toMatch(/outside the workflow project/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('rejects a symlink escape before contacting the template API', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eig-push-symlink-'));
    try {
      const project = join(dir, 'project');
      mkdirSync(join(project, 'templates'), { recursive: true });
      writeFileSync(join(project, 'workflow.yaml'), workflowYaml('./templates/link.xlsx'));
      writeFileSync(join(dir, 'outside.xlsx'), createWorkbook([['{title}']]));
      symlinkSync(join(dir, 'outside.xlsx'), join(project, 'templates', 'link.xlsx'));
      const result = await runCli(
        ['workflow', 'push', '--file', join(project, 'workflow.yaml'), '--json'],
        'http://127.0.0.1:9'
      );
      expect(result.status).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`).toMatch(/outside the workflow project/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('failed publish deletes staged templates and leaves source YAML unchanged', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eig-push-fail-'));
    const calls: string[] = [];
    try {
      mkdirSync(join(dir, 'templates'));
      const yamlPath = join(dir, 'workflow.yaml');
      const original = workflowYaml('./templates/roster.xlsx');
      writeFileSync(yamlPath, original);
      writeFileSync(join(dir, 'templates', 'roster.xlsx'), createWorkbook([['{title}']]));
      const created = createdTemplate();
      await withApiServer(
        async (request) => {
          const url = new URL(request.url);
          calls.push(`${request.method} ${url.pathname}`);
          if (request.method === 'POST' && url.pathname === '/api/workflows/validate') {
            return jsonResponse({ valid: true, issues: [] });
          }
          if (request.method === 'GET' && url.pathname === '/v1/templates') {
            return jsonResponse({ items: [], total: 0 });
          }
          if (request.method === 'POST' && url.pathname === '/v1/files/uploads') {
            return jsonResponse({
              transport: 'multipart',
              url: '/v1/files',
              maxFileSizeBytes: 50 * 1024 * 1024,
            });
          }
          if (request.method === 'POST' && url.pathname === '/v1/files') {
            return jsonResponse({ id: 'file_1' });
          }
          if (request.method === 'POST' && url.pathname === '/v1/templates') {
            return jsonResponse(created);
          }
          if (request.method === 'DELETE' && url.pathname === `/v1/files/file_1`) {
            return jsonResponse({ deleted: true });
          }
          if (request.method === 'POST' && url.pathname === `/v1/templates/${created.id}/staging`) {
            return jsonResponse({ cleaned: true });
          }
          if (request.method === 'DELETE' && url.pathname === `/v1/templates/${created.id}`) {
            return jsonResponse(
              { error: 'public delete must not hard-clean staging' },
              { status: 500 }
            );
          }
          if (request.method === 'PUT' && url.pathname.startsWith('/v1/templates/')) {
            return jsonResponse({ error: 'must not replace' }, { status: 500 });
          }
          if (request.method === 'POST' && url.pathname === '/api/workflows') {
            return jsonResponse({ error: 'publish exploded' }, { status: 400 });
          }
          return jsonResponse({ error: 'not found' }, { status: 404 });
        },
        async (baseUrl) => {
          const result = await runCli(['workflow', 'push', '--file', yamlPath, '--json'], baseUrl);
          expect(result.status).not.toBe(0);
          expect(`${result.stdout}${result.stderr}`).toMatch(/publish exploded/);
          expect(`${result.stdout}${result.stderr}`).toMatch(/Removed staged template/);
          expect(calls).toContain(`POST /v1/templates/${created.id}/staging`);
          expect(calls).not.toContain(`DELETE /v1/templates/${created.id}`);
          expect(calls.some((call) => call.startsWith('PUT /v1/templates/'))).toBe(false);
          expect(readFileSync(yamlPath, 'utf8')).toBe(original);
        }
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('server validation failure happens before template mutation', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eig-push-preflight-'));
    const calls: string[] = [];
    try {
      mkdirSync(join(dir, 'templates'));
      const yamlPath = join(dir, 'workflow.yaml');
      writeFileSync(yamlPath, workflowYaml('./templates/roster.xlsx'));
      writeFileSync(join(dir, 'templates', 'roster.xlsx'), createWorkbook([['{title}']]));
      await withApiServer(
        async (request) => {
          const url = new URL(request.url);
          calls.push(`${request.method} ${url.pathname}`);
          if (request.method === 'POST' && url.pathname === '/api/workflows/validate') {
            return jsonResponse({
              valid: false,
              issues: [{ field: 'steps', message: 'invoke cycle', severity: 'error' }],
            });
          }
          return jsonResponse({ error: 'not found' }, { status: 404 });
        },
        async (baseUrl) => {
          const result = await runCli(['workflow', 'push', '--file', yamlPath, '--json'], baseUrl);
          expect(result.status).not.toBe(0);
          expect(`${result.stdout}${result.stderr}`).toMatch(/invoke cycle/);
          expect(calls).not.toContain('GET /v1/templates');
          expect(calls).not.toContain('POST /v1/templates');
        }
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('name match with different checksum creates a new tmpl_ instead of replacing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eig-push-noptr-'));
    const calls: string[] = [];
    try {
      mkdirSync(join(dir, 'templates'));
      const yamlPath = join(dir, 'workflow.yaml');
      const original = workflowYaml('./templates/roster.xlsx');
      writeFileSync(yamlPath, original);
      writeFileSync(join(dir, 'templates', 'roster.xlsx'), createWorkbook([['{title}']]));
      const existing = {
        id: 'tmpl_existing000000000001',
        name: 'roster',
        filename: 'roster.xlsx',
        format: 'xlsx' as const,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        tokens: [],
        grammar: { syntax: '{field}', tokenDiscovery: true, capabilities: [] },
        currentRevision: {
          id: 'tmpr_existing000000000001',
          number: 4,
          sha256: 'ab'.repeat(32),
          createdAt: '2026-08-28T00:00:00.000Z',
        },
        createdAt: '2026-08-28T00:00:00.000Z',
      };
      const created = createdTemplate();
      await withApiServer(
        async (request) => {
          const url = new URL(request.url);
          calls.push(`${request.method} ${url.pathname}`);
          if (request.method === 'POST' && url.pathname === '/api/workflows/validate') {
            return jsonResponse({ valid: true, issues: [] });
          }
          if (request.method === 'GET' && url.pathname === '/v1/templates') {
            return jsonResponse({ items: [existing], total: 1 });
          }
          if (request.method === 'POST' && url.pathname === '/v1/files/uploads') {
            return jsonResponse({
              transport: 'multipart',
              url: '/v1/files',
              maxFileSizeBytes: 50 * 1024 * 1024,
            });
          }
          if (request.method === 'POST' && url.pathname === '/v1/files') {
            return jsonResponse({ id: 'file_1' });
          }
          if (request.method === 'POST' && url.pathname === '/v1/templates') {
            return jsonResponse(created);
          }
          if (request.method === 'DELETE' && url.pathname.startsWith('/v1/files/')) {
            return jsonResponse({ deleted: true });
          }
          if (request.method === 'POST' && url.pathname === `/v1/templates/${created.id}/staging`) {
            return jsonResponse({ finalized: true });
          }
          if (request.method === 'PUT' && url.pathname === `/v1/templates/${existing.id}`) {
            return jsonResponse({ error: 'must not replace' }, { status: 500 });
          }
          if (request.method === 'POST' && url.pathname === '/api/workflows') {
            return jsonResponse({
              workflow: { id: 'wf_new', currentVersion: { version: '1.0.0' } },
              version: { version: '1.0.0' },
            });
          }
          return jsonResponse({ error: 'not found' }, { status: 404 });
        },
        async (baseUrl) => {
          const result = await runCli(['workflow', 'push', '--file', yamlPath, '--json'], baseUrl);
          expect(result.status).toBe(0);
          const body = JSON.parse(result.stdout) as {
            localTemplates?: Array<{ templateId: string; action: string }>;
          };
          expect(body.localTemplates?.[0]?.templateId).toBe(created.id);
          expect(body.localTemplates?.[0]?.action).toBe('created');
          expect(calls).toContain(`POST /v1/templates/${created.id}/staging`);
          expect(calls.some((call) => call === `PUT /v1/templates/${existing.id}`)).toBe(false);
          expect(readFileSync(yamlPath, 'utf8')).toBe(original);
        }
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
