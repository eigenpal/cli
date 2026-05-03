/**
 * Shared CLI UI helpers — colors + status icons + tables + --json toggle.
 *
 * Backed by picocolors, which auto-detects `NO_COLOR`, `FORCE_COLOR`, and
 * non-TTY stdout. Anything we colorize is safe to pipe / redirect.
 *
 * Three surfaces:
 * 1. `ui.{ok,err,warn,info,dim,bold}(text)` — inline color, returns the
 *    string so it can be embedded in `console.log` calls.
 * 2. `success/error/info/warn(message)` — full-line print with a leading
 *    status icon (`✓` / `✗` / `ℹ` / `!`). Use these for command outcomes.
 * 3. `table(rows, columns)` + `addJsonFlag(cmd)` — list/get rendering. Default
 *    to a tight aligned ASCII table; `--json` flag restores raw shape for
 *    piping. See `commands/workflow/index.ts:list` handlers.
 *
 * Stream convention: stdout is for *data* (JSON, table rows, file contents);
 * stderr is for *status* (success / info / warn / error chrome). This keeps
 * `eigenpal foo --json | jq .` clean even when a success line gets printed.
 * `--quiet` / `-q` (set via `setQuiet(true)` from `cli.ts`) silences the
 * status helpers (`success`, `info`, `dim`); `error` and `warn` always fire,
 * and stdout (data) is never touched.
 *
 * Color: picocolors auto-disables on `NO_COLOR=1`, `FORCE_COLOR=0`, or
 * non-TTY stdout. Set the env var to disable; we don't ship a `--no-color`
 * CLI flag because it would just be a verbose alias for the env.
 */

import type { Command } from 'commander';
import pc from 'picocolors';

export { pc };

export function isTTY(): boolean {
  return Boolean(process.stdout.isTTY);
}

export const ui = {
  ok: pc.green,
  err: pc.red,
  warn: pc.yellow,
  info: pc.cyan,
  dim: pc.dim,
  bold: pc.bold,
};

// Module-level flag toggled by `setQuiet(true)` from `cli.ts` before
// `program.parseAsync` runs. Read lazily inside helpers so commands picked
// up after the flag is set behave correctly. Only `success` / `info` / `dim`
// honor it — `error` / `warn` are too important to ever silence, and JSON
// (stdout) is never silenced regardless.
let quietMode = false;

export function setQuiet(value: boolean): void {
  quietMode = value;
}

export function isQuiet(): boolean {
  return quietMode;
}

export function success(message: string): void {
  if (quietMode) return;
  process.stderr.write(`${pc.green('✓')} ${message}\n`);
}

export function error(message: string): void {
  process.stderr.write(`${pc.red('✗')} ${message}\n`);
}

export function info(message: string): void {
  if (quietMode) return;
  process.stderr.write(`${pc.cyan('ℹ')} ${message}\n`);
}

export function warn(message: string): void {
  process.stderr.write(`${pc.yellow('!')} ${message}\n`);
}

export function dim(message: string): void {
  if (quietMode) return;
  process.stderr.write(`${pc.dim(message)}\n`);
}

export function header(message: string): void {
  if (quietMode) return;
  process.stderr.write(`\n${pc.bold(message)}\n\n`);
}

// ---------------------------------------------------------------------------
// Table renderer + `--json` toggle
// ---------------------------------------------------------------------------

export interface TableColumn<T> {
  key: keyof T & string;
  header: string;
  /** Custom cell formatter (table view). Receives the raw value + the full row. */
  format?: (value: T[keyof T], row: T) => string;
  /** Right-align is correct for numbers and durations; default is left. */
  align?: 'left' | 'right';
}

/**
 * Render a list of rows as an aligned ASCII table. Columns auto-size to the
 * widest cell. Returns the rendered string; the caller decides how to print
 * (typically `console.log` or stderr for status hints).
 *
 * Empty input renders a single dim line so the user gets feedback rather than
 * a blank screen — matches the "(no rows)" convention used in
 * `compareExecutions`.
 */
