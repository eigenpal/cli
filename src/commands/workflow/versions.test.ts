import { describe, expect, test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  formatWorkflowVersionLabel,
  paginatePublicVersionList,
  resolveWorkflowVersionCreateRequest,
} from './index';

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

const UNTAGGED_HEAD = {
  id: 'wh_head',
  automationId: 'wf_abc',
  version: null,
  isCurrent: true,
  createdAt: '2026-08-24T12:00:00.000Z',
};

const TAGGED = {
  id: 'wh_tagged',
  automationId: 'wf_abc',
  version: '1.4.0',
  isCurrent: false,
  createdAt: '2026-08-24T11:00:00.000Z',
};

describe('paginatePublicVersionList', () => {
  const raw = { data: [UNTAGGED_HEAD, TAGGED], total: 2, limit: 2, offset: 0 };

  test('keeps untagged HEAD on the first page', () => {
    expect(paginatePublicVersionList(raw, { limit: 1, offset: 0 })).toEqual({
      data: [UNTAGGED_HEAD],
      total: 2,
      limit: 1,
      offset: 0,
    });
  });

  test('offset/limit slice past HEAD without changing total', () => {
    expect(paginatePublicVersionList(raw, { limit: 1, offset: 1 })).toEqual({
      data: [TAGGED],
      total: 2,
      limit: 1,
      offset: 1,
    });
  });

  test('treats missing data as an empty list', () => {
    expect(paginatePublicVersionList({}, { limit: 50, offset: 0 })).toEqual({
      data: [],
      total: 0,
      limit: 50,
      offset: 0,
    });
  });
});

describe('formatWorkflowVersionLabel', () => {
  test('renders null and empty as untagged', () => {
    expect(formatWorkflowVersionLabel(null)).toBe('untagged');
    expect(formatWorkflowVersionLabel(undefined)).toBe('untagged');
    expect(formatWorkflowVersionLabel('')).toBe('untagged');
  });

  test('passes through a bare semver tag', () => {
    expect(formatWorkflowVersionLabel('1.4.0')).toBe('1.4.0');
  });
});

describe('resolveWorkflowVersionCreateRequest', () => {
  test('requires exactly one source', () => {
    expect(() => resolveWorkflowVersionCreateRequest({ setVersion: '1.0.0' })).toThrow(
      /--file <yaml> or --from/
    );
    expect(() =>
      resolveWorkflowVersionCreateRequest({
        file: 'workflow.yaml',
        from: 'wh_abc',
        setVersion: '1.0.0',
      })
    ).toThrow(/not both/);
  });

  test('requires explicit semver when copying history', () => {
    expect(() => resolveWorkflowVersionCreateRequest({ from: 'wh_abc' })).toThrow(/--set-version/);
  });

  test('accepts YAML version when --set-version is omitted', () => {
    expect(
      resolveWorkflowVersionCreateRequest({ file: 'workflow.yaml', yamlVersion: '1.2.3' })
    ).toEqual({ source: 'yaml', version: '1.2.3' });
  });

  test('rejects YAML version plus --set-version', () => {
    expect(() =>
      resolveWorkflowVersionCreateRequest({
        file: 'workflow.yaml',
        setVersion: '1.4.0',
        yamlVersion: '1.2.3',
      })
    ).toThrow(/conflicts/);
  });

  test('rejects a leading v', () => {
    expect(() =>
      resolveWorkflowVersionCreateRequest({ from: 'wh_abc', setVersion: 'v1.4.0' })
    ).toThrow(/bare semver/);
  });
});

