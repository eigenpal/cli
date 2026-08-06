import { randomUUID } from 'node:crypto';
import { apiPath } from './api-paths';
import type { ApiClient } from './client';
import { guessMimeType } from './fs-helpers';

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

/**
 * Upload one file through the Files API, negotiating storage-direct when
 * available. Pass `purpose: 'run-input'` for CLI/SDK run pre-uploads so the
 * server can consume the pool object after run-input materialization.
 */
export async function uploadReusableFile(
  client: ApiClient,
  input: {
    content: Buffer;
    filename: string;
    mimeType?: string;
    purpose?: 'run-input';
    idempotencyKey?: string;
  }
): Promise<ReusableFileUploadResult> {
  const contentType = input.mimeType ?? guessMimeType(input.filename) ?? 'application/octet-stream';
  const idempotencyKey = input.idempotencyKey ?? newIdempotencyKey();
  const negotiation = (await client.post(apiPath('/files/uploads'), {
    filename: input.filename,
    contentType,
    size: input.content.byteLength,
    idempotencyKey,
    ...(input.purpose ? { purpose: input.purpose } : {}),
  })) as UploadNegotiation;

  if (input.content.byteLength > negotiation.maxFileSizeBytes) {
    throw new Error(
      `File too large. Maximum size: ${Math.floor(negotiation.maxFileSizeBytes / (1024 * 1024))}MB`
    );
  }

  if (negotiation.transport === 'multipart') {
    const form = new FormData();
    form.append(
      'file',
      new Blob([input.content as BlobPart], { type: contentType }),
      input.filename
    );
    if (input.purpose) form.append('purpose', input.purpose);
    return (await client.postFormData(negotiation.url, form)) as ReusableFileUploadResult;
  }

  const putHeaders = Object.fromEntries(
    Object.entries(negotiation.headers ?? {}).filter(
      ([name]) => name.toLowerCase() !== 'content-length'
    )
  );
  const putResponse = await fetch(negotiation.url, {
    method: 'PUT',
    headers: putHeaders,
    body: new Uint8Array(input.content),
  });
  if (!putResponse.ok) {
    await client.delete(apiPath(`/files/uploads/${negotiation.uploadId}`)).catch(() => undefined);
    throw new Error(`Storage upload failed (${putResponse.status}); retry the upload`);
  }

  return (await client.post(
    apiPath(`/files/uploads/${negotiation.uploadId}/complete`),
    {}
  )) as ReusableFileUploadResult;
}
