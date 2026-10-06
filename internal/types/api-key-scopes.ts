/**
 * API key scopes: what an API key is allowed to do.
 *
 * A key carries a list of scope identifiers in `api_keys.scope`. Identifiers
 * use `resource:action` (`observability:read`); `full_access` is the
 * unrestricted scope. Every consumer that authenticates API keys (app, git
 * server, OpenParser) decides access through {@link apiKeyHasScope}, so a
 * narrower scope is denied everywhere except where a route asks for it.
 *
 * `*` is the legacy spelling of full access. Keys issued before scopes were
 * named carry only `*`; migration 0070 adds `full_access` next to it, and new
 * full-access keys are written with both. `*` stays readable so an older
 * release (during a rolling deploy or after a rollback) still recognizes keys
 * written by this one. A later migration can drop it.
 */
export const API_KEY_SCOPE = {
  FULL_ACCESS: 'full_access',
  OBSERVABILITY_READ: 'observability:read',
  /** Legacy alias of {@link API_KEY_SCOPE.FULL_ACCESS}. Never check for it directly. */
  LEGACY_FULL_ACCESS: '*',
  OCR_FULL: 'ocr:full',
  OCR_PLAYGROUND: 'ocr:playground',
} as const;

export type ApiKeyScopeId = (typeof API_KEY_SCOPE)[keyof typeof API_KEY_SCOPE];

/** Scopes a customer can choose when creating an EigenPal API key. */
export const API_KEY_ACCESS_LEVELS = [
  {
    scope: API_KEY_SCOPE.FULL_ACCESS,
    label: 'Full access',
    description:
      'Use every API, CLI, and SDK operation the key creator is allowed to perform in this organization.',
  },
  {
    scope: API_KEY_SCOPE.OBSERVABILITY_READ,
    label: 'Observability (read-only)',
    description:
      'Read operational metrics from the Prometheus endpoint. Cannot run automations or read run data, files, or settings.',
  },
] as const;

export type ApiKeyAccessLevel = (typeof API_KEY_ACCESS_LEVELS)[number]['scope'];

/**
 * Organization roles that may create observability keys and scrape metrics
 * with them. Metrics cover the whole deployment, which is an operator concern.
 */
export const OBSERVABILITY_KEY_ROLES: readonly string[] = ['owner', 'admin'];

export function canUseObservabilityKeys(role: string | null | undefined): boolean {
  return role != null && OBSERVABILITY_KEY_ROLES.includes(role);
}

export function isApiKeyAccessLevel(value: unknown): value is ApiKeyAccessLevel {
  return API_KEY_ACCESS_LEVELS.some((level) => level.scope === value);
}

/** Scope list stored for a new key of the given access level. */
export function scopesForApiKeyAccessLevel(level: ApiKeyAccessLevel): string[] {
  return level === API_KEY_SCOPE.FULL_ACCESS
    ? [API_KEY_SCOPE.FULL_ACCESS, API_KEY_SCOPE.LEGACY_FULL_ACCESS]
    : [level];
}

/** True when the key may do anything. Absent or malformed scope data never does. */
export function apiKeyHasFullAccess(granted: unknown): boolean {
  return (
    Array.isArray(granted) &&
    (granted.includes(API_KEY_SCOPE.FULL_ACCESS) ||
      granted.includes(API_KEY_SCOPE.LEGACY_FULL_ACCESS))
  );
}

/** True when the key holds `required`, directly or through full access. */
export function apiKeyHasScope(granted: unknown, required: string): boolean {
  return apiKeyHasFullAccess(granted) || (Array.isArray(granted) && granted.includes(required));
}

/** Human label for a stored scope list, for key tables and audit views. */
export function describeApiKeyScopes(granted: unknown): string[] {
  if (!Array.isArray(granted)) return [];
  if (apiKeyHasFullAccess(granted)) return ['Full access'];
  return granted
    .filter((entry): entry is string => typeof entry === 'string')
    .map(
      (entry) =>
        API_KEY_ACCESS_LEVELS.find((level) => level.scope === entry)?.label ??
        (entry === API_KEY_SCOPE.OCR_FULL ? 'OCR (full)' : entry)
    );
}
