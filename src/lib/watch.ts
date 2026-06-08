/**
 * Lightweight terminal "watch mode" — `\r` line redraw + adaptive polling.
 *
 * Used by `eigenpal runs watch <id>` to
 * stream a vertical step list while an execution is in flight. ASCII status
 * badges (no unicode, so it works in non-UTF-8 terminals + CI logs).
 *
 * Adaptive polling cadence:
 *   - 2s while any step is transitioning (status changed since last frame)
 *   - 5s when steady (no change in last frame)
 *   - 30-minute auto-detach (returns final snapshot, prints a hint)
 *
 * Zero deps. No Ink, no readline, no React. Calls `process.stdout.write` +
 * ANSI cursor-up/clear-line escapes directly.
 */

import { ApiError } from './client';
import { formatDuration } from './ui';

export interface StepSnapshot {
  stepName: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'skipped' | string;
  durationMs?: number | null;
  error?: string | null;
  /** Optional truncated one-liner of the step's output. Populated by
   *  `execution get` so agents see what each step actually produced without
   *  reaching for `--json`. Live watch leaves it undefined to keep frames small. */
  outputPreview?: string | null;
}

export interface ExecutionSnapshot {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | string;
  startedAt?: string | null;
  completedAt?: string | null;
  durationMs?: number | null;
  stepExecutions?: StepSnapshot[] | null;
  error?: string | null;
}

export interface WatchOptions {
  /** How to fetch the latest snapshot. Caller-supplied so this stays test-friendly. */
  fetch: () => Promise<ExecutionSnapshot>;
  /** Optional renderer override (default: stderr ANSI). */
  render?: (frame: string) => void;
  /** Optional clock override (Date.now). */
  now?: () => number;
  /** Optional sleep override (setTimeout-based). */
  sleep?: (ms: number) => Promise<void>;
  /** Stop watching after this many ms (default 30 min). */
  maxMs?: number;
  /** Polling cadence while transitioning. */
  transitionIntervalMs?: number;
  /** Polling cadence while steady. */
  steadyIntervalMs?: number;
  /**
   * Optional predicate: if it returns `true` for a thrown error, the watch
   * loop rethrows immediately instead of treating the error as transient.
   * Default: rethrow `ApiError` with status in `[400, 500)` (e.g. 404 on a
   * bad execution id) so the caller surfaces the real error rather than
   * spinning forever.
   */
  shouldAbort?: (err: unknown) => boolean;
}

export interface WatchResult {
  final: ExecutionSnapshot;
  detached: boolean;
}

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'rejected']);

const STATUS_BADGES: Record<string, string> = {
  pending: '[ ]',
  running: '[..]',
  completed: '[ok]',
  failed: '[x]',
  cancelled: '[-]',
  skipped: '[s]',
};

function statusBadge(status: string): string {
  return STATUS_BADGES[status] ?? `[${status.slice(0, 3)}]`;
}

/** Format duration with a 2-space leading separator, or '' when no duration. */
function durationSuffix(ms: number | null | undefined): string {
  const formatted = formatDuration(ms);
  return formatted ? `  ${formatted}` : '';
}

/** Build the rendered frame for a snapshot. Pure; trivially testable. */
export function renderFrame(snapshot: ExecutionSnapshot): string {
  const lines: string[] = [
    `${statusBadge(snapshot.status)} ${snapshot.id}${durationSuffix(snapshot.durationMs)}`,
  ];

  for (const step of snapshot.stepExecutions ?? []) {
    const errSuffix = step.error ? `  err: ${step.error.slice(0, 80)}` : '';
    lines.push(
      `  ${statusBadge(step.status)} ${step.stepName}${durationSuffix(step.durationMs)}${errSuffix}`
    );
    if (step.outputPreview) {
      lines.push(`     ↳ ${step.outputPreview}`);
    }
  }
  if (snapshot.error && (snapshot.stepExecutions ?? []).length === 0) {
    lines.push(`  err: ${snapshot.error.slice(0, 200)}`);
  }
  return lines.join('\n');
}

const ANSI_CURSOR_UP = '\x1b[A';
const ANSI_CLEAR_LINE = '\x1b[2K\r';

