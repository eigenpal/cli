import type { ErrorObject } from 'ajv';
import { eigenpalAjv } from './ajv';

/**
 * Machine-readable discriminator for an input validation issue. Closed set so
 * SDKs and the CLI can branch on a known code; `message` is the human-readable
 * counterpart that we ship straight to UI / stderr.
 */
export const INPUT_VALIDATION_CODES = [
  'missing_required',
  'type_mismatch',
  'enum_mismatch',
  'file_required',
  'array_length',
  'invalid_value',
] as const;
export type InputValidationCode = (typeof INPUT_VALIDATION_CODES)[number];

export interface InputValidationIssue {
  /** Dot/bracket path to the offending field — e.g. `contracts[0].fileId`. */
  field: string;
  code: InputValidationCode;
  message: string;
}

export type InputValidationResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; issues: InputValidationIssue[] };

/**
 * JSON Schema describing the canonical file-reference shape stored in
 * `triggerInput` after the route uploads multipart files. The
 * `x-eigenpal-type: 'file'` marker is how `classifyAjvError` knows a `type`
 * mismatch on this subschema means "expected a file" (rather than a generic
 * object mismatch).
 */
const FILE_REF_SCHEMA = {
  type: 'object',
  required: ['fileId'],
  'x-eigenpal-type': 'file',
  properties: {
    fileId: { type: 'string' },
    filename: { type: 'string' },
    mimeType: { type: 'string' },
  },
} as const;

/**
 * Workflow-side input definition shape (kept loose here to avoid a circular
 * import on the Zod-validated `WorkflowInputDef`).
 */
export interface WorkflowInputDefLike {
  name: string;
  type: string;
  description?: string;
  required?: boolean;
  default?: unknown;
  values?: string[];
  items?: { type: string; values?: string[] };
}

/**
 * Convert a workflow's flat `inputs: [{ name, type, ... }]` array into a JSON
 * Schema object. Workflow authors never see JSON Schema directly; this is
 * how the shared validator engine speaks both dialects.
 */
export function workflowInputsToJsonSchema(
  inputs: WorkflowInputDefLike[]
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const def of inputs) {
    properties[def.name] = workflowInputTypeToJsonSchema(def);
    if (def.required !== false) required.push(def.name);
  }

  const schema: Record<string, unknown> = {
    type: 'object',
    properties,
  };
  if (required.length > 0) schema.required = required;
  return schema;
}

function workflowInputTypeToJsonSchema(def: WorkflowInputDefLike): Record<string, unknown> {
  switch (def.type) {
    case 'string':
      return { type: 'string' };
    case 'enum':
      return def.values && def.values.length > 0
        ? { type: 'string', enum: def.values }
        : { type: 'string' };
    case 'number':
      return { type: 'number' };
    case 'integer':
      return { type: 'integer' };
    case 'boolean':
      return { type: 'boolean' };
    case 'file':
      return { ...FILE_REF_SCHEMA };
    case 'array':
      return { type: 'array', items: itemsToJsonSchema(def.items) };
    case 'object':
      return { type: 'object' };
    default:
      // Unknown type label: fall back to permissive object so we don't reject
      // valid inputs just because a workflow uses a type the validator hasn't
      // learned about yet. The catch-all keeps existing workflows working.
      return {};
  }
}

function itemsToJsonSchema(items?: { type: string; values?: string[] }): Record<string, unknown> {
  if (!items) return {};
  if (items.type === 'file') return { ...FILE_REF_SCHEMA };
  if (items.type === 'enum' && items.values && items.values.length > 0) {
    return { type: 'string', enum: items.values };
  }
  return { type: items.type };
}

/**
 * Validate an input map against a JSON Schema. Returns the validated value on
 * success or a list of structured issues on failure.
 */
export function validateInput(
  input: unknown,
  schema: Record<string, unknown>
): InputValidationResult {
  const validate = eigenpalAjv.compile(schema);
  const ok = validate(input);

  if (ok) {
    return { ok: true, value: (input ?? {}) as Record<string, unknown> };
  }

  const issues = (validate.errors ?? []).map(ajvErrorToIssue);
  return { ok: false, issues };
}

function ajvErrorToIssue(err: ErrorObject): InputValidationIssue {
  const field = instancePathToField(err.instancePath, err.params);
  const { code, message } = classifyAjvError(err);
  return { field, code, message };
}

/**
 * Turn AJV's `/contracts/0/fileId` into the `contracts[0].fileId` form humans
 * (and stack traces in client code) actually read. Empty path collapses to
 * `<root>` for messages that target the whole input map.
 */
function instancePathToField(instancePath: string, params: ErrorObject['params']): string {
  let path = instancePath;
  // `required` errors hang the missing field off `params.missingProperty`
  // instead of the instance path. Splice it on so the issue points at the
  // exact field rather than the parent object.
  if (typeof params?.missingProperty === 'string') {
    path = `${path}/${params.missingProperty}`;
  }
  if (!path) return '<root>';

  const segments = path.split('/').filter(Boolean);
  let out = '';
  for (const seg of segments) {
    if (/^\d+$/.test(seg)) {
      out += `[${seg}]`;
    } else {
      out += out ? `.${seg}` : seg;
    }
  }
  return out || '<root>';
}

