import { ApiError, HtmlResponseError } from './client';
import { resolveConfig } from './config';
import { error, ui } from './ui';

/**
 * Substrings on an Error/cause that mean "the server didn't answer at all" —
 * not a 4xx/5xx response, but a connect-, DNS-, or socket-level failure.
 *
 * Why a substring list and not `instanceof TypeError`:
 *   - `fetch()` in Bun/Node wraps the underlying connect/DNS error in a
 *     `TypeError('fetch failed')` whose `cause` is the real Error (often a
 *     plain `Error` with `code: 'ECONNREFUSED'` etc.).
 *   - Some libraries surface the raw cause directly.
 *   - `bun fetch()` against an unreachable host yields a TypeError whose
 *     message is `'Unable to connect. Is the computer able to access the url?'`.
 * We want one branch that handles all of these cleanly.
 */
const CONNECTION_FAILURE_TOKENS = [
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ERR_INVALID_URL',
  'fetch failed',
  'Unable to connect',
];

function isConnectionFailure(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  // Walk the cause chain — `TypeError('fetch failed')` hides ECONNREFUSED in
  // `.cause`. Cap at 4 hops to defend against pathological cycles.
  let cursor: unknown = err;
  for (let i = 0; i < 4 && cursor instanceof Error; i++) {
    const m = String(cursor.message ?? '');
    const code = (cursor as { code?: unknown }).code;
    if (CONNECTION_FAILURE_TOKENS.some((t) => m.includes(t))) return true;
    if (typeof code === 'string' && CONNECTION_FAILURE_TOKENS.includes(code)) return true;
    cursor = (cursor as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Format errors for CLI output: friendly message for API, network/URL, and
 * generic errors. Every recoverable failure ends with an actionable hint —
 * mirrors `gh`'s pattern of always pointing the user at the next command.
 *
 * Connection failures (DNS, refused, timed out) get `context.baseUrl`
 * appended so the user can see *which* URL we tried — the most common cause
 * is a typo or a stale env var.
 */
export function formatCliError(err: unknown, context?: { baseUrl?: string }): string {
  if (err instanceof HtmlResponseError) return err.message;
  if (err instanceof ApiError) {
    if (err.status === 401) {
      // 401 always ends with a recovery action — no exceptions. Mirrors `gh`'s
      // convention. The user either has no token or a stale one; either way
      // the next move is `auth login` (or set the env var in CI).
      return `${err.message}\n  Run \`eigenpal auth login\` or set EIGENPAL_API_KEY.`;
    }
    return err.message;
  }
  if (isConnectionFailure(err)) {
    // The most common cause is a typo in the base URL or the server isn't
    // running. Echo the URL we tried so the user can diagnose at a glance,
    // and point at the env var / flag they can change.
    const url = context?.baseUrl;
    const suffix = url ? ` at ${url}` : '';
    return `Could not connect to the server${suffix} (invalid or unreachable base URL)\n  Set EIGENPAL_BASE_URL or pass --base-url <url>.`;
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * Server error envelope. Modern routes return `{ issues, hint? }`; legacy
 * routes return `{ error, details? }`. Either is acceptable; `printApiError`
 * dispatches on shape.
 */
export interface ApiErrorBody {
  issues?: Array<{ field: string; message: string; code?: string; severity?: string }>;
  hint?: string;
  docsUrl?: string;
  requestId?: string;
  /** Legacy fallback. New routes return only `issues`. */
  error?: string;
  details?: unknown;
}

/**
 * Render a server error: aligned-field issues for the modern
 * `{ issues, hint }` envelope, friendly fallback for the legacy
 * `{ error, details }` envelope, and `formatCliError` prose otherwise.
 *
 * Every command wired through `action()` routes errors here so rendering
 * is uniform across the CLI surface.
 */
export function printApiError(err: unknown, context?: { baseUrl?: string }): void {
  if (err instanceof HtmlResponseError) {
    error(err.message);
    return;
  }
  if (err && typeof err === 'object' && 'body' in err) {
    const body = (err as { body: ApiErrorBody }).body;

    // Modern envelope: structured issues. Render with aligned field column.
    if (body?.issues && body.issues.length > 0) {
      const fieldWidth = Math.max(...body.issues.map((i) => i.field.length));
      error(ui.bold('Validation failed'));
      process.stderr.write('\n');
      for (const issue of body.issues) {
        const field = issue.field.padEnd(fieldWidth);
        process.stderr.write(`  ${ui.bold(field)}  ${issue.message}\n`);
      }
      process.stderr.write('\n');
      if (body.hint) process.stderr.write(`${ui.info('ℹ')} ${body.hint}\n`);
      if (body.docsUrl) process.stderr.write(`${ui.dim('docs:')} ${body.docsUrl}\n`);
      if (body.requestId) process.stderr.write(`${ui.dim('request id:')} ${body.requestId}\n`);
      return;
    }

    // Legacy envelope: { error, details? }. Best-effort surface of details.
    if (body?.error) {
      error(body.error);
      if (body.details !== undefined) {
        const detail =
          typeof body.details === 'string' ? body.details : JSON.stringify(body.details, null, 2);
        process.stderr.write(`${detail}\n`);
      }
      return;
    }
  }
  error(formatCliError(err, context));
}

/**
 * Wrap a Commander action handler so any thrown error is rendered through
 * `printApiError` and the process exits 1. Lets call sites replace the
 * `try { body } catch (err) { printApiError(err); process.exit(1); }`
 * boilerplate with a single decorator while keeping each handler body focused
 * on its happy path.
 *
 * On the error path we pull the parsed opts off the trailing `Command` arg
 * (Commander's invocation shape is `(...positional, opts, command)`) and
 * forward `baseUrl` to `printApiError` so connection failures echo the URL
 * we tried — `formatCliError` reads it as context. For local-only commands
 * (no server in play, e.g. `step exec`) the lookup yields undefined and
 * the renderer just omits the URL.
 */
export function action<A extends unknown[]>(
  body: (...args: A) => Promise<void>
): (...args: A) => Promise<void> {
  return async (...args: A) => {
    try {
      await body(...args);
    } catch (err) {
      printApiError(err, { baseUrl: resolveBaseUrlFromActionArgs(args) });
      process.exit(1);
    }
  };
}

/**
 * Read `baseUrl` off the trailing `Command` arg Commander hands to every
 * action callback. Returns undefined on any unexpected shape (or if the
 * config resolver itself throws, e.g. malformed credentials) so the renderer
 * just omits the URL.
 */
function resolveBaseUrlFromActionArgs(args: readonly unknown[]): string | undefined {
  const cmd = args[args.length - 1] as { opts?: () => unknown } | undefined;
  if (!cmd || typeof cmd.opts !== 'function') return undefined;
  try {
    // resolveConfig handles the precedence chain (flag > env > profile >
    // localhost default); going through it means a missing `--base-url`
    // still yields the URL the request actually targeted.
    return resolveConfig(cmd.opts() as { baseUrl?: string; dir?: string }).baseUrl;
  } catch {
    return undefined;
  }
}
