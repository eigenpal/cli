import type { WorkflowInputDef } from './workflow';

/** Maps one declared workflow input to a JSON Schema fragment for AJV. */
function inputToJsonSchema(input: WorkflowInputDef): Record<string, unknown> {
  switch (input.type) {
    case 'string':
      return { type: 'string' };
    case 'number':
      return { type: 'number' };
    case 'integer':
      return { type: 'integer' };
    case 'boolean':
      return { type: 'boolean' };
    case 'object':
      return { type: 'object' };
    case 'enum':
      return input.values && input.values.length > 0
        ? { type: 'string', enum: input.values }
        : { type: 'string' };
    case 'array': {
      const itemType = input.items?.type;
      if (itemType === 'enum' && input.items?.values?.length) {
        return { type: 'array', items: { type: 'string', enum: input.items.values } };
      }
      // `file` is not a JSON Schema type, and file elements arrive as a string id
      // or a resolved descriptor object — so leave array-of-file items unconstrained
      // (mirrors the scalar `file` case). Constraining them would make ajv.compile
      // throw and reject valid file values.
      if (!itemType || itemType === 'file') return { type: 'array' };
      return { type: 'array', items: { type: itemType } };
    }
    // Files arrive as a string id (external source) or a resolved descriptor object;
    // both are valid, so do not constrain the shape.
    case 'file':
      return {};
    default:
      // Unknown/free-form types stay permissive rather than reject valid values.
      return {};
  }
}

/**
 * JSON Schema (AJV-ready) for the object a workflow accepts as input. Inputs with
 * `required !== false` are required; unknown keys are rejected.
 */
export function buildWorkflowInputsJsonSchema(
  inputs: WorkflowInputDef[] | undefined
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const input of inputs ?? []) {
    properties[input.name] = inputToJsonSchema(input);
    if (input.required !== false) required.push(input.name);
  }
  return { type: 'object', additionalProperties: false, required, properties };
}

/**
 * Whether a declared workflow input accepts a value of the given base JSON type.
 * Used for build-time type checking of the expressions mapped to an
 * invoke-workflow step's inputs. `resolvedType` is the base JSON type a mapped
 * expression resolves to ('string' | 'number' | 'integer' | 'boolean' | 'array'
 * | 'object'); 'unknown'/'null' are treated as compatible because the value
 * cannot be disproven statically. Mirrors `inputToJsonSchema` above so the
 * build-time check and the runtime AJV check agree.
 */
export function workflowInputAcceptsType(
  inputType: WorkflowInputDef['type'] | undefined,
  resolvedType: string
): boolean {
  if (resolvedType === 'unknown' || resolvedType === 'null') return true;
  switch (inputType) {
    case 'string':
    case 'enum':
      return resolvedType === 'string';
    case 'number':
    case 'integer':
      // Liquid resolves numeric literals/paths to 'number'; accept either.
      return resolvedType === 'number' || resolvedType === 'integer';
    case 'boolean':
      return resolvedType === 'boolean';
    case 'array':
      return resolvedType === 'array';
    case 'file':
      // A file input must reference a file, not an arbitrary scalar. A file
      // reference types as 'file'; a resolved descriptor as 'object'; an
      // array-of-files element as 'array'. This rejects bare literals like
      // "xd" (which resolve to 'string') that are clearly not file references.
      return resolvedType === 'file' || resolvedType === 'object' || resolvedType === 'array';
    // Objects are free-form, so stay permissive.
    case 'object':
    default:
      return true;
  }
}

/**
 * JSON Schema (AJV-ready) for a workflow's runtime result. The `output:`
 * declaration is a map of key -> template expression; the rendered result is an
 * object with exactly those keys. We validate shape (required keys, no extras),
 * not per-field value types, because Liquid expression types are not reliably
 * derivable at runtime. Returns undefined when no output is declared.
 */
export function buildWorkflowOutputContractSchema(
  output: Record<string, string> | string | undefined
): Record<string, unknown> | undefined {
  // Passthrough output (a single expression) has no enumerable required keys,
  // so there is no key-shape contract to enforce; the resolved value is whatever
  // the expression yields. Skip shape validation in that case.
  if (typeof output === 'string') return undefined;
  const keys = Object.keys(output ?? {});
  if (keys.length === 0) return undefined;
  const properties: Record<string, unknown> = {};
  for (const key of keys) properties[key] = {};
  return { type: 'object', additionalProperties: false, required: keys, properties };
}

/** Whether a workflow declares any output (named fields or a passthrough expression). */
export function hasDeclaredOutput(output: Record<string, string> | string | undefined): boolean {
  if (typeof output === 'string') return output.trim().length > 0;
  return !!output && Object.keys(output).length > 0;
}

interface StepLike {
  type?: unknown;
  with?: { workflowId?: unknown } | undefined;
  [key: string]: unknown;
}

/** Yields every step in a definition, descending into nested control containers. */
function* iterateSteps(steps: unknown): Iterable<StepLike> {
  if (!Array.isArray(steps)) return;
  for (const raw of steps) {
    if (!raw || typeof raw !== 'object') continue;
    const step = raw as StepLike;
    yield step;
    for (const value of Object.values(step)) {
      if (!Array.isArray(value)) continue;
      for (const item of value) {
        if (!item || typeof item !== 'object') continue;
        const obj = item as Record<string, unknown>;
        // Nested step arrays (control.if then/else, control.foreach steps, etc.)
        if ('type' in obj) {
          yield* iterateSteps([obj]);
        } else if (Array.isArray(obj.steps)) {
          // Branch wrappers (control.parallel branches: [{ steps: [...] }]).
          yield* iterateSteps(obj.steps);
        }
      }
    }
  }
}

/** Unique target workflow ids referenced by action.invoke-workflow steps. */
export function collectInvokeWorkflowTargetIds(
  definition: { steps?: unknown[] } | undefined
): string[] {
  const ids = new Set<string>();
  for (const step of iterateSteps(definition?.steps)) {
    if (step.type === 'action.invoke-workflow') {
      const id = step.with?.workflowId;
      if (typeof id === 'string' && id.length > 0) ids.add(id);
    }
  }
  return [...ids];
}
