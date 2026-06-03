import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sourcePathForInstalledPackage } from './env';

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
