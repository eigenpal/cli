import { z } from 'zod';

/**
 * Optional upload purpose bound to a pending session and resulting `files` row.
 *
 * - omitted / null — durable reusable file (explicit `files.upload`)
 * - `run-input` — maintained-client run pre-upload; retained briefly for safe
 *   run-start retries and reaped after 24 hours. Explicit uploads must not set this.
 * - `builder-attachment` — Studio builder intermediary; any MIME (ZIP, octet-stream).
 *   Retained briefly for handoff retries and reaped after 24 hours. Only the Studio
 *   builder upload helper may set this.
 */
export const FILE_UPLOAD_PURPOSES = ['run-input', 'builder-attachment'] as const;
export const FileUploadPurposeSchema = z.enum(FILE_UPLOAD_PURPOSES);
export type FileUploadPurpose = z.infer<typeof FileUploadPurposeSchema>;

export const FILE_PURPOSE_RUN_INPUT = 'run-input' as const satisfies FileUploadPurpose;
export const FILE_PURPOSE_BUILDER_ATTACHMENT =
  'builder-attachment' as const satisfies FileUploadPurpose;

export function isRunInputFilePurpose(purpose: string | null | undefined): boolean {
  return purpose === FILE_PURPOSE_RUN_INPUT;
}

export function isBuilderAttachmentFilePurpose(purpose: string | null | undefined): boolean {
  return purpose === FILE_PURPOSE_BUILDER_ATTACHMENT;
}

/** Ephemeral reusable-pool files reaped after 24 hours when not consumed. */
export function isEphemeralPoolFilePurpose(purpose: string | null | undefined): boolean {
  return isRunInputFilePurpose(purpose) || isBuilderAttachmentFilePurpose(purpose);
}

/**
 * Lifecycle of a storage-direct reusable-file upload session.
 *
 * Pending sessions reserve a `file_*` id but do not create a `files` row.
 * `promoting` means completion has claimed the session and is copying into the
 * canonical key — the reaper must not delete the pending object yet.
 * `recovering` is a fenced reaper ownership state: the first stale pass takes
 * the row from `promoting` without touching storage; only a later grace-expired
 * pass may observe canonical evidence and complete or expire.
 * Only `completed` sessions are durable reusable Files API resources.
 */
export const FILE_UPLOAD_STATUSES = [
  'pending',
  'promoting',
  'recovering',
  'completed',
  'aborted',
  'expired',
] as const;

export const FileUploadStatusSchema = z.enum(FILE_UPLOAD_STATUSES);
export type FileUploadStatus = z.infer<typeof FileUploadStatusSchema>;

export const FILE_UPLOAD_TERMINAL_STATUSES = ['completed', 'aborted', 'expired'] as const;
export type FileUploadTerminalStatus = (typeof FILE_UPLOAD_TERMINAL_STATUSES)[number];

/** In-flight statuses whose pending object must not be reaped. */
export const FILE_UPLOAD_PROTECTED_STATUSES = ['pending', 'promoting', 'recovering'] as const;
export type FileUploadProtectedStatus = (typeof FILE_UPLOAD_PROTECTED_STATUSES)[number];

export function isFileUploadTerminalStatus(status: FileUploadStatus): boolean {
  return (FILE_UPLOAD_TERMINAL_STATUSES as readonly string[]).includes(status);
}

export function isFileUploadProtectedStatus(status: FileUploadStatus): boolean {
  return (FILE_UPLOAD_PROTECTED_STATUSES as readonly string[]).includes(status);
}

/**
 * Negotiated upload transport returned by session create.
 * `presigned-put` requires a storage backend that supports signed PUT.
 * `presigned-multipart` is storage-direct S3 MPU with presigned UploadPart URLs.
 * `multipart` is the API-mediated HTTP FormData fallback (local / on-prem /
 * unsupported). Distinct from S3 multipart — do not reuse this value for MPU.
 */
export const FILE_UPLOAD_TRANSPORTS = [
  'presigned-put',
  'presigned-multipart',
  'multipart',
] as const;
export const FileUploadTransportSchema = z.enum(FILE_UPLOAD_TRANSPORTS);
export type FileUploadTransport = z.infer<typeof FileUploadTransportSchema>;

export function isPresignedMultipartTransport(
  transport: string | null | undefined
): transport is 'presigned-multipart' {
  return transport === 'presigned-multipart';
}

/**
 * Pending object key suffix (tenant prefix applied by TenantScopedStorage).
 * Server-selected; clients never supply a key. Used only by `presigned-put`
 * (pending + copy). MPU writes the canonical key directly.
 */
export function pendingFileUploadKey(uploadId: string): string {
  return `file-uploads/${uploadId}`;
}

/**
 * Canonical reusable-file key suffix. MPU initiates at this key so completion
 * does not CopyObject. PUT still copies pending → this key after verify.
 */
export function canonicalReusableFileKey(fileId: string): string {
  return `files/${fileId}`;
}

/** True when `key` is a reusable-pool object (`files/<fileId>`), not a run prefix. */
export function isReusablePoolStorageKey(key: string): boolean {
  return key.startsWith('files/');
}

/**
 * True when `key` is a reusable-pool object, including tenant-prefixed forms
 * (`tenants/<tenantId>/files/<fileId>`). Used to keep whole-execution prefix
 * deletes from touching shared canonical objects.
 */
export function isReusablePoolObjectKey(key: string): boolean {
  const normalized = key.replace(/^\/+/, '');
  const suffix = normalized.replace(/^tenants\/[^/]+\//, '');
  return isReusablePoolStorageKey(suffix);
}

/**
 * Reusable-pool objects (`files/<fileId>`) can be referenced by a new files row
 * without copying bytes. Ephemeral pool files (`run-input`, `builder-attachment`)
 * are included: last-reference deletion plus the blob advisory lock keep the
 * object alive while any alias remains, so the 24-hour reaper cannot delete
 * bytes a run still needs. `purpose` / `executionId` are accepted so callers
 * can pass a files row; they do not gate sharing.
 */
export function canShareReusableStorageKey(file: {
  key: string;
  purpose?: string | null;
  executionId?: string | null;
}): boolean {
  return isReusablePoolStorageKey(file.key);
}
