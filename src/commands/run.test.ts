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
  opts: { baseUrl?: string; env?: Record<string, string> } = {}
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('bun', [CLI, ...args], {
      env: {
        ...process.env,
        EIGENPAL_API_KEY: 'eig_test_key',
        ...(opts.baseUrl ? { EIGENPAL_BASE_URL: opts.baseUrl } : {}),
        ...opts.env,
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
  test('run posts JSON input to the unified runs endpoint', async () => {
    let captured: { pathname: string; body: unknown } | null = null;
    await withRunServer(
      async (request) => {
        const url = new URL(request.url);
        captured = { pathname: url.pathname, body: await request.json() };
        return json({ id: 'run_123', type: 'workflow', finished: false }, { status: 201 });
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
          pathname: '/v1/runs',
          body: { target: 'workflows.invoice', input: { language: 'en' } },
        });
        expect(JSON.parse(result.stdout)).toMatchObject({ id: 'run_123', type: 'workflow' });
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
        return json({ id: 'run_456', type: 'workflow', finished: false }, { status: 201 });
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
          pathname: '/v1/runs',
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

  test('run --input-file pre-uploads oversized files via Files with purpose=run-input', async () => {
    const { mkdtemp, rm, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'cli-run-preupload-'));
    const filePath = join(dir, 'big.bin');
    await writeFile(filePath, Buffer.alloc(5 * 1024 * 1024, 1));

    const calls: Array<{ method: string; pathname: string; body?: unknown }> = [];
    try {
      await withRunServer(
        async (request) => {
          const url = new URL(request.url);
          const pathname = url.pathname;
          if (request.method === 'POST' && pathname === '/v1/files/uploads') {
            const body = await request.json();
            calls.push({ method: 'POST', pathname, body });
            return json({
              transport: 'multipart',
              url: '/v1/files',
              maxFileSizeBytes: 100 * 1024 * 1024,
            });
          }
          if (request.method === 'POST' && pathname === '/v1/files') {
            const form = await request.formData();
            calls.push({
              method: 'POST',
              pathname,
              body: { purpose: form.get('purpose') },
            });
            return json({
              id: 'file_cli_large',
              filename: 'big.bin',
              contentType: 'application/octet-stream',
              size: 5 * 1024 * 1024,
              purpose: 'run-input',
              createdAt: '2026-08-04T09:00:00.000Z',
            });
          }
          if (request.method === 'POST' && pathname === '/v1/runs') {
            const body = await request.json();
            calls.push({ method: 'POST', pathname, body });
            return json({ id: 'run_pre', type: 'workflow', finished: false }, { status: 201 });
          }
          return new Response('not found', { status: 404 });
        },
        async (baseUrl) => {
          const result = await runCli(
            [
              'run',
              'workflows.invoice',
              '--input-file',
              `document=${filePath}`,
              '--json',
              '--base-url',
              baseUrl,
            ],
            { baseUrl }
          );
          expect(result.status).toBe(0);
          expect(calls).toEqual([
            {
              method: 'POST',
              pathname: '/v1/files/uploads',
              body: expect.objectContaining({
                filename: 'big.bin',
                purpose: 'run-input',
              }),
            },
            {
              method: 'POST',
              pathname: '/v1/files',
              body: { purpose: 'run-input' },
            },
            {
              method: 'POST',
              pathname: '/v1/runs',
              body: {
                target: 'workflows.invoice',
                input: { document: { $fileId: 'file_cli_large' } },
              },
            },
          ]);
        }
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('EIGENPAL_MULTIPART_MAX_BYTES=none keeps oversized files on run multipart', async () => {
    const { mkdtemp, rm, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'cli-run-multipart-'));
    const filePath = join(dir, 'big.bin');
    await writeFile(filePath, Buffer.alloc(5 * 1024 * 1024, 1));

    try {
      await withRunServer(
        async (request) => {
          const url = new URL(request.url);
          expect(url.pathname).toBe('/v1/runs');
          expect(request.headers.get('content-type')).toStartWith('multipart/form-data');
          const form = await request.formData();
          expect(form.get('files.document')).toBeInstanceOf(File);
          return json({ id: 'run_multipart', type: 'workflow', finished: false }, { status: 201 });
        },
        async (baseUrl) => {
          const result = await runCli(
            [
              'run',
              'workflows.invoice',
              '--input-file',
              `document=${filePath}`,
              '--json',
              '--base-url',
              baseUrl,
            ],
            { baseUrl, env: { EIGENPAL_MULTIPART_MAX_BYTES: 'none' } }
          );
          expect(result.status).toBe(0);
        }
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('rerun --version original passes through for workflow runs', async () => {
    const calls: Array<{ pathname: string; version: string | null; body: string }> = [];
    await withRunServer(
      async (request) => {
        const url = new URL(request.url);
        if (request.method === 'POST' && url.pathname === '/v1/runs/exec_1/rerun') {
          calls.push({
            pathname: url.pathname,
            version: url.searchParams.get('version'),
            body: await request.text(),
          });
          return json({ id: 'exec_2', status: 'pending' });
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
          { pathname: '/v1/runs/exec_1/rerun', version: 'original', body: '' },
        ]);
        expect(JSON.parse(result.stdout)).toMatchObject({ id: 'exec_2' });
      }
    );
  });

  test('rerun posts to the canonical rerun endpoint with version override', async () => {
    let captured: { pathname: string; version: string | null; body: string } | null = null;
    await withRunServer(
      async (request) => {
        const url = new URL(request.url);
        captured = {
          pathname: url.pathname,
          version: url.searchParams.get('version'),
          body: await request.text(),
        };
        return json({ id: 'run_rerun', status: 'pending' });
      },
      async (baseUrl) => {
        const result = await runCli(
          ['rerun', 'run_123', '--version', 'abc123', '--json', '--base-url', baseUrl],
          { baseUrl }
        );

        expect(result.status).toBe(0);
        expect(captured).toEqual({
          pathname: '/v1/runs/run_123/rerun',
          version: 'abc123',
          body: '',
        });
        expect(JSON.parse(result.stdout)).toMatchObject({ id: 'run_rerun' });
      }
    );
  });

  test('runs reviews update uses the canonical PUT endpoint', async () => {
    const calls: Array<{ method: string; pathname: string; body?: unknown }> = [];
    await withRunServer(
      async (request) => {
        const url = new URL(request.url);
        calls.push({ method: request.method, pathname: url.pathname });
        if (request.method === 'GET' && url.pathname === '/v1/runs/aex_1') {
          return json({ id: 'aex_1', type: 'agent', finished: true });
        }
        if (request.method === 'PUT' && url.pathname === '/v1/runs/aex_1/reviews') {
          calls[calls.length - 1] = {
            method: request.method,
            pathname: url.pathname,
            body: await request.json(),
          };
          return json({
            review: {
              status: 'open',
              verdict: 'incorrect',
              note: 'needs review',
            },
          });
        }
        return new Response('not found', { status: 404 });
      },
      async (baseUrl) => {
        const result = await runCli(
          [
            'runs',
            'reviews',
            'update',
            'aex_1',
            '--verdict',
            'incorrect',
            '--note',
            'needs review',
            '--json',
            '--base-url',
            baseUrl,
          ],
          { baseUrl }
        );

        expect(result.status).toBe(0);
        expect(calls).toEqual([
          {
            method: 'PUT',
            pathname: '/v1/runs/aex_1/reviews',
            body: { verdict: 'incorrect', note: 'needs review' },
          },
        ]);
        expect(JSON.parse(result.stdout)).toMatchObject({ review: { verdict: 'incorrect' } });
      }
    );
  });
});

describe('runs trace JSONL output', () => {
  function traceHandler(payload: unknown) {
    return (request: Request): Response => {
      const url = new URL(request.url);
      if (request.method === 'GET' && url.pathname === '/v1/runs/run_1/trace') {
        return json(payload);
      }
      return new Response('not found', { status: 404 });
    };
  }

  test('re-emits trace events as one JSON line each, newline-terminated', async () => {
    await withRunServer(traceHandler({ events: [{ a: 1 }, { b: 2 }] }), async (baseUrl) => {
      const result = await runCli(['runs', 'trace', 'run_1', '--base-url', baseUrl], { baseUrl });

      expect(result.status).toBe(0);
      expect(result.stdout).toBe('{"a":1}\n{"b":2}\n');
      expect(result.stderr).not.toContain('No trace events');
    });
  });

  test('empty events → empty stdout plus a stderr warning', async () => {
    await withRunServer(traceHandler({ events: [] }), async (baseUrl) => {
      const result = await runCli(['runs', 'trace', 'run_1', '--base-url', baseUrl], { baseUrl });

      expect(result.status).toBe(0);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('No trace events');
    });
  });

  test('a payload without an events array is treated as zero events, not a crash', async () => {
    await withRunServer(traceHandler({}), async (baseUrl) => {
      const result = await runCli(['runs', 'trace', 'run_1', '--base-url', baseUrl], { baseUrl });

      expect(result.status).toBe(0);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('No trace events');
    });
  });
});

describe('run --example agent eval gating', () => {
  /** Minimal server for an agent example run whose evaluator rollup has landed. */
  function agentExampleHandler(options: {
    eval?: { example: string; score: number | null; passed: boolean | null };
    evaluatorsConfigured: boolean;
  }) {
    return (request: Request): Response => {
      const url = new URL(request.url);
      if (
        request.method === 'POST' &&
        url.pathname === '/v1/automations/agents.support/experiments'
      ) {
        return json({ id: 'batch_1', runs: [{ id: 'run_1', exampleId: 'ex-1' }] }, { status: 201 });
      }
      if (
        request.method === 'GET' &&
        url.pathname === '/v1/automations/agents.support/evaluators'
      ) {
        return json({
          config: {
            evaluators: options.evaluatorsConfigured ? [{ name: 'exact', type: 'exact-diff' }] : [],
          },
        });
      }
      if (request.method === 'GET' && url.pathname === '/v1/runs/run_1') {
        return json({
          id: 'run_1',
          type: 'agent',
          finished: true,
          execution: { status: 'completed', schemaValid: true },
          ...(options.eval ? { eval: options.eval } : {}),
        });
      }
      return new Response('not found', { status: 404 });
    };
  }

  const failingEval = { example: 'ex-1', score: 0.4, passed: false };
  const passingEval = { example: 'ex-1', score: 1, passed: true };

  test('exits 1 with --fail-on-mismatch when the evaluator verdict is FAIL', async () => {
    await withRunServer(
      agentExampleHandler({ eval: failingEval, evaluatorsConfigured: true }),
      async (baseUrl) => {
        const result = await runCli(
          [
            'run',
            'agents.support',
            '--example',
            'ex-1',
            '--wait',
            '--fail-on-mismatch',
            '--json',
            '--base-url',
            baseUrl,
          ],
          { baseUrl }
        );

        expect(result.status).toBe(1);
        expect(JSON.parse(result.stdout)).toMatchObject({
          id: 'run_1',
          eval: { score: 0.4, passed: false },
        });
      }
    );
  });

  test('exits 0 with --fail-on-mismatch when the evaluator verdict is PASS', async () => {
    await withRunServer(
      agentExampleHandler({ eval: passingEval, evaluatorsConfigured: true }),
      async (baseUrl) => {
        const result = await runCli(
          [
            'run',
            'agents.support',
            '--example',
            'ex-1',
            '--wait',
            '--fail-on-mismatch',
            '--json',
            '--base-url',
            baseUrl,
          ],
          { baseUrl }
        );

        expect(result.status).toBe(0);
        expect(JSON.parse(result.stdout)).toMatchObject({
          id: 'run_1',
          eval: { score: 1, passed: true },
        });
      }
    );
  });

  test('warns and exits 0 when no evaluators are configured, even with --fail-on-mismatch', async () => {
    await withRunServer(agentExampleHandler({ evaluatorsConfigured: false }), async (baseUrl) => {
      const result = await runCli(
        [
          'run',
          'agents.support',
          '--example',
          'ex-1',
          '--wait',
          '--fail-on-mismatch',
          '--json',
          '--base-url',
          baseUrl,
        ],
        { baseUrl }
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toContain('No evaluators configured');
    });
  });

  test('exits 2 with --fail-on-mismatch when evaluators are configured but no rollup lands in the grace window', async () => {
    // Evaluators ARE configured, but the run payload never carries an
    // `eval` block, so pollEvalRollup can only time out. The grace window
    // is shrunk via the test-only env override; without it this test would
    // wait the real 90s.
    await withRunServer(agentExampleHandler({ evaluatorsConfigured: true }), async (baseUrl) => {
      const result = await runCli(
        [
          'run',
          'agents.support',
          '--example',
          'ex-1',
          '--wait',
          '--fail-on-mismatch',
          '--json',
          '--base-url',
          baseUrl,
        ],
        { baseUrl, env: { EIGENPAL_EVAL_GRACE_MS: '0' } }
      );

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('no evaluator verdict landed');
      // The run itself completed — the payload still prints for scripts.
      expect(JSON.parse(result.stdout)).toMatchObject({ id: 'run_1' });
    });
  }, 15000); // Worst case one 2s eval poll sleep on top of the run poll; leave slack.

  test('prints the eval verdict in human output; a FAIL without --fail-on-mismatch keeps exit 0', async () => {
    await withRunServer(
      agentExampleHandler({ eval: failingEval, evaluatorsConfigured: true }),
      async (baseUrl) => {
        const result = await runCli(
          ['run', 'agents.support', '--example', 'ex-1', '--wait', '--base-url', baseUrl],
          { baseUrl }
        );

        expect(result.status).toBe(0);
        expect(result.stderr).toContain('eval: score 0.40');
        expect(result.stderr).toContain('FAIL');
      }
    );
  });
});
