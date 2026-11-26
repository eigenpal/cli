import valid from 'semver/functions/valid';
import maxSatisfying from 'semver/ranges/max-satisfying';

/**
 * Workflow version selectors: what a caller (API run, rerun, CLI,
 * invoke-workflow step) names when it picks a workflow version.
 *
 * - `latest`: the workflow's current version (HEAD). Every save made current
 *   goes live for these callers immediately, tagged or not.
 * - exact `X.Y.Z`: that tag, and only that tag.
 * - range: the highest released tag that satisfies it (npm semantics):
 *   `1` / `1.2` (prefixes), `1.x` / `1.2.x` / `1.*` / `1.2.*` (x-ranges),
 *   `^1` / `^1.2` / `^1.2.3` (caret), `~1.2` / `~1.2.3` (tilde). A
 *   prerelease tag only matches when the range itself names a prerelease of
 *   the same `X.Y.Z` (`^1.3.0-rc.1`).
 * - id: a `wfv_` / `wfh_` / `version_` history id, exactly that row.
 *
 * Comparator sets (`>=1 <2`), unions (`||`) and hyphen ranges are not part
 * of the grammar: they rarely help a caller and are easy to get wrong in a
 * URL. This module is pure; DB resolution lives in `@eigenpal/db`
 * (`resolveWorkflowVersionSelector`).
 */

const NUM = '(?:0|[1-9][0-9]*)';
const PRERELEASE = '(?:-[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)';

/** Exact release tag. Kept identical to the historic run grammar. */
export const WORKFLOW_VERSION_EXACT_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+$/;

/** Every range form the grammar accepts (see module docs). */
export const WORKFLOW_VERSION_RANGE_PATTERN = new RegExp(
  [
    // 1, 1.2
    `^${NUM}(?:\\.${NUM})?$`,
    // 1.x, 1.*, 1.2.x, 1.2.*
    `^${NUM}(?:\\.${NUM})?\\.[x*]$`,
    // ^1, ^1.2, ^1.2.3, ^1.2.3-rc.1, and the same with ~
    `^[\\^~]${NUM}(?:\\.${NUM}(?:\\.${NUM}${PRERELEASE}?)?)?$`,
  ].join('|')
);

const WORKFLOW_VERSION_ID_PREFIXES = ['wfv_', 'wfh_', 'version_'] as const;

export type WorkflowVersionSelectorKind = 'latest' | 'exact' | 'range' | 'id';

export type WorkflowVersionSelector =
  | { kind: 'latest' }
  | { kind: 'exact'; version: string }
  | { kind: 'range'; range: string }
  | { kind: 'id'; id: string };

export const WORKFLOW_VERSION_SELECTOR_HINT =
  'Use latest, an exact version (1.2.3), a range (1, 1.2, 1.x, 1.2.x, ^1.2.3, ~1.2.3), or a workflow version id (wfv_..., wfh_...)';

export function isWorkflowVersionRange(value: string): boolean {
  return WORKFLOW_VERSION_RANGE_PATTERN.test(value);
}

/**
 * Classify a selector string, or return null when it is not valid grammar.
 * Exact `X.Y.Z` wins over the range pattern, so `1.2.3` keeps exact matching.
 */
export function parseWorkflowVersionSelector(raw: string): WorkflowVersionSelector | null {
  const value = raw.trim();
  if (value === 'latest') return { kind: 'latest' };
  if (WORKFLOW_VERSION_EXACT_PATTERN.test(value)) return { kind: 'exact', version: value };
  if (WORKFLOW_VERSION_RANGE_PATTERN.test(value)) return { kind: 'range', range: value };
  if (WORKFLOW_VERSION_ID_PREFIXES.some((prefix) => value.startsWith(prefix))) {
    return { kind: 'id', id: value };
  }
  return null;
}

/**
 * A tag counts for range matching only when it is a canonical semver string
 * (`1.2.3` or `1.2.3-rc.1`). Legacy labels such as `v25` or `v1.2.3` never
 * satisfy a range; they stay reachable by exact lookup.
 */
function isCanonicalSemverTag(tag: string): boolean {
  return valid(tag) === tag;
}

/**
 * Highest tag in `tags` that satisfies `range`, or null. The caller decides
 * which tags are eligible (see the released-only rule in `@eigenpal/db`);
 * this only does the semver math, through the `semver` package.
 */
export function maxSatisfyingWorkflowVersion(
  tags: readonly string[],
  range: string
): string | null {
  if (!isWorkflowVersionRange(range)) return null;
  const candidates = tags.filter(isCanonicalSemverTag);
  return maxSatisfying(candidates, range);
}
