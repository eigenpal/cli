import {
  cancel,
  intro,
  isCancel,
  log,
  note,
  outro,
  password,
  select,
  spinner,
  text,
} from '@clack/prompts';
import { exec } from 'child_process';
import { env } from '../env';
import { ApiClient } from '../lib/client';
import { deleteProfile, listProfiles, setCurrentProfile, upsertProfile } from '../lib/credentials';
import { dim, error, success, ui } from '../lib/ui';

const CLOUD_BASE_URL = 'https://studio.eigenpal.com';

function openBrowser(url: string): void {
  const cmd =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  exec(`${cmd} "${url}"`);
}

/** Treat clack cancellation (Ctrl-C / Esc) as a graceful exit, not a crash. */
function exitOnCancel<T>(value: T | symbol): T {
  if (isCancel(value)) {
    cancel('Cancelled.');
    process.exit(0);
  }
  return value as T;
}

/**
 * Normalize and validate a server base URL. Returns the canonical form
 * (origin only, no trailing slash) or an error message suitable for a
 * clack `validate` return.
 *
 * Forgiving inputs:
 *   - leading/trailing whitespace stripped
 *   - missing scheme → `https://` auto-prepended (most users paste the
 *     hostname; this avoids a "URL must include scheme" reject loop)
 *   - trailing slashes stripped
 *
 * Strict on:
 *   - scheme: only http or https accepted (no file://, ftp://, ws://, …)
 *   - structure: URL must parse cleanly
 *   - path/query/hash: rejected — baseUrl is an origin, not a route
 *
 * The hostname `localhost` (and common loopback variants) is allowed
 * with `http://` because that's how on-prem dev servers run; everything
 * else with `http://` is allowed but flagged so the user can confirm
 * they're not misconfiguring a production endpoint.
 */
export function normalizeBaseUrl(
  input: string
): { ok: true; url: string; insecure: boolean } | { ok: false; error: string } {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, error: 'Enter a URL.' };

  // Auto-prepend https:// when the user pastes a bare host. We can't just
  // try-parse first because `new URL("eigenpal.example.com")` throws, and
  // probing with a regex is more reliable than guessing from the error.
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
  const candidate = hasScheme ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { ok: false, error: 'Not a valid URL.' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      ok: false,
      error: `Unsupported scheme "${parsed.protocol.replace(':', '')}" — use http or https.`,
    };
  }

  // Reject query/hash and any non-trivial path. Trailing slashes alone
  // (one or many) are user-pasting noise — strip them and proceed. A real
  // path like `/api/v1` would silently break every API call (which
  // appends its own path), so reject those. Show the user the corrected
  // origin form so they know what to paste instead — most people pasted
  // their browser's address bar URL and just need to trim the path.
  const trailingSlashOnly = /^\/*$/.test(parsed.pathname);
  if (!trailingSlashOnly || parsed.search || parsed.hash) {
    return {
      ok: false,
      error: `URL must be the server origin only (no path/query). Try ${parsed.origin} instead of "${parsed.pathname}${parsed.search}${parsed.hash}".`,
    };
  }

  if (!parsed.hostname) {
    return { ok: false, error: 'URL is missing a hostname.' };
  }

  const isLoopback =
    parsed.hostname === 'localhost' ||
    parsed.hostname === '127.0.0.1' ||
    parsed.hostname === '[::1]';

  // Origin-only canonical form: scheme://host[:port], no trailing slash.
  // `URL.origin` already gives us this; double-checking with a strip in
  // case of any edge case.
  const url = parsed.origin.replace(/\/+$/, '');
  const insecure = parsed.protocol === 'http:' && !isLoopback;
  return { ok: true, url, insecure };
}

/**
 * Prompt the user for the server to authenticate against. Cloud is always
 * the first option (and the default highlight). Any on-prem URLs already
 * in the credentials file are surfaced as discovered options so users
 * with existing on-prem profiles can re-login without retyping the URL.
 * "Custom" prompts for a URL with full validation.
 */
