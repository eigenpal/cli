/**
 * Smoke tests for the bundled binary. The shipping format is `dist/cli.js`
 * invoked via shebang or symlink (npm/bun install -g writes a symlink in
 * the user's bin dir). A previous regression had the entry-point guard
 * comparing argv[1] against __filename without realpath resolution — that
 * silently produced empty output for every CLI invocation through the
 * symlink. These tests pin the contract: the bundle must produce help text
 * when invoked directly, via shebang, and via a symlink.
 */

import { spawnSync } from 'child_process';
import { existsSync, mkdtempSync, symlinkSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

import { describe, expect, it } from 'bun:test';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const BUNDLE = join(REPO_ROOT, 'packages', 'cli', 'dist', 'cli.js');

function buildIfMissing(): void {
  if (existsSync(BUNDLE)) return;
  const result = spawnSync('bun', ['run', '--cwd', join(REPO_ROOT, 'packages', 'cli'), 'build'], {
    stdio: 'inherit',
  });
  if (result.status !== 0) throw new Error('bundle build failed');
}

describe('bundled CLI entry-point', () => {
  it('prints help via direct shebang invocation', () => {
    buildIfMissing();
    const result = spawnSync(BUNDLE, ['--help'], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Usage: eigenpal');
  });

  it('prints help via symlinked invocation (the npm install -g shape)', () => {
    buildIfMissing();
    const dir = mkdtempSync(join(tmpdir(), 'eigenpal-cli-bin-'));
    const link = join(dir, 'eigenpal-dev');
    symlinkSync(BUNDLE, link);
    const result = spawnSync(link, ['--help'], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Usage: eigenpal');
    expect(result.stdout.length).toBeGreaterThan(500);
  });
});