/**
 * Default renderer: clears the previous frame's lines and writes the new one
 * to stderr. Stderr keeps the watch chrome out of the way of `--json` stdout.
 *
 * When stderr is piped to a non-TTY (CI logs, `2>watch.log`), cursor-up
 * escapes turn into garbage. Detect that and emit each frame followed by a
 * blank-line separator instead — slightly noisier on disk but readable.
 */
function makeAnsiRenderer(): (frame: string) => void {
  const isTty = Boolean(process.stderr.isTTY);
  let previousLineCount = 0;
  return (frame: string) => {
    let buf = '';
    if (isTty) {
      for (let i = 0; i < previousLineCount; i++) {
        buf += i === 0 ? ANSI_CLEAR_LINE : `${ANSI_CURSOR_UP}${ANSI_CLEAR_LINE}`;
      }
    }
    buf += frame;
    if (!frame.endsWith('\n')) buf += '\n';
    if (!isTty && previousLineCount > 0) buf += '\n';
    process.stderr.write(buf);
    previousLineCount = frame.split('\n').length;
  };
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function snapshotsDiffer(a: ExecutionSnapshot, b: ExecutionSnapshot): boolean {
  if (a.status !== b.status) return true;
  const aSteps = a.stepExecutions ?? [];
  const bSteps = b.stepExecutions ?? [];
  if (aSteps.length !== bSteps.length) return true;
  for (let i = 0; i < aSteps.length; i++) {
    if (aSteps[i].stepName !== bSteps[i].stepName || aSteps[i].status !== bSteps[i].status) {
      return true;
    }
  }
  return false;
}

/**
 * Default abort predicate: bail on `ApiError` with a 4xx status (404 on a
 * bad execution id, 401/403 on auth, …). 5xx and bare network errors are
 * still treated as transient and retried — the server might be restarting.
 */
function defaultShouldAbort(err: unknown): boolean {
  return err instanceof ApiError && err.status >= 400 && err.status < 500;
}

/**
 * Stream successive snapshots from `opts.fetch` until the execution reaches
 * a terminal state OR `maxMs` elapses. Returns the last snapshot and a flag
 * indicating whether watching ended via auto-detach.
 *
 * Errors thrown by `fetch` are bucketed:
 *   - 4xx `ApiError` (per `shouldAbort`, default) → rethrown so the caller
 *     surfaces it via `printApiError` / non-zero exit. A `watch <bad-id>`
 *     should fail fast, not spin until `maxMs`.
 *   - Anything else (5xx, ECONNREFUSED, transient DNS) → rendered as a
 *     one-line `(network) …` frame and the loop continues.
 */
export async function watchExecution(opts: WatchOptions): Promise<WatchResult> {
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? (() => Date.now());
  const render = opts.render ?? makeAnsiRenderer();
  const maxMs = opts.maxMs ?? 30 * 60 * 1000;
  const transitionInterval = opts.transitionIntervalMs ?? 2000;
  const steadyInterval = opts.steadyIntervalMs ?? 5000;
  const shouldAbort = opts.shouldAbort ?? defaultShouldAbort;

  const start = now();
  let previous: ExecutionSnapshot | undefined;
  let lastFetched: ExecutionSnapshot | undefined;

  while (true) {
    let current: ExecutionSnapshot;
    try {
      current = await opts.fetch();
    } catch (err) {
      if (shouldAbort(err)) throw err;
      const message = err instanceof Error ? err.message : String(err);
      render(`(network) ${message.slice(0, 120)}`);
      // Even on transient failures, honor the deadline rather than spinning forever.
      if (lastFetched && now() - start >= maxMs) {
        return { final: lastFetched, detached: true };
      }
      await sleep(steadyInterval);
      continue;
    }
    lastFetched = current;
    render(renderFrame(current));

    if (TERMINAL_STATUSES.has(current.status)) {
      return { final: current, detached: false };
    }

    if (now() - start >= maxMs) {
      return { final: current, detached: true };
    }

    const transitioned = previous == null || snapshotsDiffer(previous, current);
    previous = current;
    await sleep(transitioned ? transitionInterval : steadyInterval);
  }
}

/** Test-only exports. */
export const __testing = { snapshotsDiffer };
