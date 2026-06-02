import { eigenpalAjv } from './ajv';
import type { ValidationResult } from './output';

const SCHEMA_FILES = new Set(['input-schema.json', 'output-schema.json']);

/** Returns true if the filename is a schema file that should be validated. */
export function isSchemaFile(filePath: string): boolean {
  const basename = filePath.split('/').pop() ?? '';
  return SCHEMA_FILES.has(basename);
}

/**
 * Validate a workspace schema file. Accepts any valid JSON Schema plus two
 * Eigenpal conventions:
 *   - root `type` must be "object"
 *   - `x-eigenpal-type` (if present) must be "file"
 */
export function validateWorkspaceSchema(content: string, _filename: string): ValidationResult {
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch (e) {
    return {
      valid: false,
      errors: [`Invalid JSON: ${e instanceof Error ? e.message : 'parse error'}`],
    };
  }

  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    return { valid: false, errors: ['Schema must be a JSON object'] };
  }

  const schema = json as Record<string, unknown>;
  const errors: string[] = [];

  if (schema.type !== 'object') {
    errors.push('Root "type" must be "object"');
  }

  if (!eigenpalAjv.validateSchema(schema)) {
    // Capture errors immediately — ajv.errors is mutable instance state that
    // gets clobbered by the next validate/compile call.
    const metaErrors = eigenpalAjv.errors ?? [];
    for (const err of metaErrors) {
      errors.push(`${err.instancePath || '/'}: ${err.message ?? 'invalid schema'}`);
    }
  }

  checkEigenpalTypeExtension(schema, '', errors);

  return { valid: errors.length === 0, errors };
}

function checkEigenpalTypeExtension(
  node: unknown,
  path: string,
  errors: string[],
  seen: WeakSet<object> = new WeakSet()
): void {
  if (!node || typeof node !== 'object') return;
  if (seen.has(node as object)) return;
  seen.add(node as object);

  const obj = node as Record<string, unknown>;
  if ('x-eigenpal-type' in obj && obj['x-eigenpal-type'] !== 'file') {
    errors.push(`${path || '/'}: x-eigenpal-type must be "file" if present`);
  }

  if (obj.properties && typeof obj.properties === 'object') {
    for (const [k, v] of Object.entries(obj.properties as Record<string, unknown>)) {
      checkEigenpalTypeExtension(v, `${path}/properties/${k}`, errors, seen);
    }
  }
  if (obj.items) {
    if (Array.isArray(obj.items)) {
      obj.items.forEach((item, i) =>
        checkEigenpalTypeExtension(item, `${path}/items/${i}`, errors, seen)
      );
    } else {
      checkEigenpalTypeExtension(obj.items, `${path}/items`, errors, seen);
    }
  }
  for (const key of ['oneOf', 'anyOf', 'allOf'] as const) {
    if (Array.isArray(obj[key])) {
      (obj[key] as unknown[]).forEach((sub, i) =>
        checkEigenpalTypeExtension(sub, `${path}/${key}/${i}`, errors, seen)
      );
    }
  }
}
