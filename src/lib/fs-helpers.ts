/**
 * Shared file system helpers for CLI commands.
 * Consolidates utilities used across payload helpers (root run examples / eval-local).
 */

import { mimeTypeForExtension } from '@eigenpal/types';
import { existsSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'fs';
import { extname, join } from 'path';
import { normalizeJsonString } from './normalize';

/** Extensions for template index files (e.g., index.docx). */
export const INDEX_FILE_EXTS = ['.docx', '.doc', '.xlsx', '.xls'];

/**
 * Guess MIME type from filename extension.
 * Returns empty string for unknown extensions (preserves payload.ts behavior for optional mimeType).
 */
export function guessMimeType(filename: string): string {
  return mimeTypeForExtension(extname(filename)) ?? '';
}

/**
 * Write eval JSON file (input.json, expected.json) or remove it when value is null/undefined.
 * Keeps push and pull in sync: neither writes a file containing only "null".
 */
export function writeEvalJson(path: string, value: unknown): void {
  if (value === null || value === undefined) {
    if (existsSync(path)) unlinkSync(path);
    return;
  }
  writeFileSync(path, normalizeJsonString(value) + '\n', 'utf-8');
}

/**
 * Find template directories recursively.
 * A directory is considered a template dir if it has meta.json or an index document (index.docx, etc.).
 */
export function findTemplateDirs(
  baseDir: string,
  prefix: string
): Array<{ relPath: string; absDir: string }> {
  const results: Array<{ relPath: string; absDir: string }> = [];
  const entries = readdirSync(baseDir).filter((f) => statSync(join(baseDir, f)).isDirectory());

  for (const entry of entries) {
    const absDir = join(baseDir, entry);
    const relPath = prefix ? `${prefix}/${entry}` : entry;
    const hasMeta = existsSync(join(absDir, 'meta.json'));
    const hasIndex = INDEX_FILE_EXTS.some((ext) => existsSync(join(absDir, `index${ext}`)));

    if (hasMeta || hasIndex) {
      results.push({ relPath, absDir });
    } else {
      results.push(...findTemplateDirs(absDir, relPath));
    }
  }

  return results;
}
