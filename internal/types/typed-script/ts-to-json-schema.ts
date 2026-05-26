/**
 * TS type-annotation AST → JSON Schema (draft-7 subset).
 *
 * Used to derive the runtime AJV-validatable schema from a typed script
 * function's return annotation. The mapping is intentionally conservative:
 * features the QuickJS sandbox couldn't honor anyway (generics, conditional
 * types, mapped types) degrade to `{}` plus an `unsupported-feature` issue
 * surfaced to the user, rather than silently producing a too-permissive
 * schema.
 */
import type {
  TSPropertySignature,
  TSType,
  TSTypeAliasDeclaration,
  TSTypeLiteral,
} from '@babel/types';
import type { JsonSchema } from '../core/common';

export type { JsonSchema };

export interface ConvertContext {
  /** Local `type X = ...` aliases declared in the same source. Resolved
   *  lazily at lookup time so forward references work. */
  localAliases: Map<string, TSType>;
  /** Pre-resolved JSON Schema for in-scope type aliases (e.g. the
   *  `_Items = Array<{...}>` we inject for `transform.script` inputs).
   *  When the user's annotation references one of these, we substitute the
   *  schema directly instead of trying to re-walk an opaque aliased shape. */
  inScopeSchemas: Map<string, JsonSchema>;
  /** Local-alias names currently being resolved on the stack. Guards
   *  against `type Node = { children: Node[] }` and mutually-recursive
   *  pairs; without this the converter recurses forever and crashes
   *  the process with a stack overflow rather than surfacing a
   *  CompileIssue. */
  resolving: Set<string>;
  /** Issue accumulator; each unsupported feature appends here. */
  issues: ConvertIssue[];
  /** Non-fatal warnings (e.g. `: any` / `: unknown` returns, untyped
   *  object literals). Surfaced to the user without blocking compile. */
  warnings: ConvertWarning[];
}

export interface ConvertIssue {
  message: string;
  /** TS AST node `start`/`end` for diagnostics. Babel parser populates
   *  these when `attachComment: false, ranges: true` (default). */
  start?: number;
  end?: number;
}

export interface ConvertWarning {
  /** Stable identifier so the CLI / UI can filter or de-duplicate. */
  code: 'weak-return-type' | 'unstructured-object';
  message: string;
  start?: number;
  end?: number;
}

