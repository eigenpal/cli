/**
 * Helpers for the `transform.script` step's user-supplied function. The YAML
 * stores the entire `function script(arg1, arg2, ...): T { ... }` declaration
 * as a string. Validation, body extraction, and runtime checks all live in
 * the shared `compileTypedScript` pipeline (`packages/types/src/typed-script`);
 * this module only owns the dashboard-facing helpers: the canonical default
 * text and the Monaco type-alias name convention.
 */

/**
 * Hard cap on the function string length. Larger than the evaluator's
 * 10 KB ceiling because transform.script bodies often inline tabular
 * shape definitions, big lookup maps, or chained reduce pipelines;
 * 10 KB caused real-world rejections without buying meaningful safety
 * (V8 parses 50 KB synchronously without choking). The cap exists to
 * stop someone shoving a 1 MB blob into the YAML and slowing parse.
 */
export const SCRIPT_FN_MAX_BYTES = 50_000;

/**
 * Convert an input name into the type-alias identifier the dashboard editor
 * advertises (e.g. `items` -> `_Items`). Kept here so the JSDoc preamble
 * we emit references the same alias the Monaco extra-lib registers.
 */
export function scriptParamTypeAlias(name: string): string {
  if (!name) return '_';
  return '_' + name[0].toUpperCase() + name.slice(1);
}

/**
 * Canonical default function text for a fresh `transform.script` step.
 *
 * Uses the named-alias form: a `type StepOutput = { ... }` declaration at
 * the top, referenced by the function's return annotation. This keeps the
 * signature line short for non-trivial returns and gives the user one
 * obvious place to describe the output shape. The converter resolves the
 * local alias the same way it resolves an inline literal; an inline
 * `function script(args): { ... } { ... }` is equally valid for terse
 * returns.
 */
export function defaultScriptFunction(paramNames: readonly string[]): string {
  const typedParams = paramNames.map((p) => `${p}: ${scriptParamTypeAlias(p)}`).join(', ');
  return `// This type IS this step's output schema. Add the fields your function returns;
// downstream steps reference them as steps.<this-step>.output.<field>.
type StepOutput = {
  // example: total: number;
};

// The parameters below must match the keys of the "inputs" map above,
// in the same order. Each one receives the resolved value of its
// template expression. Add an input field above to add a parameter here.
function script(${typedParams}): StepOutput {
  // TODO: build the output
  return {};
}
`;
}
