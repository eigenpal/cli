/**
 * Tenant-scoped derivation of the git operator credential.
 *
 * `AGENT_GIT_ADMIN_TOKEN` is one deployment-wide secret shared by the app and
 * git-server. git-server used to accept it as `{ tenantId: '*', internal: true }`,
 * which short-circuits the organization access check for ANY repository path.
 * Since the git-server ALB is public, one bearer header was full read/write on
 * any hosted tenant's agent source -- exactly the cross-tenant master key the
 * app-side gate (`isOperatorTokenAuthAllowed`) exists to refuse.
 *
 * The fix is to stop putting the root secret on the wire. A caller derives a
 * token that names the single tenant it may touch and carries an HMAC over that
 * name; git-server recomputes the HMAC and scopes access to the named tenant.
 * Same construction as `deriveSandboxRelayKey`: one root secret, one derived
 * credential per scope, no new state to provision or revoke.
 *
 * What this closes: nothing on the wire, in a log, in a proxy, or in a sandbox
 * is cross-tenant any more, and a path-resolution bug cannot reach another
 * tenant because the credential itself pins the tenant.
 *
 * What this does NOT close: the root secret still derives a token for any
 * tenant, so an operator (or a leaked sops value, or an old backup) retains
 * cross-tenant reach. Closing that needs credentials git-server can verify
 * without holding a secret that derives the others -- per-tenant DB-backed
 * service keys, which `authenticateRequest` already supports for sandboxes.
 * Tracked separately; do not describe the derivation as a fix for a
 * compromised root secret.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/** Wire prefix. `.` separates the fields because tenant ids may contain `_`. */
const GIT_TENANT_TOKEN_PREFIX = 'epgit.';
const GIT_TENANT_TOKEN_CONTEXT = 'eigenpal-git-tenant-token-v1';

/** A tenant id has to survive a round trip through the token verbatim. */
function isEncodableTenantId(tenantId: string): boolean {
  return /^[A-Za-z0-9_-]{1,190}$/.test(tenantId);
}

/**
 * Token authorizing git operations for exactly one tenant.
 *
 * Deliberately NOT accepted as a general API key anywhere: the app's inbound
 * path keys on the root token, and this value never authenticates there.
 */
export function deriveGitTenantToken(rootToken: string, tenantId: string): string {
  if (!rootToken) throw new Error('rootToken is required to derive a git tenant token');
  if (!isEncodableTenantId(tenantId)) {
    throw new Error(`Cannot derive a git tenant token for tenant id ${JSON.stringify(tenantId)}`);
  }
  const signature = createHmac('sha256', rootToken)
    .update(`${GIT_TENANT_TOKEN_CONTEXT}:${tenantId}`)
    .digest('hex');
  return `${GIT_TENANT_TOKEN_PREFIX}${tenantId}.${signature}`;
}

/** Split the wire form without verifying it. */
export function parseGitTenantToken(token: string): { tenantId: string; signature: string } | null {
  if (!token.startsWith(GIT_TENANT_TOKEN_PREFIX)) return null;
  const body = token.slice(GIT_TENANT_TOKEN_PREFIX.length);
  // Signature is hex and the tenant id cannot contain `.`, so the last
  // separator is unambiguous.
  const split = body.lastIndexOf('.');
  if (split <= 0 || split === body.length - 1) return null;
  const tenantId = body.slice(0, split);
  const signature = body.slice(split + 1);
  if (!isEncodableTenantId(tenantId) || !/^[0-9a-f]{64}$/.test(signature)) return null;
  return { tenantId, signature };
}

/**
 * Tenant this token authorizes, or null when it is not a valid derived token.
 *
 * Returning the tenant id (rather than a boolean against a caller-supplied
 * tenant) is what keeps the check honest: the caller cannot pass the tenant it
 * hopes the token names.
 */
export function verifyGitTenantToken(token: string, rootToken: string): string | null {
  if (!rootToken) return null;
  const parsed = parseGitTenantToken(token);
  if (!parsed) return null;
  const expected = deriveGitTenantToken(rootToken, parsed.tenantId);
  const provided = Buffer.from(token, 'utf8');
  const candidate = Buffer.from(expected, 'utf8');
  if (provided.byteLength !== candidate.byteLength) return null;
  return timingSafeEqual(provided, candidate) ? parsed.tenantId : null;
}
