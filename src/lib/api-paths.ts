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

/** Project legacy `/api/v1` call sites onto the canonical `/v1` prefix. */
export function canonicalApiPath(path: string): string {
  if (path === '/api/v1' || path.startsWith('/api/v1/')) {
    return `${API_PREFIX}${path.slice('/api/v1'.length)}`;
  }
  return path;
}

function parseBaseUrl(baseUrl: string): URL {
  return new URL(baseUrl.match(/^https?:\/\//i) ? baseUrl : `https://${baseUrl}`);
}

function endsWithApiPrefix(basePath: string): boolean {
  return basePath === '/api' || basePath.endsWith('/api');
}

function endsWithApiV1Prefix(basePath: string): boolean {
  return basePath === '/api/v1' || basePath.endsWith('/api/v1');
}

/**
 * Join a CLI `baseUrl` with a request path without double `/v1` segments.
 *
 * Supports origin-only bases (`https://studio.eigenpal.com`), `/api` bases for
 * deployments without the additive `/v1` rewrite, and `/api/v1` bases copied
 * from API docs. Dashboard authoring routes (`/api/workflows`, …) stay rooted
 * at the origin even when the base carries an `/api` prefix.
 */
export function resolveRequestUrl(baseUrl: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;

  const requestPath = canonicalApiPath(path);
  const isCanonicalV1 = requestPath === API_PREFIX || requestPath.startsWith(`${API_PREFIX}/`);
  const base = parseBaseUrl(baseUrl);
  const basePath = base.pathname.replace(/\/+$/, '');

  if (isCanonicalV1) {
    if (endsWithApiV1Prefix(basePath)) {
      const suffix = requestPath === API_PREFIX ? '' : requestPath.slice(API_PREFIX.length);
      return `${base.origin}${basePath}${suffix}`;
    }
    if (endsWithApiPrefix(basePath)) {
      return `${base.origin}${basePath}${requestPath}`;
    }
    return `${base.origin}${requestPath}`;
  }

  if (
    requestPath.startsWith('/api/') &&
    (endsWithApiPrefix(basePath) || endsWithApiV1Prefix(basePath))
  ) {
    return `${base.origin}${requestPath}`;
  }

  if (!basePath) return `${base.origin}${requestPath}`;
  return `${base.origin}${basePath}${requestPath}`;
}
