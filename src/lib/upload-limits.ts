import {
  DEFAULT_MULTIPART_MAX_BYTES,
  indicesRequiringPreUpload as sdkIndicesRequiringPreUpload,
  multipartFileByteBudget as sdkMultipartFileByteBudget,
} from '@eigenpal/sdk/upload';
import { env } from '../env';

/**
 * CLI wrappers over the canonical `@eigenpal/sdk/upload` budget helpers.
 * The only CLI-specific part is the default: self-hosted operators can
 * override the body limit globally with EIGENPAL_MULTIPART_MAX_BYTES, and
 * `none` keeps every file on the run's multipart request.
 */

/** Max aggregate file-content bytes that may ride in one multipart run request. */
export function multipartFileByteBudget(
  multipartMaxBytes: number | null = multipartMaxBytesFromEnv()
): number | null {
  return sdkMultipartFileByteBudget(multipartMaxBytes);
}

/** Positional pre-upload selection; see the SDK's `indicesRequiringPreUpload`. */
export function indicesRequiringPreUpload(
  files: ReadonlyArray<{ size: number }>,
  multipartMaxBytes: number | null = multipartMaxBytesFromEnv()
): Set<number> {
  return sdkIndicesRequiringPreUpload(files, multipartMaxBytes);
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
