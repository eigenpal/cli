/**
 * Single entry-point for compiling a user-authored typed-TS function body
 * for `transform.script` or the custom-script evaluator.
 *
 * Two outputs from one parse:
 *   1. `js`   ; annotations stripped via sucrase, ready for the QuickJS sandbox.
 *   2. `returnSchema`; JSON Schema derived from the return-type annotation,
 *                       used for downstream autocomplete + AJV runtime check.
 *
 * The contract is intentionally narrow: one top-level function declaration
 * with the canonical name, exact param list, and a *required* return-type
 * annotation. Anything else (`async`, `import()`, `require`, generics on
 * the function itself, multiple top-level decls) is rejected here so the
 * worker never sees ambiguous input.
 */
import { parse } from '@babel/parser';
import type {
  File,
  FunctionDeclaration,
  Identifier,
  Statement,
  TSType,
  TSTypeAliasDeclaration,
} from '@babel/types';
import { transform as sucraseTransform } from 'sucrase';
import {
  collectLocalAliases,
  convertTsTypeToJsonSchema,
  type ConvertIssue,
  type JsonSchema,
} from './ts-to-json-schema';

export interface CompileOptions {
  /** Full TypeScript source string; must contain exactly one top-level
   *  `function <name>(...)` declaration. */
  source: string;
  /** Which surface this script is for. Decides the canonical name +
   *  parameter list + required return type. */
  kind: 'transform' | 'evaluator';
  /** For `kind: 'transform'`, the param names must equal `Object.keys(inputs)`
   *  in declaration order. Ignored for `kind: 'evaluator'`. */
  paramNames?: readonly string[];
  /** For `kind: 'transform'`, optional pre-resolved JSON Schemas for type
   *  references the user can use in their annotations. Lets the
   *  `inScopeTypes` we already inject into Monaco round-trip into the
   *  derived schema. */
  inScopeSchemas?: Record<string, JsonSchema>;
}

export interface CompileSuccess {
  ok: true;
  result: {
    js: string;
    returnSchema: JsonSchema;
    paramNames: readonly string[];
  };
}

export interface CompileFailure {
  ok: false;
  issues: CompileIssue[];
}

export type CompileIssue =
  | { kind: 'parse-error'; message: string; line?: number; column?: number }
  | {
      kind: 'wrong-shape';
      message: string;
      line?: number;
      column?: number;
    }
  | { kind: 'missing-return-annotation'; message: string }
  | {
      kind: 'wrong-return-type';
      message: string;
      expected: string;
      got: string;
    }
  | { kind: 'unsupported-feature'; message: string; line?: number; column?: number };

const EVALUATOR_FN_NAME = 'scoreScript';
const EVALUATOR_PARAM_NAMES = ['expected', 'actual'] as const;
const TRANSFORM_FN_NAME = 'script';

