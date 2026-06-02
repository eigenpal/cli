import { eigenpalAjv } from './ajv';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate an output JSON object against a JSON Schema.
 */
export function validateOutput(output: unknown, schema: Record<string, unknown>): ValidationResult {
  const validate = eigenpalAjv.compile(schema);
  const valid = validate(output);

  if (valid) {
    return { valid: true, errors: [] };
  }

  const errors = (validate.errors ?? []).map(
    (e) => `${e.instancePath || '/'}: ${e.message ?? 'unknown error'}`
  );
  return { valid: false, errors };
}
