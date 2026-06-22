/**
 * `eigenpal status` — one-shot dashboard. Prints account / tenant / workflow
 * count / recent execution count once, then exits. Not live-updating.
 *
 * The minimum a user wants to know after `auth login`:
 *   - Am I authenticated?
 *   - Which tenant is this key bound to?
 *   - Are there workflows on this tenant I can address?
 *
 * Exit codes:
 *   - 0 if the API key authenticates successfully.
 *   - 1 if the user is not authenticated, or the auth check failed (so
 *     scripts can `eigenpal status && deploy`). Non-auth network failures
 *     after the auth check (e.g. a flaky `/workflows` call) still exit 0 —
 *     the headline question ("am I authenticated?") was answered.
 */

import { ApiClient, ApiError } from '../../lib/client';
import { resolveConfig, resolveSource } from '../../lib/config';
import { listProfiles } from '../../lib/credentials';
import { error, ui, warn } from '../../lib/ui';

interface StatusOpts {
  baseUrl?: string;
  json?: boolean;
}

export async function status(opts: StatusOpts): Promise<void> {
  const config = resolveConfig(opts);

  if (!config.apiKey) {
    if (opts.json) {
      console.log(JSON.stringify({ authenticated: false, baseUrl: config.baseUrl }, null, 2));
    } else {
      warn('Not authenticated. Run `eigenpal auth login` to set an API key.');
    }
    process.exit(1);
  }

  const client = new ApiClient(config);
  const auth = await fetchAuthOrNull<{
    ok: boolean;
    tenantId?: string;
    tenantName?: string | null;
    email?: string | null;
    name?: string | null;
    keyId?: string;
  }>(client, '/api/v1/auth/check');

  if (!auth || !auth.ok) {
    if (opts.json) {
      console.log(JSON.stringify({ authenticated: false, baseUrl: config.baseUrl }, null, 2));
    } else {
      error('Authentication check failed. Try `eigenpal auth login`.');
    }
    process.exit(1);
  }

  // The list endpoint returns { items, total }. We pass limit=1 because we
  // only need the count, not the rows — and the tenant might have thousands.
  const workflows = await fetchOrNull<{ data?: unknown[]; items?: unknown[]; total?: number }>(
    client,
    '/api/workflows?limit=1'
  );
  const workflowCount =
    typeof workflows?.total === 'number'
      ? workflows.total
      : Array.isArray(workflows?.data)
        ? workflows.data.length
        : Array.isArray(workflows?.items)
          ? workflows.items.length
          : null;

  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          authenticated: true,
          baseUrl: config.baseUrl,
          tenantId: auth.tenantId,
          tenantName: auth.tenantName ?? null,
          user: { email: auth.email ?? null, name: auth.name ?? null },
          keyId: auth.keyId,
          workflows: workflowCount,
        },
        null,
        2
      )
    );
    return;
  }

  const source = resolveSource();
  // Only surface `key from:` when it carries signal:
  //   - env var override (load-bearing — silently bypasses the credentials
  //     file, easy to be confused about which tenant you're hitting)
  //   - more than one profile in the credentials file (so the user knows
  //     which one is currently active)
  // For the common case (single profile, no env var), the line is noise.
  // Wrap in try/catch — a corrupt credentials file shouldn't crash status
  // after a successful auth check; fall through to "show the line" so the
  // user at least sees something and can act.
  let profileCount = 0;
  let profileLookupFailed = false;
  if (source.apiKey === 'profile') {
    try {
      profileCount = Object.keys(listProfiles().profiles).length;
    } catch {
      profileLookupFailed = true;
    }
  }
  const showSourceLine = source.apiKey === 'env' || profileCount > 1 || profileLookupFailed;
  const sourceLabel =
    source.apiKey === 'env'
      ? ui.warn('EIGENPAL_API_KEY env var (overrides credentials file)')
      : `profile ${ui.bold(source.profile ?? '?')}`;

  const lines: string[] = [];
  lines.push(`${ui.dim('server:')}    ${config.baseUrl}`);
  lines.push(`${ui.dim('tenant:')}    ${ui.bold(auth.tenantName ?? auth.tenantId ?? '?')}`);
  if (auth.tenantId) {
    lines.push(`${ui.dim('tenant id:')} ${auth.tenantId}`);
  }
  if (auth.email) {
    lines.push(`${ui.dim('user:')}      ${auth.email}${auth.name ? ` (${auth.name})` : ''}`);
  }
  lines.push(`${ui.dim('key:')}       ${auth.keyId}`);
  if (showSourceLine) {
    lines.push(`${ui.dim('key from:')}  ${sourceLabel}`);
  }
  if (workflowCount != null) {
    const hint =
      workflowCount === 0 ? ui.dim('  (run `eigenpal init workflow <name>` to scaffold one)') : '';
    lines.push(`${ui.dim('workflows:')} ${workflowCount}${hint}`);
  }
  console.log(lines.join('\n'));
}

/**
 * Fetcher for the auth-check call. Returns `null` ONLY for genuine auth
 * failures (401/403); every other error — connection refused, DNS NXDOMAIN,
 * timeout, HTML response from the wrong port, 5xx — rethrows so
 * `formatCliError` upstream can show the right friendly hint.
 *
 * The previous implementation swallowed everything except `HtmlResponseError`,
 * which meant pointing at an unreachable host (e.g. via `EIGENPAL_BASE_URL`)
 * printed "Authentication check failed; try `eigenpal auth login`" — the
 * wrong rabbit hole. The user's API key is fine; the server isn't there.
 */
async function fetchAuthOrNull<T>(client: ApiClient, path: string): Promise<T | null> {
  try {
    return (await client.get(path)) as T;
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      return null;
    }
    throw err;
  }
}

/**
 * Lenient fetcher for the post-auth `/workflows` count. Once the auth check
 * has passed, the headline question ("am I authenticated?") is answered and
 * we don't want a flaky list call to flip the exit code or scare the user.
 * Any failure here just collapses the count line — same shape `null`-handling
 * the renderer already has.
 */
async function fetchOrNull<T>(client: ApiClient, path: string): Promise<T | null> {
  try {
    return (await client.get(path)) as T;
  } catch {
    return null;
  }
}
