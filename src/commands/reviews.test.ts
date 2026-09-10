import { describe, expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildReviewListParams,
  decisionRows,
  formatReviewTaskDetail,
  parseReviewScalarValue,
  resolveReviewIdempotencyKey,
} from '../lib/reviews-cli';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'cli.ts');

const TASK_SUMMARY = {
  id: 'hrt_test000000000001',
  executionId: 'exec_test00000000001',
  automationId: 'auto_test00000000001',
  automationName: 'Invoice Review',
  sourceKind: 'workflow_step' as const,
  sourceLabel: 'human-review',
  status: 'pending' as const,
  requiredCount: 2,
  confirmedCount: 1,
  version: 3,
  createdAt: '2026-09-08T10:00:00.000Z',
  updatedAt: '2026-09-08T10:05:00.000Z',
};

const TASK_DETAIL = {
  ...TASK_SUMMARY,
  files: [
    {
      fileId: 'file_test00000000001',
      filename: 'invoice.pdf',
      artifactPath:
        'automations/auto_test00000000001/runs/exec_test00000000001/input/document/file_test00000000001-invoice.pdf',
      fieldName: 'document',
    },
  ],
  input: { status: 'available' as const, data: { vendor: 'Acme' } },
  machineData: { vendor: 'Acme' },
  draftData: { vendor: 'Acme Corp' },
  schema: null,
  fieldMetadata: {},
  requiredPaths: ['/vendor'],
  selectionReasons: { '/vendor': 'always' as const },
  decisions: [
    {
      id: 'dec_1',
      path: '/vendor',
      originalValue: 'Acme',
      currentValue: 'Acme Corp',
      required: true,
      reason: 'always' as const,
      confirmedBy: 'user_test',
      confirmedAt: '2026-09-08T10:04:00.000Z',
      version: 2,
    },
    {
      id: 'dec_2',
      path: '/total',
      originalValue: 100,
      currentValue: 100,
      required: true,
      reason: 'low_confidence' as const,
      confirmedBy: null,
      confirmedAt: null,
      version: 1,
    },
  ],
  instructions: 'Confirm vendor and total.',
  completedBy: null,
  completedAt: null,
  outcomeReason: null,
};

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
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
  opts: { baseUrl: string; stdin?: string } = { baseUrl: 'http://127.0.0.1:9' }
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('bun', [CLI, ...args], {
      env: {
        ...process.env,
        EIGENPAL_API_KEY: 'eig_test_key',
        EIGENPAL_BASE_URL: opts.baseUrl,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
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
    if (opts.stdin !== undefined) {
      child.stdin.write(opts.stdin);
    }
    child.stdin.end();
    child.on('error', reject);
    child.on('close', (status) => {
      resolvePromise({ status, stdout, stderr });
    });
  });
}

