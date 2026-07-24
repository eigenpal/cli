import { z } from 'zod';
import { JobIdSchema, OCR_JOB_ID_PATTERN } from './job-id';
import { ExtractionPipelineIdSchema } from './pipelines';

/**
 * Transition helpers for OpenParser public id cutover (Drizzle 0046).
 *
 * Preferred wire format is `opj_` / `oppl_`. During the expand window, request
 * paths and body fields also accept remapped legacy forms and normalize them to
 * the preferred prefix. Response / OpenAPI schemas stay strict preferred-only.
 */

/** Pre-0046 public job ids were UUID strings. */
export const LEGACY_OCR_JOB_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Deterministic 0046 mapping: `opj_` + lowercase hex (no dashes). */
export function migratedOcrJobIdFromUuid(uuid: string): string {
  return `opj_${uuid.toLowerCase().replace(/-/g, '')}`;
}

/**
 * Reverse of {@link migratedOcrJobIdFromUuid} for dual-read against still-live
 * old-writer UUID rows. Returns null for nanoid-shaped `opj_` ids.
 */
export function legacyUuidFromMigratedOcrJobId(jobId: string): string | null {
  const match = /^opj_([0-9a-f]{32})$/.exec(jobId);
  if (!match) return null;
  const hex = match[1]!;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Normalize a request job id: UUID → `opj_<hex>`; otherwise leave unchanged. */
export function normalizeOcrJobIdInput(id: string): string {
  const trimmed = id.trim();
  if (LEGACY_OCR_JOB_UUID_PATTERN.test(trimmed)) {
    return migratedOcrJobIdFromUuid(trimmed);
  }
  return trimmed;
}

/**
 * Lookup candidates for dual-read after 0046 remap + deferred CHECKs.
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

/**
 * Request-side job id: accepts legacy UUID, outputs preferred `opj_`.
 * Use string+transform (not preprocess) so OpenAPI `io: input` keeps
 * `required` and a plain string property; preferred pattern stays on
 * {@link JobIdSchema} response components.
 */
export const JobIdInputSchema = z
  .string()
  .max(128)
  .transform((value, ctx) => {
    const normalized = normalizeOcrJobIdInput(value);
    if (!OCR_JOB_ID_PATTERN.test(normalized)) {
      ctx.addIssue({
        code: 'custom',
        message: 'job id must be an opj_… id',
      });
      return z.NEVER;
    }
    return normalized as z.infer<typeof JobIdSchema>;
  });
export type JobIdInput = z.infer<typeof JobIdSchema>;

export function isOcrJobIdInput(id: string): boolean {
  return JobIdInputSchema.safeParse(id).success;
}

export function isPreferredOcrJobId(id: string): boolean {
  return OCR_JOB_ID_PATTERN.test(id);
}

/** Pre-0046 saved pipeline ids used `oep_`. */
export const LEGACY_OCR_PIPELINE_ID_PREFIX = 'oep_' as const;

/** Normalize a request pipeline id: `oep_<suffix>` → `oppl_<suffix>`. */
export function normalizeOcrPipelineIdInput(id: string): string {
  const trimmed = id.trim();
  if (trimmed.startsWith(LEGACY_OCR_PIPELINE_ID_PREFIX)) {
    return `oppl_${trimmed.slice(LEGACY_OCR_PIPELINE_ID_PREFIX.length)}`;
  }
  return trimmed;
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

/** Request-side pipeline id: accepts legacy `oep_`, outputs preferred `oppl_`. */
export const ExtractionPipelineIdInputSchema = z
  .string()
  .max(128)
  .transform((value, ctx) => {
    const normalized = normalizeOcrPipelineIdInput(value);
    const parsed = ExtractionPipelineIdSchema.safeParse(normalized);
    if (!parsed.success) {
      ctx.addIssue({
        code: 'custom',
        message: 'pipeline_id must be an oppl_… id',
      });
      return z.NEVER;
    }
    return parsed.data;
  });
export type ExtractionPipelineIdInput = z.infer<typeof ExtractionPipelineIdSchema>;
