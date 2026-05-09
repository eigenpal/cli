/**
 * Helpers for the `transform.script` step's user-supplied function. The YAML
 * stores the entire `function script(arg1, arg2, …) { … }` declaration as a
 * string — this module is the single source of truth for parsing /
 * validating / extracting the body, used by (a) the Zod schema's
 * `.refine()` checks, (b) the worker before handing the function to the
 * sandbox, and (c) the dashboard's Monaco editor for client-side mirror
 * checks.
 *
 * Mirrors `packages/types/src/eval/score-function.ts` (the evaluator's
 * `scoreScript` helper module). The shape is parallel-not-shared because
 * the evaluator hardcodes the function name + parameter list, while
 * `transform.script` derives both from `Object.keys(inputs)` at the call
 * site. Parameterizing the evaluator's helpers would have been clumsier
 * than copying the structure.
 */

/**
 * Hard cap on the function string length. Larger than the evaluator's
 * 10 KB ceiling because transform.script bodies often inline tabular
 * shape definitions, big lookup maps, or chained reduce pipelines —
 * 10 KB caused real-world rejections without buying meaningful safety
 * (V8 parses 50 KB synchronously without choking). The cap exists to
 * stop someone shoving a 1 MB blob into the YAML and slowing parse.
 */
export const SCRIPT_FN_MAX_BYTES = 50_000;

/** Loose header — accepts any param list, only requires `function script(…){`.
 *  Used by `extractScriptFunctionBody` so we can still extract the body when
 *  the param list is wrong; the param-list mismatch is a separate, more
 *  specific error. */
const ANY_HEADER_REGEX = /function\s+script\s*\(([^)]*)\)\s*\{/;

/**
 * Linear-time leading-trivia stripper: consumes whitespace, line
 * comments, and block comments at the start of `text`. Used as a
 * pre-pass before the strict signature regex so the regex itself stays a
 * single anchored match with no alternation. Unterminated block comments
 * leave the rest of the text intact; the regex check on the remainder will
 * then fail cleanly.
 *
 * Copied from the evaluator's `score-function.ts` rather than shared —
 * this module is a sibling, and a single shared internal helper would
 * cross-couple two boundaries that should be free to evolve.
 */
function stripLeadingTrivia(text: string): string {
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\v' || ch === '\f') {
      i++;
      continue;
    }
    if (ch === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i + 2);
      if (nl === -1) return '';
      i = nl + 1;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end === -1) break;
      i = end + 2;
      continue;
    }
    break;
  }
  return text.slice(i);
}

/**
 * Strip comments and string/template literals from JS source so a regex
 * check (e.g. `\b(return|throw)\b`) doesn't false-positive on tokens that
 * aren't actually statements. Linear-time, mirrors the brace-walker in
 * `extractScriptFunctionBody`. Best-effort: regex literals are not
 * tracked because tokenizing them requires JS lexing context — false
 * positives on `/return/` are accepted as the lower-cost trade-off.
 */
export function stripCommentsAndStrings(text: string): string {
  let out = '';
  let i = 0;
  let inLine = false;
  let inBlock = false;
  let strQuote: string | null = null;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (inLine) {
      if (ch === '\n') {
        inLine = false;
        out += ch;
      }
    } else if (inBlock) {
      if (ch === '*' && next === '/') {
        inBlock = false;
        i++;
      }
    } else if (strQuote) {
      if (ch === '\\') i++;
      else if (ch === strQuote) strQuote = null;
    } else if (ch === '/' && next === '/') {
      inLine = true;
      i++;
    } else if (ch === '/' && next === '*') {
      inBlock = true;
      i++;
    } else if (ch === '"' || ch === "'" || ch === '`') {
      strQuote = ch;
    } else {
      out += ch;
    }
    i++;
  }
  return out;
}