export function convertTsTypeToJsonSchema(node: TSType, ctx: ConvertContext): JsonSchema {
  switch (node.type) {
    case 'TSStringKeyword':
      return { type: 'string' };
    case 'TSNumberKeyword':
      return { type: 'number' };
    case 'TSBooleanKeyword':
      return { type: 'boolean' };
    case 'TSNullKeyword':
      return { type: 'null' };
    case 'TSUndefinedKeyword':
    case 'TSVoidKeyword':
      // JSON Schema has no `undefined`. The closest semantic is "absent",
      // which we model as an empty schema (accepts anything, including
      // undefined returns from user code).
      return {};
    case 'TSAnyKeyword':
    case 'TSUnknownKeyword': {
      // User explicitly opted out of validation. Emit a non-fatal warning
      // so downstream tooling (autocomplete, `workflow push`) can nudge
      // them toward a concrete shape. Downstream consumers of this step's
      // output can't navigate or validate fields of an empty schema.
      const keyword = node.type === 'TSAnyKeyword' ? 'any' : 'unknown';
      ctx.warnings.push({
        code: 'weak-return-type',
        message: `\`${keyword}\` produces an empty schema, so downstream steps can't autocomplete this field or its descendants. Describe the actual shape (\`{ name: string; total: number }\`) or a literal union (\`"low" | "medium" | "high"\`) for the strongest downstream typing.`,
        start: node.start ?? undefined,
        end: node.end ?? undefined,
      });
      return {};
    }
    case 'TSNeverKeyword':
      // `never` rules out all values. No JSON Schema equivalent that
      // rejects everything; closest is `not: {}`.
      return { not: {} };

    case 'TSArrayType':
      return {
        type: 'array',
        items: convertTsTypeToJsonSchema(node.elementType, ctx),
      };

    case 'TSTupleType': {
      const items = node.elementTypes.map((el) => {
        // Tuple elements can be `TSNamedTupleMember`; unwrap to the underlying type.
        if (el.type === 'TSNamedTupleMember') {
          return convertTsTypeToJsonSchema(el.elementType, ctx);
        }
        return convertTsTypeToJsonSchema(el as TSType, ctx);
      });
      // Draft-7 tuple syntax: `items` as an array + `additionalItems: false`.
      // (The 2020-12 `prefixItems` keyword isn't recognized by the worker's
      // draft-7 AJV instance; see the round-trip test.)
      return {
        type: 'array',
        items,
        additionalItems: false,
        minItems: items.length,
        maxItems: items.length,
      };
    }

    case 'TSTypeLiteral':
      return convertTypeLiteral(node, ctx);

    case 'TSUnionType': {
      // Special-case literal-union of primitives → enum (cleaner JSON Schema).
      const allLiterals = node.types.every(
        (t) =>
          t.type === 'TSLiteralType' &&
          (t.literal.type === 'StringLiteral' ||
            t.literal.type === 'NumericLiteral' ||
            t.literal.type === 'BooleanLiteral')
      );
      if (allLiterals) {
        const values = node.types.map((t) => {
          const lit = (t as { literal: { value: unknown } }).literal;
          return lit.value;
        });
        return { enum: values };
      }
      return { anyOf: node.types.map((t) => convertTsTypeToJsonSchema(t, ctx)) };
    }

    case 'TSIntersectionType':
      return { allOf: node.types.map((t) => convertTsTypeToJsonSchema(t, ctx)) };

    case 'TSLiteralType': {
      const lit = node.literal;
      if (lit.type === 'StringLiteral') return { const: lit.value };
      if (lit.type === 'NumericLiteral') return { const: lit.value };
      if (lit.type === 'BooleanLiteral') return { const: lit.value };
      ctx.issues.push({
        message: `unsupported literal type \`${lit.type}\`; degraded to \`unknown\``,
        start: node.start ?? undefined,
        end: node.end ?? undefined,
      });
      return {};
    }

    case 'TSTypeReference': {
      // Identifier reference; look up local alias or in-scope schema.
      if (node.typeName.type !== 'Identifier') {
        ctx.issues.push({
          message: `namespaced types (like \`Foo.Bar\`) cannot be used in a return type here; write out the concrete shape as a type literal or use \`unknown\``,
          start: node.start ?? undefined,
          end: node.end ?? undefined,
        });
        return {};
      }
      const name = node.typeName.name;

      // Built-in generic shortcuts the user is likely to type.
      if (name === 'Array' && node.typeParameters?.params.length === 1) {
        return {
          type: 'array',
          items: convertTsTypeToJsonSchema(node.typeParameters.params[0], ctx),
        };
      }
      if (name === 'ReadonlyArray' && node.typeParameters?.params.length === 1) {
        return {
          type: 'array',
          items: convertTsTypeToJsonSchema(node.typeParameters.params[0], ctx),
        };
      }
      if (
        name === 'Record' &&
        node.typeParameters?.params.length === 2 &&
        node.typeParameters.params[0].type === 'TSStringKeyword'
      ) {
        return {
          type: 'object',
          additionalProperties: convertTsTypeToJsonSchema(node.typeParameters.params[1], ctx),
        };
      }
      if (name === 'Promise') {
        ctx.issues.push({
          message: '`Promise<...>` not supported; async returns are rejected at parse time',
          start: node.start ?? undefined,
          end: node.end ?? undefined,
        });
        return {};
      }

      // In-scope type alias (e.g. `_Items` from `inScopeTypes`); substitute schema directly.
      const inScope = ctx.inScopeSchemas.get(name);
      if (inScope) return inScope;

      // Local `type X = ...` declaration in the same source. Cycle-guard
      // against self- and mutually-recursive aliases; JSON Schema can
      // express `$ref` cycles but our walker can't model them safely
      // through AJV without a deep restructure, so we surface a
      // user-actionable issue instead of looping.
      const local = ctx.localAliases.get(name);
      if (local) {
        if (ctx.resolving.has(name)) {
          ctx.issues.push({
            message: `recursive type \`${name}\` is not supported; inline the structure or restructure to avoid the cycle`,
            start: node.start ?? undefined,
            end: node.end ?? undefined,
          });
          return {};
        }
        ctx.resolving.add(name);
        try {
          return convertTsTypeToJsonSchema(local, ctx);
        } finally {
          ctx.resolving.delete(name);
        }
      }

      ctx.issues.push({
        message: `unresolved type reference \`${name}\`; declare it as \`type ${name} = ...\` above the function or use an inline type literal`,
        start: node.start ?? undefined,
        end: node.end ?? undefined,
      });
      return {};
    }

    case 'TSParenthesizedType':
      return convertTsTypeToJsonSchema(node.typeAnnotation, ctx);

    default:
      ctx.issues.push({
        message: `${describeUnsupportedType(node.type)} cannot be used in a return type here; write out the concrete shape as a type literal (\`{ field: string; ... }\`) or use \`unknown\``,
        start: node.start ?? undefined,
        end: node.end ?? undefined,
      });
      return {};
  }
}