describe('workflow versions help', () => {
  test('lists create, promote, restore, and list', () => {
    const result = spawnSync('bun', [CLI, 'workflow', 'versions', '--help'], {
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('create');
    expect(result.stdout).toContain('promote');
    expect(result.stdout).toContain('restore');
    expect(result.stdout).toContain('list');
    expect(result.stdout).toContain('--no-activate');
  });

  test('create help documents sources, semver, and detached activate', () => {
    const result = spawnSync('bun', [CLI, 'workflow', 'versions', 'create', '--help'], {
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('--file');
    expect(result.stdout).toContain('--from');
    expect(result.stdout).toContain('--set-version');
    expect(result.stdout).toContain('--no-activate');
    expect(result.stdout).toContain('workflow versions promote');
  });

  test('list help documents client-side pagination and the --json envelope', () => {
    const result = spawnSync('bun', [CLI, 'workflow', 'versions', 'list', '--help'], {
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('--limit');
    expect(result.stdout).toContain('--offset');
    expect(result.stdout).toContain('client-side');
    expect(result.stdout).toContain('{ data, total, limit, offset }');
    expect(result.stdout).not.toContain('accepted for compatibility');
  });
});

describe('workflow versions list', () => {
  test('GETs the public automations versions path', async () => {
    let seenPath: string | null = null;
    let seenSearch: string | null = null;
    await withApiServer(
      (request) => {
        const resolved = resolveWorkflowRoute(request, 'wf_abc');
        if (resolved) return resolved;
        const url = new URL(request.url);
        seenPath = url.pathname;
        seenSearch = url.search;
        if (request.method === 'GET' && url.pathname === '/v1/automations/wf_abc/versions') {
          return jsonResponse({
            data: [UNTAGGED_HEAD, TAGGED],
            total: 2,
            limit: 2,
            offset: 0,
          });
        }
        return new Response('not found', { status: 404 });
      },
      async (baseUrl) => {
        const result = await runCli(
          ['workflow', 'versions', 'list', 'wf_abc', '--base-url', baseUrl],
          baseUrl
        );
        expect(result.status).toBe(0);
        expect(seenPath).toBe('/v1/automations/wf_abc/versions');
        expect(seenSearch).toBe('');
        expect(result.stdout).toContain('untagged');
        expect(result.stdout).toContain('wh_head');
        expect(result.stdout).toContain('yes');
        expect(result.stdout).toContain('1.4.0');
        expect(result.stdout).not.toContain('vnull');
      }
    );
  });

  test('--json preserves version: null on the untagged current row', async () => {
    await withApiServer(
      (request) => {
        const resolved = resolveWorkflowRoute(request, 'wf_abc');
        if (resolved) return resolved;
        const url = new URL(request.url);
        if (request.method === 'GET' && url.pathname === '/v1/automations/wf_abc/versions') {
          return jsonResponse({
            data: [UNTAGGED_HEAD, TAGGED],
            total: 2,
            limit: 2,
            offset: 0,
          });
        }
        return new Response('not found', { status: 404 });
      },
      async (baseUrl) => {
        const result = await runCli(
          ['workflow', 'versions', 'list', 'wf_abc', '--json', '--base-url', baseUrl],
          baseUrl
        );
        expect(result.status).toBe(0);
        const payload = JSON.parse(result.stdout) as {
          data: Array<{ id: string; version: string | null; isCurrent: boolean }>;
          total: number;
          limit: number;
          offset: number;
        };
        expect(payload).toMatchObject({ total: 2, limit: 50, offset: 0 });
        expect(payload.data[0]).toMatchObject({
          id: 'wh_head',
          version: null,
          isCurrent: true,
        });
        expect(result.stdout).toMatch(/"version": null/);
      }
    );
  });

  test('--limit 1 keeps untagged HEAD and reports unsliced total', async () => {
    let seenSearch: string | null = null;
    await withApiServer(
      (request) => {
        const resolved = resolveWorkflowRoute(request, 'wf_abc');
        if (resolved) return resolved;
        const url = new URL(request.url);
        if (request.method === 'GET' && url.pathname === '/v1/automations/wf_abc/versions') {
          seenSearch = url.search;
          return jsonResponse({
            data: [UNTAGGED_HEAD, TAGGED],
            total: 2,
            limit: 2,
            offset: 0,
          });
        }
        return new Response('not found', { status: 404 });
      },
      async (baseUrl) => {
        const result = await runCli(
          [
            'workflow',
            'versions',
            'list',
            'wf_abc',
            '--limit',
            '1',
            '--json',
            '--base-url',
            baseUrl,
          ],
          baseUrl
        );
        expect(result.status).toBe(0);
        expect(seenSearch).toBe('');
        const payload = JSON.parse(result.stdout) as {
          data: Array<{ id: string; version: string | null }>;
          total: number;
          limit: number;
          offset: number;
        };
        expect(payload).toEqual({
          data: [UNTAGGED_HEAD],
          total: 2,
          limit: 1,
          offset: 0,
        });
        expect(result.stderr).toContain('1 of 2 versions');
      }
    );
  });

  test('--offset 1 --limit 1 skips untagged HEAD and keeps the tagged row', async () => {
    await withApiServer(
      (request) => {
        const resolved = resolveWorkflowRoute(request, 'wf_abc');
        if (resolved) return resolved;
        const url = new URL(request.url);
        if (request.method === 'GET' && url.pathname === '/v1/automations/wf_abc/versions') {
          return jsonResponse({
            data: [UNTAGGED_HEAD, TAGGED],
            total: 2,
            limit: 2,
            offset: 0,
          });
        }
        return new Response('not found', { status: 404 });
      },
      async (baseUrl) => {
        const result = await runCli(
          [
            'workflow',
            'versions',
            'list',
            'wf_abc',
            '--offset',
            '1',
            '--limit',
            '1',
            '--json',
            '--base-url',
            baseUrl,
          ],
          baseUrl
        );
        expect(result.status).toBe(0);
        const payload = JSON.parse(result.stdout) as {
          data: Array<{ id: string; version: string | null; isCurrent: boolean }>;
          total: number;
          limit: number;
          offset: number;
        };
        expect(payload).toEqual({
          data: [TAGGED],
          total: 2,
          limit: 1,
          offset: 1,
        });
        expect(result.stdout).not.toMatch(/"version": null/);
        expect(result.stderr).toContain('1 of 2 versions');
      }
    );
  });
});

describe('workflow versions create', () => {
  test('posts YAML, explicit semver, and activate: true by default', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eigenpal-versions-create-'));
    const file = join(dir, 'workflow.yaml');
    writeFileSync(file, 'name: invoices\nsteps: []\n');
    let posted: { pathname: string; body: unknown } | null = null;
    try {
      await withApiServer(
        async (request) => {
          const resolved = resolveWorkflowRoute(request, 'wf_abc');
          if (resolved) return resolved;
          const url = new URL(request.url);
          if (request.method === 'POST' && url.pathname === '/v1/automations/wf_abc/versions') {
            posted = { pathname: url.pathname, body: await request.json() };
            return jsonResponse(
              { id: 'wh_new', automationId: 'wf_abc', version: '1.4.0', isCurrent: true },
              { status: 201 }
            );
          }
          return new Response('not found', { status: 404 });
        },
        async (baseUrl) => {
          const result = await runCli(
            [
              'workflow',
              'versions',
              'create',
              'wf_abc',
              '--file',
              file,
              '--set-version',
              '1.4.0',
              '--json',
              '--base-url',
              baseUrl,
            ],
            baseUrl
          );
          expect(result.status).toBe(0);
          expect(posted).toEqual({
            pathname: '/v1/automations/wf_abc/versions',
            body: {
              yaml: 'name: invoices\nsteps: []\n',
              version: '1.4.0',
              activate: true,
            },
          });
          expect(JSON.parse(result.stdout)).toMatchObject({
            id: 'wh_new',
            version: '1.4.0',
            isCurrent: true,
          });
        }
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('--no-activate posts activate: false', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eigenpal-versions-detached-'));
    const file = join(dir, 'workflow.yaml');
    writeFileSync(file, 'name: invoices\nsteps: []\n');
    let body: unknown = null;
    try {
      await withApiServer(
        async (request) => {
          const resolved = resolveWorkflowRoute(request, 'wf_abc');
          if (resolved) return resolved;
          const url = new URL(request.url);
          if (request.method === 'POST' && url.pathname === '/v1/automations/wf_abc/versions') {
            body = await request.json();
            return jsonResponse(
              { id: 'wh_new', automationId: 'wf_abc', version: '1.4.1', isCurrent: false },
              { status: 201 }
            );
          }
          return new Response('not found', { status: 404 });
        },
        async (baseUrl) => {
          const result = await runCli(
            [
              'workflow',
              'versions',
              'create',
              'wf_abc',
              '--file',
              file,
              '--set-version',
              '1.4.1',
              '--no-activate',
              '--base-url',
              baseUrl,
            ],
            baseUrl
          );
          expect(result.status).toBe(0);
          expect(body).toMatchObject({ version: '1.4.1', activate: false });
          expect(result.stderr).toContain('detached candidate');
          expect(result.stderr).toContain('workflow versions promote wf_abc wh_new');
        }
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('--from posts historyId and does not send yaml', async () => {
    let posted: unknown = null;
    await withApiServer(
      async (request) => {
        const resolved = resolveWorkflowRoute(request, 'wf_abc');
        if (resolved) return resolved;
        const url = new URL(request.url);
        if (request.method === 'POST' && url.pathname === '/v1/automations/wf_abc/versions') {
          posted = await request.json();
          return jsonResponse(
            { id: 'wh_copy', automationId: 'wf_abc', version: '1.5.0', isCurrent: false },
            { status: 201 }
          );
        }
        return new Response('not found', { status: 404 });
      },
      async (baseUrl) => {
        const result = await runCli(
          [
            'workflow',
            'versions',
            'create',
            'wf_abc',
            '--from',
            'wh_old',
            '--set-version',
            '1.5.0',
            '--no-activate',
            '--json',
            '--base-url',
            baseUrl,
          ],
          baseUrl
        );
        expect(result.status).toBe(0);
        expect(posted).toEqual({
          historyId: 'wh_old',
          version: '1.5.0',
          activate: false,
        });
      }
    );
  });

  test('rejects missing source without calling the API', async () => {
    const result = spawnSync(
      'bun',
      [CLI, 'workflow', 'versions', 'create', 'wf_abc', '--set-version', '1.0.0'],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          EIGENPAL_API_KEY: 'eig_test_key',
          EIGENPAL_BASE_URL: 'http://127.0.0.1:9',
        },
      }
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('--file');
    expect(result.stderr).toContain('--from');
  });
});

describe('workflow versions promote', () => {
  test('POSTs the public promote path with no body', async () => {
    let seen: { method: string; pathname: string; rawBody: string } | null = null;
    await withApiServer(
      async (request) => {
        const resolved = resolveWorkflowRoute(request, 'wf_abc');
        if (resolved) return resolved;
        const url = new URL(request.url);
        if (url.pathname === '/v1/automations/wf_abc/versions/wh_tagged/promote') {
          seen = {
            method: request.method,
            pathname: url.pathname,
            rawBody: await request.text(),
          };
          return jsonResponse({
            id: 'wh_tagged',
            automationId: 'wf_abc',
            version: '1.4.0',
            isCurrent: true,
          });
        }
        return new Response('not found', { status: 404 });
      },
      async (baseUrl) => {
        const result = await runCli(
          [
            'workflow',
            'versions',
            'promote',
            'wf_abc',
            'wh_tagged',
            '--json',
            '--base-url',
            baseUrl,
          ],
          baseUrl
        );
        expect(result.status).toBe(0);
        expect(seen).toEqual({
          method: 'POST',
          pathname: '/v1/automations/wf_abc/versions/wh_tagged/promote',
          rawBody: '',
        });
        expect(JSON.parse(result.stdout)).toMatchObject({
          id: 'wh_tagged',
          version: '1.4.0',
          isCurrent: true,
        });
      }
    );
  });
});

describe('workflow versions restore', () => {
  test('POSTs the public restore path with an empty object by default', async () => {
    let posted: { pathname: string; body: unknown } | null = null;
    await withApiServer(
      async (request) => {
        const resolved = resolveWorkflowRoute(request, 'wf_abc');
        if (resolved) return resolved;
        const url = new URL(request.url);
        if (url.pathname === '/v1/automations/wf_abc/versions/wh_old/restore') {
          posted = { pathname: url.pathname, body: await request.json() };
          return jsonResponse(UNTAGGED_HEAD, { status: 201 });
        }
        return new Response('not found', { status: 404 });
      },
      async (baseUrl) => {
        const result = await runCli(
          ['workflow', 'versions', 'restore', 'wf_abc', 'wh_old', '--base-url', baseUrl],
          baseUrl
        );
        expect(result.status).toBe(0);
        expect(posted).toEqual({
          pathname: '/v1/automations/wf_abc/versions/wh_old/restore',
          body: {},
        });
        expect(result.stderr).toContain('untagged current version');
        expect(result.stderr).toContain('wh_head');
        expect(result.stderr).not.toContain('vnull');
        expect(result.stderr).not.toContain('to v?');
      }
    );
  });

  test('--json preserves version: null and --message is forwarded', async () => {
    let posted: unknown = null;
    await withApiServer(
      async (request) => {
        const resolved = resolveWorkflowRoute(request, 'wf_abc');
        if (resolved) return resolved;
        const url = new URL(request.url);
        if (url.pathname === '/v1/automations/wf_abc/versions/wh_old/restore') {
          posted = await request.json();
          return jsonResponse(UNTAGGED_HEAD, { status: 201 });
        }
        return new Response('not found', { status: 404 });
      },
      async (baseUrl) => {
        const result = await runCli(
          [
            'workflow',
            'versions',
            'restore',
            'wf_abc',
            'wh_old',
            '--message',
            'roll back Friday change',
            '--json',
            '--base-url',
            baseUrl,
          ],
          baseUrl
        );
        expect(result.status).toBe(0);
        expect(posted).toEqual({ message: 'roll back Friday change' });
        const payload = JSON.parse(result.stdout) as { version: string | null; isCurrent: boolean };
        expect(payload.version).toBeNull();
        expect(payload.isCurrent).toBe(true);
        expect(result.stdout).toMatch(/"version": null/);
      }
    );
  });
});
