// Structured extraction steps (ai.extract, ai.vision) treat an optional field
// the document does not contain as `null`: OpenAI strict mode requires every
// key, so optionality becomes nullability, and other providers are prompted
// with the same contract. The provider request, the processor-boundary
// validation, and the types downstream steps see must all agree on it.

interface Options {
  /**
   * Also list every key in `required`, matching OpenAI strict-mode semantics
   * ("all fields required, use null for absent values") so `zodResponseFormat`
   * accepts the converted schema. Leaves `enum` / `const` untouched so the
   * request shape stays what strict mode already accepts.
   */
  requireAll?: boolean;
}

/** Keywords whose value is a map of name -> subschema. */
const SCHEMA_MAP_KEYS = ['properties', 'patternProperties', '$defs', 'definitions'] as const;
/** Keywords whose value is a subschema or a list of subschemas. */
const SUBSCHEMA_KEYS = [
  'items',
  'prefixItems',
  'additionalProperties',
  'anyOf',
  'oneOf',
  'not',
  'if',
  'then',
  'else',
] as const;

/**
 * Add `null` to every optional (not `required`) property, recursively.
 *
 * Default mode keeps `required` as declared: use it to validate step output and
 * to type it for downstream steps. An optional field may be missing or `null`;
 * a required one must be present and typed. Only real schema positions are
 * walked, so a field literally named `properties` or an object-valued
 * `enum`/`default` is never mistaken for a schema node.
 */
export function makeOptionalNullable(value: unknown, options: Options = {}): unknown {
  return walk(value, options, new Set());
}

function walk(value: unknown, options: Options, inheritedRequired: ReadonlySet<string>): unknown {
  if (Array.isArray(value)) return value.map((item) => walk(item, options, new Set()));
  if (value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = { ...(value as Record<string, unknown>) };

  // `required` on a node also applies to properties declared in its allOf branches.
  const required = new Set([
    ...inheritedRequired,
    ...(Array.isArray(out.required) ? (out.required as string[]) : []),
  ]);

  for (const key of SCHEMA_MAP_KEYS) {
    const map = out[key];
    if (!map || typeof map !== 'object' || Array.isArray(map)) continue;
    const next: Record<string, unknown> = {};
    for (const [name, sub] of Object.entries(map as Record<string, unknown>)) {
      next[name] = walk(sub, options, new Set());
    }
    out[key] = next;
  }
  for (const key of SUBSCHEMA_KEYS) {
    if (out[key] !== undefined) out[key] = walk(out[key], options, new Set());
  }
  if (Array.isArray(out.allOf)) {
    out.allOf = out.allOf.map((branch) => walk(branch, options, required));
  }

  const props = out.properties as Record<string, unknown> | undefined;
  if (props && typeof props === 'object' && !Array.isArray(props)) {
    for (const name of Object.keys(props)) {
      if (!required.has(name)) props[name] = addNull(props[name], options);
    }
    if (options.requireAll) out.required = Object.keys(props);
  }
  return out;
}

function addNull(value: unknown, options: Options): unknown {
  if (value === null || typeof value !== 'object') return value;
  const node = { ...(value as Record<string, unknown>) };
  if (node.type === 'null') return node;
  if (Array.isArray(node.type) && node.type.includes('null')) return node;
  if (!options.requireAll) {
    // Widen value constraints in place rather than wrapping in `anyOf`, which
    // the grounded extraction path does not support. A fixed value becomes a
    // two-value enum; `enum` constrains values independently of `type`, so
    // null must be listed there too.
    if (node.const !== undefined) {
      node.enum = [node.const, null];
      delete node.const;
    } else if (Array.isArray(node.enum) && !node.enum.includes(null)) {
      node.enum = [...node.enum, null];
    }
    if (Array.isArray(node.enum) && node.type === undefined) return node;
  }
  if (typeof node.type === 'string') {
    node.type = [node.type, 'null'];
    return node;
  }
  if (Array.isArray(node.type)) {
    node.type = [...node.type, 'null'];
    return node;
  }
  // Type-less node (anyOf/oneOf/allOf/$ref/enum/const): offer null as an alternative.
  if (Array.isArray(node.anyOf)) {
    if (!node.anyOf.some((s) => (s as Record<string, unknown>)?.type === 'null')) {
      node.anyOf = [...node.anyOf, { type: 'null' }];
    }
    return node;
  }
  return { anyOf: [node, { type: 'null' }] };
}
