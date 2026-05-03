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
} from '@clack/prompts';
import { exec } from 'child_process';
import { env } from '../env';
import { ApiClient } from '../lib/client';
import { deleteProfile, listProfiles, setCurrentProfile, upsertProfile } from '../lib/credentials';
import { dim, error, success, ui } from '../lib/ui';

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

export async function authLogin(baseUrl: string): Promise<void> {
  // CI environments shouldn't be running interactive login — the readline
  // prompt would hang indefinitely. Bail with a clear hint pointing at the
  // env var. Most CI runners (GitHub Actions, CircleCI, Jenkins, GitLab,
  // BitBucket, Vercel) set CI=true; nektos/act and some Jenkins flows set
  // CI=false for local emulation, so explicitly compare to "true" rather
  // than relying on truthiness.
  if (env.CI === 'true' && process.stdin.isTTY !== true) {
    error(
      'Refusing to run `auth login` in CI: set EIGENPAL_API_KEY (and optionally EIGENPAL_BASE_URL) in your CI environment instead.'
    );
    process.exit(1);
  }

  // `?from=cli` is a hint for the dashboard — it can detect the param and
  // surface a "create a key, copy it back to your terminal" banner. The CLI
  // doesn't depend on that handler existing today; the dashboard ignores
  // unknown query params and the copy-paste flow works.
  const settingsUrl = `${baseUrl}/developers/api-keys?from=cli`;

  intro(ui.bold('Eigenpal — sign in'));
  log.step(`Opening browser at ${ui.dim(settingsUrl)}`);
  openBrowser(settingsUrl);
  note(
    `Create a new key (suggested name: ${ui.bold('"Eigenpal CLI"')}), copy it,\nand paste it below. Input is hidden.`,
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

  const profileName = upsertProfile({
    apiKey: trimmedKey,
    baseUrl,
    tenantId: authCheck.tenantId,
    tenantName: authCheck.tenantName ?? undefined,
  });

  outro(
    `${ui.ok('✓')} Logged in as ${ui.bold(authCheck.tenantName || authCheck.tenantId)} ${ui.dim(`(profile ${profileName})`)}`
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
