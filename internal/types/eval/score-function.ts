/**
 * Helpers for the custom-script evaluator's score source. The YAML stores
 * optional supporting `type` aliases plus the entire
 * `function scoreScript(expected, actual): number { … }` declaration as a
 * string. Validation, body extraction, and runtime checks all live in the
 * shared `compileTypedScript` pipeline (`packages/types/src/typed-script`) —
 * this module only owns the canonical default function text used by the
 * dashboard's "reset" action and the server-side schema's seed.
 */

/**
 * Canonical default function text. Same JSDoc preamble the dashboard pinned
 * for IntelliSense + the always-required `scoreScript(expected, actual)`
 * signature with the mandatory `: number` return annotation.
 */
export function defaultScoreFunction(): string {
  return `type WorkflowData = Record<string, unknown>;
type WorkflowOutput = { data: WorkflowData };
type Expected = WorkflowOutput;
type Actual = WorkflowOutput;

/**
 * Score the workflow output against the example's expected output.
 * Return a number in [0, 1]; throws are caught and scored as 0.
 *
 * The \`: number\` return-type annotation is required and enforced at
 * push time. The body is compiled to JS via sucrase before sandbox.
 */
function scoreScript(expected: WorkflowOutput, actual: WorkflowOutput): number {
  return JSON.stringify(actual) === JSON.stringify(expected) ? 1 : 0;
}
`;
}
