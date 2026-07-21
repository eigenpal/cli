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

/** Grounding for a single field. Looked up by field path, e.g.
 * `_grounding.hourly_rate.confidence` or `_grounding.hourly_rate.source_span.start`. */
export interface FieldGrounding {
  /** high = verbatim in source, medium = fuzzy, low = ungrounded. */
  confidence: GroundingConfidence;
  /** True when the field tripped the review threshold (route to a human). */
  needsReview: boolean;
  /** Why it needs review (only set when needsReview). */
  reason?: string;
  /** Character span of the value in the source text, or null when ungrounded.
   * `start: -1` marks a normalized/fuzzy match with no usable offset. */
  source_span: { start: number; end: number; text: string; alignment: string } | null;
}

/**
 * `_grounding` is keyed by field name, so grounding is looked up by the same
 * path as the value: value at `output.hourly_rate`, its grounding at
 * `output._grounding.hourly_rate`. Only string/number scalar fields get an
 * entry — booleans, objects, and arrays have no verbatim source span and are
 * intentionally omitted.
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
