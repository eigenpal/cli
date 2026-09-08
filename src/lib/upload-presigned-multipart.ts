/**
 * Client protocol for `presigned-multipart` file uploads.
 * Part math matches the server session; ETags are never trusted locally.
 */

export const MULTIPART_UPLOAD_CONCURRENCY = 4;
export const MULTIPART_PART_MAX_RETRIES = 4;
export const MULTIPART_PART_RETRY_BASE_MS = 250;

export type ListedUploadPart = {
  partNumber: number;
  size?: number;
  etag: string;
};

export type PresignedUploadPart = {
  url: string;
  headers?: Record<string, string>;
  partSizeBytes: number;
};

export function expectedPartByteLength(
  totalSize: number,
  partSizeBytes: number,
  partNumber: number,
  partCount: number
): number {
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > partCount) {
    throw new Error(`partNumber must be an integer in [1, ${partCount}]`);
  }
  if (totalSize === 0) return 0;
  if (partNumber < partCount) return partSizeBytes;
  const remainder = totalSize % partSizeBytes;
  return remainder === 0 ? partSizeBytes : remainder;
}

export function partByteOffset(partSizeBytes: number, partNumber: number): number {
  return (partNumber - 1) * partSizeBytes;
}

export function isTransientHttpStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

export function filterStorageHeaders(
  headers: Record<string, string> | undefined,
  stripContentLength: boolean
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers ?? {}).filter(([name]) =>
      stripContentLength ? name.toLowerCase() !== 'content-length' : true
    )
  );
}

export function partIsAuthoritativelyComplete(
  listed: ReadonlyArray<ListedUploadPart>,
  partNumber: number,
  expectedSize: number
): boolean {
  const found = listed.find((part) => part.partNumber === partNumber);
  if (!found) return false;
  // Server complete rejects missing sizes. Treat them as incomplete so resume
  // re-uploads instead of skipping a part the API cannot finalize.
  return found.size === expectedSize;
}

export class PartUploadHttpError extends Error {
  constructor(readonly status: number) {
    super(`Storage part upload failed (${status})`);
    this.name = 'PartUploadHttpError';
  }
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === 'AbortError') ||
    (typeof DOMException !== 'undefined' &&
      error instanceof DOMException &&
      error.name === 'AbortError')
  );
}

/**
 * Abort leftover MPU state only while parts are not yet authoritative.
 *
 * After ListParts shows every expected part, POST complete is idempotent.
 * 409/429/timeout/lost responses must not abort — that would delete GiB of
 * uploaded parts and can race a complete that already succeeded server-side.
 * Caller cancellation and unrecoverable part PUT/API failures still abort
 * because `partsReady` is false in those cases.
 */
export function shouldAbortMultipartUploadSession(options: { partsReady: boolean }): boolean {
  return !options.partsReady;
}

export function multipartCompleteRetryHint(uploadId: string): string {
  return `Uploaded parts remain stored for ${uploadId}; retry complete and do not abort the session.`;
}

export function annotateMultipartCompleteFailure(uploadId: string, error: unknown): unknown {
  const hint = multipartCompleteRetryHint(uploadId);
  if (error instanceof Error) {
    if (!error.message.includes('retry complete')) {
      error.message = `${error.message} ${hint}`;
    }
    return error;
  }
  return new Error(`${String(error)} ${hint}`);
}

export function isRetryablePartError(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return false;
  if (isAbortError(error)) return false;
  if (error instanceof PartUploadHttpError) return isTransientHttpStatus(error.status);
  return true;
}

export async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw abortError(signal);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError(signal));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function abortError(signal?: AbortSignal): Error {
  if (signal?.reason instanceof Error) return signal.reason;
  return typeof DOMException !== 'undefined'
    ? new DOMException('Upload aborted', 'AbortError')
    : Object.assign(new Error('Upload aborted'), { name: 'AbortError' });
}

export async function mapPool<T>(
  items: readonly T[],
  concurrency: number,
  signal: AbortSignal | undefined,
  worker: (item: T) => Promise<void>
): Promise<void> {
  if (items.length === 0) return;
  let cursor = 0;
  let firstError: unknown;
  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
      while (firstError == null) {
        if (signal?.aborted) throw abortError(signal);
        const index = cursor++;
        if (index >= items.length) return;
        try {
          await worker(items[index]!);
        } catch (error) {
          firstError ??= error;
        }
      }
    })
  );
  if (firstError) throw firstError;
}

export async function uploadPresignedMultipartParts(options: {
  partCount: number;
  partSizeBytes: number;
  totalSize: number;
  signal?: AbortSignal;
  concurrency?: number;
  onProgress?: (uploadedBytes: number, totalBytes: number) => void;
  listParts: () => Promise<ReadonlyArray<ListedUploadPart>>;
  presignPart: (partNumber: number) => Promise<PresignedUploadPart>;
  putPart: (args: {
    url: string;
    headers: Record<string, string>;
    partNumber: number;
    start: number;
    length: number;
  }) => Promise<void>;
}): Promise<void> {
  const concurrency = options.concurrency ?? MULTIPART_UPLOAD_CONCURRENCY;
  let uploadedBytes = 0;
  const credited = new Set<number>();

  const credit = (partNumber: number, length: number) => {
    if (credited.has(partNumber)) return;
    credited.add(partNumber);
    uploadedBytes += length;
    options.onProgress?.(uploadedBytes, options.totalSize);
  };

  const pendingPartNumbers = async (): Promise<number[]> => {
    const listed = await options.listParts();
    const pending: number[] = [];
    for (let partNumber = 1; partNumber <= options.partCount; partNumber++) {
      const length = expectedPartByteLength(
        options.totalSize,
        options.partSizeBytes,
        partNumber,
        options.partCount
      );
      if (partIsAuthoritativelyComplete(listed, partNumber, length)) {
        credit(partNumber, length);
        continue;
      }
      pending.push(partNumber);
    }
    return pending;
  };

  const uploadOne = async (partNumber: number): Promise<void> => {
    const length = expectedPartByteLength(
      options.totalSize,
      options.partSizeBytes,
      partNumber,
      options.partCount
    );
    const start = partByteOffset(options.partSizeBytes, partNumber);
    let lastError: unknown;
    for (let attempt = 0; attempt <= MULTIPART_PART_MAX_RETRIES; attempt++) {
      if (options.signal?.aborted) throw abortError(options.signal);
      try {
        const signed = await options.presignPart(partNumber);
        const partLength = Number.isInteger(signed.partSizeBytes) ? signed.partSizeBytes : length;
        await options.putPart({
          url: signed.url,
          headers: signed.headers ?? {},
          partNumber,
          start,
          length: partLength,
        });
        credit(partNumber, length);
        return;
      } catch (error) {
        lastError = error;
        if (
          !isRetryablePartError(error, options.signal) ||
          attempt === MULTIPART_PART_MAX_RETRIES
        ) {
          throw error;
        }
        await sleep(MULTIPART_PART_RETRY_BASE_MS * 2 ** attempt, options.signal);
      }
    }
    throw lastError;
  };

  let pending = await pendingPartNumbers();
  if (pending.length > 0) {
    await mapPool(pending, concurrency, options.signal, uploadOne);
  }
  pending = await pendingPartNumbers();
  if (pending.length > 0) {
    await mapPool(pending, concurrency, options.signal, uploadOne);
    pending = await pendingPartNumbers();
  }
  if (pending.length > 0) {
    throw new Error(
      `Upload incomplete: ${pending.length} part(s) missing from storage before complete`
    );
  }
}
