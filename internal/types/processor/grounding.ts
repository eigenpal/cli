/**
 * Grounding result types for ai.extract.
 *
 * Produced by the worker's grounding pass and consumed by the app's
 * execution-view grounding viewer, so they live in @eigenpal/types.
 * The semantics (what confidence means, reserved keys) are documented on
 * each type; the computation lives in
 * packages/worker/src/processors/ai/grounding.ts.
 */

export type GroundingConfidence = 'high' | 'medium' | 'low';

/** Spatial citation projected from shared OpenParser grounding (temporary `_grounding` contract). */
export interface FieldGroundingCitation {
  element_id: string;
  table_cell_id?: string;
  page_number: number;
  granularity: string;
  source_type?: string;
}

/** Grounding for a single scalar leaf. Looked up by dotted path, e.g.
 * `_grounding.hourly_rate.confidence` or `_grounding['line_items.0.amount']`. */
export interface FieldGrounding {
  /** high = verbatim in source, medium = fuzzy, low = ungrounded. Always categorical for existing UIs. */
  confidence: GroundingConfidence;
  /** Numeric 0–1 confidence when the producer supplied one. */
  score?: number;
  /** True when the field tripped the review threshold (route to a human). */
  needsReview: boolean;
  /** Why it needs review (only set when needsReview). */
  reason?: string;
  /** Character span of the value in the source text, or null when ungrounded.
   * `start: -1` marks a normalized/fuzzy match with no usable offset. */
  source_span: { start: number; end: number; text: string; alignment: string } | null;
  /** Verbatim source quote when the producer reported one. */
  quote?: string;
  /** Verified spatial citations (OpenParser evidence), when present. */
  citations?: FieldGroundingCitation[];
}

/**
 * `_grounding` is keyed by dotted field path (array indexes are decimal
 * segments), so grounding is looked up by the same path as the value: value at
 * `output.hourly_rate`, its grounding at `output._grounding.hourly_rate`;
 * nested `output.line_items[0].amount` at `_grounding['line_items.0.amount']`.
 * Every scalar leaf (string/number/boolean/null) may have an entry.
 * RFC 6901 pointers for human review are derived from these dotted keys.
 *
 * Reserved marker keys (same underscore convention as `_grounding` itself):
 * - `_degraded: true` — grounding ran without its LLM pass (model
 *   unavailable, zero extractions, or a runtime failure); per-field entries
 *   reflect only the deterministic direct-alignment signal.
 * - `_reason: string` — human-readable cause for the degradation.
 *
 * Absent `_grounding` means grounding was explicitly disabled
 * (`grounded: false`).
 */
export type GroundingResult = Record<string, FieldGrounding>;

/**
 * Deep-strip reserved `_grounding` maps from a value tree.
 *
 * Grounding is volatile provenance metadata (spans and confidence shift with
 * model drift), so anything that snapshots or compares run output as a value
 * — eval expected-output capture, LLM-judge payloads — should strip it first
 * and judge the VALUES only.
 */
export function stripGroundingMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripGroundingMetadata);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === '_grounding') continue;
      out[k] = stripGroundingMetadata(v);
    }
    return out;
  }
  return value;
}

/**
 * Convert an OpenParser dotted leaf path to an RFC 6901 JSON Pointer.
 * `line_items.0.amount` → `/line_items/0/amount`. A key that is already a
 * pointer (starts with `/`) is returned unchanged. Top-level `vendor` → `/vendor`.
 */
export function dottedPathToJsonPointer(path: string): string {
  if (path.startsWith('/')) return path;
  return `/${path
    .split('.')
    .map((segment) => segment.replaceAll('~', '~0').replaceAll('/', '~1'))
    .join('/')}`;
}

/**
 * Read a value at an OpenParser dotted path (`line_items.0.amount`).
 * Used by the grounding viewer so nested `_grounding` keys still resolve.
 */
export function valueAtDottedPath(root: unknown, path: string): unknown {
  if (!path) return root;
  let current: unknown = root;
  for (const segment of path.split('.')) {
    if (current == null) return undefined;
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0) return undefined;
      current = current[index];
      continue;
    }
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}
