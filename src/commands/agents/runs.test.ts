import { describe, expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAgentExecutionRunFormData } from './run-form-data';
import { buildRunListParams, compareFileInventory, diffJson, runArtifactInventory } from './runs';
import { parseAgentTarget } from './target';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'cli.ts');

async function withAgentRunServer(
  status: 'completed' | 'failed' | 'cancelled',
  fn: (baseUrl: string) => void | Promise<void>
): Promise<void> {
  const server = Bun.serve({
    port: 0,
    fetch: (request) => {
      const url = new URL(request.url);
      const json = (body: unknown, init?: ResponseInit) =>
        new Response(JSON.stringify(body), {
          ...init,
          headers: { 'content-type': 'application/json', ...init?.headers },
        });

      if (request.method === 'POST' && url.pathname === '/api/v1/agents/invoice-agent/run') {
        return json({ runId: 'run_terminal' });
      }
      if (request.method === 'GET' && url.pathname === '/api/v1/agents/runs/run_terminal') {
        return json({
          run: {
            id: 'run_terminal',
            status,
            error: status === 'failed' ? 'boom' : null,
          },
        });
      }
      return json({ error: `Unexpected ${request.method} ${url.pathname}` }, { status: 404 });
    },
  });
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

describe('agent run command helpers', () => {
  test('execution run file upload supports named repeated multipart fields', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eigenpal-agent-run-'));
    const file = join(dir, 'invoice.pdf');
    const secondFile = join(dir, 'statement.pdf');
    try {
      writeFileSync(file, 'fake pdf');
      writeFileSync(secondFile, 'fake statement');

      const form = await buildAgentExecutionRunFormData(
        [`document=${file}`, `bank_statement=${secondFile}`],
        '{"language":"en"}'
      );
      const entries = [...form.entries()];

      expect(entries.map(([key]) => key)).toEqual(['document', 'bank_statement', '_json']);
      expect(entries.find(([key]) => key === 'input')).toBeUndefined();
      expect(entries.find(([key]) => key === '_sourceRef')).toBeUndefined();
      expect(entries.find(([key]) => key === '_json')?.[1]).toBe('{"language":"en"}');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('execution run file upload keeps bare path compatibility with file field', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eigenpal-agent-run-'));
    const file = join(dir, 'invoice.pdf');
    try {
      writeFileSync(file, 'fake pdf');

      const form = await buildAgentExecutionRunFormData(file);
      const entries = [...form.entries()];

      expect(entries.map(([key]) => key)).toEqual(['file']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('execution run file upload rejects reserved multipart fields', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eigenpal-agent-run-'));
    const file = join(dir, 'invoice.pdf');
    try {
      writeFileSync(file, 'fake pdf');

      for (const field of ['_json', '_metadata', 'input']) {
        await expect(buildAgentExecutionRunFormData(`${field}=${file}`)).rejects.toThrow(
          `--input-file field "${field}" is reserved`
        );
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test.each([['failed' as const], ['cancelled' as const]])(
    'agents run --wait --json exits nonzero when terminal status is %s',
    async (status) => {
      await withAgentRunServer(status, async (baseUrl) => {
        const result = await runCli(
          [
            'agents',
            'run',
            'invoice-agent',
            '--wait',
            '--json',
            '--interval',
            '0',
            '--base-url',
            baseUrl,
          ],
          { baseUrl }
        );

        expect(result.status).toBe(1);
        expect(result.stderr).toBe('');
        expect(JSON.parse(result.stdout)).toMatchObject({
          run: { id: 'run_terminal', status },
        });
      });
    }
  );

  test('--no-feedback serializes as server noFeedback query param', () => {
    expect(buildRunListParams({ feedback: false })).toMatchObject({ noFeedback: 'true' });
    expect(buildRunListParams({ noFeedback: true })).toMatchObject({ noFeedback: 'true' });
    expect(buildRunListParams({ feedback: false })).not.toHaveProperty('feedback');
  });

  test('run list omits client-only compact param', () => {
    expect(buildRunListParams({ compact: true } as { compact: boolean })).not.toHaveProperty(
      'compact'
    );
  });

  test('run list includes source provenance filter', () => {
    expect(buildRunListParams({ sourceRef: '1.2.3' })).toMatchObject({
      sourceRef: '1.2.3',
    });
    expect(
      buildRunListParams({ sourceRef: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' })
    ).toMatchObject({
      sourceRef: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
  });

  test('agent targets only filter by source ref when explicitly qualified', () => {
    expect(parseAgentTarget('invoice-agent')).toMatchObject({
      slug: 'invoice-agent',
      sourceRef: undefined,
    });
    expect(parseAgentTarget('agents.invoice-agent')).toMatchObject({
      slug: 'invoice-agent',
      sourceRef: undefined,
    });
    expect(parseAgentTarget('invoice-agent@latest')).toMatchObject({
      slug: 'invoice-agent',
      sourceRef: 'latest',
    });
    expect(parseAgentTarget('agents.invoice-agent@1.2.3')).toMatchObject({
      slug: 'invoice-agent',
      sourceRef: '1.2.3',
    });
  });

  test('run artifact inventory exposes fetch paths for singleton artifacts', () => {
    expect(
      runArtifactInventory({
        inputJson: { language: 'en' },
        metadata: { source: 'git' },
        resultFiles: [{ name: 'report.pdf' }, { name: 'trace.jsonl' }],
        issueFiles: [{ name: 'issues.md' }],
        traceFiles: [{ name: 'trace.jsonl' }],
        lockfileFiles: [{ name: 'eigenpal.lock' }],
        expected: { ok: true },
        expectedFiles: [{ name: 'golden.pdf' }],
        inputFiles: [{ name: 'invoice.pdf' }],
      }).map(({ kind, name, path }) => ({ kind, name, path }))
    ).toEqual([
      { kind: 'lockfile', name: 'eigenpal.lock', path: 'eigenpal.lock' },
      { kind: 'expected', name: 'expected.json', path: 'expected.json' },
      { kind: 'expected', name: 'golden.pdf', path: 'expected/golden.pdf' },
      { kind: 'input', name: 'input.json', path: 'input.json' },
      { kind: 'input', name: 'invoice.pdf', path: 'input/invoice.pdf' },
      { kind: 'issues', name: 'issues.md', path: 'issues.md' },
      { kind: 'metadata', name: 'metadata.json', path: 'metadata.json' },
      { kind: 'output', name: 'report.pdf', path: 'output/report.pdf' },
      { kind: 'metadata', name: 'run.json', path: 'run.json' },
      { kind: 'trace', name: 'trace.jsonl', path: 'trace.jsonl' },
    ]);
  });
});

describe('agent execution comparison helpers', () => {
  test('reports no JSON differences for matching expected output', () => {
    expect(diffJson({ ok: true, count: 2 }, { ok: true, count: 2 })).toEqual([]);
  });

  test('reports missing, extra, and changed JSON fields', () => {
    expect(diffJson({ a: 1, b: 2 }, { a: 2, c: 3 })).toEqual([
      { path: '$.a', type: 'changed', expected: '1', actual: '2' },
      { path: '$.b', type: 'missing' },
      { path: '$.c', type: 'extra' },
    ]);
  });

  test('compares file inventory with missing and extra files', () => {
    expect(
      compareFileInventory(['expected.pdf', 'missing.pdf'], ['expected.pdf', 'extra.pdf'], false)
    ).toEqual({
      matched: [{ expected: 'expected.pdf', output: 'expected.pdf' }],
      missing: ['missing.pdf'],
      extra: ['extra.pdf'],
    });
  });

  test('normalizes generated date tokens in filenames', () => {
    expect(
      compareFileInventory(
        ['FR_Zakladatelska_listina_20260507.pdf'],
        ['FR_Zakladatelska_listina_20260512.pdf'],
        true
      )
    ).toMatchObject({
      matched: [
        {
          expected: 'FR_Zakladatelska_listina_20260507.pdf',
          output: 'FR_Zakladatelska_listina_20260512.pdf',
        },
      ],
      missing: [],
      extra: [],
    });
  });
});