function convertTypeLiteral(node: TSTypeLiteral, ctx: ConvertContext): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  let additionalProperties: JsonSchema | boolean | undefined;

  for (const member of node.members) {
    if (member.type === 'TSIndexSignature') {
      // `{ [key: string]: T }`; model as additionalProperties.
      const ann = member.typeAnnotation?.typeAnnotation;
      additionalProperties = ann ? convertTsTypeToJsonSchema(ann, ctx) : true;
      continue;
    }
    if (member.type !== 'TSPropertySignature') {
      // Method signatures, call/construct signatures; not meaningful for
      // a JSON return shape.
      ctx.issues.push({
        message: `a return type can only contain plain properties (\`field: type\`); methods, call signatures, and index-only members aren't allowed here`,
        start: member.start ?? undefined,
        end: member.end ?? undefined,
      });
      continue;
    }
    const name = propertyName(member, ctx);
    if (name === null) continue;
    const ann = member.typeAnnotation?.typeAnnotation;
    properties[name] = ann ? convertTsTypeToJsonSchema(ann, ctx) : {};
    if (!member.optional) required.push(name);
  }

  const schema: JsonSchema = { type: 'object', properties };
  if (required.length > 0) schema.required = required;
  if (additionalProperties !== undefined) schema.additionalProperties = additionalProperties;
  return schema;
}

function propertyName(member: TSPropertySignature, ctx: ConvertContext): string | null {
  const key = member.key;
  if (key.type === 'Identifier') return key.name;
  if (key.type === 'StringLiteral') return key.value;
  if (key.type === 'NumericLiteral') return String(key.value);
  ctx.issues.push({
    message: `computed property keys are not supported in return type literals`,
    start: member.start ?? undefined,
    end: member.end ?? undefined,
  });
  return null;
}

/** Build a context with the local `type X = ...` aliases collected from
 *  the source's program body. */
export function collectLocalAliases(decls: readonly TSTypeAliasDeclaration[]): Map<string, TSType> {
  const out = new Map<string, TSType>();
  for (const d of decls) {
    out.set(d.id.name, d.typeAnnotation);
  }
  return out;
}

/** Translate a Babel `TSType` node name into plain English for error
 *  messages. The walker rejects everything it can't map to JSON Schema;
 *  the user sees "conditional types (`A extends B ? ... : ...`)" rather
 *  than "TSConditionalType". Falls back to a generic phrase for the long
 *  tail of exotic constructs nobody should be putting in a return type. */
function describeUnsupportedType(nodeType: string): string {
  switch (nodeType) {
    case 'TSConditionalType':
      return 'conditional types (`A extends B ? X : Y`)';
    case 'TSMappedType':
      return 'mapped types (`{ [K in ...]: ... }`)';
    case 'TSTypeQuery':
      return '`typeof` types';
    case 'TSIndexedAccessType':
      return 'indexed-access types (`T["key"]`)';
    case 'TSTypeOperator':
      return '`keyof` / `readonly` type operators';
    case 'TSInferType':
      return '`infer` types';
    case 'TSImportType':
      return '`import("...")` types';
    case 'TSFunctionType':
    case 'TSConstructorType':
      return 'function / constructor types';
    case 'TSTemplateLiteralType':
      return 'template-literal types';
    case 'TSObjectKeyword':
      return 'the bare `object` type (use `{ [key: string]: unknown }` or a concrete shape)';
    case 'TSSymbolKeyword':
    case 'TSBigIntKeyword':
      return 'the `symbol` / `bigint` types (not representable as JSON)';
    default:
      return `\`${nodeType}\` types`;
  }
}