describe('reviews CLI helpers', () => {
  test('parseReviewScalarValue accepts null, booleans, numbers, and strings', () => {
    expect(parseReviewScalarValue('null')).toBe(null);
    expect(parseReviewScalarValue('true')).toBe(true);
    expect(parseReviewScalarValue('false')).toBe(false);
    expect(parseReviewScalarValue('42')).toBe(42);
    expect(parseReviewScalarValue('3.14')).toBe(3.14);
    expect(parseReviewScalarValue('Acme')).toBe('Acme');
    expect(parseReviewScalarValue('  spaced  ')).toBe('  spaced  ');
  });

  test('buildReviewListParams omits empty filters', () => {
    expect(buildReviewListParams({ limit: 25, automationId: 'auto_1' })).toEqual({
      automationId: 'auto_1',
      limit: '25',
    });
  });

  test('resolveReviewIdempotencyKey generates when omitted', () => {
    expect(resolveReviewIdempotencyKey('cli-key-1')).toBe('cli-key-1');
    expect(resolveReviewIdempotencyKey()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  test('decisionRows and detail formatting surface files and confirmation state', () => {
    const rows = decisionRows(TASK_DETAIL);
    expect(rows).toEqual([
      expect.objectContaining({ path: '/vendor', confirmed: 'yes' }),
      expect.objectContaining({ path: '/total', confirmed: 'no' }),
    ]);
    const text = formatReviewTaskDetail(TASK_DETAIL);
    expect(text).toContain('invoice.pdf');
    expect(text).toContain('Confirm vendor and total.');
  });
});

describe('reviews CLI commands', () => {
  test('registers top-level help and requires a subcommand', async () => {
    const help = await runCli(['reviews', '--help']);
    expect(help.status).toBe(0);
    expect(help.stdout).toMatch(/list|get|confirm|approve|reject|download/);
    expect(help.stdout).toMatch(/runs cancel/);

    const missing = await runCli(['reviews']);
    expect(missing.status).toBe(2);
    expect(missing.stderr).toMatch(/requires a subcommand/);
  });

  test('list renders pending tasks and passes query params', async () => {
    const seen: string[] = [];
    await withApiServer(
      (request) => {
        seen.push(
          `${request.method} ${new URL(request.url).pathname}${new URL(request.url).search}`
        );
        expect(new URL(request.url).searchParams.get('automationId')).toBe('auto_test00000000001');
        expect(new URL(request.url).searchParams.get('limit')).toBe('10');
        return jsonResponse({
          tasks: [TASK_SUMMARY],
          nextCursor: 'cursor_2',
        });
      },
      async (baseUrl) => {
        const result = await runCli(
          ['reviews', 'list', '--automation-id', 'auto_test00000000001', '--limit', '10'],
          { baseUrl }
        );
        expect(result.status).toBe(0);
        expect(result.stdout).toContain('hrt_test000000000001');
        expect(result.stderr).toMatch(/cursor_2/);
        expect(seen[0]).toMatch(/\/v1\/human-reviews\?/);
      }
    );
  });

  test('get prints task detail and decisions in human mode', async () => {
    await withApiServer(
      (request) => {
        expect(request.method).toBe('GET');
        expect(new URL(request.url).pathname).toMatch(/\/v1\/human-reviews\/hrt_test000000000001$/);
        return jsonResponse({ task: TASK_DETAIL });
      },
      async (baseUrl) => {
        const result = await runCli(['reviews', 'get', 'hrt_test000000000001'], { baseUrl });
        expect(result.status).toBe(0);
        expect(result.stdout).toContain('/vendor');
        expect(result.stdout).toContain('/total');
      }
    );
  });

  test('confirm sends field mutation body with withdraw semantics', async () => {
    let body: Record<string, unknown> | undefined;
    await withApiServer(
      async (request) => {
        expect(request.method).toBe('PUT');
        body = (await request.json()) as Record<string, unknown>;
        return jsonResponse({ task: { ...TASK_DETAIL, confirmedCount: 1 } });
      },
      async (baseUrl) => {
        const result = await runCli(
          [
            'reviews',
            'confirm',
            'hrt_test000000000001',
            '--path',
            '/vendor',
            '--value',
            'Acme Corp',
            '--expected-version',
            '3',
            '--idempotency-key',
            'confirm-1',
            '--withdraw',
          ],
          { baseUrl }
        );
        expect(result.status).toBe(0);
        expect(body).toEqual({
          path: '/vendor',
          value: 'Acme Corp',
          expectedVersion: 3,
          idempotencyKey: 'confirm-1',
          confirmed: false,
        });
      }
    );
  });

  test('approve posts expectedVersion only', async () => {
    let body: unknown;
    await withApiServer(
      async (request) => {
        expect(request.method).toBe('POST');
        body = await request.json();
        return jsonResponse({ task: { ...TASK_DETAIL, status: 'approved' } });
      },
      async (baseUrl) => {
        const result = await runCli(
          ['reviews', 'approve', 'hrt_test000000000001', '--expected-version', '3'],
          { baseUrl }
        );
        expect(result.status).toBe(0);
        expect(body).toEqual({ expectedVersion: 3 });
      }
    );
  });

  test('reject posts reason, expectedVersion, and idempotency key', async () => {
    let body: unknown;
    await withApiServer(
      async (request) => {
        expect(request.method).toBe('POST');
        body = await request.json();
        return jsonResponse({ task: { ...TASK_DETAIL, status: 'rejected' } });
      },
      async (baseUrl) => {
        const result = await runCli(
          [
            'reviews',
            'reject',
            'hrt_test000000000001',
            '--reason',
            'Missing PO',
            '--expected-version',
            '4',
            '--idempotency-key',
            'reject-1',
          ],
          { baseUrl }
        );
        expect(result.status).toBe(0);
        expect(body).toEqual({
          reason: 'Missing PO',
          expectedVersion: 4,
          idempotencyKey: 'reject-1',
        });
      }
    );
  });

  test('download writes file bytes to --out', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eig-reviews-cli-'));
    const outPath = join(dir, 'invoice.pdf');
    try {
      await withApiServer(
        (request) => {
          expect(request.method).toBe('GET');
          expect(new URL(request.url).pathname).toMatch(
            /\/v1\/human-reviews\/hrt_test000000000001\/files\/file_test00000000001\/content$/
          );
          return new Response('pdf-bytes', {
            headers: { 'content-type': 'application/pdf' },
          });
        },
        async (baseUrl) => {
          const result = await runCli(
            [
              'reviews',
              'download',
              'hrt_test000000000001',
              'file_test00000000001',
              '--out',
              outPath,
            ],
            { baseUrl }
          );
          expect(result.status).toBe(0);
          expect(readFileSync(outPath, 'utf8')).toBe('pdf-bytes');
          expect(result.stderr).toMatch(/Wrote/);
        }
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('confirm requires a value flag', async () => {
    const result = await runCli([
      'reviews',
      'confirm',
      'hrt_test000000000001',
      '--path',
      '/vendor',
      '--expected-version',
      '1',
    ]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/Missing field value|--value/);
  });
});
