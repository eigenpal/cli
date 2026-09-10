/**
 * Shared file system helpers for CLI commands.
 * Consolidates utilities used across payload helpers (root run examples / eval-local).
 */

import { mimeTypeForExtension } from '@eigenpal/types';
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'fs';
import { extname, join } from 'path';
import { parse as parseYaml } from 'yaml';
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
 * Read JSON file or return empty object if missing/invalid.
 */
export function readJsonOrEmpty<T>(path: string): T {
  if (!existsSync(path)) return {} as T;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T;
  } catch {
    return {} as T;
  }
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
 * Extract workflow name from YAML content, falling back to provided default.
 */
export function getWorkflowNameFromYaml(yaml: string, fallback: string): string {
  try {
    const parsed = parseYaml(yaml) as { name?: unknown };
    if (typeof parsed?.name === 'string' && parsed.name.trim().length > 0) {
      return parsed.name;
    }
  } catch {
    // use fallback
  }
  return fallback;
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
