/**
 * Client protocol for `http-chunked` file uploads.
 *
 * Sequential PUTs of byte ranges, then POST complete. Resume listing is not
 * implemented — a retry re-sends from chunk 0. The server accepts idempotent
 * overwrite of an already-staged index.
 */
import { isAbortError, isTransientHttpStatus, sleep } from './upload-presigned-multipart';

export const HTTP_CHUNKED_MAX_RETRIES = 4;
export const HTTP_CHUNKED_RETRY_BASE_MS = 250;

export type HttpChunkedSession = {
  transport: 'http-chunked';
  uploadId: string;
  fileId: string;
  chunkSizeBytes: number;
  chunkCount: number;
  chunksUrl: string;
  completeUrl: string;
  expiresAt: string;
  maxFileSizeBytes: number;
};

export function expectedHttpChunkByteLength(
  totalSize: number,
  chunkSizeBytes: number,
  chunkIndex: number,
  chunkCount: number
): number {
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= chunkCount) {
    throw new Error(`chunkIndex must be an integer in [0, ${chunkCount})`);
  }
  if (totalSize === 0) return 0;
  if (chunkIndex < chunkCount - 1) return chunkSizeBytes;
  const remainder = totalSize % chunkSizeBytes;
  return remainder === 0 ? chunkSizeBytes : remainder;
}

export function chunkByteOffset(chunkSizeBytes: number, chunkIndex: number): number {
  return chunkIndex * chunkSizeBytes;
}

export function shouldAbortHttpChunkedUploadSession(options: { chunksReady: boolean }): boolean {
  return !options.chunksReady;
}

export function httpChunkedCompleteRetryHint(uploadId: string): string {
  return `Uploaded chunks remain stored for ${uploadId}; retry complete and do not abort the session.`;
}

export function annotateHttpChunkedCompleteFailure(uploadId: string, error: unknown): unknown {
  const hint = httpChunkedCompleteRetryHint(uploadId);
  if (error instanceof Error) {
    if (!error.message.includes('retry complete')) {
      error.message = `${error.message} ${hint}`;
    }
    return error;
  }
  return new Error(`${String(error)} ${hint}`);
}

export class ChunkUploadHttpError extends Error {
  constructor(readonly status: number) {
    super(`Chunk upload failed (${status})`);
    this.name = 'ChunkUploadHttpError';
  }
}

function isRetryableChunkError(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return false;
  if (isAbortError(error)) return false;
  if (error instanceof ChunkUploadHttpError) return isTransientHttpStatus(error.status);
  return true;
}

function abortError(signal?: AbortSignal): Error {
  if (signal?.reason instanceof Error) return signal.reason;
  return typeof DOMException !== 'undefined'
    ? new DOMException('Upload aborted', 'AbortError')
    : Object.assign(new Error('Upload aborted'), { name: 'AbortError' });
}

export async function uploadHttpChunks(options: {
  chunkCount: number;
  chunkSizeBytes: number;
  totalSize: number;
  signal?: AbortSignal;
  onProgress?: (uploadedBytes: number, totalBytes: number) => void;
  putChunk: (args: { chunkIndex: number; start: number; length: number }) => Promise<void>;
}): Promise<void> {
  let uploadedBytes = 0;
  for (let chunkIndex = 0; chunkIndex < options.chunkCount; chunkIndex++) {
    if (options.signal?.aborted) throw abortError(options.signal);
    const length = expectedHttpChunkByteLength(
      options.totalSize,
      options.chunkSizeBytes,
      chunkIndex,
      options.chunkCount
    );
    const start = chunkByteOffset(options.chunkSizeBytes, chunkIndex);
    let lastError: unknown;
    for (let attempt = 0; attempt <= HTTP_CHUNKED_MAX_RETRIES; attempt++) {
      if (options.signal?.aborted) throw abortError(options.signal);
      try {
        await options.putChunk({ chunkIndex, start, length });
        uploadedBytes += length;
        options.onProgress?.(uploadedBytes, options.totalSize);
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
        if (!isRetryableChunkError(error, options.signal) || attempt === HTTP_CHUNKED_MAX_RETRIES) {
          throw error;
        }
        await sleep(HTTP_CHUNKED_RETRY_BASE_MS * 2 ** attempt, options.signal);
      }
    }
    if (lastError) throw lastError;
  }
}