export function table<T extends Record<string, unknown>>(
  rows: T[],
  columns: TableColumn<T>[]
): string {
  if (rows.length === 0) return pc.dim('(no rows)');

  const formatted = rows.map((row) =>
    columns.map((col) => {
      const value = row[col.key];
      if (col.format) return col.format(value as T[keyof T], row);
      // null / undefined render as a dash so empty cells are visible. Callers
      // that want a different placeholder (or empty string) supply `format`.
      if (value == null) return '-';
      return String(value);
    })
  );

  const widths = columns.map((col, i) => {
    const dataMax = Math.max(0, ...formatted.map((r) => r[i].length));
    return Math.max(col.header.length, dataMax);
  });

  const align = (text: string, idx: number): string => {
    const w = widths[idx];
    return columns[idx].align === 'right' ? text.padStart(w) : text.padEnd(w);
  };

  const headerLine = columns.map((col, i) => align(col.header, i)).join('  ');
  const separator = pc.dim(widths.map((w) => '─'.repeat(w)).join('  '));
  const dataLines = formatted.map((cells) => cells.map((c, i) => align(c, i)).join('  '));

  return [headerLine, separator, ...dataLines].join('\n');
}

/**
 * Adds `--json` to a Commander command. With `--json`, the raw server payload
 * goes to stdout (the table is suppressed). For list endpoints this is the
 * `{ data, total }` envelope unchanged — pipe through `jq '.data'` (or
 * `jq '.data | .[].id'` for projection) to extract what you need.
 *
 * Convention: the CLI returns the raw payload and lets `jq` do projection.
 * That mirrors `gh` / `kubectl` and keeps a single canonical wrap helper —
 * scripts that need a column subset already have `jq` in the pipeline.
 */
export function addJsonFlag<C extends Command>(cmd: C): C {
  return cmd.option('--json', 'Output the raw server response as JSON') as C;
}

/** Add the standard `--base-url <url>` option to a command. */
export function withBaseUrl<C extends Command>(cmd: C): C {
  return cmd.option('--base-url <url>', 'Server base URL') as C;
}

/**
 * Parse a CLI string argument as a base-10 integer. Used by every `--limit`,
 * `--offset`, `--interval`, etc. so call sites don't repeat the lambda.
 */
export function intArg(value: string): number {
  return Number.parseInt(value, 10);
}

/** Shape spread into every list-handler `opts`. Pair with `withPagination`. */
export interface PaginationOpts {
  limit: number;
  offset: number;
}

/**
 * Adds the standard `--limit/--offset` pair to a list command. Defaults to
 * 50/0; `dataset list` overrides via the optional `defaultLimit` argument.
 * Handlers receive `opts.limit` / `opts.offset` as numbers (via `intArg`).
 */
export function withPagination<C extends Command>(cmd: C, defaultLimit = 50): C {
  return cmd
    .option('--limit <n>', 'Page size', intArg, defaultLimit)
    .option('--offset <n>', 'Page offset', intArg, 0) as C;
}

/** Compact ms → "412ms" / "1.2s" / "2m3s". Mirrors lib/watch.ts:fmtDuration. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return '';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.floor((ms % 60_000) / 1000)}s`;
}

/** ISO timestamp → "YYYY-MM-DD HH:MM" (UTC). Falls back to '-' on bad input. */
export function formatTimestamp(value: unknown): string {
  if (value == null) return '-';
  const text = typeof value === 'string' ? value : String(value);
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  const iso = date.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

/**
 * Render a list endpoint response.
 *
 * - **Default (no flags)**: aligned ASCII table to stdout, "N of M records"
 *   hint to stderr.
 * - **`--json`**: the raw `{ data, total }` envelope unchanged. Pipe through
 *   `jq '.data'` to unwrap. Matches the gh/kubectl convention of returning
 *   the full server payload by default.
 *
 * All server list endpoints return `{ data, total }`.
 */
export function renderListResult<T extends Record<string, unknown>>(
  raw: unknown,
  columns: TableColumn<T>[],
  opts: { json?: boolean; entityLabel?: string } = {}
): void {
  const payload = raw as { data?: T[]; total?: number };
  const rows = payload.data ?? [];
  const total = typeof payload.total === 'number' ? payload.total : rows.length;
  const label = opts.entityLabel ?? 'record';

  if (opts.json) {
    console.log(JSON.stringify(raw, null, 2));
    if (rows.length > 0) writeRecordCountHint(rows.length, total, label);
    return;
  }

  console.log(table(rows, columns));
  if (rows.length > 0) writeRecordCountHint(rows.length, total, label);
}

function writeRecordCountHint(shown: number, total: number, label: string): void {
  process.stderr.write(
    `${pc.dim(`${shown}${total > shown ? ` of ${total}` : ''} ${label}${total === 1 ? '' : 's'} · use --json for the raw payload`)}\n`
  );
}
