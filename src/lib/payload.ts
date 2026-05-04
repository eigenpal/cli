/**
 * Build payloads for `eigenpal workflow execution run` from local dataset
 * folders.  The only supported layout is the flat one that
 * `eigenpal init workflow` scaffolds and `dataset push --mode replace`
 * round-trips:
 *
 *   ./dataset/examples/<name>/input/arguments.json    REQUIRED — scalar args
 *   ./dataset/examples/<name>/input/<arg-name>/<file> file-arg folders (auto-inlined)
 *   ./dataset/examples/<name>/expected/output.json    OPTIONAL — for evals
 *   ./dataset/examples/<name>/meta.json               OPTIONAL { rowOrder, annotation, overrides }
 *
 * No legacy `workflows/<slug>/eval/...` support — that layout was removed.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { guessMimeType } from './fs-helpers';

export interface ExamplePayload {
  input?: Record<string, unknown>;
  overrides?: { steps: Record<string, Record<string, unknown>> } | null;
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

/**
 * Read scalar args from `arguments.json` and merge in inlined file folders
 * sitting alongside them.  Each subfolder of `inputDir` becomes one file-arg —
 * single-file folder → object, multi-file folder → array.
 */
function readInput(exampleDir: string): Record<string, unknown> {
  const argsPath = join(exampleDir, 'input', 'arguments.json');
  const inputDir = join(exampleDir, 'input');
  const merged: Record<string, unknown> = JSON.parse(readFileSync(argsPath, 'utf-8'));
  for (const entry of readdirSync(inputDir)) {
    const full = join(inputDir, entry);
    if (!statSync(full).isDirectory()) continue;
    const files = readdirSync(full)
      .filter((f) => statSync(join(full, f)).isFile())
      .sort();
    if (files.length === 0) continue;
    const inlined = files.map((filename) => {
      const buf = readFileSync(join(full, filename));
      const mime = guessMimeType(filename);
      return {
        _inline: buf.toString('base64'),
        filename,
        ...(mime ? { mimeType: mime } : {}),
      };
    });
    merged[entry] = files.length === 1 ? inlined[0] : inlined;
  }
  return merged;
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

/** Build input + overrides for one example dir. */
export function buildExamplePayload(exampleDir: string): ExamplePayload {
  return {
    input: readInput(exampleDir),
    overrides: readOverrides(exampleDir),
  };
}
