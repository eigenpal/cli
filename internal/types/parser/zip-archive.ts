/**
 * ZIP is a workflow *input container*, not a parseable document MIME.
 * Keep this list next to the parser registry so search-files and uploads
 * recognize the same variants without putting ZIP in ParserCategory.
 */
export const ZIP_ARCHIVE_MIME_TYPES = [
  'application/zip',
  'application/x-zip',
  'application/x-zip-compressed',
  'application/zip-compressed',
  'multipart/x-zip',
] as const;

/** Canonical MIME written for native ZIP uploads. */
export const ZIP_CANONICAL_MIME_TYPE = 'application/zip';

const ZIP_ARCHIVE_MIME_SET: ReadonlySet<string> = new Set(ZIP_ARCHIVE_MIME_TYPES);

export function isZipArchiveMimeType(mimeType: string): boolean {
  const mime = mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
  return ZIP_ARCHIVE_MIME_SET.has(mime);
}

export function isZipArchiveFilename(filename: string): boolean {
  return filename.toLowerCase().endsWith('.zip');
}

/** True when the declared MIME or `.zip` filename identifies a ZIP archive. */
export function isZipArchive(filename: string, mimeType: string): boolean {
  if (isZipArchiveMimeType(mimeType)) return true;
  return isZipArchiveFilename(filename);
}

/**
 * MIME for a file extracted from a ZIP. Nested ZIPs are `application/zip`
 * via this helper — never ParserCategory, which does not list ZIP.
 */
export function mimeTypeForArchiveEntry(
  filename: string,
  mimeTypeForExtension: (extension: string) => string | undefined
): string {
  const base = filename.split('/').pop() ?? filename;
  if (isZipArchiveFilename(base)) return ZIP_CANONICAL_MIME_TYPE;
  const dot = base.lastIndexOf('.');
  const ext = dot >= 0 ? base.slice(dot + 1) : '';
  return mimeTypeForExtension(ext) || 'application/octet-stream';
}
