/**
 * Resolve a workflow argument that the user typed at the CLI to a concrete
 * server-side workflow id.
 *
 * Every command that takes `<workflow-id>` accepts two forms:
 *   1. A `wf_…` id   — opaque, server-generated, stable across renames.
 *                      The form to use in scripts and CI.
 *   2. A slug        — the workflow YAML's `name:` field. Constrained to
 *                      `[a-z0-9][a-z0-9_-]*` (URL-safe, shell-safe).
 *
 * The shape is auto-detected by the `wf_` prefix.
 *
 * Usage:
 *
 *   const workflowId = await resolveWorkflowId(client, idOrSlug);
 *   await client.post('/api/v1/runs', runStartJsonBody(`workflows.${workflowId}`, input));
 */

import type { ApiClient } from './client';

interface WorkflowSummary {
  id: string;
  name?: string | null;
}

interface WorkflowListEnvelope {
  data: WorkflowSummary[];
}

const WORKFLOW_ID_PREFIX = 'wf_';

/** True iff the string begins with the canonical workflow-id prefix. */
function looksLikeWorkflowId(value: string): boolean {
  return value.startsWith(WORKFLOW_ID_PREFIX);
}

/**
 * Levenshtein distance, capped at `maxDistance` so we bail out of long
 * comparisons quickly. Used purely for the "did you mean" hint — small
 * inputs (workflow slugs ≤ 64 chars), happy-path-free callers.
 */
function levenshtein(a: string, b: string, maxDistance: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;
  if (a.length === 0 || b.length === 0) return a.length || b.length;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let minRow = curr[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < minRow) minRow = curr[j];
    }
    if (minRow > maxDistance) return maxDistance + 1;
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

/**
 * Best-effort "did you mean?" suggestion for a slug that didn't match.
 * Pages through `?search=<slug>` (server does substring + slug search) and
 * returns the closest name by Levenshtein distance, capped at 2 edits. One
 * extra round-trip on the unhappy path; no cost on the happy path.
 *
 * Returns null if no candidate is within range.
 */
async function findSimilarSlug(client: ApiClient, slug: string): Promise<string | null> {
  try {
    const res = (await client.get('/api/v1/workflows', {
      search: slug,
      limit: '20',
    })) as WorkflowListEnvelope;
    const candidates = (res.data ?? [])
      .map((w) => w.name)
      .filter((n): n is string => typeof n === 'string' && n.length > 0);
    let best: { name: string; distance: number } | null = null;
    for (const candidate of candidates) {
      const distance = levenshtein(candidate, slug, 2);
      if (distance <= 2 && (best === null || distance < best.distance)) {
        best = { name: candidate, distance };
      }
    }
    return best?.name ?? null;
  } catch {
    // Search is a UX nicety — if it fails, just don't suggest.
    return null;
  }
}

function notFound(idOrSlug: string, suggestion: string | null): Error {
  // Same wording for both id-not-found and slug-not-found — from the user's
  // POV the resolution failed; the fix is the same: push or pick a real one.
  const base = `Workflow "${idOrSlug}" not found on the server.`;
  const action = "Push it first, or run `eigenpal workflow list` to see what's available.";
  return new Error(
    suggestion ? `${base} Did you mean "${suggestion}"? ${action}` : `${base} ${action}`
  );
}

/**
 * Resolve `<workflow-id>` → server-side workflow id. Throws actionably when
 * the workflow has not been pushed; on a slug miss, attempts a "did you
 * mean?" hint via fuzzy search.
 */
export async function resolveWorkflowId(client: ApiClient, idOrSlug: string): Promise<string> {
  if (looksLikeWorkflowId(idOrSlug)) {
    try {
      const wf = (await client.get(`/api/v1/workflows/${idOrSlug}`)) as WorkflowSummary;
      return wf.id;
    } catch {
      // Don't fuzzy-search ids — `wf_` ids are opaque, no useful neighbors.
      throw notFound(idOrSlug, null);
    }
  }
  // Slug path: `?name=` is an exact match against `definition.name`. Empty
  // data array means no workflow has that slug.
  const res = (await client.get('/api/v1/workflows', { name: idOrSlug })) as WorkflowListEnvelope;
  const match = res.data?.[0];
  if (!match) {
    const suggestion = await findSimilarSlug(client, idOrSlug);
    throw notFound(idOrSlug, suggestion);
  }
  return match.id;
}
