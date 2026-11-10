/**
 * Default to Vercel's ~4.5 MiB function body limit. Operators with a different
 * ingress limit can override it; `null` keeps every run file on multipart.
 */
export const DEFAULT_MULTIPART_MAX_BYTES = Math.floor(4.5 * 1024 * 1024);

/**
 * Conservative allowance for multipart boundaries, `target` / `input` /
 * `overrides` / `metadata` parts, and Content-Disposition headers.
 */
export const MULTIPART_ENVELOPE_HEADROOM_BYTES = 256 * 1024;

/** Max aggregate file-content bytes that may ride in one multipart run request. */
export function multipartFileByteBudget(
  multipartMaxBytes: number | null = DEFAULT_MULTIPART_MAX_BYTES
): number | null {
  if (multipartMaxBytes === null) return null;
  return Math.max(0, multipartMaxBytes - MULTIPART_ENVELOPE_HEADROOM_BYTES);
}

/**
 * Choose which file positions must be pre-uploaded so remaining multipart file
 * bytes plus envelope headroom stay under the configured multipart maximum.
 *
 * Uses positional identity so repeated values for the same field (CLI
 * `--input-file field=...`) are budgeted independently. Prefers shedding the
 * largest files first so smaller ones can stay on the single multipart
 * round-trip when the aggregate still fits; ties go to the earlier position.
 */
export function indicesRequiringPreUpload(
  files: ReadonlyArray<{ size: number }>,
  multipartMaxBytes: number | null = DEFAULT_MULTIPART_MAX_BYTES
): Set<number> {
  const budget = multipartFileByteBudget(multipartMaxBytes);
  const toPreUpload = new Set<number>();
  if (budget === null) return toPreUpload;

  files.forEach((file, index) => {
    if (file.size > budget) toPreUpload.add(index);
  });

  let multipartTotal = 0;
  files.forEach((file, index) => {
    if (!toPreUpload.has(index)) multipartTotal += file.size;
  });

  const candidates = files
    .map((file, index) => ({ size: file.size, index }))
    .filter(({ index }) => !toPreUpload.has(index))
    .sort((a, b) => b.size - a.size || a.index - b.index);

  for (const { size, index } of candidates) {
    if (multipartTotal <= budget) break;
    toPreUpload.add(index);
    multipartTotal -= size;
  }

  return toPreUpload;
}

/**
 * Field-keyed variant of {@link indicesRequiringPreUpload} for inputs where
 * each key appears once. Ties between equal sizes go to the lexically first key.
 */
export function keysRequiringPreUpload(
  files: ReadonlyArray<{ key: string; size: number }>,
  multipartMaxBytes: number | null = DEFAULT_MULTIPART_MAX_BYTES
): Set<string> {
  const ordered = files.slice().sort((a, b) => a.key.localeCompare(b.key));
  const indices = indicesRequiringPreUpload(ordered, multipartMaxBytes);
  return new Set([...indices].map((index) => ordered[index]!.key));
}