async function pickBaseUrlInteractive(): Promise<string> {
  // Collect distinct on-prem URLs from existing profiles, keyed by URL so a
  // user with several profiles against the same server doesn't see dupes.
  // listProfiles() returns { current, profiles: Record<name, creds> } —
  // iterate the map's entries to keep the profile name alongside the data.
  const onPrem = new Map<string, string[]>(); // url → [profile names that use it]
  for (const [name, creds] of Object.entries(listProfiles().profiles)) {
    const raw = creds.baseUrl?.trim();
    if (!raw) continue;
    const norm = normalizeBaseUrl(raw);
    if (!norm.ok) continue; // skip malformed entries silently — validate-on-write fixes this going forward
    if (norm.url === CLOUD_BASE_URL) continue;
    const names = onPrem.get(norm.url) ?? [];
    names.push(name);
    onPrem.set(norm.url, names);
  }

  const options: { value: string; label: string; hint?: string }[] = [
    { value: CLOUD_BASE_URL, label: `EigenPal Studio (${CLOUD_BASE_URL})` },
  ];
  for (const [url, profiles] of onPrem) {
    options.push({
      value: url,
      label: url,
      hint: `(saved profile) from ${profiles.join(', ')}`,
    });
  }
  options.push({ value: '__custom__', label: 'Custom URL…', hint: 'paste your own' });

  const picked = exitOnCancel(
    await select<string>({
      message: 'Authenticate against',
      options,
      initialValue: CLOUD_BASE_URL,
    })
  );

  if (picked !== '__custom__') return picked;

  const custom = exitOnCancel(
    await text({
      message: 'Server URL',
      placeholder: 'https://eigenpal.example.com',
      validate: (value) => {
        const norm = normalizeBaseUrl(value);
        return norm.ok ? undefined : norm.error;
      },
    })
  );
  // Validation already passed; normalize() is idempotent so this just
  // gives us the canonical form (auto-prepended https, stripped slash).
  const norm = normalizeBaseUrl(custom);
  if (!norm.ok) {
    // Defensive — should be unreachable because validate() already gated.
    error(norm.error);
    process.exit(1);
  }
  if (norm.insecure) warnInsecure();
  return norm.url;
}

/** Shared insecure-http warning — emitted from both the explicit-flag and custom-URL paths. */
function warnInsecure(): void {
  log.warn(
    `Using ${ui.bold('http://')} against a non-loopback host — credentials and traffic are sent unencrypted.`
  );
}

