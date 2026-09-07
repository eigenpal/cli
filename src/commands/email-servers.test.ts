import { describe, expect, test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertCompleteSmtpUpdateTarget,
  buildCreateRequest,
  buildUpdateRequest,
  redactEmailServerPayload,
  rejectInlineSecrets,
} from '../lib/email-servers-cli';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'cli.ts');

const RESEND_SERVER = {
  id: 'ems_testserver00000000001',
  name: 'Alerts',
  enabled: true,
  transport: 'resend' as const,
  fromEmail: 'alerts@example.com',
  fromName: 'Alerts',
  apiKeyConfigured: true as const,
  createdAt: '2026-09-04T10:00:00.000Z',
  updatedAt: '2026-09-04T10:00:00.000Z',
};

const SMTP_SERVER = {
  id: 'ems_testserver00000000002',
  name: 'Corp SMTP',
  enabled: true,
  transport: 'smtp' as const,
  fromEmail: 'noreply@example.com',
  fromName: 'Eigenpal',
  host: 'smtp.example.com',
  port: 587,
  security: 'starttls' as const,
  username: 'mailer',
  passwordConfigured: true,
  caPemConfigured: false,
  createdAt: '2026-09-04T10:00:00.000Z',
  updatedAt: '2026-09-04T10:00:00.000Z',
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

describe('email-servers CLI helpers', () => {
  test('redactEmailServerPayload strips secret keys recursively', () => {
    const redacted = redactEmailServerPayload({
      id: RESEND_SERVER.id,
      apiKey: 're_live_secret',
      nested: { password: 'pw', ciphertext: 'blob', ok: true },
    });
    expect(JSON.stringify(redacted)).not.toContain('re_live_secret');
    expect(JSON.stringify(redacted)).not.toContain('"password":"pw"');
    expect(JSON.stringify(redacted)).toContain('[redacted]');
  });

  test('rejectInlineSecrets blocks secrets in config JSON', () => {
    expect(() => rejectInlineSecrets({ name: 'Alerts', apiKey: 're_test' })).toThrow(/apiKey/i);
  });

  test('buildCreateRequest merges explicit flags with secret file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eig-email-cli-lib-'));
    try {
      const keyPath = join(dir, 're.key');
      writeFileSync(keyPath, 're_test_key');
      const body = await buildCreateRequest({
        name: 'Alerts',
        transport: 'resend',
        fromEmail: 'alerts@example.com',
        fromName: 'Alerts',
        apiKeyFile: keyPath,
      });
      expect(body).toMatchObject({
        name: 'Alerts',
        transport: 'resend',
        apiKey: 're_test_key',
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('buildUpdateRequest errors on empty patch', async () => {
    await expect(
      buildUpdateRequest({
        existing: RESEND_SERVER,
        opts: {},
      })
    ).rejects.toThrow(/No changes requested/);
  });

  test('buildCreateRequest defaults SMTP security and port', async () => {
    const body = await buildCreateRequest({
      name: 'Corp SMTP',
      transport: 'smtp',
      host: 'smtp.example.com',
      fromEmail: 'noreply@example.com',
      fromName: 'Eigenpal',
    });
    expect(body).toMatchObject({
      transport: 'smtp',
      security: 'starttls',
      port: 587,
      fromName: 'Eigenpal',
    });
  });

  test('buildCreateRequest trims fromName and rejects angle brackets', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eig-email-cli-fromname-'));
    try {
      const keyPath = join(dir, 're.key');
      writeFileSync(keyPath, 're_test_key');
      const body = await buildCreateRequest({
        name: 'Alerts',
        transport: 'resend',
        fromEmail: 'alerts@example.com',
        fromName: '  Alerts  ',
        apiKeyFile: keyPath,
      });
      expect(body.fromName).toBe('Alerts');
      await expect(
        buildCreateRequest({
          name: 'Alerts',
          transport: 'resend',
          fromEmail: 'alerts@example.com',
          fromName: 'Alerts <ops@example.com>',
          apiKeyFile: keyPath,
        })
      ).rejects.toThrow(/fromName|angle brackets|control/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('assertCompleteSmtpUpdateTarget and buildUpdateRequest require port and security', async () => {
    expect(() =>
      assertCompleteSmtpUpdateTarget({
        transport: 'smtp',
        host: 'smtp.example.com',
        fromEmail: 'noreply@example.com',
        fromName: 'Eigenpal',
      })
    ).toThrow(/--port.*--security|--security.*--port/);

    await expect(
      buildUpdateRequest({
        existing: RESEND_SERVER,
        opts: {
          transport: 'smtp',
          host: 'smtp.example.com',
          fromEmail: 'noreply@example.com',
          fromName: 'Eigenpal',
        },
      })
    ).rejects.toThrow(/complete target/i);

    const patch = await buildUpdateRequest({
      existing: SMTP_SERVER,
      opts: {
        transport: 'smtp',
        host: 'smtp.example.com',
        port: 587,
        security: 'starttls',
        fromEmail: 'noreply@example.com',
        fromName: 'Eigenpal',
      },
    });
    expect(patch).toMatchObject({
      transport: 'smtp',
      port: 587,
      security: 'starttls',
    });
    expect('password' in patch).toBe(false);
  });

  test('buildCreateRequest accepts unauthenticated security none and rejects credentials', async () => {
    const body = await buildCreateRequest({
      name: 'Internal relay',
      transport: 'smtp',
      host: 'smtp.internal',
      security: 'none',
      fromEmail: 'noreply@example.com',
      fromName: 'Eigenpal',
    });
    expect(body).toMatchObject({ transport: 'smtp', security: 'none', port: 25 });
    expect('username' in body).toBe(false);

    const dir = mkdtempSync(join(tmpdir(), 'eig-email-cli-none-'));
    try {
      const passwordPath = join(dir, 'smtp.pw');
      writeFileSync(passwordPath, 'secret');
      await expect(
        buildCreateRequest({
          name: 'Internal relay',
          transport: 'smtp',
          host: 'smtp.internal',
          security: 'none',
          username: 'mailer',
          fromEmail: 'noreply@example.com',
          fromName: 'Eigenpal',
          passwordFile: passwordPath,
        })
      ).rejects.toThrow(/security 'none'/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('buildUpdateRequest rejects retaining SMTP credentials when switching to none', async () => {
    const noneOpts = {
      transport: 'smtp' as const,
      host: 'smtp.example.com',
      port: 25,
      security: 'none',
      fromEmail: 'noreply@example.com',
      fromName: 'Eigenpal',
    };
    await expect(buildUpdateRequest({ existing: SMTP_SERVER, opts: noneOpts })).rejects.toThrow(
      /security 'none'/
    );

    const cleared = await buildUpdateRequest({
      existing: SMTP_SERVER,
      opts: { ...noneOpts, clearUsername: true },
    });
    expect(cleared).toMatchObject({ security: 'none', username: null });
  });

  test('buildUpdateRequest rejects unpaired SMTP credentials', async () => {
    const unauth = { ...SMTP_SERVER, username: null, passwordConfigured: false };
    const target = {
      transport: 'smtp' as const,
      host: 'smtp.example.com',
      port: 587,
      security: 'starttls',
      fromEmail: 'noreply@example.com',
      fromName: 'Eigenpal',
    };

    await expect(
      buildUpdateRequest({ existing: unauth, opts: { ...target, username: 'mailer' } })
    ).rejects.toThrow(/--password-stdin|password is required in noninteractive/i);

    const dir = mkdtempSync(join(tmpdir(), 'eig-email-cli-pair-'));
    try {
      const passwordPath = join(dir, 'smtp.pw');
      writeFileSync(passwordPath, 'secret');
      await expect(
        buildUpdateRequest({
          existing: unauth,
          opts: { ...target, passwordFile: passwordPath },
        })
      ).rejects.toThrow(/both be present or both absent/);

      const both = await buildUpdateRequest({
        existing: unauth,
        opts: { ...target, username: 'mailer', passwordFile: passwordPath },
      });
      expect(both).toMatchObject({ username: 'mailer' });
      expect('password' in both && both.password).toBe('secret');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    await expect(
      buildUpdateRequest({
        existing: SMTP_SERVER,
        opts: { ...target, username: 'ops' },
      })
    ).rejects.toThrow(/--password-stdin|password is required in noninteractive/i);
  });
});

describe('eigenpal email-servers', () => {
  test('help lists lifecycle verbs', () => {
    const result = spawnSync('bun', [CLI, 'email-servers', '--help'], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    for (const verb of ['list', 'get', 'create', 'update', 'delete', 'test']) {
      expect(result.stdout).toContain(verb);
    }
    expect(result.stdout).toContain('real connectivity test email');
    expect(result.stdout).toContain('--port 587');
    expect(result.stdout).toContain('--security starttls');
    const createHelp = spawnSync('bun', [CLI, 'email-servers', 'create', '--help'], {
      encoding: 'utf8',
    });
    expect(createHelp.status).toBe(0);
    expect(createHelp.stdout).toContain('unauthenticated');
    expect(createHelp.stdout).toContain('credentials are rejected');
  });

  test('list forwards pagination and prints table/json envelope', async () => {
    let capturedPath = '';
    await withApiServer(
      (request) => {
        const url = new URL(request.url);
        capturedPath = url.pathname + url.search;
        return jsonResponse({
          data: [RESEND_SERVER, SMTP_SERVER],
          total: 2,
          limit: 10,
          offset: 5,
        });
      },
      async (baseUrl) => {
        const result = await runCli(
          [
            'email-servers',
            'list',
            '--limit',
            '10',
            '--offset',
            '5',
            '--json',
            '--base-url',
            baseUrl,
          ],
          { baseUrl }
        );
        expect(result.status).toBe(0);
        expect(capturedPath).toBe('/v1/email-servers?limit=10&offset=5');
        const body = JSON.parse(result.stdout) as { data: (typeof RESEND_SERVER)[] };
        expect(body.data).toHaveLength(2);
      }
    );
  });

  test('get --json redacts leaked secret fields from the API', async () => {
    await withApiServer(
      (request) => {
        const url = new URL(request.url);
        if (request.method === 'GET' && url.pathname === `/v1/email-servers/${RESEND_SERVER.id}`) {
          return jsonResponse({ ...RESEND_SERVER, apiKey: 're_leaked_secret' });
        }
        return jsonResponse({ error: 'not found' }, { status: 404 });
      },
      async (baseUrl) => {
        const result = await runCli(
          ['email-servers', 'get', RESEND_SERVER.id, '--json', '--base-url', baseUrl],
          { baseUrl }
        );
        expect(result.status).toBe(0);
        expect(result.stdout).not.toContain('re_leaked_secret');
        expect(result.stdout).toContain('[redacted]');
      }
    );
  });

  test('create posts validated body without echoing secrets', async () => {
    let capturedBody: unknown;
    await withApiServer(
      (request) => {
        const url = new URL(request.url);
        if (request.method === 'POST' && url.pathname === '/v1/email-servers') {
          return request.json().then((body) => {
            capturedBody = body;
            return jsonResponse(RESEND_SERVER, { status: 201 });
          });
        }
        return jsonResponse({ error: 'not found' }, { status: 404 });
      },
      async (baseUrl) => {
        const result = await runCli(
          [
            'email-servers',
            'create',
            '--transport',
            'resend',
            '--name',
            'Alerts',
            '--from-email',
            'alerts@example.com',
            '--from-name',
            'Alerts',
            '--api-key-stdin',
            '--json',
            '--base-url',
            baseUrl,
          ],
          { baseUrl, stdin: 're_test_key\n' }
        );
        expect(result.status).toBe(0);
        expect(capturedBody).toEqual({
          name: 'Alerts',
          transport: 'resend',
          fromEmail: 'alerts@example.com',
          fromName: 'Alerts',
          enabled: true,
          apiKey: 're_test_key',
        });
        expect(`${result.stdout}${result.stderr}`).not.toContain('re_test_key');
      }
    );
  });

  test('create rejects secrets embedded in config JSON', async () => {
    const result = await runCli([
      'email-servers',
      'create',
      '--config-json',
      JSON.stringify({
        name: 'Alerts',
        transport: 'resend',
        fromEmail: 'alerts@example.com',
        fromName: 'Alerts',
        apiKey: 're_test',
      }),
    ]);
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toMatch(/Secret field "apiKey"/);
  });

  test('update PATCHes metadata-only changes', async () => {
    let capturedPath = '';
    let capturedBody: unknown;
    await withApiServer(
      (request) => {
        const url = new URL(request.url);
        if (request.method === 'GET' && url.pathname === `/v1/email-servers/${RESEND_SERVER.id}`) {
          return jsonResponse(RESEND_SERVER);
        }
        if (
          request.method === 'PATCH' &&
          url.pathname === `/v1/email-servers/${RESEND_SERVER.id}`
        ) {
          capturedPath = url.pathname;
          return request.json().then((body) => {
            capturedBody = body;
            return jsonResponse({ ...RESEND_SERVER, name: 'Renamed' });
          });
        }
        return jsonResponse({ error: 'not found' }, { status: 404 });
      },
      async (baseUrl) => {
        const result = await runCli(
          [
            'email-servers',
            'update',
            RESEND_SERVER.id,
            '--name',
            'Renamed',
            '--json',
            '--base-url',
            baseUrl,
          ],
          { baseUrl }
        );
        expect(result.status).toBe(0);
        expect(capturedPath).toBe(`/v1/email-servers/${RESEND_SERVER.id}`);
        expect(capturedBody).toEqual({ name: 'Renamed' });
      }
    );
  });

  test('update rejects incomplete SMTP transport replacement without PATCHing', async () => {
    let patched = false;
    await withApiServer(
      (request) => {
        const url = new URL(request.url);
        if (request.method === 'GET' && url.pathname === `/v1/email-servers/${RESEND_SERVER.id}`) {
          return jsonResponse(RESEND_SERVER);
        }
        if (request.method === 'PATCH') {
          patched = true;
          return jsonResponse({ error: 'should not patch' }, { status: 500 });
        }
        return jsonResponse({ error: 'not found' }, { status: 404 });
      },
      async (baseUrl) => {
        const result = await runCli(
          [
            'email-servers',
            'update',
            RESEND_SERVER.id,
            '--transport',
            'smtp',
            '--host',
            'smtp.example.com',
            '--from-email',
            'noreply@example.com',
            '--from-name',
            'Eigenpal',
            '--base-url',
            baseUrl,
          ],
          { baseUrl }
        );
        expect(result.status).not.toBe(0);
        expect(patched).toBe(false);
        expect(`${result.stdout}${result.stderr}`).toMatch(/complete target/i);
        expect(`${result.stdout}${result.stderr}`).toMatch(/--port/);
        expect(`${result.stdout}${result.stderr}`).toMatch(/--security/);
      }
    );
  });

  test('update PATCHes a complete SMTP target and omits password to retain it', async () => {
    let capturedBody: unknown;
    await withApiServer(
      (request) => {
        const url = new URL(request.url);
        if (request.method === 'GET' && url.pathname === `/v1/email-servers/${SMTP_SERVER.id}`) {
          return jsonResponse(SMTP_SERVER);
        }
        if (request.method === 'PATCH' && url.pathname === `/v1/email-servers/${SMTP_SERVER.id}`) {
          return request.json().then((body) => {
            capturedBody = body;
            return jsonResponse(SMTP_SERVER);
          });
        }
        return jsonResponse({ error: 'not found' }, { status: 404 });
      },
      async (baseUrl) => {
        const result = await runCli(
          [
            'email-servers',
            'update',
            SMTP_SERVER.id,
            '--transport',
            'smtp',
            '--host',
            'smtp.example.com',
            '--port',
            '587',
            '--security',
            'starttls',
            '--from-email',
            'noreply@example.com',
            '--from-name',
            'Eigenpal',
            '--json',
            '--base-url',
            baseUrl,
          ],
          { baseUrl }
        );
        expect(result.status).toBe(0);
        expect(capturedBody).toEqual({
          transport: 'smtp',
          host: 'smtp.example.com',
          port: 587,
          security: 'starttls',
          fromEmail: 'noreply@example.com',
          fromName: 'Eigenpal',
        });
      }
    );
  });

  test('update errors when no changes are requested', async () => {
    await withApiServer(
      (request) => {
        const url = new URL(request.url);
        if (request.method === 'GET' && url.pathname === `/v1/email-servers/${RESEND_SERVER.id}`) {
          return jsonResponse(RESEND_SERVER);
        }
        return jsonResponse({ error: 'not found' }, { status: 404 });
      },
      async (baseUrl) => {
        const result = await runCli(
          ['email-servers', 'update', RESEND_SERVER.id, '--base-url', baseUrl],
          { baseUrl }
        );
        expect(result.status).not.toBe(0);
        expect(`${result.stdout}${result.stderr}`).toMatch(/No changes requested/);
      }
    );
  });

  test('delete requires --yes off TTY', async () => {
    const result = spawnSync('bun', [CLI, 'email-servers', 'delete', RESEND_SERVER.id], {
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

  test('test sends live message request and exits nonzero on failure', async () => {
    await withApiServer(
      (request) => {
        const url = new URL(request.url);
        if (
          request.method === 'POST' &&
          url.pathname === `/v1/email-servers/${RESEND_SERVER.id}/test`
        ) {
          return request.json().then((body) => {
            expect(body).toEqual({ to: 'ops@example.com' });
            return jsonResponse({ ok: false, error: 'connection refused' });
          });
        }
        return jsonResponse({ error: 'not found' }, { status: 404 });
      },
      async (baseUrl) => {
        const result = await runCli(
          [
            'email-servers',
            'test',
            RESEND_SERVER.id,
            '--to',
            'ops@example.com',
            '--json',
            '--base-url',
            baseUrl,
          ],
          { baseUrl }
        );
        expect(result.status).toBe(1);
        expect(JSON.parse(result.stdout)).toEqual({ ok: false, error: 'connection refused' });
      }
    );
  });

  test('create accepts --config-file and external secret file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eig-email-servers-'));
    try {
      const configPath = join(dir, 'server.json');
      const keyPath = join(dir, 're.key');
      writeFileSync(
        configPath,
        JSON.stringify({
          name: 'Alerts',
          transport: 'resend',
          fromEmail: 'alerts@example.com',
          fromName: 'Alerts',
        })
      );
      writeFileSync(keyPath, 're_from_file\n');

      let capturedBody: unknown;
      await withApiServer(
        (request) => {
          const url = new URL(request.url);
          if (request.method === 'POST' && url.pathname === '/v1/email-servers') {
            return request.json().then((body) => {
              capturedBody = body;
              return jsonResponse(RESEND_SERVER, { status: 201 });
            });
          }
          return jsonResponse({ error: 'not found' }, { status: 404 });
        },
        async (baseUrl) => {
          const result = await runCli(
            [
              'email-servers',
              'create',
              '--config-file',
              configPath,
              '--api-key-file',
              keyPath,
              '--json',
              '--base-url',
              baseUrl,
            ],
            { baseUrl }
          );
          expect(result.status).toBe(0);
          expect(capturedBody).toMatchObject({ apiKey: 're_from_file' });
          expect(`${result.stdout}${result.stderr}`).not.toContain('re_from_file');
        }
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
