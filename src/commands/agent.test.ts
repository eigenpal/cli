import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildAgentExecutionRunFormData,
  buildExecutionListParams,
  compareFileInventory,
  diffJson,
  validateAgentProject,
  validateDatasetDir,
} from './agent';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'cli.ts');

describe('agent local project validation', () => {
  test('accepts canonical agent.yaml, agent/, and dataset/ layout', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eigenpal-agent-'));
    try {
      mkdirSync(join(dir, 'agent'));
      mkdirSync(join(dir, 'dataset', 'example-1'), { recursive: true });
      writeFileSync(join(dir, 'agent.yaml'), 'slug: invoice-agent\nname: Invoice Agent\n');
      writeFileSync(join(dir, 'agent', 'SOP.md'), 'Extract invoices.\n');
      writeFileSync(join(dir, 'agent', 'input-schema.json'), '{"type":"object"}\n');
      writeFileSync(join(dir, 'agent', 'output-schema.json'), '{"type":"object"}\n');

      await expect(validateAgentProject(dir)).resolves.toMatchObject({ valid: true });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('rejects old workflow, eval, and runs layout names', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eigenpal-agent-old-'));
    try {
      mkdirSync(join(dir, 'workflow'));
      mkdirSync(join(dir, 'eval'));
      mkdirSync(join(dir, 'runs'));
      const result = await validateAgentProject(dir);
      expect(result.valid).toBe(false);
      expect(result.errors.join('\n')).toContain('Use agent/ instead of old workflow/');
      expect(result.errors.join('\n')).toContain('Use dataset/ instead of old eval/');
      expect(result.errors.join('\n')).toContain('Use executions/ instead of old runs/');
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
      expect(result.errors.join('\n')).toContain('Use dataset/ instead of old eval/');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('agent command tree', () => {
  test('help exposes every agent namespace without old terminology', () => {
    const result = spawnSync('bun', [CLI, 'agent', '--help'], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    for (const word of [
      'list',
      'push',
      'pull',
      'validate',
      'dataset',
      'execution',
      'experiment',
      'session',
      'trigger',
      'evaluators',
      'versions',
    ]) {
      expect(result.stdout).toContain(word);
    }
    expect(result.stdout).not.toContain('agent-workflow');
    expect(result.stdout).not.toContain('email-alias');
    expect(result.stdout).not.toContain('runs/');
    expect(result.stdout).not.toContain('eval/');
  });

  test('trigger help exposes api and email commands', () => {
    const result = spawnSync('bun', [CLI, 'agent', 'trigger', '--help'], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('api');
    expect(result.stdout).toContain('email');
    expect(result.stdout).not.toContain('email-alias');
  });

  test('execution help exposes rerun and trace inspection commands', () => {
    const result = spawnSync('bun', [CLI, 'agent', 'execution', '--help'], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('rerun');
    expect(result.stdout).toContain('trace');
    expect(result.stdout).toContain('artifacts');
  });

  test('execution compare uses two positional ids like workflow compare', () => {
    const result = spawnSync('bun', [CLI, 'agent', 'execution', 'compare', '--help'], {
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('<reference-execution-id> <execution-id>');
    expect(result.stdout).not.toContain('--expected-from');
    expect(result.stdout).not.toContain('--baseline-from');
  });

  test('agent file help exposes targeted file operations', () => {
    const result = spawnSync('bun', [CLI, 'agent', 'file', '--help'], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('list');
    expect(result.stdout).toContain('get');
    expect(result.stdout).toContain('put');
    expect(result.stdout).toContain('diff');
  });

  test('short aliases expose execution and feedback commands', () => {
    const exec = spawnSync('bun', [CLI, 'agent', 'exec', '--help'], { encoding: 'utf8' });
    expect(exec.status).toBe(0);
    expect(exec.stdout).toContain('compare');

    const feedback = spawnSync('bun', [CLI, 'agent', 'exec', 'fb', '--help'], { encoding: 'utf8' });
    expect(feedback.status).toBe(0);
    expect(feedback.stdout).toContain('resolve');
  });

  test('agent file put dry-run validates local file without network access', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eigenpal-agent-file-'));
    const file = join(dir, 'SOP.md');
    try {
      writeFileSync(file, 'Run carefully.\n');
      const result = spawnSync(
        'bun',
        [CLI, 'agent', 'file', 'put', 'invoice-agent', 'agent/SOP.md', file, '--dry-run', '--json'],
        { encoding: 'utf8' }
      );
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        ok: true,
        dryRun: true,
        path: 'agent/SOP.md',
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('coming-soon versions namespace exits 2 for unsupported behavior', () => {
    const result = spawnSync('bun', [CLI, 'agent', 'versions', 'list', 'invoice-agent'], {
      encoding: 'utf8',
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Agent versions are coming soon');
  });

  test('hidden version flags are rejected with exit 2 and omitted from help', () => {
    const help = spawnSync('bun', [CLI, 'agent', 'push', '--help'], { encoding: 'utf8' });
    expect(help.stdout).not.toContain('--bump');
    expect(help.stdout).not.toContain('--set-version');

    const result = spawnSync('bun', [CLI, 'agent', 'push', '--bump', 'patch'], {
      encoding: 'utf8',
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('--bump is not supported for agents yet');
  });

  test('replace dataset requires confirmation in non-interactive mode before network access', () => {
    const result = spawnSync(
      'bun',
      [CLI, 'agent', 'dataset', 'push', 'invoice-agent', '--file', '.', '--mode', 'replace'],
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
      expect(entries.find(([key]) => key === '_json')?.[1]).toBe('{"language":"en"}');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('--no-feedback serializes as server noFeedback query param', () => {
    expect(buildExecutionListParams({ feedback: false })).toMatchObject({ noFeedback: 'true' });
    expect(buildExecutionListParams({ noFeedback: true })).toMatchObject({ noFeedback: 'true' });
    expect(buildExecutionListParams({ feedback: false })).not.toHaveProperty('feedback');
  });

  test('execution list omits client-only compact param', () => {
    expect(buildExecutionListParams({ compact: true } as { compact: boolean })).not.toHaveProperty(
      'compact'
    );
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
