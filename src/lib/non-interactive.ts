import { createInterface } from 'node:readline/promises';
import { ui } from './ui';

/** stdin + stderr TTY — typed confirmations and some cancel gates write to stderr. */
export function isInteractiveStderr(): boolean {
  return Boolean(process.stdin.isTTY && process.stderr.isTTY);
}

/** stdin + stdout TTY — clack prompts and multiselect pickers. */
export function isInteractiveStdout(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

export function nonInteractiveYesRequired(action: string): string {
  return `${action} requires --yes when run non-interactively (CI, pipes, or agent terminals without a TTY).`;
}

/** Fail fast when a command would otherwise hang waiting for confirmation. */
export function requireYesInNonInteractive(yes: boolean | undefined, action: string): void {
  if (yes || isInteractiveStderr()) return;
  throw new Error(nonInteractiveYesRequired(action));
}

/**
 * Typed-slug-style TTY confirmation. Returns true only on an exact id match.
 * Non-TTY callers should use {@link requireTypedConfirmation} instead.
 */
export async function confirmTyped(id: string, actionName: string): Promise<boolean> {
  if (!isInteractiveStderr()) return false;
  process.stderr.write(
    `\n  ${ui.warn('!')} About to ${actionName} for ${ui.bold(id)}.\n  Type ${ui.bold(id)} to confirm: `
  );
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return (await rl.question('')).trim() === id;
  } finally {
    rl.close();
  }
}

/**
 * Destructive gate: `--yes` bypasses; TTY prompts to type the id; non-TTY
 * fails immediately with an actionable message (never hangs).
 */
export async function requireTypedConfirmation(opts: {
  yes?: boolean;
  id: string;
  actionName: string;
  cancelledMessage?: string;
}): Promise<void> {
  if (opts.yes) return;
  if (!isInteractiveStderr()) {
    throw new Error(nonInteractiveYesRequired(`Typed confirmation to ${opts.actionName}`));
  }
  const ok = await confirmTyped(opts.id, opts.actionName);
  if (!ok) {
    throw new Error(opts.cancelledMessage ?? `${opts.actionName} aborted`);
  }
}
