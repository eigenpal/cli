import { describe, expect, test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'cli.ts');

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

function resolveWorkflowRoute(request: Request, workflowId: string): Response | null {
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === `/api/workflows/${workflowId}`) {
    return jsonResponse({ id: workflowId });
  }
  return null;
}

describe('workflow move (public v1)', () => {
  test('PATCHes /v1/automations/{id} with folderPath and supports root', async () => {
    const calls: Array<{ method: string; path: string; body: unknown }> = [];
    await withApiServer(
      (request) => {
        const resolved = resolveWorkflowRoute(request, 'wf_move1');
        if (resolved) return resolved;
        const url = new URL(request.url);
        if (request.method === 'GET' && url.pathname === '/v1/automations/wf_move1') {
          return jsonResponse({ id: 'wf_move1', type: 'workflow' });
        }
        if (request.method === 'PATCH' && url.pathname === '/v1/automations/wf_move1') {
          return request.json().then((body) => {
            calls.push({ method: request.method, path: url.pathname, body });
            return jsonResponse({
              id: 'wf_move1',
              folderPath: (body as { folderPath?: string }).folderPath,
            });
          });
        }
        return new Response('not found', { status: 404 });
      },
      async (baseUrl) => {
        const root = await runCli(
          ['workflow', 'move', 'wf_move1', '--folder', '/', '--base-url', baseUrl],
          baseUrl
        );
        expect(root.status).toBe(0);
        expect(root.stderr).toContain('root');

        const nested = await runCli(
          [
            'workflow',
            'move',
            'wf_move1',
            '--folder',
            'billing/invoices',
            '--json',
            '--base-url',
            baseUrl,
          ],
          baseUrl
        );
        expect(nested.status).toBe(0);
        expect(JSON.parse(nested.stdout).folderPath).toBe('billing/invoices');

        expect(calls).toEqual([
          { method: 'PATCH', path: '/v1/automations/wf_move1', body: { folderPath: '/' } },
          {
            method: 'PATCH',
            path: '/v1/automations/wf_move1',
            body: { folderPath: 'billing/invoices' },
          },
        ]);
      }
    );
  });
});

describe('workflow delete', () => {
  test('requires --yes without TTY before DELETE', async () => {
    const result = spawnSync(
      'bun',
      [CLI, 'workflow', 'delete', 'wf_del1', '--base-url', 'http://127.0.0.1:1'],
      {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, EIGENPAL_API_KEY: 'eig_test_key' },
      }
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/requires --yes when run non-interactively/);
  });

  test('DELETE /v1/automations/{id} tolerates JSON body or 204', async () => {
    await withApiServer(
      (request) => {
        const resolved = resolveWorkflowRoute(request, 'wf_del1');
        if (resolved) return resolved;
        const url = new URL(request.url);
        if (request.method === 'GET' && url.pathname === '/v1/automations/wf_del1') {
          return jsonResponse({ id: 'wf_del1', type: 'workflow' });
        }
        if (request.method === 'DELETE' && url.pathname === '/v1/automations/wf_del1') {
          return new Response(null, { status: 204 });
        }
        return new Response('not found', { status: 404 });
      },
      async (baseUrl) => {
        const result = await runCli(
          ['workflow', 'delete', 'wf_del1', '--yes', '--json', '--base-url', baseUrl],
          baseUrl
        );
        expect(result.status).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual({ deleted: true, id: 'wf_del1' });
      }
    );
  });
});

