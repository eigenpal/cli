import { z } from 'zod';

export const ScopedFileRefSchema = z
  .object({
    $file: z.string().min(1).describe('Owner-relative artifact path'),
  })
  .strict();

export const FileIdIngressRefSchema = z
  .object({
    $fileId: z.string().min(1).describe('Reusable file-pool id to materialize'),
  })
  .strict();

export const InlineFileIngressPayloadSchema = z
  .object({
    filename: z.string().min(1).describe('Original filename for the materialized artifact'),
    mimeType: z.string().min(1).describe('MIME type for the materialized artifact'),
    base64: z.string().min(1).describe('Base64-encoded file bytes'),
  })
  .strict();

export const InlineFileIngressRefSchema = z
  .object({
    $inline: InlineFileIngressPayloadSchema,
  })
  .strict();

export const FileIngressRefSchema = z.union([FileIdIngressRefSchema, InlineFileIngressRefSchema]);

export const FileReferenceSentinelSchema = z.union([
  ScopedFileRefSchema,
  FileIdIngressRefSchema,
  InlineFileIngressRefSchema,
]);

export type ScopedFileRef = z.infer<typeof ScopedFileRefSchema>;
export type FileIdIngressRef = z.infer<typeof FileIdIngressRefSchema>;
export type InlineFileIngressPayload = z.infer<typeof InlineFileIngressPayloadSchema>;
export type InlineFileIngressRef = z.infer<typeof InlineFileIngressRefSchema>;
export type FileIngressRef = z.infer<typeof FileIngressRefSchema>;
export type FileReferenceSentinel = z.infer<typeof FileReferenceSentinelSchema>;

export type FileReferenceKind = 'file' | 'fileId' | 'inline';

export interface ScopedArtifactPath {
  path: string;
  segments: string[];
  root: string;
}

export type ScopedArtifactPathValidation =
  | { ok: true; value: ScopedArtifactPath }
  | { ok: false; reason: string };

export interface FileReferenceMatch {
  path: string[];
  ref: FileReferenceSentinel;
  kind: FileReferenceKind;
}

export interface ScopedFileOwnerContext {
  kind: 'run' | 'dataset-example' | 'headless' | 'other';
  tenantId?: string;
  automationId?: string;
  runId?: string;
  exampleName?: string;
  rootKey?: string;
  allowedRoots?: readonly string[];
}

export interface ResolvedScopedFile {
  filename: string;
  mimeType: string;
  size?: number;
  checksum?: string;
  storageKey?: string;
  localPath?: string;
  read(): Promise<Uint8Array>;
}

export interface ScopedFileResolver {
  resolve(owner: ScopedFileOwnerContext, ref: ScopedFileRef): Promise<ResolvedScopedFile>;
}

export function isScopedFileRef(value: unknown): value is ScopedFileRef {
  return ScopedFileRefSchema.safeParse(value).success;
}

export function isFileIdIngressRef(value: unknown): value is FileIdIngressRef {
  return FileIdIngressRefSchema.safeParse(value).success;
}

export function isInlineFileIngressRef(value: unknown): value is InlineFileIngressRef {
  return InlineFileIngressRefSchema.safeParse(value).success;
}

export function isFileIngressRef(value: unknown): value is FileIngressRef {
  return FileIngressRefSchema.safeParse(value).success;
}

export function isFileReferenceSentinel(value: unknown): value is FileReferenceSentinel {
  return FileReferenceSentinelSchema.safeParse(value).success;
}

export function fileReferenceKind(ref: FileReferenceSentinel): FileReferenceKind {
  if ('$file' in ref) return 'file';
  if ('$fileId' in ref) return 'fileId';
  return 'inline';
}

export function validateScopedArtifactPath(
  path: string,
  options: { allowedRoots?: readonly string[] } = {}
): ScopedArtifactPathValidation {
  if (path.length === 0) return { ok: false, reason: 'path is empty' };
  if (path.startsWith('/')) return { ok: false, reason: 'leading slash not allowed' };
  if (path.includes('\\')) return { ok: false, reason: 'backslashes not allowed' };
  if (path.includes('\u0000')) return { ok: false, reason: 'null bytes not allowed' };

  const segments = path.split('/');
  for (const segment of segments) {
    if (segment.length === 0) return { ok: false, reason: 'empty path segment not allowed' };
    if (segment === '.') return { ok: false, reason: 'current-directory segment not allowed' };
    if (segment === '..') return { ok: false, reason: 'path traversal segment not allowed' };
  }

  if (
    segments[0] === 'tenants' ||
    segments[0] === 'automations' ||
    segments[0] === 'workflows' ||
    segments[0] === 'agents'
  ) {
    return { ok: false, reason: 'storage prefixes are not allowed in scoped file refs' };
  }

  const normalizedRoots = (options.allowedRoots ?? []).map((root) =>
    root.replace(/^\/+|\/+$/g, '')
  );
  if (
    normalizedRoots.length > 0 &&
    !normalizedRoots.some((root) => path === root || path.startsWith(`${root}/`))
  ) {
    return { ok: false, reason: `path root must be one of: ${normalizedRoots.join(', ')}` };
  }

  return { ok: true, value: { path: segments.join('/'), segments, root: segments[0] } };
}

export function collectFileReferenceSentinels(value: unknown): FileReferenceMatch[] {
  const matches: FileReferenceMatch[] = [];
  walkFileReferenceSentinels(value, (match) => {
    matches.push(match);
  });
  return matches;
}

export function walkFileReferenceSentinels(
  value: unknown,
  visit: (match: FileReferenceMatch) => void,
  path: string[] = []
): void {
  const parsed = FileReferenceSentinelSchema.safeParse(value);
  if (parsed.success) {
    visit({ path, ref: parsed.data, kind: fileReferenceKind(parsed.data) });
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      walkFileReferenceSentinels(item, visit, [...path, String(index)])
    );
    return;
  }

  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      walkFileReferenceSentinels(item, visit, [...path, key]);
    }
  }
}

export function mapFileReferenceSentinels(
  value: unknown,
  mapper: (match: FileReferenceMatch) => unknown,
  path: string[] = []
): unknown {
  const parsed = FileReferenceSentinelSchema.safeParse(value);
  if (parsed.success) {
    return mapper({ path, ref: parsed.data, kind: fileReferenceKind(parsed.data) });
  }

  if (Array.isArray(value)) {
    return value.map((item, index) =>
      mapFileReferenceSentinels(item, mapper, [...path, String(index)])
    );
  }

  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = mapFileReferenceSentinels(item, mapper, [...path, key]);
    }
    return out;
  }

  return value;
}
