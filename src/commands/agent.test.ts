import { describe, expect, test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildAgentExecutionRunFormData,
  buildRunListParams,
  compareFileInventory,
  diffJson,
  parseAgentTarget,
  runArtifactInventory,
  sourcePathForInstalledPackage,
  validateAgentProject,
  validateDatasetDir,
} from './agent';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'cli.ts');

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

describe('agent local project validation', () => {
  test('accepts Git-backed eigenpal.yaml package layout', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eigenpal-agent-'));
    try {
      mkdirSync(join(dir, 'dataset', 'example-1'), { recursive: true });
      writeFileSync(join(dir, 'eigenpal.yaml'), 'schemaVersion: 1\nname: Test Agent\n');
      writeFileSync(join(dir, 'AGENT.md'), 'Extract invoices.\n');

      await expect(validateAgentProject(dir)).resolves.toMatchObject({ valid: true });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('accepts valid input and output schema files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eigenpal-agent-schema-'));
    try {
      mkdirSync(join(dir, 'dataset', 'example-1'), { recursive: true });
      writeFileSync(join(dir, 'eigenpal.yaml'), 'schemaVersion: 1\nname: Test Agent\n');
      writeFileSync(join(dir, 'AGENT.md'), 'Extract invoices.\n');
      writeFileSync(
        join(dir, 'input-schema.json'),
        JSON.stringify({
          type: 'object',
          properties: {
            document: { type: 'string', 'x-eigenpal-type': 'file' },
            language: { type: 'string' },
          },
          required: ['document'],
        })
      );
      writeFileSync(
        join(dir, 'output-schema.json'),
        JSON.stringify({
          type: 'object',
          properties: {
            total: { type: 'number' },
            vendor: { type: ['string', 'null'] },
          },
          required: ['total', 'vendor'],
        })
      );

      await expect(validateAgentProject(dir)).resolves.toMatchObject({ valid: true });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('rejects invalid input and output schema files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eigenpal-agent-bad-schema-'));
    try {
      mkdirSync(join(dir, 'dataset', 'example-1'), { recursive: true });
      writeFileSync(join(dir, 'eigenpal.yaml'), 'schemaVersion: 1\nname: Test Agent\n');
      writeFileSync(join(dir, 'AGENT.md'), 'Extract invoices.\n');
      writeFileSync(join(dir, 'input-schema.json'), '{"type":"array"}');
      writeFileSync(
        join(dir, 'output-schema.json'),
        JSON.stringify({
          type: 'object',
          properties: {
            document: { type: 'string', 'x-eigenpal-type': 'image' },
          },
        })
      );

      const result = await validateAgentProject(dir);
      expect(result.valid).toBe(false);
      expect(result.errors.join('\n')).toContain('input-schema.json: Root "type" must be "object"');
      expect(result.errors.join('\n')).toContain(
        'output-schema.json: /properties/document: x-eigenpal-type must be "file" if present'
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('rejects legacy workflow and eval layout names', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eigenpal-agent-old-'));
    try {
      mkdirSync(join(dir, 'workflow'));
      mkdirSync(join(dir, 'eval'));
      const result = await validateAgentProject(dir);
      expect(result.valid).toBe(false);
      expect(result.errors.join('\n')).toContain('Legacy layout workflow/');
      expect(result.errors.join('\n')).toContain('Legacy layout eval/');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('dataset validator rejects old eval directory name', async () => {
    const root = mkdtempSync(join(tmpdir(), 'eigenpal-agent-dataset-'));
    const dir = join(root, 'eval');
    mkdirSync(dir);
    try {
      const result = await validateDatasetDir(dir);
      expect(result.valid).toBe(false);
      expect(result.errors.join('\n')).toContain('Use dataset/ instead of legacy eval/');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('dataset validator accepts partial expected output against agent schemas', async () => {
    const root = mkdtempSync(join(tmpdir(), 'eigenpal-agent-dataset-valid-'));
    const agentDir = join(root, 'agent');
    const datasetDir = join(root, 'dataset');
    try {
      mkdirSync(join(datasetDir, 'cats-jokes'), { recursive: true });
      mkdirSync(agentDir);
      writeFileSync(
        join(agentDir, 'input-schema.json'),
        JSON.stringify({
          type: 'object',
          properties: {
            topic: { type: 'string' },
            count: { type: 'number' },
          },
          required: ['topic'],
        })
      );
      writeFileSync(
        join(agentDir, 'output-schema.json'),
        JSON.stringify({
          type: 'object',
          properties: {
            topic: { type: 'string' },
            jokes: { type: 'array', items: { type: 'string' } },
          },
          required: ['topic', 'jokes'],
        })
      );
      writeFileSync(join(datasetDir, 'cats-jokes', 'input.json'), '{"topic":"cats","count":3}');
      writeFileSync(join(datasetDir, 'cats-jokes', 'expected.json'), '{"topic":"cats"}');

      await expect(validateDatasetDir(datasetDir, { agentDir })).resolves.toMatchObject({
        valid: true,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('dataset validator rejects malformed inputs, expected fields, and goldens', async () => {
    const root = mkdtempSync(join(tmpdir(), 'eigenpal-agent-dataset-invalid-'));
    const agentDir = join(root, 'agent');
    const datasetDir = join(root, 'dataset');
    try {
      mkdirSync(join(datasetDir, 'bad-example', 'input'), { recursive: true });
      mkdirSync(join(datasetDir, 'bad-example', 'expected'), { recursive: true });
      mkdirSync(agentDir);
      writeFileSync(
        join(agentDir, 'input-schema.json'),
        JSON.stringify({
          type: 'object',
          properties: {
            document: { type: 'string', 'x-eigenpal-type': 'file' },
            topic: { type: 'string' },
          },
          required: ['document', 'topic'],
        })
      );
      writeFileSync(
        join(agentDir, 'output-schema.json'),
        JSON.stringify({
          type: 'object',
          properties: {
            topic: { type: 'string' },
            report: { type: 'string', 'x-eigenpal-type': 'file' },
          },
          required: ['topic', 'report'],
        })
      );
      writeFileSync(join(datasetDir, 'bad-example', 'input.json'), '{"topic":123,"extra":true}');
      writeFileSync(join(datasetDir, 'bad-example', 'input', 'other.pdf'), 'pdf');
      writeFileSync(join(datasetDir, 'bad-example', 'expected.json'), '{"unknown":true}');
      writeFileSync(join(datasetDir, 'bad-example', 'expected', 'orphan.pdf'), 'pdf');

      const result = await validateDatasetDir(datasetDir, { agentDir });
      expect(result.valid).toBe(false);
      const errors = result.errors.join('\n');
      expect(errors).toContain('missing file for "document"');
      expect(errors).toContain('input.json/topic: must be string');
      expect(errors).toContain('extra field "extra"');
      expect(errors).toContain('extra field "unknown"');
      expect(errors).toContain('extra golden file "orphan.pdf"');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('agent command tree', () => {
  test('help exposes every agent namespace without old terminology', () => {
    const result = spawnSync('bun', [CLI, 'agents', '--help'], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    for (const word of [
      'run',
      'list',
      'clone',
      'save',
      'release',
      'sync',
      'validate',
      'dataset',
      'runs',
      'experiment',
      'session',
      'env',
      'versions',
      'secret',
    ]) {
      expect(result.stdout).toContain(word);
    }
    expect(result.stdout).not.toContain('trigger');
    expect(result.stdout).not.toContain('agent-workflow');
    expect(result.stdout).not.toContain('email-alias');
    expect(result.stdout).not.toContain('runs/');
    expect(result.stdout).not.toContain('eval/');
  });

  test('runs help exposes list, rerun, and trace inspection commands', () => {
    const result = spawnSync('bun', [CLI, 'agents', 'runs', '--help'], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('list');
    expect(result.stdout).toContain('<target>');
    expect(result.stdout).toContain('rerun');
    expect(result.stdout).toContain('trace');
    expect(result.stdout).toContain('artifacts');
  });

  test('run help exposes persisted example execution', () => {
    const result = spawnSync('bun', [CLI, 'agents', 'run', '--help'], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('--example <name>');
  });

  test('runs compare uses two positional run ids', () => {
    const result = spawnSync('bun', [CLI, 'agents', 'runs', 'compare', '--help'], {
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('<reference-run-id> <run-id>');
    expect(result.stdout).not.toContain('--expected-from');
    expect(result.stdout).not.toContain('--baseline-from');
  });

  test('agent file put is removed for Git-backed agents', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eigenpal-agent-file-put-'));
    const file = join(dir, 'AGENT.md');
    try {
      writeFileSync(file, 'Run carefully.\n');
      const result = spawnSync(
        'bun',
        [CLI, 'agents', 'file', 'put', 'invoice-agent', 'agent/AGENT.md', file],
        { encoding: 'utf8' }
      );
      expect(result.status).toBe(2);
      expect(result.stderr).toContain('file put removed');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('agent file help exposes targeted file operations', () => {
    const result = spawnSync('bun', [CLI, 'agents', 'file', '--help'], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('list');
    expect(result.stdout).toContain('get');
    expect(result.stdout).toContain('put');
    expect(result.stdout).toContain('[removed]');
    expect(result.stdout).toContain('diff');
  });

  test('runs feedback subcommands are available', () => {
    const feedback = spawnSync('bun', [CLI, 'agents', 'runs', 'feedback', '--help'], {
      encoding: 'utf8',
    });
    expect(feedback.status).toBe(0);
    expect(feedback.stdout).toContain('resolve');
  });

  test('replace dataset requires confirmation in non-interactive mode before network access', () => {
    const result = spawnSync(
      'bun',
      [CLI, 'agents', 'dataset', 'push', 'invoice-agent', '--file', '.', '--mode', 'replace'],
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Dataset replace aborted');
  });

  test('execution run file upload does not use reserved input multipart field', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eigenpal-agent-run-'));
    const file = join(dir, 'invoice.pdf');
    try {
      writeFileSync(file, 'fake pdf');

      const form = await buildAgentExecutionRunFormData(file, '{"language":"en"}');
      const entries = [...form.entries()];

      expect(entries.map(([key]) => key)).toEqual(['file', '_json']);
      expect(entries.find(([key]) => key === 'input')).toBeUndefined();
      expect(entries.find(([key]) => key === '_sourceRef')).toBeUndefined();
      expect(entries.find(([key]) => key === '_json')?.[1]).toBe('{"language":"en"}');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('top-level run is removed before network access', () => {
    const result = spawnSync('bun', [CLI, 'run', 'workflows.invoice@latest'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('`eigenpal run` removed');
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

  test('run artifact inventory exposes pull paths for singleton artifacts', () => {
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

describe('agent source secrets', () => {
  test('uses installed lockfile package path for root secret source path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eigenpal-agent-installed-'));
    try {
      mkdirSync(join(dir, '.eigenpal'), { recursive: true });
      writeFileSync(join(dir, 'eigenpal.yaml'), 'name: Human Friendly Agent\n');
      writeFileSync(
        join(dir, '.eigenpal', 'eigenpal.lock'),
        JSON.stringify({
          lockfileVersion: 1,
          root: { packagePath: 'agents/local-secret-agent' },
        })
      );

      expect(sourcePathForInstalledPackage(dir, dir)).toBe('agents/local-secret-agent');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
