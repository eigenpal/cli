import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'cli.ts');

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

  test('runs help exposes list, trace, and artifact inspection commands', () => {
    const result = spawnSync('bun', [CLI, 'agents', 'runs', '--help'], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('list');
    expect(result.stdout).toContain('<target>');
    expect(result.stdout).not.toContain('rerun');
    expect(result.stdout).not.toContain('pull');
    expect(result.stdout).toContain('trace');
    expect(result.stdout).toContain('artifacts');
  });

  test('top-level agent rerun command exposes source selection', () => {
    const result = spawnSync('bun', [CLI, 'agents', 'rerun', '--help'], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('<run-id>');
    expect(result.stdout).toContain('--source-ref <ref>');
    expect(result.stdout).toContain('original');
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

  test('agent file put is not registered for Git-backed agents', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eigenpal-agent-file-put-'));
    const file = join(dir, 'AGENT.md');
    try {
      writeFileSync(file, 'Run carefully.\n');
      const result = spawnSync(
        'bun',
        [CLI, 'agents', 'file', 'put', 'invoice-agent', 'agent/AGENT.md', file],
        { encoding: 'utf8' }
      );
      expect(result.status).not.toBe(0);
      expect(result.stderr).not.toContain('file put removed');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('agent file help exposes targeted file operations', () => {
    const result = spawnSync('bun', [CLI, 'agents', 'file', '--help'], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('list');
    expect(result.stdout).toContain('get');
    expect(result.stdout).not.toContain('put');
    expect(result.stdout).not.toContain('[removed]');
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

  test('top-level run command is not registered', () => {
    const result = spawnSync('bun', [CLI, 'run', 'workflows.invoice@latest'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).not.toContain('`eigenpal run` removed');
  });

  test('top-level runs command is not registered', () => {
    const result = spawnSync('bun', [CLI, 'runs', 'agents.invoice-agent'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).not.toContain('`eigenpal runs` removed');
  });
});