describe('workflow folders', () => {
  test('list --tree prints hierarchy from GET /v1/folders?type=workflow&tree=true', async () => {
    await withApiServer(
      (request) => {
        const url = new URL(request.url);
        if (
          request.method === 'GET' &&
          url.pathname === '/v1/folders' &&
          url.searchParams.get('type') === 'workflow' &&
          url.searchParams.get('tree') === 'true'
        ) {
          return jsonResponse([
            { id: 'fldr_a', name: 'billing', parentId: null },
            { id: 'fldr_b', name: 'invoices', parentId: 'fldr_a' },
          ]);
        }
        return new Response('not found', { status: 404 });
      },
      async (baseUrl) => {
        const result = await runCli(
          ['workflow', 'folders', 'list', '--tree', '--base-url', baseUrl],
          baseUrl
        );
        expect(result.status).toBe(0);
        expect(result.stdout).toContain('billing (fldr_a)');
        expect(result.stdout).toContain('invoices (fldr_b)');
      }
    );
  });

  test('create posts missing segments under /v1/folders', async () => {
    const posts: unknown[] = [];
    await withApiServer(
      (request) => {
        const url = new URL(request.url);
        if (request.method === 'GET' && url.pathname === '/v1/folders') {
          return jsonResponse([]);
        }
        if (request.method === 'POST' && url.pathname === '/v1/folders') {
          return request.json().then((body) => {
            posts.push(body);
            const row = body as { name: string; parentId?: string | null };
            return jsonResponse({
              id: `fldr_${row.name}`,
              name: row.name,
              parentId: row.parentId ?? null,
            });
          });
        }
        return new Response('not found', { status: 404 });
      },
      async (baseUrl) => {
        const result = await runCli(
          ['workflow', 'folders', 'create', 'billing/invoices', '--json', '--base-url', baseUrl],
          baseUrl
        );
        expect(result.status).toBe(0);
        expect(posts).toEqual([
          { name: 'billing', parentId: null, type: 'workflow' },
          { name: 'invoices', parentId: 'fldr_billing', type: 'workflow' },
        ]);
      }
    );
  });

  test('delete requires --yes without TTY', () => {
    const result = spawnSync(
      'bun',
      [CLI, 'workflow', 'folders', 'delete', 'fldr_test', '--base-url', 'http://127.0.0.1:1'],
      {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, EIGENPAL_API_KEY: 'eig_test_key' },
      }
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/requires --yes when run non-interactively/);
  });
});

describe('agents delete', () => {
  test('requires --yes without TTY', () => {
    const result = spawnSync(
      'bun',
      [CLI, 'agents', 'delete', 'invoice-agent', '--base-url', 'http://127.0.0.1:1'],
      {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, EIGENPAL_API_KEY: 'eig_test_key' },
      }
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/requires --yes when run non-interactively/);
  });

  test('DELETE /v1/automations/agents.{slug} with --yes', async () => {
    let deleted = false;
    await withApiServer(
      (request) => {
        const url = new URL(request.url);
        if (request.method === 'GET' && url.pathname === '/v1/automations/agents.invoice-agent') {
          return jsonResponse({
            id: 'auto_1',
            type: 'agent',
            slug: 'invoice-agent',
            name: 'Invoice Agent',
          });
        }
        if (
          request.method === 'DELETE' &&
          url.pathname === '/v1/automations/agents.invoice-agent'
        ) {
          deleted = true;
          return jsonResponse({ deleted: true });
        }
        return new Response('not found', { status: 404 });
      },
      async (baseUrl) => {
        const result = await runCli(
          ['agents', 'delete', 'invoice-agent', '--yes', '--json', '--base-url', baseUrl],
          baseUrl
        );
        expect(result.status).toBe(0);
        expect(deleted).toBe(true);
        expect(JSON.parse(result.stdout)).toMatchObject({
          deleted: true,
          id: 'agents.invoice-agent',
          slug: 'invoice-agent',
        });
      }
    );
  });
});

describe('command help', () => {
  test('registers workflow delete, folders, and agents delete', () => {
    const folders = spawnSync('bun', [CLI, 'workflow', 'folders', '--help'], { encoding: 'utf8' });
    expect(folders.status).toBe(0);
    expect(folders.stdout).toContain('delete');

    for (const args of [
      ['workflow', 'delete', '--help'],
      ['workflow', 'folders', 'delete', '--help'],
      ['agents', 'delete', '--help'],
    ]) {
      const result = spawnSync('bun', [CLI, ...args], { encoding: 'utf8' });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('--yes');
    }
  });
});
