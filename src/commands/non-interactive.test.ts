import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'cli.ts');

function runCli(args: string[]) {
  return spawnSync('bun', [CLI, ...args], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      EIGENPAL_API_KEY: 'eig_test_key',
      EIGENPAL_BASE_URL: 'http://127.0.0.1:1',
    },
  });
}

describe('non-interactive CLI guards', () => {
  test('runs cancel requires --yes without TTY', () => {
    const result = runCli(['runs', 'cancel', 'exec_test']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/requires --yes when run non-interactively/);
  });

  test('runs reviews clear requires --yes without TTY', () => {
    const result = runCli(['runs', 'reviews', 'clear', 'exec_test']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/requires --yes when run non-interactively/);
  });

  test('runs expected delete requires --yes without TTY', () => {
    const result = runCli(['runs', 'expected', 'delete', 'exec_test', 'invoice.pdf']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/requires --yes when run non-interactively/);
  });

  test('workflow dataset replace requires --yes without TTY', () => {
    const result = runCli([
      'workflow',
      'dataset',
      'push',
      'wf_test',
      '--file',
      '.',
      '--mode',
      'replace',
    ]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/requires --yes when run non-interactively/);
  });

  test('workflow experiment cancel requires --yes without TTY', () => {
    const result = runCli(['workflow', 'experiment', 'cancel', 'wf_test', 'evb_test']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/requires --yes when run non-interactively/);
  });

  test('skill uninstall with no args requires tool ids or --all without TTY', () => {
    const result = runCli(['skill', 'uninstall']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/Non-interactive/);
  });

  test('auth login rejects non-TTY even with an explicit base URL', () => {
    for (const args of [
      ['auth', 'login'],
      ['auth', 'login', '--base-url', 'https://studio.eigenpal.com'],
    ]) {
      const result = spawnSync('bun', [CLI, ...args], {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, EIGENPAL_BASE_URL: undefined },
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/interactive terminal|needs an interactive terminal/i);
    }
  });
});

describe('non-interactive help exposes --yes', () => {
  test('runs cancel help mentions --yes', () => {
    const result = spawnSync('bun', [CLI, 'runs', 'cancel', '--help'], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('--yes');
  });

  test('agents dataset push help mentions --yes for replace', () => {
    const result = spawnSync('bun', [CLI, 'agents', 'dataset', 'push', '--help'], {
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('--yes');
  });
});
