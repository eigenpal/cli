import { describe, expect, test } from 'bun:test';
import { __testing } from './secrets';

describe('readSecretInput', () => {
  test('requires --stdin or --value-file in non-TTY', async () => {
    if (process.stdin.isTTY && process.stdout.isTTY) return;
    await expect(__testing.readSecretInput({})).rejects.toThrow(/--stdin|--value-file/);
  });
});
