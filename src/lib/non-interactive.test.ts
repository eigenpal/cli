import { describe, expect, test } from 'bun:test';
import {
  confirmTyped,
  nonInteractiveYesRequired,
  requireTypedConfirmation,
  requireYesInNonInteractive,
} from './non-interactive';

describe('nonInteractiveYesRequired', () => {
  test('names the action and --yes bypass', () => {
    expect(nonInteractiveYesRequired('Cancel run')).toContain('Cancel run');
    expect(nonInteractiveYesRequired('Cancel run')).toContain('--yes');
    expect(nonInteractiveYesRequired('Cancel run')).toContain('non-interactively');
  });
});

describe('requireYesInNonInteractive', () => {
  test('passes when --yes is set', () => {
    expect(() => requireYesInNonInteractive(true, 'cancel run')).not.toThrow();
  });

  test('throws in non-TTY without --yes', () => {
    if (!process.stdin.isTTY || !process.stderr.isTTY) {
      expect(() => requireYesInNonInteractive(undefined, 'cancel run')).toThrow(
        /requires --yes when run non-interactively/
      );
    }
  });
});

describe('confirmTyped', () => {
  test('returns false without blocking in non-TTY', async () => {
    if (process.stdin.isTTY && process.stderr.isTTY) return;
    await expect(confirmTyped('exec_test', 'clear review artifacts')).resolves.toBe(false);
  });
});

describe('requireTypedConfirmation', () => {
  test('throws actionable error in non-TTY without --yes', async () => {
    if (process.stdin.isTTY && process.stderr.isTTY) return;
    await expect(
      requireTypedConfirmation({
        id: 'wf_abc',
        actionName: 'replace dataset',
      })
    ).rejects.toThrow(/requires --yes when run non-interactively/);
  });

  test('passes with --yes in non-TTY', async () => {
    await expect(
      requireTypedConfirmation({
        yes: true,
        id: 'wf_abc',
        actionName: 'replace dataset',
      })
    ).resolves.toBeUndefined();
  });
});
