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
      'list',
      'clone',
      'save',
      'release',
      'sync',
      'validate',
      'dataset',
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

  test('root runs help exposes list, trace, and artifact inspection commands', () => {
    const result = spawnSync('bun', [CLI, 'runs', '--help'], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('list');
    expect(result.stdout).toContain('[source]');
    expect(result.stdout).not.toContain('pull');
    expect(result.stdout).toContain('trace');
    expect(result.stdout).toContain('artifacts');
  });

  test('root rerun command exposes version selection', () => {
    const result = spawnSync('bun', [CLI, 'rerun', '--help'], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('<run-id>');
    expect(result.stdout).toContain('--version <version>');
    expect(result.stdout).toContain('original');
  });

  test('run help exposes persisted example execution', () => {
    const result = spawnSync('bun', [CLI, 'run', '--help'], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('<target>');
    expect(result.stdout).toContain('--example <name>');
  });

  test('agent run start command is not registered', () => {
    const result = spawnSync('bun', [CLI, 'agents', 'run', '--help'], { encoding: 'utf8' });
    expect(result.stdout).not.toContain('Usage: eigenpal agents run');
    expect(result.stdout).not.toContain('--example <name>');
  });

  test('singular agent alias is not registered', () => {
    const result = spawnSync('bun', [CLI, 'agent', 'list'], { encoding: 'utf8' });
    expect(result.status).not.toBe(0);
  });

  test('agents secrets is one unified group with list/set/unset/import/export', () => {
    const result = spawnSync('bun', [CLI, 'agents', 'secrets', '--help'], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    // Each verb must be a registered subcommand line in the Commands block —
    // a bare `toContain(verb)` would be satisfied by the group's own
    // description string ("list, set, unset, import, export").
    for (const verb of ['list', 'set', 'unset', 'import', 'export']) {
      expect(result.stdout).toMatch(new RegExp(`^\\s+${verb}\\b`, 'm'));
    }
    // And each verb resolves to a real subcommand, not an arity error.
    for (const verb of ['unset', 'import', 'export']) {
      const help = spawnSync('bun', [CLI, 'agents', 'secrets', verb, '--help'], {
        encoding: 'utf8',
      });
      expect(help.status).toBe(0);
      expect(help.stdout).toContain(`Usage: eigenpal agents secrets ${verb}`);
    }
    // Singular alias keeps working.
    const alias = spawnSync('bun', [CLI, 'agents', 'secret', 'set', '--help'], {
      encoding: 'utf8',
    });
    expect(alias.status).toBe(0);
    expect(alias.stdout).toContain('<name>');
  });

  test('agents secrets list is a real subcommand, not an arity error', () => {
    const result = spawnSync('bun', [CLI, 'agents', 'secrets', 'list', '--help'], {
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain('too many arguments');
  });

  test('root runs compare uses two positional run ids', () => {
    const result = spawnSync('bun', [CLI, 'runs', 'compare', '--help'], {
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

  test('runs reviews subcommands are available', () => {
    const reviews = spawnSync('bun', [CLI, 'runs', 'reviews', '--help'], {
      encoding: 'utf8',
    });
    expect(reviews.status).toBe(0);
    expect(reviews.stdout).toContain('close');
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

  test('bare top-level runs command requires a subcommand', () => {
    const result = spawnSync('bun', [CLI, 'runs'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('requires a subcommand');
    expect(result.stderr).not.toContain('`eigenpal runs` removed');
  });
});
