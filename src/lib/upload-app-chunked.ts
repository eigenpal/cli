/**
 * Client protocol for `http-chunked` file uploads.
 *
 * Sequential PUTs of byte ranges, then POST complete. Resume listing is not
 * implemented — a retry re-sends from chunk 0. The server accepts idempotent
 * overwrite of an already-staged index.
 */
import { isTransientHttpStatus } from './upload-presigned-multipart';

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

function isRetryableChunkError(error: unknown): boolean {
  if (error instanceof ChunkUploadHttpError) return isTransientHttpStatus(error.status);
  return true;
}

export async function uploadHttpChunks(options: {
  chunkCount: number;
  chunkSizeBytes: number;
  totalSize: number;
  putChunk: (args: { chunkIndex: number; start: number; length: number }) => Promise<void>;
}): Promise<void> {
  for (let chunkIndex = 0; chunkIndex < options.chunkCount; chunkIndex++) {
    const length = expectedHttpChunkByteLength(
      options.totalSize,
      options.chunkSizeBytes,
      chunkIndex,
      options.chunkCount
    );
    const start = chunkByteOffset(options.chunkSizeBytes, chunkIndex);
    let lastError: unknown;
    for (let attempt = 0; attempt <= HTTP_CHUNKED_MAX_RETRIES; attempt++) {
      try {
        await options.putChunk({ chunkIndex, start, length });
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
        if (!isRetryableChunkError(error) || attempt === HTTP_CHUNKED_MAX_RETRIES) {
          throw error;
        }
        await sleep(HTTP_CHUNKED_RETRY_BASE_MS * 2 ** attempt);
      }
    }
    if (lastError) throw lastError;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
