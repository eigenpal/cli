/**
 * Build payloads for `eigenpal run ... --example` from local dataset
 * folders. The only supported layout is the flat one that
 * `eigenpal init workflow` scaffolds and `dataset push --mode replace`
 * round-trips:
 *
 *   ./dataset/examples/<name>/input.json              REQUIRED — full run input
 *   ./dataset/examples/<name>/input/<file>            files referenced via { "$file": "input/<file>" }
 *   ./dataset/examples/<name>/expected.json           OPTIONAL — for evals
 *   ./dataset/examples/<name>/meta.json               OPTIONAL { rowOrder, annotation, overrides }
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { guessMimeType } from './fs-helpers';

/**
 * Local file descriptor read from a dataset example folder. The CLI
 * separates these from scalar inputs and uploads them as multipart form
 * fields (`-F` style) when invoking the run endpoint — no base64.
 */
export interface ExampleFile {
  /** Multipart field name. For canonical datasets this is the top-level input key containing `$file`. */
  argument: string;
  filename: string;
  content: Buffer;
  mimeType?: string;
}

export interface ExamplePayload {
  /** Input JSON with top-level file refs removed. Multipart files are sent separately. */
  scalars: Record<string, unknown>;
  /** File uploads, in stable per-argument order. */
  files: ExampleFile[];
  overrides: { steps: Record<string, Record<string, unknown>> } | null;
}

const DATASET_EXAMPLES_DIR = ['dataset', 'examples'];

/**
 * Resolve the dataset/examples directory for the given project root.
 * Returns the absolute path or null if the project hasn't been scaffolded.
 */
export function resolveEvalBaseDir(dir: string): string | null {
  const candidates = [join(dir, ...DATASET_EXAMPLES_DIR), join(...DATASET_EXAMPLES_DIR)];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * List example directory names under `dataset/examples/`, sorted naturally.
 * If `exampleNamesFilter` is non-empty, returns only the intersection.
 */
export function getExampleNames(dir: string, exampleNamesFilter?: string[]): string[] {
  const baseDir = resolveEvalBaseDir(dir);
  if (!baseDir) {
    throw new Error(
      `No dataset/examples directory found at ${join(dir, ...DATASET_EXAMPLES_DIR)}. Run \`eigenpal init workflow <name>\` to scaffold one.`
    );
  }
  const all = readdirSync(baseDir)
    .filter(
      (name) =>
        statSync(join(baseDir, name)).isDirectory() && existsSync(join(baseDir, name, 'input.json'))
    )
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!exampleNamesFilter?.length) return all;
  return all.filter((n) => exampleNamesFilter.includes(n));
}

/** Read input JSON and gather file refs for multipart upload. */
function readInput(exampleDir: string): { scalars: Record<string, unknown>; files: ExampleFile[] } {
  const canonicalPath = join(exampleDir, 'input.json');
  return readCanonicalInput(exampleDir, canonicalPath);
}

function readCanonicalInput(
  exampleDir: string,
  inputPath: string
): { scalars: Record<string, unknown>; files: ExampleFile[] } {
  const raw = JSON.parse(readFileSync(inputPath, 'utf-8'));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${inputPath} must contain a JSON object.`);
  }
  const scalars: Record<string, unknown> = {};
  const files: ExampleFile[] = [];
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const refs = topLevelFileRefs(value);
    if (refs.length === 0) {
      scalars[key] = value;
      continue;
    }
    for (const ref of refs) {
      const relative = parseDatasetInputFileRef(ref);
      if (!relative) {
        throw new Error(
          `${inputPath}: ${key} must reference files under input/ without path traversal.`
        );
      }
      const filePath = join(exampleDir, 'input', relative);
      const filename = relative.split('/').at(-1) ?? relative;
      files.push({
        argument: key,
        filename,
        content: readFileSync(filePath),
        mimeType: guessMimeType(filename),
      });
    }
  }
  return { scalars, files };
}

function topLevelFileRefs(value: unknown): string[] {
  if (isFileRef(value)) return [value.$file];
  if (Array.isArray(value) && value.every(isFileRef)) return value.map((item) => item.$file);
  if (Array.isArray(value) && value.some(isFileRef)) {
    throw new Error('file arrays must contain only { "$file": "input/..." } entries.');
  }
  return [];
}

function isFileRef(value: unknown): value is { $file: string } {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof (value as { $file?: unknown }).$file === 'string'
  );
}

function parseDatasetInputFileRef(path: string): string | null {
  if (!path.startsWith('input/')) return null;
  if (path.startsWith('/') || path.includes('\\') || path.includes('\u0000')) return null;
  const relative = path.slice('input/'.length);
  const parts = relative.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) return null;
  return parts.join('/');
}

/** Read `meta.json`'s `overrides.steps` if present, else null. */
function readOverrides(
  exampleDir: string
): { steps: Record<string, Record<string, unknown>> } | null {
  const metaPath = join(exampleDir, 'meta.json');
  if (!existsSync(metaPath)) return null;
  const raw = JSON.parse(readFileSync(metaPath, 'utf-8')) as { overrides?: unknown };
  const ov = raw.overrides;
  if (
    ov &&
    typeof ov === 'object' &&
    'steps' in ov &&
    typeof (ov as { steps: unknown }).steps === 'object'
  ) {
    return ov as { steps: Record<string, Record<string, unknown>> };
  }
  return null;
}

/** Build scalar input + file uploads + overrides for one example dir. */
export function buildExamplePayload(exampleDir: string): ExamplePayload {
  const { scalars, files } = readInput(exampleDir);
  return {
    scalars,
    files,
    overrides: readOverrides(exampleDir),
  };
}