/** Build a strict header regex for the exact param list the caller declares. */
function strictHeaderRegex(paramNames: readonly string[]): RegExp {
  const params = paramNames.map(escapeRegExp).join('\\s*,\\s*');
  // Accept zero-arg case as `function script()`. The optional `async\s+`
  // prefix lets `async function script(…)` still satisfy the signature
  // check (function name + parameter order). The `async` keyword is then
  // rejected by `getScriptFunctionRuntimeIssue` with a dedicated "must be
  // synchronous" message, so the user sees one clear error instead of a
  // redundant signature-mismatch one.
  return new RegExp(`^(?:async\\s+)?function\\s+script\\s*\\(\\s*${params}\\s*\\)\\s*\\{`);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Strict signature check — does the text declare
 * `function script(${paramNames.join(', ')}) { … }` at the top level (after
 * optional leading whitespace / comments)? Param order is load-bearing:
 * silent swaps would feed the wrong inputs to user code and produce
 * baffling output.
 */
export function hasValidScriptSignature(fn: string, paramNames: readonly string[]): boolean {
  return strictHeaderRegex(paramNames).test(stripLeadingTrivia(fn));
}

/**
 * Pure syntactic parseability check. `new Function` only validates syntax;
 * it doesn't execute the body. Pair with `hasValidScriptSignature` for the
 * semantic "is this actually the right declaration" check.
 */
export function isParseableScriptFunction(fn: string): boolean {
  try {
    new Function(fn);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reject patterns that are syntactically valid JS but won't work in the
 * QuickJS sandbox. Surfacing these at validation time gives the author a
 * clear message; without it they'd get a confused empty result with a
 * runtime "X is not a function" error after the workflow ran.
 *
 * Each check is a word-boundary regex against the raw source. False
 * positives only on the same identifier appearing inside a string literal,
 * which is rare enough to be an acceptable trade for not having to lex.
 *
 * Runtime semantics for the patterns we catch:
 * - `async script`: returns a Promise. The worker calls it synchronously so
 *   the result is a Promise object, fails downstream.
 * - Dynamic `import(...)`: QuickJS has no module loader.
 * - `require(...)`: undefined in the sandbox; throws ReferenceError.
 *
 * `await` outside async is a SyntaxError already (caught by
 * `isParseableScriptFunction`), so it doesn't need its own check.
 */
export function getScriptFunctionRuntimeIssue(fn: string): string | null {
  if (/\basync\s+function\s+script\b/.test(fn)) {
    return 'script must be synchronous (drop the `async` keyword — the sandbox calls it sync, so a Promise return won’t be awaited)';
  }
  if (/\bimport\s*\(/.test(fn)) {
    return 'dynamic `import(...)` is not supported in the script sandbox';
  }
  if (/\brequire\s*\(/.test(fn)) {
    return '`require(...)` is not available in the script sandbox (no Node module system)';
  }
  return null;
}

/**
 * Pull the body and parameter list out from between the function header and
 * its matching close brace. Tracks brace depth (with string / template /
 * line + block comment awareness) instead of `lastIndexOf('}')` — bodies
 * routinely contain object literals, template `}`, and JSDoc, so a naive
 * search truncates everything past the first inner `}`.
 *
 * Best-effort: anything that confuses this scanner (e.g. a regex literal
 * containing `}`) just degrades to `wrapperOk: false`, which surfaces as a
 * clear "keep the function shape" error.
 */
export function extractScriptFunctionBody(fn: string): {
  body: string;
  paramNames: string[];
  wrapperOk: boolean;
  /** Source after the function's closing brace (modulo trivia). When non-
   *  empty the user wrote code outside the declaration — the worker's
   *  re-wrap would silently drop it, so the schema rejects this case
   *  instead of letting it land. */
  trailing: string;
} {
  const headerMatch = fn.match(ANY_HEADER_REGEX);
  if (!headerMatch || headerMatch.index === undefined) {
    return { body: fn, paramNames: [], wrapperOk: false, trailing: '' };
  }
  const paramText = headerMatch[1] ?? '';
  const paramNames = paramText
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const start = headerMatch.index + headerMatch[0].length;
  let depth = 1;
  let i = start;
  let inLine = false;
  let inBlock = false;
  let strQuote: string | null = null;
  while (i < fn.length) {
    const ch = fn[i];
    const next = fn[i + 1];
    if (inLine) {
      if (ch === '\n') inLine = false;
    } else if (inBlock) {
      if (ch === '*' && next === '/') {
        inBlock = false;
        i++;
      }
    } else if (strQuote) {
      if (ch === '\\') i++;
      else if (ch === strQuote) strQuote = null;
    } else if (ch === '/' && next === '/') {
      inLine = true;
      i++;
    } else if (ch === '/' && next === '*') {
      inBlock = true;
      i++;
    } else if (ch === '"' || ch === "'" || ch === '`') {
      strQuote = ch;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const inner = fn.slice(start, i).replace(/^\n+|\n+$/g, '');
        // Anything after the closing brace, with leading trivia stripped:
        // a non-empty `trailing` means the user wrote code that the
        // worker's re-wrap would silently drop.
        const trailing = stripLeadingTrivia(fn.slice(i + 1)).replace(/^\s+|\s+$/g, '');
        return { body: inner, paramNames, wrapperOk: true, trailing };
      }
    }
    i++;
  }
  return { body: fn.slice(start), paramNames, wrapperOk: false, trailing: '' };
}

/**
 * Convert an input name into the type-alias identifier the dashboard editor
 * advertises (e.g. `items` → `_Items`). Kept here so the JSDoc preamble
 * we emit references the same alias the Monaco extra-lib registers.
 */
export function scriptParamTypeAlias(name: string): string {
  if (!name) return '_';
  return '_' + name[0].toUpperCase() + name.slice(1);
}

/**
 * Single source of truth for the canonical wrapper shape (JSDoc preamble +
 * `function script(args) { body }`). `defaultScriptFunction` and
 * `wrapBodyAsScriptFunction` are thin wrappers around this — they only
 * differ in the body content, so co-locating the format keeps the JSDoc
 * preamble from drifting between them.
 *
 * The JSDoc `@param` lines reference per-input type aliases (e.g.
 * `@param {_Items} items`) instead of `{unknown}`. The dashboard's
 * Monaco editor registers matching `type _Items = <ts>` declarations
 * via `addExtraLib`, so the function parameter resolves to the upstream
 * step's actual output shape — without this pairing the parameter
 * shadows the global `declare const` and autocomplete falls back to
 * `unknown`.
 */
function buildScriptFunction(body: string, paramNames: readonly string[]): string {
  const params = paramNames.join(', ');
  const jsdoc = paramNames.length
    ? paramNames.map((p) => ` * @param {${scriptParamTypeAlias(p)}} ${p}`).join('\n') + '\n'
    : '';
  return `/**
 * Transform the inputs into the step's output.
 *
${jsdoc} * @returns the step output (validated against \`outputSchema\` if set)
 */
function script(${params}) {
${body}
}
`;
}

/**
 * Canonical default function text for a given parameter list. The dashboard
 * pins this when the user creates a fresh `transform.script` step or
 * resets its body. Includes a JSDoc preamble so Monaco's IntelliSense
 * surfaces the parameter types declared by the editor's `inScopeTypes`.
 */
export function defaultScriptFunction(paramNames: readonly string[]): string {
  return buildScriptFunction(
    `  // TODO: return the transformed value\n  return ${paramNames[0] ?? 'null'};`,
    paramNames
  );
}

/**
 * Wrap a bare body (statements only) as a fully-formed `script` declaration
 * for the given parameter list. Used by the worker's BC adapter and the
 * dashboard's migrate-on-load, so legacy `code:` YAML keeps running and
 * editing migrates to the new `function:` shape.
 */
export function wrapBodyAsScriptFunction(body: string, paramNames: readonly string[]): string {
  return buildScriptFunction(body.replace(/^\n+|\n+$/g, ''), paramNames);
}