export async function authLogin(flagBaseUrl?: string): Promise<void> {
  // CI environments shouldn't be running interactive login — the readline
  // prompt would hang indefinitely. Bail with a clear hint pointing at the
  // env var. Most CI runners (GitHub Actions, CircleCI, Jenkins, GitLab,
  // BitBucket, Vercel) set CI=true; nektos/act and some Jenkins flows set
  // CI=false for local emulation, so explicitly compare to "true" rather
  // than relying on truthiness.
  if (env.CI === 'true' && process.stdin.isTTY !== true) {
    error(
      '`auth login` needs an interactive terminal. In CI, set EIGENPAL_API_KEY (and optionally EIGENPAL_BASE_URL) directly instead.'
    );
    process.exit(1);
  }

  intro(ui.bold('Eigenpal — sign in'));

  // baseUrl resolution — explicit override (flag or env) wins outright.
  // Otherwise show a picker: Cloud, any on-prem URLs detected from
  // existing profiles, or a custom URL. The picker exists because a stale
  // dev/on-prem profile inheriting through `resolveConfig` silently
  // redirects logins to the wrong server (the user can't tell the URL on
  // the banner came from their profile, not the default).
  const explicit = flagBaseUrl?.trim() || env.EIGENPAL_BASE_URL?.trim();
  let baseUrl: string;
  if (explicit) {
    const norm = normalizeBaseUrl(explicit);
    if (!norm.ok) {
      error(`Invalid base URL "${explicit}": ${norm.error}`);
      process.exit(2);
    }
    if (norm.insecure) warnInsecure();
    baseUrl = norm.url;
  } else {
    // The picker reads from stdin via clack — it deadlocks waiting for
    // input on a non-TTY (script piping, redirected stdin, container w/o
    // -it). Catch this BEFORE clack hangs and point the user at the
    // explicit-override paths.
    if (process.stdin.isTTY !== true) {
      error(
        '`auth login` needs an interactive terminal to pick a server. Pass --base-url <url> or set EIGENPAL_BASE_URL to skip the picker.'
      );
      process.exit(2);
    }
    baseUrl = await pickBaseUrlInteractive();
  }

  // `?from=cli` is a hint for the dashboard — it can detect the param and
  // surface a "create a key, copy it back to your terminal" banner. The CLI
  // doesn't depend on that handler existing today; the dashboard ignores
  // unknown query params and the copy-paste flow works.
  const settingsUrl = `${baseUrl}/developers/api-keys?from=cli`;

  log.step(`Opening browser at ${ui.dim(settingsUrl)}`);
  openBrowser(settingsUrl);
  // Repeat the URL inside the note: openBrowser is best-effort (silently
  // fails on headless VMs, WSL without xdg-open, restricted containers).
  // Embedding it in the note means a user whose browser didn't pop has
  // a copyable URL right next to the prompt instead of having to scroll
  // back to the dim `log.step` line above.
  note(
    `If a browser didn't open, visit:\n${ui.bold(settingsUrl)}\n\nCreate a new key (suggested name: ${ui.bold('"Eigenpal CLI"')}), copy it,\nand paste it below. Input is hidden.`,
    'Next'
  );

  const key = exitOnCancel(
    await password({
      message: 'API key (eig_live_…)',
      mask: '*',
      validate: (value) =>
        value.trim().length > 0
          ? undefined
          : 'Paste the key from your dashboard, or press Ctrl-C to cancel.',
    })
  );
  const trimmedKey = key.trim();

  const config = { baseUrl, apiKey: trimmedKey, dir: '' };
  const client = new ApiClient(config);
  const s = spinner();
  s.start('Validating key with the server');
  let authCheck: { ok: boolean; tenantName: string | null; tenantId: string };
  try {
    authCheck = (await client.get('/api/v1/auth/check')) as typeof authCheck;
  } catch (err) {
    s.stop('API key validation failed', 1);
    error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
  if (!authCheck.ok) {
    s.stop('API key validation failed', 1);
    process.exit(1);
  }
  s.stop(`Validated against ${ui.bold(authCheck.tenantName || authCheck.tenantId)}`);

  // Track whether the slug already existed so the outro can distinguish
  // "first login here" from "updated existing profile in place" — the
  // latter quietly overwrote prior credentials and the user deserves to
  // see that, not just a generic success.
  const existingProfiles = listProfiles().profiles;
  const profileName = upsertProfile({
    apiKey: trimmedKey,
    baseUrl,
    tenantId: authCheck.tenantId,
    tenantName: authCheck.tenantName ?? undefined,
  });
  const updated = profileName in existingProfiles;

  const tenantLabel = ui.bold(authCheck.tenantName || authCheck.tenantId);
  const action = updated ? 'Updated profile' : 'Saved profile';
  outro(
    `${ui.ok('✓')} Logged in as ${tenantLabel}\n  ${dim(`${action} ${ui.bold(profileName)} — switch with`)} ${ui.bold(`eigenpal auth use ${profileName}`)}`
  );
}

export async function authLogout(profileName?: string): Promise<void> {
  const removed = deleteProfile(profileName);
  if (removed) {
    success(
      profileName
        ? `Removed profile ${ui.bold(profileName)}`
        : 'Logged out (active profile removed)'
    );
  } else {
    dim(profileName ? `No profile named ${profileName}` : 'No active profile to remove.');
  }
}

export async function authList(): Promise<void> {
  const { current, profiles } = listProfiles();
  const names = Object.keys(profiles);
  if (names.length === 0) {
    dim('No profiles configured. Run `eigenpal auth login` to add one.');
    return;
  }
  // Width-pad the profile name column so the tenant column lines up. Doesn't
  // collapse to padEnd(16) when one profile name is longer.
  const nameWidth = Math.max(16, ...names.map((n) => n.length));
  for (const name of names.sort()) {
    const p = profiles[name];
    const marker = name === current ? ui.ok('●') : ui.dim('○');
    const tenant = p.tenantName ?? p.tenantId ?? '?';
    // Show the canonical tenant id alongside the display name when both
    // are known — two profiles with the same tenantName otherwise look
    // identical.
    const tenantLabel =
      p.tenantName && p.tenantId ? `${tenant} ${ui.dim(`(${p.tenantId})`)}` : tenant;
    console.log(
      `${marker} ${ui.bold(name.padEnd(nameWidth))} ${ui.dim(tenantLabel)}  ${ui.dim(p.baseUrl)}`
    );
  }
  console.log('');
  dim(`(● = active. Switch with \`eigenpal auth use <name>\` or \`EIGENPAL_PROFILE=<name>\`.)`);
}

export async function authUse(profileName?: string): Promise<void> {
  const { current, profiles } = listProfiles();
  const names = Object.keys(profiles);
  if (names.length === 0) {
    error('No profiles configured. Run `eigenpal auth login` to add one.');
    process.exit(1);
  }

  // If the caller didn't name one, pick interactively. The select shows
  // tenant + URL as hints so an agent / human can identify each profile
  // without `auth list` round-tripping.
  let target = profileName;
  if (!target) {
    if (process.stdin.isTTY !== true) {
      error(
        'Specify a profile name: `eigenpal auth use <name>`. Run `eigenpal auth list` to see what is available.'
      );
      process.exit(1);
    }
    intro(ui.bold('Switch active profile'));
    const picked = exitOnCancel(
      await select({
        message: 'Pick a profile',
        initialValue: current,
        options: names.sort().map((name) => {
          const p = profiles[name];
          const tenant = p.tenantName ?? p.tenantId ?? '';
          const isActive = name === current;
          return {
            value: name,
            label: isActive ? `${name} ${ui.dim('(active)')}` : name,
            hint: tenant ? `${tenant} · ${p.baseUrl}` : p.baseUrl,
          };
        }),
      })
    );
    target = picked as string;
    if (target === current) {
      outro(`${ui.dim('Already on')} ${ui.bold(target)}`);
      return;
    }
  }

  if (!setCurrentProfile(target)) {
    error(
      `No profile named ${ui.bold(target)}. Run \`eigenpal auth list\` to see what is available.`
    );
    process.exit(1);
  }
  const p = profiles[target];
  const tenantSuffix = p?.tenantName ? ` ${ui.dim(`(${p.tenantName})`)}` : '';
  if (profileName) {
    success(`Switched to ${ui.bold(target)}${tenantSuffix}`);
  } else {
    outro(`${ui.ok('✓')} Switched to ${ui.bold(target)}${tenantSuffix}`);
  }
}
