import { describe, expect, test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';

import { readJsonFixtureFile } from './templates';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'cli.ts');

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
}

const TEMPLATE = {
  id: 'tmpl_123456789012345678901',
  name: 'Roster',
  filename: 'roster.xlsx',
  format: 'xlsx' as const,
  mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  size: 3,
  sha256: 'a'.repeat(64),
  tokens: [{ name: 'table:subjects.first_name' }, { name: 'title' }],
  grammar: {
    syntax: '{field}; {table:items.field}; {image:field}',
    tokenDiscovery: true,
    capabilities: ['scalar-values', 'table-rows'],
  },
  currentRevision: {
    id: 'tmpr_123456789012345678901',
    number: 1,
    sha256: 'a'.repeat(64),
    createdAt: '2026-08-28T00:00:00.000Z',
  },
  createdAt: '2026-08-28T00:00:00.000Z',
};

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

function createWorkbook(rows: unknown[][]): Buffer {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, worksheet, 'People');
  return Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', bookSST: true }));
}

describe('workflow templates commands', () => {
  test('help lists lifecycle verbs and XLSX table syntax', () => {
    const result = spawnSync('bun', [CLI, 'workflow', 'templates', '--help'], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('upload');
    expect(result.stdout).toContain('list');
    expect(result.stdout).toContain('get');
    expect(result.stdout).toContain('download');
    expect(result.stdout).toContain('replace');
    expect(result.stdout).toContain('delete');
    expect(result.stdout).toContain('smoke');
    expect(result.stdout).toContain('{table:subjects.first_name}');
    expect(
      spawnSync('bun', [CLI, 'workflow', 'templates', 'inspect', '--help'], { encoding: 'utf8' })
        .status
    ).toBe(0);
  });

  test('list --json prints tmpl and tmpr ids', async () => {
    await withApiServer(
      (request) => {
        const url = new URL(request.url);
        if (request.method === 'GET' && url.pathname === '/v1/templates') {
          return jsonResponse({ items: [TEMPLATE], total: 1 });
        }
        return jsonResponse({ error: 'not found' }, { status: 404 });
      },
      async (baseUrl) => {
        const result = await runCli(['workflow', 'templates', 'list', '--json'], baseUrl);
        expect(result.status).toBe(0);
        const body = JSON.parse(result.stdout) as { items: (typeof TEMPLATE)[] };
        expect(body.items[0]?.id).toBe(TEMPLATE.id);
        expect(body.items[0]?.currentRevision.id).toBe(TEMPLATE.currentRevision.id);
      }
    );
  });

  test('get --json returns grammar and tokens', async () => {
    await withApiServer(
      (request) => {
        const url = new URL(request.url);
        if (request.method === 'GET' && url.pathname === `/v1/templates/${TEMPLATE.id}`) {
          return jsonResponse(TEMPLATE);
        }
        return jsonResponse({ error: 'not found' }, { status: 404 });
      },
      async (baseUrl) => {
        const result = await runCli(
          ['workflow', 'templates', 'get', TEMPLATE.id, '--json'],
          baseUrl
        );
        expect(result.status).toBe(0);
        const body = JSON.parse(result.stdout) as typeof TEMPLATE;
        expect(body.grammar.syntax).toContain('{table:items.field}');
        expect(body.tokens.map((token) => token.name)).toContain('table:subjects.first_name');
      }
    );
  });

  test('delete requires --yes off TTY', async () => {
    const result = spawnSync('bun', [CLI, 'workflow', 'templates', 'delete', TEMPLATE.id], {
      encoding: 'utf8',
      env: {
        ...process.env,
        EIGENPAL_API_KEY: 'eig_test_key',
        EIGENPAL_BASE_URL: 'http://127.0.0.1:9',
      },
    });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('--yes');
  });

  test('smoke help documents --data as a JSON fixture file path', () => {
    const result = spawnSync('bun', [CLI, 'workflow', 'templates', 'smoke', '--help'], {
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('--data <file>');
    expect(result.stdout).toContain('JSON fixture file');
  });

  test('readJsonFixtureFile rejects missing, invalid, and non-object fixtures', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eig-fixture-read-'));
    try {
      await expect(readJsonFixtureFile(join(dir, 'missing.json'))).rejects.toThrow(
        'JSON fixture file not found'
      );

      writeFileSync(join(dir, 'bad.json'), '{not json');
      await expect(readJsonFixtureFile(join(dir, 'bad.json'))).rejects.toThrow('JSON fixture file');

      writeFileSync(join(dir, 'array.json'), '[]');
      await expect(readJsonFixtureFile(join(dir, 'array.json'))).rejects.toThrow('JSON object');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('smoke rejects a missing --data fixture file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eig-smoke-missing-data-'));
    try {
      const templatePath = join(dir, 'roster.xlsx');
      const outPath = join(dir, 'filled.xlsx');
      writeFileSync(templatePath, createWorkbook([['{title}']]));
      const result = await runCli(
        [
          'workflow',
          'templates',
          'smoke',
          templatePath,
          '--data',
          join(dir, 'missing.json'),
          '--out',
          outPath,
        ],
        'http://127.0.0.1:9'
      );
      expect(result.status).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`).toContain('JSON fixture file not found');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('smoke fills a local XLSX file without contacting the server', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eig-smoke-'));
    try {
      const templatePath = join(dir, 'roster.xlsx');
      const dataPath = join(dir, 'fixture.json');
      const outPath = join(dir, 'filled.xlsx');
      writeFileSync(
        templatePath,
        createWorkbook([
          ['Title', '{title}'],
          ['{table:subjects.first_name}', '{table:subjects.last_name}'],
        ])
      );
      writeFileSync(
        dataPath,
        JSON.stringify({
          title: 'Roster',
          subjects: [
            { first_name: 'Ada', last_name: 'Lovelace' },
            { first_name: 'Alan', last_name: 'Turing' },
          ],
        })
      );
      const result = await runCli(
        [
          'workflow',
          'templates',
          'smoke',
          templatePath,
          '--data',
          dataPath,
          '--out',
          outPath,
          '--json',
        ],
        'http://127.0.0.1:9'
      );
      expect(result.status).toBe(0);
      const body = JSON.parse(result.stdout) as {
        format: string;
        unresolved: string[];
        out: string;
      };
      expect(body.format).toBe('xlsx');
      expect(body.unresolved).toEqual([]);
      expect(existsSync(outPath)).toBe(true);
      expect(readFileSync(outPath).byteLength).toBeGreaterThan(0);
      const workbook = XLSX.read(readFileSync(outPath), { type: 'buffer' });
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets.People!, {
        header: 1,
        raw: true,
        defval: '',
      }) as unknown[][];
      expect(rows[0]?.[1]).toBe('Roster');
      expect(rows[1]?.[0]).toBe('Ada');
      expect(rows[2]?.[0]).toBe('Alan');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('smoke keeps formula-looking strings as text', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eig-smoke-formula-'));
    try {
      const templatePath = join(dir, 'payload.xlsx');
      const dataPath = join(dir, 'fixture.json');
      const outPath = join(dir, 'filled.xlsx');
      writeFileSync(templatePath, createWorkbook([['{payload}']]));
      writeFileSync(dataPath, JSON.stringify({ payload: '=1+1' }));
      const result = await runCli(
        [
          'workflow',
          'templates',
          'smoke',
          templatePath,
          '--data',
          dataPath,
          '--out',
          outPath,
          '--json',
        ],
        'http://127.0.0.1:9'
      );
      expect(result.status).toBe(0);
      const workbook = XLSX.read(readFileSync(outPath), { type: 'buffer', cellFormula: true });
      const cell = workbook.Sheets.People!.A1 as { t?: string; v?: unknown; f?: unknown };
      expect(cell.f).toBeUndefined();
      expect(cell.t).toBe('s');
      expect(cell.v).toBe('=1+1');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('smoke rejects XLSX {{ }} placeholders', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eig-smoke-bad-'));
    try {
      const templatePath = join(dir, 'bad.xlsx');
      const dataPath = join(dir, 'fixture.json');
      const outPath = join(dir, 'filled.xlsx');
      writeFileSync(templatePath, createWorkbook([['Name', '{{client_name}}']]));
      writeFileSync(dataPath, JSON.stringify({ client_name: 'Ada' }));
      const result = await runCli(
        ['workflow', 'templates', 'smoke', templatePath, '--data', dataPath, '--out', outPath],
        'http://127.0.0.1:9'
      );
      expect(result.status).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`).toContain('{placeholder}');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
