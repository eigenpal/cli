/**
 * Eigenpal-private OCR id dual-read helpers for DB lookup during cutover.
 *
 * Public request normalize / InputSchema live in `@openparser/schema`.
 * These reverse maps + candidate lists are storage-layer only.
 */

import {
  LEGACY_OCR_PIPELINE_ID_PREFIX,
  normalizeOcrJobIdInput,
  normalizeOcrPipelineIdInput,
} from '@openparser/schema';

/**
 * Reverse of `migratedOcrJobIdFromUuid` for dual-read against still-live
 * old-writer UUID rows. Returns null for nanoid-shaped `opj_` ids.
 */
export function legacyUuidFromMigratedOcrJobId(jobId: string): string | null {
  const match = /^opj_([0-9a-f]{32})$/.exec(jobId);
  if (!match) return null;
  const hex = match[1]!;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Lookup candidates for dual-read after id remap + deferred CHECKs.
 * Covers preferred `opj_`, remapped UUID→`opj_`, and residual UUID rows.
 */
export function ocrJobIdLookupCandidates(id: string): string[] {
  const trimmed = id.trim();
  const canonical = normalizeOcrJobIdInput(trimmed);
  const out = new Set<string>();
  if (trimmed.length > 0) out.add(trimmed);
  if (canonical.length > 0) out.add(canonical);
  const legacy = legacyUuidFromMigratedOcrJobId(canonical);
  if (legacy) out.add(legacy);
  return [...out];
}

/** Reverse preferred→legacy for dual-read against residual `oep_` rows. */
export function legacyOepFromMigratedOcrPipelineId(pipelineId: string): string | null {
  if (!pipelineId.startsWith('oppl_')) return null;
  return `${LEGACY_OCR_PIPELINE_ID_PREFIX}${pipelineId.slice('oppl_'.length)}`;
}

export function ocrPipelineIdLookupCandidates(id: string): string[] {
  const trimmed = id.trim();
  const canonical = normalizeOcrPipelineIdInput(trimmed);
  const out = new Set<string>();
  if (trimmed.length > 0) out.add(trimmed);
  if (canonical.length > 0) out.add(canonical);
  const legacy = legacyOepFromMigratedOcrPipelineId(canonical);
  if (legacy) out.add(legacy);
  return [...out];
}
