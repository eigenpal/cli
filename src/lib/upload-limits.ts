import { env } from '../env';

/**
 * Default to Vercel's ~4.5 MiB function body limit. Self-hosted operators can
 * override this globally with EIGENPAL_MULTIPART_MAX_BYTES; `none` keeps every
 * file on the run's multipart request.
 */
export const DEFAULT_MULTIPART_MAX_BYTES = Math.floor(4.5 * 1024 * 1024);
/** @deprecated Use {@link DEFAULT_MULTIPART_MAX_BYTES}. */
export const DIRECT_UPLOAD_BYTE_THRESHOLD = DEFAULT_MULTIPART_MAX_BYTES;

/**
 * Conservative allowance for multipart boundaries, `target` / `input` /
 * `overrides` / `metadata` parts, and Content-Disposition headers.
 */
export const MULTIPART_ENVELOPE_HEADROOM_BYTES = 256 * 1024;

/** Max aggregate file-content bytes that may ride in one multipart run request. */
export function multipartFileByteBudget(
  multipartMaxBytes: number | null = multipartMaxBytesFromEnv()
): number | null {
  if (multipartMaxBytes === null) return null;
  return Math.max(0, multipartMaxBytes - MULTIPART_ENVELOPE_HEADROOM_BYTES);
}

/**
 * Choose which file indices must be pre-uploaded so remaining multipart file
 * bytes plus envelope headroom stay under {@link DIRECT_UPLOAD_BYTE_THRESHOLD}.
 *
 * Uses positional identity so repeated `--input-file field=...` values for the
 * same field are budgeted independently. Prefers shedding the largest files
 * first so smaller ones can stay on the single multipart round-trip when the
 * aggregate still fits.
 */
export function indicesRequiringPreUpload(
  files: ReadonlyArray<{ size: number }>,
  multipartMaxBytes: number | null = multipartMaxBytesFromEnv()
): Set<number> {
  const budget = multipartFileByteBudget(multipartMaxBytes);
  const toPreUpload = new Set<number>();
  if (budget === null) return toPreUpload;

  files.forEach((file, index) => {
    if (file.size > budget) {
      toPreUpload.add(index);
    }
  });

  let multipartTotal = 0;
  files.forEach((file, index) => {
    if (!toPreUpload.has(index)) multipartTotal += file.size;
  });

  const candidates = files
    .map((file, index) => ({ file, index }))
    .filter(({ index }) => !toPreUpload.has(index))
    .slice()
    .sort((a, b) => b.file.size - a.file.size || a.index - b.index);

  for (const { file, index } of candidates) {
    if (multipartTotal <= budget) break;
    toPreUpload.add(index);
    multipartTotal -= file.size;
  }

  return toPreUpload;
}

/**
 * @deprecated Prefer {@link indicesRequiringPreUpload}; field-name keys cannot
 * represent repeated values for the same field.
 */
export function keysRequiringPreUpload(
  files: ReadonlyArray<{ key: string; size: number }>,
  multipartMaxBytes: number | null = multipartMaxBytesFromEnv()
): Set<string> {
  const toPreUpload = indicesRequiringPreUpload(
    files.map((file) => ({ size: file.size })),
    multipartMaxBytes
  );
  const keys = new Set<string>();
  files.forEach((file, index) => {
    if (toPreUpload.has(index)) keys.add(file.key);
  });
  return keys;
}

export function multipartMaxBytesFromEnv(raw = env.EIGENPAL_MULTIPART_MAX_BYTES): number | null {
  if (raw == null || raw.trim() === '') return DEFAULT_MULTIPART_MAX_BYTES;
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'none' || normalized === 'null' || normalized === 'unlimited') return null;
  const parsed = Number(normalized);
  if (Number.isSafeInteger(parsed) && parsed >= 0) return parsed;
  throw new Error(
    'EIGENPAL_MULTIPART_MAX_BYTES must be a non-negative integer or one of: none, null, unlimited.'
  );
}
