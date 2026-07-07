/**
 * Local accuracy grading for `eigenpal run ... --example`.
 *
 * A dataset example's `expected.json` is, by convention, a PARTIAL assertion:
 * it lists only the fields that must be identical on every correct run
 * (timestamps, random ids, and free-form LLM text are deliberately omitted).
 * Grading therefore is a partial deep match — every leaf present in `expected`
 * must exist and be equal in the run `actual` output; extra fields in `actual`
 * are ignored. Arrays are graded by index and must have equal length.
 *
 * This is a structural diff, not the server-side evaluator score. For the
 * weighted, multi-metric evaluator accuracy, use `eigenpal workflow experiment
 * run` instead.
 */

export interface GradeResult {
  matched: boolean;
  /** Human-readable mismatch paths, e.g. `invoice.amount: 10 != 12`. */
  diffs: string[];
}

const MAX_VALUE_LEN = 60;

function preview(value: unknown): string {
  let text: string;
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    text = String(value);
  }
  if (text === undefined) text = String(value);
  return text.length > MAX_VALUE_LEN ? `${text.slice(0, MAX_VALUE_LEN)}…` : text;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function joinPath(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}

function walk(expected: unknown, actual: unknown, path: string, diffs: string[]): void {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      diffs.push(`${path || '(root)'}: expected array, got ${preview(actual)}`);
      return;
    }
    if (expected.length !== actual.length) {
      diffs.push(`${path || '(root)'}: length ${expected.length} != ${actual.length}`);
    }
    const overlap = Math.min(expected.length, actual.length);
    for (let i = 0; i < overlap; i++) {
      walk(expected[i], actual[i], `${path}[${i}]`, diffs);
    }
    return;
  }

  if (isPlainObject(expected)) {
    if (!isPlainObject(actual)) {
      diffs.push(`${path || '(root)'}: expected object, got ${preview(actual)}`);
      return;
    }
    for (const [key, value] of Object.entries(expected)) {
      const childPath = joinPath(path, key);
      if (!(key in actual)) {
        diffs.push(`${childPath}: missing in output`);
        continue;
      }
      walk(value, actual[key], childPath, diffs);
    }
    return;
  }

  // Primitive (string, number, boolean, null, undefined).
  if (!Object.is(expected, actual)) {
    diffs.push(`${path || '(root)'}: ${preview(expected)} != ${preview(actual)}`);
  }
}

/**
 * Partial deep match of `actual` against `expected`. Returns `matched: true`
 * only when every leaf in `expected` is present and equal in `actual`.
 */
export function gradeAgainstExpected(expected: unknown, actual: unknown): GradeResult {
  const diffs: string[] = [];
  walk(expected, actual, '', diffs);
  return { matched: diffs.length === 0, diffs };
}
