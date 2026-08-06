/**
 * Canonical public API path prefix.
 *
 * Cloud defaults to `https://api.eigenpal.com` + `/v1/...`. Studio, local, and
 * self-hosted origins rewrite `/v1` → `/api/v1` additively, so one path works
 * everywhere. Prefer this over hard-coding `/api/v1`.
 */
export const API_PREFIX = '/v1' as const;

/**
 * Build a canonical `/v1/...` path.
 *
 * Accepts a bare suffix (`/runs`), a canonical path (`/v1/runs`), or a legacy
 * Studio path (`/api/v1/runs`) and always returns the portable `/v1` form.
 */
export function apiPath(suffix: string): string {
  if (suffix === '/v1' || suffix.startsWith('/v1/')) return suffix;
  if (suffix === '/api/v1' || suffix.startsWith('/api/v1/')) {
    return `${API_PREFIX}${suffix.slice('/api/v1'.length)}`;
  }
  const normalized = suffix.startsWith('/') ? suffix : `/${suffix}`;
  return `${API_PREFIX}${normalized}`;
}
