import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { apiPath } from './api-paths';
import type { ApiClient } from './client';
import { isNodeReadableStream, toPutBody, type StreamableRequestInit } from './fetch-body';
import { guessMimeType } from './fs-helpers';
import {
  annotateMultipartCompleteFailure,
  filterStorageHeaders,
  PartUploadHttpError,
  shouldAbortMultipartUploadSession,
  uploadPresignedMultipartParts,
  type ListedUploadPart,
} from './upload-presigned-multipart';

/** Tenant-scoped create-session idempotency key (matches SDK/Studio). */
export function newIdempotencyKey(): string {
  return randomUUID();
}

type UploadNegotiation =
  | {
      transport: 'presigned-put';
      uploadId: string;
      fileId: string;
      url: string;
      headers?: Record<string, string>;
      expiresAt: string;
      maxFileSizeBytes: number;
    }
  | {
      transport: 'presigned-multipart';
      uploadId: string;
      fileId: string;
      partSizeBytes: number;
      partCount: number;
      partsUrl: string;
      completeUrl: string;
      expiresAt: string;
      maxFileSizeBytes: number;
    }
  | {
      transport: 'multipart';
      url: string;
      maxFileSizeBytes: number;
    };

export type ReusableFileUploadResult = {
  id: string;
  filename: string;
  contentType?: string | null;
  size?: number | null;
  purpose?: string | null;
  createdAt?: string;
};

export type ReusableFileUploadInput = {
  filename: string;
  mimeType?: string;
  purpose?: 'run-input';
  idempotencyKey?: string;
} & ({ content: Buffer; filePath?: never } | { filePath: string; content?: never });

type ResolvedUploadSource =
  | { kind: 'buffer'; content: Buffer; size: number; filename: string; contentType: string }
  | { kind: 'path'; filePath: string; size: number; filename: string; contentType: string };

/**
 * Upload one file through the Files API, negotiating storage-direct when
 * available. Pass `purpose: 'run-input'` for CLI/SDK run pre-uploads so the
 * server can consume the pool object after run-input materialization.
 *
 * Disk paths use `fs.stat` plus range streams so large files stay bounded by
 * part size. The Buffer overload remains for tests and small programmatic callers.
 */
export async function uploadReusableFile(
  client: ApiClient,
  input: ReusableFileUploadInput
): Promise<ReusableFileUploadResult> {
  const source = await resolveUploadSource(input);
  const idempotencyKey = input.idempotencyKey ?? newIdempotencyKey();
  const negotiation = (await client.post(apiPath('/files/uploads'), {
    filename: source.filename,
    contentType: source.contentType,
    size: source.size,
    idempotencyKey,
    ...(input.purpose ? { purpose: input.purpose } : {}),
  })) as UploadNegotiation;

  if (source.size > negotiation.maxFileSizeBytes) {
    throw new Error(
      `File too large. Maximum size: ${Math.floor(negotiation.maxFileSizeBytes / (1024 * 1024))}MB`
    );
  }

  if (negotiation.transport === 'multipart') {
    const bytes = source.kind === 'buffer' ? source.content : await readWholeFile(source.filePath);
    const form = new FormData();
    form.append(
      'file',
      new Blob([bytes as BlobPart], { type: source.contentType }),
      source.filename
    );
    if (input.purpose) form.append('purpose', input.purpose);
    return (await client.postFormData(apiPath(negotiation.url), form)) as ReusableFileUploadResult;
  }

  if (negotiation.transport === 'presigned-multipart') {
    return uploadPresignedMultipart(client, source, negotiation);
  }

  let putReady = false;
  try {
    const putBody =
      source.kind === 'buffer'
        ? toPutBody(new Uint8Array(source.content))
        : toPutBody(createReadStream(source.filePath));
    const putResponse = await putStorageObject(negotiation.url, negotiation.headers, putBody, {
      stream: source.kind === 'path',
      expectedByteLength: source.size,
    });
    if (!putResponse.ok) {
      throw new Error(`Storage upload failed (${putResponse.status}); retry the upload`);
    }
    putReady = true;
  } catch (error) {
    if (shouldAbortPresignedPutUploadSession({ putReady })) {
      await client.delete(apiPath(`/files/uploads/${negotiation.uploadId}`)).catch(() => undefined);
    }
    throw error;
  }

  try {
    return (await client.post(
      apiPath(`/files/uploads/${negotiation.uploadId}/complete`),
      {}
    )) as ReusableFileUploadResult;
  } catch (error) {
    throw annotatePresignedPutCompleteFailure(negotiation.uploadId, error);
  }
}

async function resolveUploadSource(input: ReusableFileUploadInput): Promise<ResolvedUploadSource> {
  const contentType = input.mimeType || guessMimeType(input.filename) || 'application/octet-stream';
  if ('filePath' in input && input.filePath) {
    const info = await stat(input.filePath);
    if (!info.isFile()) {
      throw new Error(`Upload path is not a file: ${input.filePath}`);
    }
    return {
      kind: 'path',
      filePath: input.filePath,
      size: info.size,
      filename: input.filename || path.basename(input.filePath),
      contentType,
    };
  }
  if (!('content' in input) || input.content === undefined) {
    throw new Error('Upload requires either content or filePath');
  }
  return {
    kind: 'buffer',
    content: input.content,
    size: input.content.byteLength,
    filename: input.filename,
    contentType,
  };
}

