import { isFileReferenceSentinel } from './files/scoped-file-ref';
import {
  HUMAN_REVIEW_LIMITS,
  type HumanReviewFile,
  type HumanReviewFileRole,
  type HumanReviewInputProjection,
} from './human-review';

const OMIT = Symbol('omit');
const LEAKY_KEYS = new Set([
  'triggerMetadata',
  'resolvedConfig',
  'resolvedConfigs',
  'continuation',
  'continuationKey',
  'continuationData',
  'secrets',
  'secret',
]);

function jsonByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export function humanReviewInputFieldFromArtifactPath(path: string): string | undefined {
  const match = path.replace(/\\/g, '/').match(/(?:^|\/)input\/([^/]+)\//);
  return match?.[1];
}

export function isHumanReviewRunInputArtifactPath(path: string): boolean {
  return /(?:^|\/)input\//.test(path.replace(/\\/g, '/'));
}

function isInternalStoragePath(value: string): boolean {
  const normalized = value.replace(/\\/g, '/').replace(/^\/+/, '');
  return (
    normalized.startsWith('tenants/') ||
    normalized.startsWith('automations/') ||
    normalized.startsWith('workflows/') ||
    normalized.startsWith('agents/')
  );
}

export function inferHumanReviewFileRole(file: HumanReviewFile): HumanReviewFileRole {
  if (file.role === 'run_input' || file.role === 'attachment') return file.role;
  if (file.fieldName?.trim() || isHumanReviewRunInputArtifactPath(file.artifactPath)) {
    return 'run_input';
  }
  return 'attachment';
}

export function normalizeHumanReviewFiles(files: readonly HumanReviewFile[]): HumanReviewFile[] {
  const byId = new Map<string, HumanReviewFile>();
  for (const file of files) {
    const next: HumanReviewFile = { ...file, role: inferHumanReviewFileRole(file) };
    const existing = byId.get(next.fileId);
    if (!existing) {
      byId.set(next.fileId, next);
      continue;
    }
    if (next.role === 'run_input' && existing.role !== 'run_input') {
      byId.set(next.fileId, next);
    }
  }
  return [...byId.values()];
}

export function humanReviewRunInputFieldNames(files: readonly HumanReviewFile[]): Set<string> {
  const names = new Set<string>();
  for (const file of normalizeHumanReviewFiles(files)) {
    if (file.role !== 'run_input') continue;
    const name = file.fieldName?.trim() || humanReviewInputFieldFromArtifactPath(file.artifactPath);
    if (name) names.add(name);
  }
  return names;
}

function projectValue(
  value: unknown,
  path: string[],
  runInputFieldNames: Set<string>
): unknown | typeof OMIT {
  if (isFileReferenceSentinel(value)) return OMIT;
  if (typeof value === 'string') {
    if (path.length === 1 && runInputFieldNames.has(path[0]!) && value.trim() !== '') {
      return OMIT;
    }
    if (isInternalStoragePath(value)) return OMIT;
    return value;
  }
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : OMIT;
  if (Array.isArray(value)) {
    let omittedAny = false;
    const items: unknown[] = [];
    value.forEach((item, index) => {
      const next = projectValue(item, [...path, String(index)], runInputFieldNames);
      if (next === OMIT) {
        omittedAny = true;
        return;
      }
      items.push(next);
    });
    if (items.length === 0 && omittedAny) return OMIT;
    return items;
  }
  if (value !== null && typeof value === 'object') {
    let omittedAny = false;
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (LEAKY_KEYS.has(key)) {
        omittedAny = true;
        continue;
      }
      const next = projectValue(child, [...path, key], runInputFieldNames);
      if (next === OMIT) {
        omittedAny = true;
        continue;
      }
      out[key] = next;
    }
    if (Object.keys(out).length === 0 && omittedAny) return OMIT;
    return out;
  }
  return OMIT;
}

export function projectHumanReviewInput(
  triggerInput: unknown,
  files: readonly HumanReviewFile[],
  maxBytes = HUMAN_REVIEW_LIMITS.dataBytes
): HumanReviewInputProjection | null {
  if (triggerInput === undefined || triggerInput === null) return null;
  if (typeof triggerInput !== 'object') return null;

  const projected = projectValue(triggerInput, [], humanReviewRunInputFieldNames(files));
  if (projected === OMIT || projected === undefined) return null;

  if (Array.isArray(projected)) {
    if (projected.length === 0) return null;
  } else if (projected !== null && typeof projected === 'object') {
    if (Object.keys(projected as Record<string, unknown>).length === 0) return null;
  } else {
    return null;
  }

  if (jsonByteLength(projected) > maxBytes) {
    return { status: 'omitted_too_large' };
  }

  return {
    status: 'available',
    data: projected as Record<string, unknown> | unknown[],
  };
}
