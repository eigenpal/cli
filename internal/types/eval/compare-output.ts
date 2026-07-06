/**
 * Compare expected output (data) to actual execution result (data) for eval.
 * Shared by: eval API route (server-side comparison, streamed to CLI), row comparison UI, metrics.
 *
 * - Expected can be partial: only keys present in expected are checked; actual may have extra keys.
 * - Nested objects are compared recursively (not as strings).
 * - "__any__" is a wildcard: expected string "__any__" or object { fileId: "__any__" } matches any actual.
 */

const NUM_EPSILON = 1e-6;
const WILDCARD_ANY = '__any__';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isWildcard(value: unknown): boolean {
  if (value === WILDCARD_ANY) return true;
  return isPlainObject(value) && value.fileId === WILDCARD_ANY;
}

function isEmptyExpected(value: unknown): boolean {
  return value === null || value === undefined || value === '';
}

function numbersMatch(actual: number, expected: number): boolean {
  if (actual === expected) return true;
  if (!Number.isFinite(actual) || !Number.isFinite(expected)) return false;
  if (actual === 0 || expected === 0) return Math.abs(actual - expected) < NUM_EPSILON;
  const maxMagnitude = Math.max(Math.abs(actual), Math.abs(expected));
  return Math.abs(actual - expected) / maxMagnitude < NUM_EPSILON;
}

function coerceStringToPrimitive(value: string): unknown {
  const lower = value.toLowerCase().trim();
  if (lower === 'true' || lower === 'yes') return true;
  if (lower === 'false' || lower === 'no') return false;
  if (value !== '' && !Number.isNaN(Number(value))) return Number(value);
  return value;
}

/** Compare two leaf values with type coercion and numeric tolerance. */
export function valuesMatch(actual: unknown, expected: unknown): boolean {
  if (actual === expected) return true;
  if (actual === null || actual === undefined || expected === null || expected === undefined) {
    return false;
  }
  if (isWildcard(expected)) return true;
  if (typeof actual === 'boolean' && typeof expected === 'string') {
    const coerced = coerceStringToPrimitive(expected);
    if (typeof coerced === 'boolean') return actual === coerced;
  }
  if (typeof expected === 'boolean' && typeof actual === 'string') {
    const coerced = coerceStringToPrimitive(actual);
    if (typeof coerced === 'boolean') return expected === coerced;
  }
  if (typeof actual === 'number' && typeof expected === 'number') {
    return numbersMatch(actual, expected);
  }
  if (typeof actual === 'number' && typeof expected === 'string') {
    const coerced = coerceStringToPrimitive(expected);
    if (typeof coerced === 'number') return numbersMatch(actual, coerced);
  }
  if (typeof expected === 'number' && typeof actual === 'string') {
    const coerced = coerceStringToPrimitive(actual);
    if (typeof coerced === 'number') return numbersMatch(expected, coerced);
  }
  if (typeof actual === 'string' && typeof expected === 'string') {
    const actualNum = Number(actual);
    const expectedNum = Number(expected);
    if (
      !Number.isNaN(actualNum) &&
      !Number.isNaN(expectedNum) &&
      actual !== '' &&
      expected !== ''
    ) {
      return numbersMatch(actualNum, expectedNum);
    }
    return expected === actual;
  }
  if (Array.isArray(actual) && Array.isArray(expected)) {
    if (actual.length !== expected.length) return false;
    return actual.every((val, idx) => valuesMatch(val, expected[idx]));
  }
  if (isPlainObject(actual) && isPlainObject(expected)) {
    return Object.keys(expected).every((key) => valuesMatch(actual[key], expected[key]));
  }
  try {
    return JSON.stringify(actual) === JSON.stringify(expected);
  } catch {
    return String(actual) === String(expected);
  }
}

export interface OutputComparisonMismatch {
  path: string;
  expected: unknown;
  actual: unknown;
}

export interface OutputComparisonResult {
  noExpectedData: boolean;
  passed: boolean;
  matchedFields: number;
  totalFields: number;
  mismatches: OutputComparisonMismatch[];
}

function partialMatch(
  expected: unknown,
  actual: unknown,
  path: string,
  mismatches: OutputComparisonMismatch[]
): boolean {
  if (isEmptyExpected(expected)) return true;
  if (isWildcard(expected)) return true;

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      mismatches.push({ path, expected, actual });
      return false;
    }
    let allMatch = true;
    for (let i = 0; i < expected.length; i++) {
      const childPath = path ? `${path}[${i}]` : `[${i}]`;
      if (!partialMatch(expected[i], actual[i], childPath, mismatches)) {
        allMatch = false;
      }
    }
    return allMatch;
  }

  if (isPlainObject(expected) && isPlainObject(actual)) {
    let allMatch = true;
    for (const [key, expectedVal] of Object.entries(expected)) {
      if (isEmptyExpected(expectedVal)) continue;
      const childPath = path ? `${path}.${key}` : key;
      if (!partialMatch(expectedVal, actual[key], childPath, mismatches)) {
        allMatch = false;
      }
    }
    return allMatch;
  }

  if (valuesMatch(actual, expected)) return true;
  mismatches.push({ path, expected, actual });
  return false;
}

export function schemaFileUploadMatchesField(uploadBasename: string, fieldName: string): boolean {
  return uploadBasename === fieldName || uploadBasename.startsWith(`${fieldName}.`);
}

