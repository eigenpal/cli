/**
 * Helpers for the custom-script evaluator's score function. The YAML stores
 * the entire function declaration as a string — this module is the single
 * source of truth for parsing / validating / extracting the body, used by
 * (a) the Zod schema's `.refine()` checks (server-side at YAML-parse time
 * AND client-side at form-save time), (b) the worker before handing the
 * function to the sandbox, and (c) the dashboard's Monaco editor when it
 * needs to peel off the wrapper to run inline checks.
 */

/**
 * Strict header pattern. Flat — runs against text that's already had its
 * leading whitespace + comments stripped by `stripLeadingTrivia`. Splitting
 * the comment handling out of the regex keeps it linear and ReDoS-free; an
 * earlier version folded comment matching into the regex itself with `(?:A|B|C)*`,
 * which is fine on benign input but invites backtracking on adversarial input.
 *
 * The contract REQUIRES the function be named `scoreScript` and take
 * `expected, actual` in that order — silent parameter-order swaps would
 * invert every score in the eval set.
 */
// The optional `async\s+` prefix lets `async function scoreScript(…)` still
// satisfy the signature check (function name + parameter order). The
// `async` keyword is then rejected by `getScoreFunctionRuntimeIssue` with a
// dedicated "must be synchronous" message, so the user sees exactly one
// clear error instead of a redundant signature-mismatch one.
const STRICT_HEADER_REGEX =
  /^(?:async\s+)?function\s+scoreScript\s*\(\s*expected\s*,\s*actual\s*\)\s*\{/;

/** Loose header for `extractScoreFunctionBody` — accepts whatever the user
 *  wrote so we can still extract the body for the "must return / throw" check,
 *  deferring the real signature error to `hasValidScoreSignature`. */
const ANY_HEADER_REGEX = /function\s+scoreScript\s*\([^)]*\)\s*\{/;

/**
 * Linear-time leading-trivia stripper: consumes whitespace, `//` line
 * comments, and `/* … *\/` block comments at the start of `text`. Used as a
 * pre-pass before the strict signature regex so the regex itself stays a
 * single anchored match with no alternation. Unterminated block comments
 * leave the rest of the text intact; the regex check on the remainder will
 * then fail cleanly.
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
      if (end === -1) break; // unterminated — let the regex fail on the remainder
      i = end + 2;
      continue;
    }
    break;
  }
  return text.slice(i);
}

/**
 * Strict signature check. Pass = the text declares `function
 * scoreScript(expected, actual) { … }` at the top level (after optional
 * leading comments / whitespace).
 */
export function hasValidScoreSignature(fn: string): boolean {
  return STRICT_HEADER_REGEX.test(stripLeadingTrivia(fn));
}

/**
 * Pure syntactic parseability check — does the supplied text parse as a
 * JavaScript program? `new Function` only validates syntax; it doesn't
 * execute the body. Pair with `hasValidScoreSignature` for the semantic
 * "is this actually a valid scoreScript declaration" check.
 */
export function isParseableScoreFunction(fn: string): boolean {
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
 * clear message; without it they'd get a confused score=0 with a runtime
 * "scoreScript is not a function" or "X is not a function" error after the
 * eval ran.
 *
 * Each check is a word-boundary regex against the raw source. False
 * positives only on the same identifier appearing inside a string literal
 * (e.g. `const s = "use require()"`), which is rare enough to be an
 * acceptable trade for not having to lex.
 *
 * Runtime semantics for the patterns we catch:
 * - `async` scoreScript: returns a Promise. The worker calls it synchronously
 *   so the result is a Promise object, fails the numeric check, scores 0
 *   with "must return a number". Authoring confusion guaranteed.
 * - Dynamic `import(...)`: QuickJS sandbox has no module loader, so the
 *   promise rejects synchronously with a vague resolver error.
 * - `require(...)`: undefined in the sandbox; throws ReferenceError.
 *
 * `await` outside async is a SyntaxError already (caught by
 * `isParseableScoreFunction`), so it doesn't need its own check.
 */
export function getScoreFunctionRuntimeIssue(fn: string): string | null {
  if (/\basync\s+function\s+scoreScript\b/.test(fn)) {
    return 'scoreScript must be synchronous (drop the `async` keyword — the sandbox calls it sync, so a Promise return scores 0)';
  }
  if (/\bimport\s*\(/.test(fn)) {
    return 'dynamic `import(...)` is not supported in the score sandbox';
  }
  if (/\brequire\s*\(/.test(fn)) {
    return '`require(...)` is not available in the score sandbox (no Node module system)';
  }
  return null;
}

/**
 * Pull the body out from between the function header and its matching close.
 *
 * Tracks brace depth (with string / template / line + block comment awareness)
 * instead of `lastIndexOf('}')` — bodies routinely contain object literals,
 * template `}`, and JSDoc, so a naive search truncates everything past the
 * first inner `}`.
 *
 * Best-effort: anything that confuses this scanner (e.g. a regex literal
 * containing `}`) just degrades to `wrapperOk: false`, which surfaces as a
 * clear "keep the function shape" error.
 */
export function extractScoreFunctionBody(fn: string): {
  body: string;
  wrapperOk: boolean;
} {
  const headerMatch = fn.match(ANY_HEADER_REGEX);
  if (!headerMatch || headerMatch.index === undefined) {
    return { body: fn, wrapperOk: false };
  }
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
        return { body: inner, wrapperOk: true };
      }
    }
    i++;
  }
  return { body: fn.slice(start), wrapperOk: false };
}

/**
 * Canonical default function text. Same JSDoc preamble the dashboard pinned
 * for IntelliSense + the always-required `scoreScript(expected, actual)`
 * signature. Used by the dashboard's "reset" action and as the base layer
 * for `defaultScoreFunction(outputSchema)` below.
 */
export function defaultScoreFunction(): string {
  return `/**
 * Score the workflow output against the example's expected output.
 *
 * @param {Expected} expected the example's expected output
 * @param {Actual} actual the workflow's actual output
 * @returns {number} a score in [0, 1]; throws are caught and scored as 0
 */
function scoreScript(expected, actual) {
  // Return a number in [0, 1]; throws are caught and scored as 0.
  return JSON.stringify(actual) === JSON.stringify(expected) ? 1 : 0;
}
`;
}

/**
 * Wrap a bare body (statements only) as a fully-formed `scoreScript`
 * declaration. Used by the dashboard to migrate pre-rename YAML
 * (`config.body`) into the new `config.function` shape on load — the
 * on-disk YAML still has to be ported by hand, but the editor recovers.
 */
export function wrapBodyAsScoreFunction(body: string): string {
  const trimmed = body.replace(/^\n+|\n+$/g, '');
  return `/**
 * Score the workflow output against the example's expected output.
 *
 * @param {Expected} expected the example's expected output
 * @param {Actual} actual the workflow's actual output
 * @returns {number} a score in [0, 1]; throws are caught and scored as 0
 */
function scoreScript(expected, actual) {
${trimmed}
}
`;
}
