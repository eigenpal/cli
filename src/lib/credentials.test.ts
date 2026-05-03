/**
 * Tests run against a fake `$HOME` so they never touch the real
 * `~/.config/eigenpal/credentials.json`.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  DEFAULT_PROFILE_NAME,
  activeProfileName,
  deleteProfile,
  getCredentialsPath,
  listProfiles,
  readActiveCredentials,
  setCurrentProfile,
  upsertProfile,
} from './credentials';

const originalHome = process.env.HOME;
const originalProfile = process.env.EIGENPAL_PROFILE;
let fakeHome = '';

beforeEach(() => {
  fakeHome = mkdtempSync(join(tmpdir(), 'eigenpal-home-'));
  process.env.HOME = fakeHome;
  delete process.env.EIGENPAL_PROFILE;
});

afterEach(() => {
  rmSync(fakeHome, { recursive: true, force: true });
  process.env.HOME = originalHome;
  if (originalProfile !== undefined) process.env.EIGENPAL_PROFILE = originalProfile;
});

describe('credentials (profile-based)', () => {
  it('returns null before any profile exists', () => {
    expect(readActiveCredentials()).toBeNull();
    expect(listProfiles().profiles).toEqual({});
  });

  it('upsertProfile slugifies tenantId/tenantName and marks active', () => {
    const name = upsertProfile({
      apiKey: 'eig_a',
      baseUrl: 'http://localhost:3000',
      tenantId: 'org_AbC123',
      tenantName: 'Acme Inc.',
    });

    expect(name).toBe('abc123');
    expect(listProfiles().current).toBe('abc123');
    const creds = readActiveCredentials();
    expect(creds?.apiKey).toBe('eig_a');
  });

  it('upsertProfile falls back to `default` when no slug source', () => {
    const name = upsertProfile({ apiKey: 'eig_x', baseUrl: 'http://localhost:3000' });
    expect(name).toBe(DEFAULT_PROFILE_NAME);
  });

  it('multiple profiles coexist; setCurrentProfile switches', () => {
    upsertProfile({ apiKey: 'k1', baseUrl: 'http://h1', tenantName: 'Acme' }, 'acme');
    upsertProfile({ apiKey: 'k2', baseUrl: 'http://h2', tenantName: 'Staging' }, 'staging');

    expect(listProfiles().current).toBe('staging'); // last upsert wins
    expect(readActiveCredentials()?.apiKey).toBe('k2');

    expect(setCurrentProfile('acme')).toBe(true);
    expect(readActiveCredentials()?.apiKey).toBe('k1');

    // Unknown profile — refuses + leaves current alone.
    expect(setCurrentProfile('does-not-exist')).toBe(false);
    expect(activeProfileName()).toBe('acme');
  });

  it('EIGENPAL_PROFILE env var overrides persisted current', () => {
    upsertProfile({ apiKey: 'k1', baseUrl: 'http://h1' }, 'acme');
    upsertProfile({ apiKey: 'k2', baseUrl: 'http://h2' }, 'staging');
    setCurrentProfile('acme');

    process.env.EIGENPAL_PROFILE = 'staging';
    expect(activeProfileName()).toBe('staging');
    expect(readActiveCredentials()?.apiKey).toBe('k2');
  });

  it('deleteProfile advances current to a remaining profile', () => {
    upsertProfile({ apiKey: 'k1', baseUrl: 'http://h1' }, 'acme');
    upsertProfile({ apiKey: 'k2', baseUrl: 'http://h2' }, 'staging');
    setCurrentProfile('staging');

    expect(deleteProfile('staging')).toBe(true);
    expect(listProfiles().current).toBe('acme');
  });

  it('deleting the last profile removes the file', () => {
    upsertProfile({ apiKey: 'k1', baseUrl: 'http://h1' }, 'only');
    expect(existsSync(getCredentialsPath())).toBe(true);

    expect(deleteProfile('only')).toBe(true);
    expect(existsSync(getCredentialsPath())).toBe(false);
  });
});