export function fileFieldNamesFromJsonSchema(schema: Record<string, unknown> | null): Set<string> {
  if (!schema || typeof schema !== 'object') return new Set();
  const props =
    (schema as { properties?: Record<string, { 'x-eigenpal-type'?: string }> }).properties ?? {};
  return new Set(
    Object.entries(props)
      .filter(([, p]) => p['x-eigenpal-type'] === 'file')
      .map(([k]) => k)
  );
}

export function suppressRequiredMissingErrorsForSchemaFileFields<
  T extends { path: string; message: string },
>(
  errors: T[],
  schema: Record<string, unknown> | null,
  mode:
    | { kind: 'inputEval'; uploadBasenames: string[] }
    | { kind: 'outputExpectedJson'; goldenBasenames: string[] }
): T[] {
  const fileFields = fileFieldNamesFromJsonSchema(schema);
  if (fileFields.size === 0) return errors;

  return errors.filter((e) => {
    if (!e.message.startsWith('Required field') || !fileFields.has(e.path)) return true;
    if (mode.kind === 'outputExpectedJson') {
      if (mode.goldenBasenames.length === 0) return true;
      return false;
    }
    return !mode.uploadBasenames.some((n) => schemaFileUploadMatchesField(n, e.path));
  });
}

export function fieldStemFromGoldenName(goldenBasename: string): string {
  const i = goldenBasename.indexOf('.');
  return i === -1 ? goldenBasename : goldenBasename.slice(0, i);
}

export function goldenFileSatisfiedInResult(
  goldenBasename: string,
  resultFileNames: string[]
): boolean {
  const stem = fieldStemFromGoldenName(goldenBasename);
  return resultFileNames.some((r) => r === goldenBasename || schemaFileUploadMatchesField(r, stem));
}

export function compareOutput(
  expectedData: Record<string, unknown> | null | undefined,
  actualData: Record<string, unknown> | null | undefined,
  fileFields?: string[],
  resultFileNames?: string[],
  expectedGoldenFileNames?: string[]
): OutputComparisonResult {
  const golden = (expectedGoldenFileNames ?? []).filter(
    (n) => typeof n === 'string' && n.length > 0 && !n.includes('/')
  );
  const fileFieldSet = new Set(fileFields ?? []);
  const results = resultFileNames ?? [];

  const data: Record<string, unknown> | null =
    expectedData && isPlainObject(expectedData) ? { ...expectedData } : null;
  if (data && golden.length > 0) {
    for (const k of fileFieldSet) {
      delete data[k];
    }
  }

  const mismatches: OutputComparisonMismatch[] = [];
  let matchedFields = 0;
  let totalFields = 0;

  for (const g of golden) {
    totalFields++;
    if (goldenFileSatisfiedInResult(g, results)) {
      matchedFields++;
    } else {
      mismatches.push({
        path: `output/${g}`,
        expected: '(golden file)',
        actual: '(no matching file in output/)',
      });
    }
  }

  if (!data || !isPlainObject(data)) {
    return {
      noExpectedData: totalFields === 0,
      passed: totalFields > 0 && mismatches.length === 0,
      matchedFields,
      totalFields,
      mismatches,
    };
  }

  const actual = isPlainObject(actualData) ? actualData : {};

  for (const [field, expectedValue] of Object.entries(data)) {
    if (isEmptyExpected(expectedValue)) continue;

    if (fileFieldSet.has(field)) {
      if (golden.length > 0) {
        continue;
      }
      if (!results.length) continue;
      totalFields++;
      const hasFile = results.some((f) => schemaFileUploadMatchesField(f, field));
      if (hasFile) {
        matchedFields++;
      } else {
        mismatches.push({ path: field, expected: expectedValue, actual: '(no file generated)' });
      }
      continue;
    }

    totalFields++;
    if (partialMatch(expectedValue, actual[field], field, mismatches)) {
      matchedFields++;
    }
  }

  return {
    noExpectedData: totalFields === 0,
    passed: totalFields > 0 && mismatches.length === 0,
    matchedFields,
    totalFields,
    mismatches,
  };
}

export interface FieldComparisonResult {
  hasExpected: boolean;
  matchedFields: number;
  totalFields: number;
  mismatches: Array<{ field: string; expected: unknown; actual: unknown }>;
}

export function compareExpectedValues(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>
): FieldComparisonResult {
  const mismatches: Array<{ field: string; expected: unknown; actual: unknown }> = [];
  let matchedFields = 0;
  let totalFields = 0;

  for (const [field, expectedValue] of Object.entries(expected)) {
    if (isEmptyExpected(expectedValue)) continue;
    totalFields++;

    const actualValue = actual[field];
    if (valuesMatch(actualValue, expectedValue)) {
      matchedFields++;
    } else {
      mismatches.push({ field, expected: expectedValue, actual: actualValue });
    }
  }

  return { hasExpected: totalFields > 0, matchedFields, totalFields, mismatches };
}

export function getActualDataFromResult(result: unknown): Record<string, unknown> | null {
  if (!isPlainObject(result)) return null;
  if (isPlainObject(result.data)) return result.data;
  return result;
}

const MAX_DIFF_VALUE_LENGTH = 500;

export function formatDiffValue(value: unknown): string {
  try {
    const str = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    if (str.length <= MAX_DIFF_VALUE_LENGTH) return str;
    return str.slice(0, MAX_DIFF_VALUE_LENGTH) + '...';
  } catch {
    return String(value);
  }
}
