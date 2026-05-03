/**
 * Normalize JSON and YAML for deterministic comparison and diff display.
 * Sorts object keys recursively so that reordering properties does not trigger diffs.
 */

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

/** Deterministic key order for object keys. */
function sortedKeys(obj: Record<string, unknown>): string[] {
  return Object.keys(obj).sort((a, b) => a.localeCompare(b, 'en'));
}

/**
 * Deep-clone a value with all object keys sorted recursively.
 * Array order is preserved; only object key order is normalized.
 */
export function normalizeJson(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(normalizeJson);
  }
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of sortedKeys(obj)) {
    out[k] = normalizeJson(obj[k]);
  }
  return out;
}

/**
 * Return a deterministic JSON string (sorted keys, 2-space indent).
 * Use before diff or string comparison so key order does not affect result.
 */
export function normalizeJsonString(value: unknown): string {
  return JSON.stringify(normalizeJson(value), null, 2);
}

/**
 * Normalize YAML string: parse, sort all object keys recursively, re-serialize.
 * If content is not a single object (e.g. multi-doc or scalar), returns trimmed string.
 * Use before comparing or diffing YAML so key order does not affect result.
 */
export function normalizeYaml(yaml: string): string {
  const trimmed = yaml.trim();
  if (!trimmed) return '';

  try {
    const parsed = parseYaml(trimmed, { uniqueKeys: false });
    if (parsed === undefined || parsed === null) return trimmed;
    const normalized = normalizeJson(parsed);
    return stringifyYaml(normalized, { lineWidth: 0 }).trimEnd();
  } catch {
    return trimmed;
  }
}
