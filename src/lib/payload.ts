/**
 * Locate the local dataset folder that `eigenpal init workflow` scaffolds:
 *
 *   ./dataset/examples/<name>/input.json
 *   ./dataset/examples/<name>/expected.json
 */

import { existsSync } from 'fs';
import { join } from 'path';

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
