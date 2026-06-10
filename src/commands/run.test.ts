import { describe, expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'cli.ts');

function json(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
}

async function withRunServer(
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
  opts: { baseUrl?: string } = {}
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('bun', [CLI, ...args], {
      env: {
        ...process.env,
        EIGENPAL_API_KEY: 'eig_test_key',
        ...(opts.baseUrl ? { EIGENPAL_BASE_URL: opts.baseUrl } : {}),
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

describe('root run commands', () => {
  test('run posts JSON input to the path-target endpoint', async () => {
    let captured: { pathname: string; body: unknown } | null = null;
    await withRunServer(
      async (request) => {
        const url = new URL(request.url);
        captured = { pathname: url.pathname, body: await request.json() };
        return json({ runId: 'run_123', type: 'workflow' }, { status: 201 });
      },
      async (baseUrl) => {
        const result = await runCli(
          [
            'run',
            'workflows.invoice',
            '--input-json',
            '{"language":"en"}',
            '--json',
            '--base-url',
            baseUrl,
          ],
          { baseUrl }
        );

        expect(result.status).toBe(0);
        expect(captured).toEqual({
          pathname: '/api/v1/run/workflows.invoice',
          body: { language: 'en' },
        });
        expect(JSON.parse(result.stdout)).toMatchObject({ runId: 'run_123', type: 'workflow' });
      }
    );
  });

  test('run sends the @version as a query param and tags CLI provenance', async () => {
    let captured: { pathname: string; version: string | null; trigger: string | null } | null =
      null;
    await withRunServer(
      async (request) => {
        const url = new URL(request.url);
        captured = {
          pathname: url.pathname,
          version: url.searchParams.get('version'),
          trigger: request.headers.get('x-eigenpal-trigger'),
        };
        return json({ runId: 'run_456', type: 'workflow' }, { status: 201 });
      },
      async (baseUrl) => {
        const result = await runCli(
          ['run', 'workflows.wf_AH9soXr2Aq4firaYWGkS_@1.2.3', '--json', '--base-url', baseUrl],
          { baseUrl }
        );

        expect(result.status).toBe(0);
        // Mixed-case nanoid id in the target, version moved to the query
        // string, and the run tagged as CLI-triggered.
        expect(captured).toEqual({
          pathname: '/api/v1/run/workflows.wf_AH9soXr2Aq4firaYWGkS_',
          version: '1.2.3',
          trigger: 'cli',
        });
      }
    );
  });

  test('run rejects example combined with ad hoc input before network access', async () => {
    const result = await runCli([
      'run',
      'workflows.invoice',
      '--example',
      'sample',
      '--input-json',
      '{"language":"en"}',
    ]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      '--example cannot be combined with --input-json or --input-file'
    );
  });

  test('rerun --version original passes through for workflow runs', async () => {
    const calls: Array<{ pathname: string; body?: unknown }> = [];
    await withRunServer(
      async (request) => {
        const url = new URL(request.url);
        if (request.method === 'GET' && url.pathname === '/api/v1/runs/exec_1') {
          calls.push({ pathname: url.pathname });
          return json({ run: { id: 'exec_1', type: 'workflow' } });
        }
        if (request.method === 'POST' && url.pathname === '/api/v1/runs/exec_1/rerun') {
          calls.push({ pathname: url.pathname, body: await request.json() });
          return json({ runId: 'exec_2', status: 'pending' });
        }
        return new Response('not found', { status: 404 });
      },
      async (baseUrl) => {
        const result = await runCli(
          ['rerun', 'exec_1', '--version', 'original', '--json', '--base-url', baseUrl],
          { baseUrl }
        );

        expect(result.status).toBe(0);
        expect(calls).toEqual([
          { pathname: '/api/v1/runs/exec_1' },
          { pathname: '/api/v1/runs/exec_1/rerun', body: { sourceRef: 'original' } },
        ]);
        expect(JSON.parse(result.stdout)).toMatchObject({ runId: 'exec_2' });
      }
    );
  });

  test('rerun posts to the canonical rerun endpoint with version override', async () => {
    let captured: { pathname: string; body: unknown } | null = null;
    await withRunServer(
      async (request) => {
        const url = new URL(request.url);
        captured = { pathname: url.pathname, body: await request.json() };
        return json({ runId: 'run_rerun', status: 'pending' });
      },
      async (baseUrl) => {
        const result = await runCli(
          ['rerun', 'run_123', '--version', 'abc123', '--json', '--base-url', baseUrl],
          { baseUrl }
        );

        expect(result.status).toBe(0);
        expect(captured).toEqual({
          pathname: '/api/v1/runs/run_123/rerun',
          body: { sourceRef: 'abc123' },
        });
        expect(JSON.parse(result.stdout)).toMatchObject({ runId: 'run_rerun' });
      }
    );
  });
});
