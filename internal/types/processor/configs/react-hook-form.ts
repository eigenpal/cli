/**
 * React Hook Form Integration
 *
 * Utilities for using processor config schemas with React Hook Form.
 *
 * Usage in frontend:
 *
 * ```tsx
 * import { useForm } from 'react-hook-form';
 * import { zodResolver } from '@hookform/resolvers/zod';
 * import { getConfigSchema, getFormResolver, ExtractConfig } from '@eigenpal/types';
 *
 * // Option 1: Direct Zod schema
 * const form = useForm<ExtractConfig>({
 *   resolver: zodResolver(ExtractConfigSchema),
 *   defaultValues: { temperature: 0 },
 * });
 *
 * // Option 2: Dynamic by processor ID
 * const schema = getConfigSchema('builtin/extract');
 * const form = useForm({
 *   resolver: schema ? zodResolver(schema) : undefined,
 * });
 * ```
 */

import { z } from 'zod';
import { getConfigSchema, PROCESSOR_SCHEMAS } from './index';

/**
 * Field metadata extracted from Zod schema
 * Useful for dynamic form generation
 */
export interface FieldMetadata {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'enum' | 'unknown';
  required: boolean;
  description?: string;
  defaultValue?: unknown;
  enumValues?: string[];
  min?: number;
  max?: number;
}

/**
 * Extract field metadata from a Zod schema for form generation.
 *
 * Walks `.unwrap()` for ZodOptional / ZodDefault / ZodPrefault wrappers using
 * v4's public API. `Schema` widens v4's internal `$ZodType` (the type of
 * `.unwrap()` / `ZodObject.shape[k]`) to the public `ZodType` so the
 * `instanceof` chain composes; the underlying runtime values are identical.
 */
type Schema = z.ZodType;

export function extractFieldMetadata(schema: z.ZodType): FieldMetadata[] {
  const fields: FieldMetadata[] = [];
  let inner = schema;
  while (inner instanceof z.ZodDefault || inner instanceof z.ZodPrefault) {
    inner = inner.unwrap() as Schema;
  }
  if (inner instanceof z.ZodObject) {
    for (const [name, fieldSchema] of Object.entries(inner.shape)) {
      fields.push(extractSingleFieldMetadata(name, fieldSchema as Schema));
    }
  }
  return fields;
}

function extractSingleFieldMetadata(name: string, schema: Schema): FieldMetadata {
  let current = schema;
  let required = true;
  let defaultValue: unknown = undefined;
  let description: string | undefined = current.description;

  while (true) {
    if (current instanceof z.ZodOptional) {
      required = false;
      current = current.unwrap() as Schema;
    } else if (current instanceof z.ZodDefault || current instanceof z.ZodPrefault) {
      defaultValue = (current._def as { defaultValue: unknown }).defaultValue;
      current = current.unwrap() as Schema;
    } else {
      break;
    }
    description ??= current.description;
  }

  const base: FieldMetadata = { name, type: 'unknown', required, description, defaultValue };

  if (current instanceof z.ZodString) return { ...base, type: 'string' };
  if (current instanceof z.ZodNumber) {
    let min: number | undefined;
    let max: number | undefined;
    for (const c of current._def.checks ?? []) {
      const def = c._zod.def as { check?: string; value?: number };
      if (def.check === 'greater_than') min = def.value;
      if (def.check === 'less_than') max = def.value;
    }
    return { ...base, type: 'number', min, max };
  }
  if (current instanceof z.ZodBoolean) return { ...base, type: 'boolean' };
  if (current instanceof z.ZodEnum) {
    return { ...base, type: 'enum', enumValues: current.options as string[] };
  }
  if (current instanceof z.ZodArray) return { ...base, type: 'array' };
  if (current instanceof z.ZodObject || current instanceof z.ZodRecord) {
    return { ...base, type: 'object' };
  }
  return base;
}

/**
 * Get form field metadata for a processor's config
 */
export function getConfigFieldMetadata(processorId: string): FieldMetadata[] | undefined {
  const schema = getConfigSchema(processorId);
  if (!schema) return undefined;
  return extractFieldMetadata(schema);
}

/**
 * Get default values for a processor's config
 * Useful for initializing forms
 */
export function getConfigDefaults(processorId: string): Record<string, unknown> {
  const schema = PROCESSOR_SCHEMAS[processorId]?.configSchema;
  if (!schema) return {};

  try {
    // Parse empty object to get all defaults
    const result = schema.safeParse({});
    if (result.success) {
      return result.data as Record<string, unknown>;
    }
  } catch {
    // Schema might not allow empty input
  }

  // Fallback: extract from field metadata
  const fields = extractFieldMetadata(schema);
  const defaults: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.defaultValue !== undefined) {
      defaults[field.name] = field.defaultValue;
    }
  }
  return defaults;
}

/**
 * Validate a config value and return field-level errors
 * For real-time validation in forms
 */
export function validateConfig(
  processorId: string,
  config: Record<string, unknown>
): { valid: boolean; errors: Record<string, string> } {
  const schema = getConfigSchema(processorId);
  if (!schema) {
    return { valid: true, errors: {} };
  }

  const result = schema.safeParse(config);
  if (result.success) {
    return { valid: true, errors: {} };
  }

  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const path = issue.path.join('.');
    errors[path] = issue.message;
  }

  return { valid: false, errors };
}
