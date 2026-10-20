import type { ValidateFunction } from 'ajv';
import { z } from 'zod';
import { getEigenpalAjv } from '../validation/ajv';
import type { FileSourceDescriptor } from './descriptor';
import { FileSourceError } from './resolver';

const emptyFields: Record<string, Record<string, unknown>> = {};
const validators = new WeakMap<object, ValidateFunction>();

// These belong to the runtime file handle, never to a source's enrichment.
const reserved = new Set([
  '__eigenpalFile',
  'source',
  'filename',
  'mimeType',
  'fileId',
  'ref',
  'path',
  'base64',
  'size',
  '__proto__',
  'prototype',
  'constructor',
]);
const fail = () =>
  new FileSourceError('File source returned invalid workflow fields', { permanent: true });

/** Validate a persisted snapshot without consulting a mutable connection or descriptor. */
export function validateStoredFileSourceFields(fields: Record<string, unknown>) {
  let count = 0;
  const walk = (value: unknown, depth: number): void => {
    if (depth > 16 || ++count > 4096) throw fail();
    if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        if (['__proto__', 'prototype', 'constructor'].includes(key)) throw fail();
        walk(child, depth + 1);
      }
    }
  };
  walk(fields, 0);
  const parsed = z.record(z.string(), z.json()).safeParse(fields);
  if (!parsed.success || new TextEncoder().encode(JSON.stringify(parsed.data)).byteLength > 65536)
    throw fail();
  for (const key of Object.keys(parsed.data)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key) || reserved.has(key)) throw fail();
  }
  return parsed.data;
}

/** Resolvers own the names and schemas of fields exposed on input.<file>. */
export function validateFileSourceFields(
  fields: Record<string, unknown>,
  descriptor?: FileSourceDescriptor
) {
  const parsed = validateStoredFileSourceFields(fields);
  const properties = descriptor?.resolvedFields ?? emptyFields;
  // Validate the contract even when this particular response has no fields.
  for (const key of Object.keys(properties)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key) || reserved.has(key)) throw fail();
  }
  let validate = validators.get(properties);
  if (!validate) {
    validate = getEigenpalAjv().compile({
      type: 'object',
      properties,
      additionalProperties: false,
    });
    validators.set(properties, validate);
  }
  if (!validate(parsed)) throw fail();
  return parsed;
}
