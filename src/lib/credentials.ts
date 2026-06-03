/**
 * Credentials live in one home-level file as a map of named profiles:
 *
 *   ~/.config/eigenpal/credentials.json
 *
 *   {
 *     "current": "staging",
 *     "profiles": {
 *       "default": { "apiKey": "eig_…", "baseUrl": "https://studio.eigenpal.com",
 *                    "tenantId": "org_…", "tenantName": "Acme Inc." },
 *       "staging": { "apiKey": "eig_…", "baseUrl": "https://staging.eigenpal.com",
 *                    "tenantId": "org_…", "tenantName": "Acme Staging" }
 *     }
 *   }
 *
 * Profile selection priority (highest first):
 *   1. EIGENPAL_API_KEY env var (one-off override; no profile lookup)
 *   2. EIGENPAL_PROFILE env var (per-shell switch)
 *   3. `current` field in the file (persistent default — `eigenpal auth use`)
 *   4. `default` profile if it exists
 *
 * Switching tenants:
 *   eigenpal auth login            # adds/updates profile, becomes current
 *   eigenpal auth use <profile>    # switch persistent default
 *   EIGENPAL_PROFILE=staging <cmd>     # switch for one shell / one command
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';

// Dynamic resolution so tests can override `$HOME` via process.env. Reads
// `process.env.HOME` first (which tests can mutate per-`beforeEach`) and
// falls back to `os.homedir()` — bun's `homedir()` snapshots before tests
// can override it, so we can't rely on that path for isolation.
function credentialsFilePath(): string {
  // eslint-disable-next-line no-process-env
  const home = process.env.HOME ?? homedir();
  return join(home, '.config', 'eigenpal', 'credentials.json');
}

export const DEFAULT_PROFILE_NAME = 'default';

export interface ProfileCredentials {
  apiKey: string;
  baseUrl: string;
  tenantId?: string;
  tenantName?: string;
}

interface CredentialsFile {
  /** Name of the active profile. Falls back to `default` when absent. */
  current?: string;
  profiles: Record<string, ProfileCredentials>;
}

export function getCredentialsPath(): string {
  return credentialsFilePath();
}

function readFile(): CredentialsFile | null {
  if (!existsSync(credentialsFilePath())) return null;
  let raw: string;
  try {
    raw = readFileSync(credentialsFilePath(), 'utf-8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed && typeof parsed === 'object') {
    const maybeFile = parsed as CredentialsFile;
    if (maybeFile.profiles && typeof maybeFile.profiles === 'object') {
      return maybeFile;
    }
  }
  // Malformed or unrecognized shape — ignore and treat as "not configured".
  // The user can re-run `auth login` to recreate a valid file.
  return null;
}

// Defense in depth around `credentials.json`. `writeFileSync`'s `mode:` is
// masked by the user's umask on POSIX, and a pre-existing dir/file from an
// older CLI is never re-tightened by either `mkdirSync` or `writeFileSync`.
// The trailing chmod is load-bearing on both counts. Best-effort: non-POSIX
// filesystems (Windows, some network mounts) reject chmod, and a stricter
// mode there would do nothing useful anyway.
function tighten(path: string, mode: number): void {
  try {
    chmodSync(path, mode);
  } catch {
    // intentional no-op
  }
}

function writeFile(file: CredentialsFile): void {
  const path = credentialsFilePath();
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  tighten(dir, 0o700);
  writeFileSync(path, JSON.stringify(file, null, 2) + '\n', {
    encoding: 'utf-8',
    mode: 0o600,
  });
  tighten(path, 0o600);
}

/** Return all profiles + which one is current. Empty profiles map if not set up. */
export function listProfiles(): { current: string; profiles: Record<string, ProfileCredentials> } {
  const file = readFile();
  if (!file) return { current: DEFAULT_PROFILE_NAME, profiles: {} };
  return { current: file.current ?? DEFAULT_PROFILE_NAME, profiles: file.profiles };
}

/**
 * Resolve the active profile's credentials honoring `EIGENPAL_PROFILE` /
 * the persisted `current` pointer / fallback to `default`. Returns `null`
 * when no matching profile exists.
 */
export function readActiveCredentials(profileOverride?: string): ProfileCredentials | null {
  const file = readFile();
  if (!file) return null;
  const name =
    profileOverride ||
    // eslint-disable-next-line no-process-env
    process.env.EIGENPAL_PROFILE ||
    file.current ||
    DEFAULT_PROFILE_NAME;
  return file.profiles[name] ?? null;
}

/** Name of the active profile under the same priority as `readActiveCredentials`. */
export function activeProfileName(profileOverride?: string): string {
  if (profileOverride) return profileOverride;
  // Read directly so tests can mutate process.env between assertions.
  // eslint-disable-next-line no-process-env
  if (process.env.EIGENPAL_PROFILE) return process.env.EIGENPAL_PROFILE;
  const file = readFile();
  return file?.current ?? DEFAULT_PROFILE_NAME;
}

/**
 * Upsert a profile. Picks `name` automatically when omitted: prefers
 * `tenantId` (so re-login to the same tenant updates the same profile),
 * then `tenantName` slugified, then `default`. Sets `current` pointer
 * to the upserted profile.
 */
export function upsertProfile(creds: ProfileCredentials, name?: string): string {
  const file = readFile() ?? { profiles: {} };
  const resolvedName =
    name ?? slugify(creds.tenantId ?? creds.tenantName ?? '') ?? DEFAULT_PROFILE_NAME;
  file.profiles[resolvedName] = creds;
  file.current = resolvedName;
  writeFile(file);
  return resolvedName;
}

/** Switch the persistent `current` pointer. Returns false if profile missing. */
export function setCurrentProfile(name: string): boolean {
  const file = readFile();
  if (!file || !file.profiles[name]) return false;
  file.current = name;
  writeFile(file);
  return true;
}

/**
 * Remove a profile. When `name` is omitted or matches `current`, also
 * advances `current` to any other profile (or clears it). Returns true
 * if a profile was actually deleted.
 */
export function deleteProfile(name?: string): boolean {
  const file = readFile();
  if (!file) return false;
  const target = name ?? file.current ?? DEFAULT_PROFILE_NAME;
  if (!file.profiles[target]) return false;
  delete file.profiles[target];
  if (file.current === target) {
    const remaining = Object.keys(file.profiles);
    file.current = remaining[0];
  }
  if (Object.keys(file.profiles).length === 0) {
    const path = credentialsFilePath();
    unlinkSync(path);
    // The dir lingers; tighten it so a stale 0755 install doesn't survive logout.
    tighten(dirname(path), 0o700);
  } else {
    writeFile(file);
  }
  return true;
}

function slugify(value: string): string | null {
  if (!value) return null;
  const slug = value
    .toLowerCase()
    .replace(/^org_/, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || null;
}