function classifyAjvError(err: ErrorObject): { code: InputValidationCode; message: string } {
  const params = (err.params ?? {}) as Record<string, unknown>;
  switch (err.keyword) {
    case 'required':
      return {
        code: 'missing_required',
        message: `field is required`,
      };
    case 'type': {
      const expected = Array.isArray(params.type) ? params.type.join(' | ') : String(params.type);
      // The file-ref shape is `{ fileId, ... }` modeled as `type: 'object'`
      // with `x-eigenpal-type: 'file'`. When an input declared as `file`
      // arrives as a bare string, AJV reads `expected object` against that
      // marked subschema — discriminate via `parentSchema` so generic
      // `type: 'object'` inputs still surface as `type_mismatch`.
      const parent = (err as ErrorObject & { parentSchema?: Record<string, unknown> }).parentSchema;
      if (parent && parent['x-eigenpal-type'] === 'file') {
        return { code: 'file_required', message: `expected a file reference, got ${typeOf(err)}` };
      }
      return { code: 'type_mismatch', message: `expected ${expected}, got ${typeOf(err)}` };
    }
    case 'enum': {
      const allowed = Array.isArray(params.allowedValues)
        ? params.allowedValues.map((v) => JSON.stringify(v)).join(', ')
        : '';
      return {
        code: 'enum_mismatch',
        message: `value must be one of ${allowed} (got ${JSON.stringify((err as { data?: unknown }).data ?? null)})`,
      };
    }
    case 'minItems':
    case 'maxItems': {
      const limit = params.limit;
      const verb = err.keyword === 'minItems' ? 'at least' : 'at most';
      return { code: 'array_length', message: `must have ${verb} ${limit} items` };
    }
    default:
      return { code: 'invalid_value', message: err.message ?? 'invalid value' };
  }
}

function typeOf(err: ErrorObject): string {
  const value = (err as { data?: unknown }).data;
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * Project uploaded agent input files into `inputJson` so the validator can
 * check file fields declared with `x-eigenpal-type: 'file'`. Agents store
 * files separately from `inputJson`; this bridges the two views by writing
 * each file's name into the JSON under its `fieldName`. Multi-file fields
 * (schema `type: 'array'`) collect into an array. Pure — never mutates
 * `inputJson`.
 */
export function projectAgentInputFiles(
  inputJson: Record<string, unknown>,
  files: Array<{ name: string; fieldName: string }>,
  schema: Record<string, unknown>
): Record<string, unknown> {
  if (files.length === 0) return inputJson;
  const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
  const filesByField: Record<string, string[]> = {};
  for (const f of files) {
    (filesByField[f.fieldName] ??= []).push(f.name);
  }
  const merged: Record<string, unknown> = { ...inputJson };
  for (const [field, filenames] of Object.entries(filesByField)) {
    const prop = properties[field];
    // Only project files into fields the schema actually marks as file-typed.
    // A `{type:'string'}` field (without x-eigenpal-type:'file') shouldn't get
    // a filename silently dropped on top; let the validator flag the upload
    // as an unexpected file instead.
    const isFileScalar = prop?.['x-eigenpal-type'] === 'file';
    const isFileArray =
      prop?.type === 'array' &&
      typeof prop?.items === 'object' &&
      prop.items !== null &&
      (prop.items as Record<string, unknown>)['x-eigenpal-type'] === 'file';
    if (!isFileScalar && !isFileArray) continue;
    merged[field] = isFileArray ? filenames : filenames[0];
  }
  return merged;
}

/**
 * Build the post-upload "virtual" input for workflow runs so the schema can
 * validate file fields up front (before storage I/O). Each pending multipart
 * upload becomes a synthetic `{fileId: PLACEHOLDER, ...}` ref; multiple
 * files under the same field name collapse into an array. Counterpart to
 * `projectAgentInputFiles` for the workflow run shape.
 */
export interface PendingMultipartFile {
  fieldName: string;
  filename: string;
  mimeType: string;
}

export const PENDING_FILE_REF = '__pending_upload__';

export function withPendingFileRefs(
  input: Record<string, unknown>,
  files: PendingMultipartFile[]
): Record<string, unknown> {
  if (files.length === 0) return input;
  const refsByField: Record<
    string,
    Array<{ fileId: string; filename: string; mimeType: string }>
  > = {};
  for (const f of files) {
    (refsByField[f.fieldName] ??= []).push({
      fileId: PENDING_FILE_REF,
      filename: f.filename,
      mimeType: f.mimeType,
    });
  }
  const merged = { ...input };
  for (const [field, refs] of Object.entries(refsByField)) {
    merged[field] = refs.length === 1 ? refs[0] : refs;
  }
  return merged;
}

/**
 * Parse the contents of an `input-schema.json` blob into a usable JSON
 * Schema object. Returns `undefined` for absent or malformed payloads —
 * callers treat both as "skip validation". Pure function so app + worker
 * loaders (which differ only in S3 path) can share parse semantics.
 */
export function parseInputSchemaJson(body: Buffer | null): Record<string, unknown> | undefined {
  if (!body) return undefined;
  try {
    const parsed = JSON.parse(body.toString('utf-8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Walk multipart-derived string values and coerce them to the declared type
 * (`"true"` → `true`, `"42"` → `42`). No-op for keys not declared in the
 * schema, for already-typed values, or for non-`type` declarations. Pure —
 * does not mutate the input map.
 */
export function coerceInput(
  input: Record<string, unknown>,
  schema: Record<string, unknown>
): Record<string, unknown> {
  const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
  const out: Record<string, unknown> = { ...input };

  for (const [key, value] of Object.entries(out)) {
    const prop = properties[key];
    if (!prop || typeof value !== 'string') continue;
    const coerced = coerceScalar(value, prop.type);
    if (coerced !== undefined) out[key] = coerced;
  }

  return out;
}

function coerceScalar(value: string, type: unknown): unknown {
  if (type === 'boolean') {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return undefined;
  }
  if (type === 'number' || type === 'integer') {
    if (value.trim() === '') return undefined;
    const n = Number(value);
    if (!Number.isFinite(n)) return undefined;
    if (type === 'integer' && !Number.isInteger(n)) return undefined;
    return n;
  }
  return undefined;
}