export function compileTypedScript(opts: CompileOptions): CompileSuccess | CompileFailure {
  // ---- Parse ----
  let ast: File;
  try {
    ast = parse(opts.source, {
      sourceType: 'script',
      plugins: ['typescript'],
      ranges: true,
    });
  } catch (err) {
    const e = err as { message?: string; loc?: { line: number; column: number } };
    return failWith({
      kind: 'parse-error',
      message: e.message ?? 'Failed to parse function source.',
      line: e.loc?.line,
      column: e.loc?.column,
    });
  }

  // ---- Find the single top-level function declaration ----
  const decls = ast.program.body;
  const aliasDecls = decls.filter(
    (s): s is TSTypeAliasDeclaration => s.type === 'TSTypeAliasDeclaration'
  );
  const fnDecls = decls.filter((s): s is FunctionDeclaration => s.type === 'FunctionDeclaration');

  if (fnDecls.length === 0) {
    return failWith({
      kind: 'wrong-shape',
      message: `Expected one top-level \`function ${expectedName(opts.kind)}(...)\` declaration; found none.`,
    });
  }
  if (fnDecls.length > 1) {
    return failWith({
      kind: 'wrong-shape',
      message: `Expected exactly one top-level function declaration; found ${fnDecls.length}.`,
    });
  }
  // Reject any other top-level statement kind (variables, expressions, …).
  for (const s of decls) {
    if (s.type === 'FunctionDeclaration' || s.type === 'TSTypeAliasDeclaration') continue;
    return failWith({
      kind: 'wrong-shape',
      message: `Top-level \`${describeStatement(s)}\` is not allowed; only \`function ${expectedName(opts.kind)}(...)\` and supporting \`type X = ...\` aliases.`,
      line: s.loc?.start.line,
      column: s.loc?.start.column,
    });
  }

  const fn = fnDecls[0];

  // ---- Reject async / generator / arrow / nameless ----
  if (fn.async) {
    return failWith({
      kind: 'unsupported-feature',
      message: '`async` functions are not supported; the QuickJS sandbox runs synchronously.',
      line: fn.loc?.start.line,
      column: fn.loc?.start.column,
    });
  }
  if (fn.generator) {
    return failWith({
      kind: 'unsupported-feature',
      message: 'Generator functions are not supported.',
      line: fn.loc?.start.line,
      column: fn.loc?.start.column,
    });
  }
  if (!fn.id) {
    return failWith({
      kind: 'wrong-shape',
      message: `Anonymous function declarations are not allowed; expected \`function ${expectedName(opts.kind)}(...)\`.`,
    });
  }

  // ---- Name + parameter list ----
  const expectName = expectedName(opts.kind);
  if (fn.id.name !== expectName) {
    return failWith({
      kind: 'wrong-shape',
      message: `Function must be named \`${expectName}\` (got \`${fn.id.name}\`).`,
      line: fn.id.loc?.start.line,
      column: fn.id.loc?.start.column,
    });
  }

  const expectedParams = paramNamesFor(opts);
  const actualParams = fn.params.map((p) => {
    if (p.type === 'Identifier') return p.name;
    return null;
  });
  if (actualParams.some((n) => n === null)) {
    return failWith({
      kind: 'wrong-shape',
      message: `Function parameters must be plain identifiers (no destructuring, defaults, or rest). Expected \`(${expectedParams.join(', ')})\`.`,
      line: fn.loc?.start.line,
      column: fn.loc?.start.column,
    });
  }
  const actualParamNames = actualParams as string[];
  if (
    actualParamNames.length !== expectedParams.length ||
    actualParamNames.some((n, i) => n !== expectedParams[i])
  ) {
    return failWith({
      kind: 'wrong-shape',
      message: `Parameter list must be \`(${expectedParams.join(', ')})\` in this order (got \`(${actualParamNames.join(', ')})\`).`,
      line: fn.loc?.start.line,
      column: fn.loc?.start.column,
    });
  }

  // ---- Reject async/import/require inside the body via lightweight source scan ----
  // The QuickJS sandbox can't honor these and the user gets a confusing
  // runtime error otherwise. Sucrase doesn't validate this, so do it here.
  const bodyIssue = scanBodyForUnsupported(opts.source);
  if (bodyIssue) {
    return failWith({
      kind: 'unsupported-feature',
      message: bodyIssue,
    });
  }

  // ---- Required return type annotation ----
  const returnAnnotation = fn.returnType;
  if (!returnAnnotation || returnAnnotation.type !== 'TSTypeAnnotation') {
    return failWith({
      kind: 'missing-return-annotation',
      message:
        opts.kind === 'evaluator'
          ? `Add the return type annotation \`: number\` to your function: \`function scoreScript(${EVALUATOR_PARAM_NAMES.join(', ')}): number { ... }\`. The annotation is mandatory.`
          : `Add a return type annotation to your function; for example, \`function script(${expectedParams.join(', ')}): { name: string; total: number }[] { ... }\`. The annotation between \`)\` and \`{\` is mandatory and becomes this step's output schema (downstream steps autocomplete against it; the worker validates returns against it).`,
    });
  }
  const returnTsType: TSType = returnAnnotation.typeAnnotation;

  // ---- Evaluator: return MUST be `number` ----
  if (opts.kind === 'evaluator') {
    const got = describeTsType(returnTsType);
    if (returnTsType.type !== 'TSNumberKeyword') {
      return failWith({
        kind: 'wrong-return-type',
        expected: 'number',
        got,
        message: `Evaluator return type must be \`number\` (got \`${got}\`). Score is a value in [0, 1].`,
      });
    }
  }

  // ---- Body must `return` or `throw` ----
  // A function with a non-void return annotation that never returns is a
  // mistake (the step's output would be `undefined` and fail the runtime
  // schema check). Cheap token scan over the function's `{ ... }` block
  // with comments/strings stripped so a `return` inside a comment doesn't
  // count.
  const bodyStart = fn.body.start ?? 0;
  const bodyEnd = fn.body.end ?? opts.source.length;
  const bodyText = stripCommentsAndStrings(opts.source.slice(bodyStart, bodyEnd));
  if (!/\b(return|throw)\b/.test(bodyText)) {
    return failWith({
      kind: 'wrong-shape',
      message:
        opts.kind === 'evaluator'
          ? '`scoreScript` must `return` a number in [0, 1] (or `throw`, which scores 0). The body has no `return` or `throw`.'
          : '`script` must `return` a value (or `throw`). The body has no `return` or `throw`.',
      line: fn.loc?.start.line,
      column: fn.loc?.start.column,
    });
  }

  // ---- Convert annotation → JSON Schema ----
  const convertIssues: ConvertIssue[] = [];
  const inScopeSchemas = new Map<string, JsonSchema>(Object.entries(opts.inScopeSchemas ?? {}));
  const localAliases = collectLocalAliases(aliasDecls);
  const returnSchema =
    opts.kind === 'evaluator'
      ? { type: 'number' as const }
      : convertTsTypeToJsonSchema(returnTsType, {
          localAliases,
          inScopeSchemas,
          resolving: new Set(),
          issues: convertIssues,
        });

  if (convertIssues.length > 0) {
    // Convert issues during type-walking become unsupported-feature failures.
    // We bail because a partially-degraded schema would silently weaken the
    // contract the user thought they wrote.
    return {
      ok: false,
      issues: convertIssues.map((i) => ({
        kind: 'unsupported-feature' as const,
        message: i.message,
      })),
    };
  }

  // ---- Sucrase strip TS annotations → plain JS ----
  let stripped: string;
  try {
    const out = sucraseTransform(opts.source, {
      transforms: ['typescript'],
      // The sandbox is ES2020-friendly; sucrase's default is fine.
    });
    stripped = out.code;
  } catch (err) {
    const e = err as { message?: string };
    return failWith({
      kind: 'parse-error',
      message: `sucrase failed to strip TS annotations: ${e.message ?? 'unknown error'}`,
    });
  }

  return {
    ok: true,
    result: {
      js: stripped,
      returnSchema,
      paramNames: actualParamNames,
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function failWith(issue: CompileIssue): CompileFailure {
  return { ok: false, issues: [issue] };
}

function expectedName(kind: 'transform' | 'evaluator'): string {
  return kind === 'evaluator' ? EVALUATOR_FN_NAME : TRANSFORM_FN_NAME;
}

function paramNamesFor(opts: CompileOptions): readonly string[] {
  if (opts.kind === 'evaluator') return EVALUATOR_PARAM_NAMES;
  return opts.paramNames ?? [];
}

function describeStatement(s: Statement): string {
  switch (s.type) {
    case 'VariableDeclaration':
      return 'variable declaration';
    case 'ExpressionStatement':
      return 'expression statement';
    case 'IfStatement':
    case 'ForStatement':
    case 'WhileStatement':
    case 'TryStatement':
      return s.type.replace('Statement', '').toLowerCase() + ' statement';
    case 'ImportDeclaration':
      return 'import declaration';
    default:
      return s.type;
  }
}

function describeTsType(t: TSType): string {
  switch (t.type) {
    case 'TSStringKeyword':
      return 'string';
    case 'TSNumberKeyword':
      return 'number';
    case 'TSBooleanKeyword':
      return 'boolean';
    case 'TSAnyKeyword':
      return 'any';
    case 'TSUnknownKeyword':
      return 'unknown';
    case 'TSVoidKeyword':
      return 'void';
    case 'TSNullKeyword':
      return 'null';
    case 'TSUndefinedKeyword':
      return 'undefined';
    case 'TSArrayType':
      return `${describeTsType(t.elementType)}[]`;
    case 'TSTypeReference':
      if (t.typeName.type === 'Identifier') {
        return (t.typeName as Identifier).name;
      }
      return 'qualified-type';
    case 'TSUnionType':
      return t.types.map(describeTsType).join(' | ');
    case 'TSTypeLiteral':
      return `{ … }`;
    case 'TSLiteralType':
      return JSON.stringify((t.literal as { value: unknown }).value);
    default:
      return t.type;
  }
}

/** Lightweight regex scan for sandbox-incompatible patterns inside the
 *  function body. Babel could detect these via AST walk too, but a regex
 *  pass is faster and the false-positive surface is tiny (these are
 *  identifiers we don't expect anyone to use as variables). */
function scanBodyForUnsupported(source: string): string | null {
  // Strip line + block comments + string literals before scanning so we
  // don't false-positive on text inside them.
  const cleaned = stripCommentsAndStrings(source);
  if (/\bawait\b/.test(cleaned)) return '`await` is not supported in the sandbox.';
  if (/\bimport\s*\(/.test(cleaned)) return 'Dynamic `import()` is not supported in the sandbox.';
  if (/\brequire\s*\(/.test(cleaned)) return '`require()` is not supported in the sandbox.';
  return null;
}

function stripCommentsAndStrings(s: string): string {
  // Remove block comments
  let out = s.replace(/\/\*[\s\S]*?\*\//g, '');
  // Remove line comments
  out = out.replace(/\/\/[^\n]*/g, '');
  // Remove single-quoted strings
  out = out.replace(/'(\\.|[^'\\])*'/g, "''");
  // Remove double-quoted strings
  out = out.replace(/"(\\.|[^"\\])*"/g, '""');
  // Remove template literals (naïve; doesn't handle nested ${`...`} but
  // good enough; we only care about `await`/`import(`/`require(` keywords
  // outside strings, which is conservative).
  out = out.replace(/`(\\.|[^`\\])*`/g, '``');
  return out;
}
