import { FileSourceError } from './resolver';

/**
 * The string a caller passes for a source-backed file input. Storage systems
 * address a file by a container plus an id inside it (GFR stack + file id, S3
 * bucket + key, Azure container + blob name, FileNet object store + document
 * id), so every file source reads the same shape:
 *
 *   `<container>/<id>` an explicit container
 *   `<id>`             only where the source has a default container and its
 *                      ids never contain `/` (GFR file ids); a path-like id
 *                      (an S3 key) would be ambiguous, so those sources always
 *                      take the container
 *
 * Only the first `/` separates the two, so an id may itself contain `/` (an S3
 * key, a blob path). Each resolver decides how a container maps onto its
 * transport and must encode both parts itself.
 */
export interface FileReference {
  /** Container named by the caller; absent when the reference is a bare id. */
  container?: string;
  /** File id within the container. */
  id: string;
}

/** Raised for a malformed reference. The message is safe to show the caller. */
export class FileReferenceError extends FileSourceError {
  constructor(message: string) {
    super(message, { permanent: true });
    this.name = 'FileReferenceError';
  }
}

/**
 * Throw unless `part` can stand as one path segment. `encodeURIComponent`
 * leaves `.` and `..` untouched, and URL parsing resolves them, so a reference
 * like `../x` would otherwise climb out of the registry path.
 */
function assertFileReferencePart(part: string, label: string): void {
  if (part === '') throw new FileReferenceError(`File reference has an empty ${label}`);
  if (part === '.' || part === '..') {
    throw new FileReferenceError(`File reference ${label} cannot be "${part}"`);
  }
}

/** Split a caller-supplied reference into an optional container and an id. */
export function parseFileReference(reference: string): FileReference {
  const slash = reference.indexOf('/');
  if (slash === -1) {
    assertFileReferencePart(reference, 'file id');
    return { id: reference };
  }
  const container = reference.slice(0, slash);
  const id = reference.slice(slash + 1);
  assertFileReferencePart(container, 'container');
  assertFileReferencePart(id, 'file id');
  return { container, id };
}

/**
 * Split an id that is itself a path (an S3 key, a blob name) into segments,
 * rejecting `.` and `..` anywhere in it for the same reason as above. Callers
 * encode each segment and join them with `/`.
 */
export function fileReferencePathSegments(id: string): string[] {
  const segments = id.split('/');
  for (const segment of segments) {
    if (segment === '.' || segment === '..') {
      throw new FileReferenceError(`File reference file id cannot contain a "${segment}" segment`);
    }
  }
  return segments;
}

/**
 * Parse an "allowed containers" setting (comma or newline separated) into a
 * list, or `undefined` when it is blank (any container the credentials reach).
 */
export function parseAllowedContainers(value: unknown): string[] | undefined {
  if (typeof value !== 'string') return undefined;
  const list = value
    .split(/[,\n]/)
    .map((part) => part.trim())
    .filter((part) => part !== '');
  return list.length > 0 ? list : undefined;
}

/**
 * Throw unless `container` is on the allow-list. A source's credentials are
 * shared by everyone who can run a workflow using it, so the allow-list is how
 * an admin narrows what those runs can fetch. With a list set, a reference
 * that names no container is refused too.
 */
export function assertContainerAllowed(
  container: string | undefined,
  allowed: string[] | undefined,
  noun: string
): void {
  if (!allowed) return;
  if (container === undefined) {
    throw new FileReferenceError(`This source only accepts references that name the ${noun}`);
  }
  if (!allowed.includes(container)) {
    throw new FileReferenceError(`The ${noun} "${container}" is not allowed for this source`);
  }
}
