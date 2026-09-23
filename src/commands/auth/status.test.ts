import { describe, expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
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
  opts: { baseUrl?: string; apiKey?: string | null } = {}
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('bun', [CLI, ...args], {
      env: {
        ...process.env,
        // Point HOME at nowhere so no developer profile leaks into the test.
        HOME: '/nonexistent-eigenpal-test-home',
        ...(opts.apiKey === undefined
          ? { EIGENPAL_API_KEY: 'eig_test_key' }
          : opts.apiKey === null
            ? {}
            : { EIGENPAL_API_KEY: opts.apiKey }),
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

const AUTH_CHECK = {
  ok: true,
  tenantId: 'org_test',
  tenantName: 'Test Org',
  email: 'timur@eigenpal.com',
  name: 'Timur',
  keyId: 'key_123',
};

describe('auth status', () => {
  test('status --json reports profile, base URL, and credential validity with silent stderr', async () => {
    await withApiServer(
      (request) => {
        const url = new URL(request.url);
        if (url.pathname === '/v1/auth/check') return jsonResponse(AUTH_CHECK);
        return jsonResponse({ error: 'not found' }, { status: 404 });
      },
      async (baseUrl) => {
        const result = await runCli(['auth', 'status', '--json'], { baseUrl });
        expect(result.status).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual({
          authenticated: true,
          profile: null,
          baseUrl,
          keySource: 'env',
          tenantId: 'org_test',
          tenantName: 'Test Org',
          user: { email: 'timur@eigenpal.com', name: 'Timur' },
          keyId: 'key_123',
        });
        expect(result.stderr).toBe('');
      }
    );
  });

  test('whoami answers the same as status', async () => {
    await withApiServer(
      (request) => {
        const url = new URL(request.url);
        if (url.pathname === '/v1/auth/check') return jsonResponse(AUTH_CHECK);
        return jsonResponse({ error: 'not found' }, { status: 404 });
      },
      async (baseUrl) => {
        const result = await runCli(['auth', 'whoami', '--json'], { baseUrl });
        expect(result.status).toBe(0);
        expect(JSON.parse(result.stdout)).toMatchObject({
          authenticated: true,
          tenantId: 'org_test',
        });
        expect(result.stderr).toBe('');
      }
    );
  });

  test('human output names server, tenant, and user', async () => {
    await withApiServer(
      (request) => {
        const url = new URL(request.url);
        if (url.pathname === '/v1/auth/check') return jsonResponse(AUTH_CHECK);
        return jsonResponse({ error: 'not found' }, { status: 404 });
      },
      async (baseUrl) => {
        const result = await runCli(['auth', 'status'], { baseUrl });
        expect(result.status).toBe(0);
        expect(result.stdout).toContain(baseUrl);
        expect(result.stdout).toContain('Test Org');
        expect(result.stdout).toContain('timur@eigenpal.com');
      }
    );
  });

  test('revoked key exits 1 with valid JSON', async () => {
    await withApiServer(
      () => jsonResponse({ error: 'unauthorized' }, { status: 401 }),
      async (baseUrl) => {
        const result = await runCli(['auth', 'status', '--json'], { baseUrl });
        expect(result.status).toBe(1);
        expect(JSON.parse(result.stdout)).toMatchObject({ authenticated: false });
      }
    );
  });

  test('missing key exits 1 with valid JSON', async () => {
    await withApiServer(
      () => jsonResponse({ error: 'should not be called' }, { status: 500 }),
      async (baseUrl) => {
        const result = await runCli(['auth', 'status', '--json'], { baseUrl, apiKey: null });
        expect(result.status).toBe(1);
        expect(JSON.parse(result.stdout)).toMatchObject({ authenticated: false, baseUrl });
      }
    );
  });
});
