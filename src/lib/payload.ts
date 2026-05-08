/**
 * Build payloads for `eigenpal workflow execution run` from local dataset
 * folders. The only supported layout is the flat one that
 * `eigenpal init workflow` scaffolds and `dataset push --mode replace`
 * round-trips:
 *
 *   ./dataset/examples/<name>/input/arguments.json    REQUIRED — scalar args
 *   ./dataset/examples/<name>/input/<arg-name>/<file> file-arg folders (uploaded via multipart)
 *   ./dataset/examples/<name>/expected/output.json    OPTIONAL — for evals
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
  /** Argument name (the folder under `<example>/input/`). */
  argument: string;
  filename: string;
  content: Buffer;
  mimeType?: string;
}

export interface ExamplePayload {
  /** Scalar args from `arguments.json`. File-args are NOT included here. */
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
        statSync(join(baseDir, name)).isDirectory() &&
        existsSync(join(baseDir, name, 'input', 'arguments.json'))
    )
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!exampleNamesFilter?.length) return all;
  return all.filter((n) => exampleNamesFilter.includes(n));
}

/** Read scalar args from `arguments.json` and gather file-arg folders. */
function readInput(exampleDir: string): { scalars: Record<string, unknown>; files: ExampleFile[] } {
  const argsPath = join(exampleDir, 'input', 'arguments.json');
  const inputDir = join(exampleDir, 'input');
  const scalars: Record<string, unknown> = JSON.parse(readFileSync(argsPath, 'utf-8'));
  const files: ExampleFile[] = [];
  for (const entry of readdirSync(inputDir)) {
    const full = join(inputDir, entry);
    if (!statSync(full).isDirectory()) continue;
    const filenames = readdirSync(full)
      .filter((f) => statSync(join(full, f)).isFile())
      .sort();
    for (const filename of filenames) {
      files.push({
        argument: entry,
        filename,
        content: readFileSync(join(full, filename)),
        mimeType: guessMimeType(filename),
      });
    }
  }
  return { scalars, files };
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
