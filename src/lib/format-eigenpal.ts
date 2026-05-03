import { spawnSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';

const PRETTRC_NAMES = [
  '.prettierrc',
  '.prettierrc.json',
  '.prettierrc.yaml',
  '.prettierrc.yml',
  '.prettierrc.js',
  '.prettierrc.cjs',
  'prettier.config.js',
  'prettier.config.cjs',
];

/**
 * Returns true if Prettier appears to be configured in the project (cwd).
 * Does not add prettier as a dependency; only checks for config files.
 */
function hasPrettierConfig(cwd: string): boolean {
  for (const name of PRETTRC_NAMES) {
    if (existsSync(join(cwd, name))) return true;
  }
  try {
    const pkgPath = join(cwd, 'package.json');
    if (!existsSync(pkgPath)) return false;
    const raw = readFileSync(pkgPath, 'utf-8');
    const pkg = JSON.parse(raw) as Record<string, unknown>;
    return pkg != null && typeof pkg === 'object' && 'prettier' in pkg;
  } catch {
    return false;
  }
}

/**
 * Run Prettier on the eigenpal directory if Prettier is configured in the project.
 * Uses bunx/npx so it only runs when you already have Prettier (no new deps).
 * Runs silently (no stdout/stderr). No-op if Prettier is not available or config is missing.
 */
export function formatEigenpalDirIfAvailable(dir: string): void {
  const cwd = process.cwd();
  const absDir = resolve(cwd, dir);
  if (!existsSync(absDir)) return;
  if (!hasPrettierConfig(cwd)) return;

  const runner = typeof Bun !== 'undefined' ? 'bunx' : 'npx';
  spawnSync(runner, ['prettier', '--write', absDir], {
    cwd,
    stdio: 'ignore',
    shell: false,
  });
}