async function uploadPresignedMultipart(
  client: ApiClient,
  source: ResolvedUploadSource,
  session: Extract<UploadNegotiation, { transport: 'presigned-multipart' }>
): Promise<ReusableFileUploadResult> {
  const partsPath = apiPath(session.partsUrl);
  const completePath = apiPath(session.completeUrl);
  let partsReady = false;
  try {
    await uploadPresignedMultipartParts({
      partCount: session.partCount,
      partSizeBytes: session.partSizeBytes,
      totalSize: source.size,
      listParts: async () => {
        const body = (await client.get(partsPath)) as { parts?: ListedUploadPart[] };
        return body.parts ?? [];
      },
      presignPart: async (partNumber) => {
        return (await client.post(partsPath, { partNumber })) as {
          url: string;
          headers?: Record<string, string>;
          partSizeBytes: number;
        };
      },
      putPart: async ({ url, headers, start, length }) => {
        const body =
          source.kind === 'buffer'
            ? toPutBody(source.content.subarray(start, start + length))
            : length === 0
              ? toPutBody(new Uint8Array())
              : toPutBody(createReadStream(source.filePath, { start, end: start + length - 1 }));
        const response = await putStorageObject(url, headers, body, {
          stream: source.kind === 'path' && length > 0,
          expectedByteLength: length,
        });
        if (!response.ok) throw new PartUploadHttpError(response.status);
      },
    });
    partsReady = true;
    return (await client.post(completePath, {})) as ReusableFileUploadResult;
  } catch (error) {
    if (shouldAbortMultipartUploadSession({ partsReady })) {
      await client.delete(apiPath(`/files/uploads/${session.uploadId}`)).catch(() => undefined);
      throw error;
    }
    throw annotateMultipartCompleteFailure(session.uploadId, error);
  }
}

type NodeReadableState = NodeJS.ReadableStream & {
  readableEnded?: boolean;
  destroyed?: boolean;
  destroy?: (error?: Error) => void;
};

/** Drop a Node readable that never started sending (fetch failed before upload). */
function destroyUnreadNodeReadable(stream: NodeJS.ReadableStream): void {
  const readable = stream as NodeReadableState;
  if (!readable.readableEnded && !readable.destroyed && typeof readable.destroy === 'function') {
    readable.destroy();
  }
}

/**
 * Block until every byte of a Node readable PUT body has been consumed.
 * Real fetch/undici should drain the stream before resolving; mocks that
 * return early leave bytes unread and must be drained here so callers do
 * not destroy the stream while a retry or background upload is still running.
 */
async function ensureNodeReadableFullySent(
  stream: NodeJS.ReadableStream,
  expectedByteLength?: number
): Promise<number> {
  const readable = stream as NodeReadableState;
  if (readable.readableEnded) {
    return expectedByteLength ?? 0;
  }
  if (readable.destroyed) {
    throw new Error('Upload stream was destroyed before the request body finished sending');
  }

  let bytes = 0;
  for await (const chunk of stream as AsyncIterable<Buffer | Uint8Array | string>) {
    bytes += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length;
  }
  if (expectedByteLength !== undefined && bytes !== expectedByteLength) {
    throw new Error(
      `Upload sent ${bytes} byte(s) but ${expectedByteLength} were expected for this part`
    );
  }
  return bytes;
}

/**
 * Abort leftover presigned-PUT state only while storage PUT is not yet authoritative.
 *
 * After a successful storage PUT, POST complete is idempotent. 409/429/timeout/lost
 * responses must not abort — that would delete a recoverable up-to-4-GiB object and
 * can race a complete that already succeeded server-side.
 */
export function shouldAbortPresignedPutUploadSession(options: { putReady: boolean }): boolean {
  return !options.putReady;
}

export function presignedPutCompleteRetryHint(uploadId: string): string {
  return `Uploaded object remains stored for ${uploadId}; retry complete and do not abort the session.`;
}

export function annotatePresignedPutCompleteFailure(uploadId: string, error: unknown): unknown {
  const hint = presignedPutCompleteRetryHint(uploadId);
  if (error instanceof Error) {
    if (!error.message.includes('retry complete')) {
      error.message = `${error.message} ${hint}`;
    }
    return error;
  }
  return new Error(`${String(error)} ${hint}`);
}

async function putStorageObject(
  url: string,
  headers: Record<string, string> | undefined,
  body: BodyInit,
  options: { stream: boolean; expectedByteLength?: number }
): Promise<Response> {
  const stream = options.stream && isNodeReadableStream(body);
  const init: StreamableRequestInit = {
    method: 'PUT',
    headers: filterStorageHeaders(headers, !stream),
    body,
    ...(stream ? { duplex: 'half' as const } : {}),
  };
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    if (stream) destroyUnreadNodeReadable(body as NodeJS.ReadableStream);
    throw error;
  }
  if (stream) {
    await ensureNodeReadableFullySent(body as NodeJS.ReadableStream, options.expectedByteLength);
  }
  return response;
}

async function readWholeFile(filePath: string): Promise<Buffer> {
  const { readFile } = await import('node:fs/promises');
  return readFile(filePath);
}
