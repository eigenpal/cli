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
export const MAX_UNORDERED_ARRAY_ITEMS = 1_000;
export const MAX_UNORDERED_PAIR_COMPARISONS = 1_000_000;
export const MAX_UNORDERED_COMPARISON_OPERATIONS = 2_000_000;
export const MAX_COMPARISON_MISMATCHES = 200;

/**
 * Absolute slack stamped onto normalized legacy rules when `numericTolerance`
 * was omitted. Comparison itself uses historical relative epsilon in that case;
 * this constant is only the normalize/details stand-in and the unit for explicit
 * absolute tolerances.
 */
export const DEFAULT_EXACT_DIFF_NUMERIC_TOLERANCE = NUM_EPSILON;

export const EXACT_DIFF_ARRAY_ITEMS = ['at-least', 'at-most', 'exactly'] as const;
export type ExactDiffArrayItems = (typeof EXACT_DIFF_ARRAY_ITEMS)[number];

export interface ExactDiffPathRule {
  /** Array matching mode at this path. Omitted = ordered. */
  order?: 'ordered' | 'unordered';
  /**
   * How expected and actual array items relate. Arrays only. Omitted = `at-least`.
   * Independent of `order`. Ordered arrays use positional prefix matching
   * (`at-least` = expected is a prefix of actual; `at-most` = actual is a prefix
   * of expected; `exactly` = equal-length positional). Unordered arrays match
   * distinct items in any order.
   */
  items?: ExactDiffArrayItems;
  /**
   * Relative object-field path(s) used to pair unordered array items by identity.
   * Applies only at the array path where it is set (not inherited) and only to
   * unordered arrays of objects. Omitted = structural compatibility matching.
   * Identity type and value must both match (numeric `10` differs from `'10'`).
   */
  matchBy?: string | readonly string[];
  /** Whether actual objects may contain keys absent from expected. Objects only. */
  allowExtraFields?: boolean;
  /**
   * Maximum absolute difference for numeric leaves at or under this path.
   * Omitted = inherit, then historical relative epsilon (not this field as 1e-6).
   */
  numericTolerance?: number;
}

export type ExactDiffRules = Readonly<Record<string, ExactDiffPathRule>>;

export interface OutputComparisonOptions {
  /** Dot-paths to arrays whose expected items may match actual items in any order. */
  unorderedPaths?: readonly string[];
  /**
   * Maximum absolute difference between numeric values that still matches.
   * When omitted, comparison uses historical relative epsilon (`|a-e|/max(|a|,|e|) < 1e-6`,
   * with a zero-magnitude special case). Explicit `0` is exact absolute match.
   */
  numericTolerance?: number;
  /**
   * Whether actual objects may contain keys absent from expected objects.
   * Also controls extra array items when `rules` is not set.
   */
  allowExtraFields?: boolean;
  /** Per-path comparison rules. When set, inherited effective rules override the globals above. */
  rules?: ExactDiffRules;
}

interface EffectivePathRule {
  order: 'ordered' | 'unordered';
  items: ExactDiffArrayItems;
  allowExtraFields: boolean;
  /** `undefined` means historical relative epsilon, not absolute 1e-6. */
  numericTolerance?: number;
  /** Normalized identity paths at this array path only; not inherited. */
  matchBy?: string[];
}

const MATCH_BY_ONLY_UNORDERED_OBJECTS =
  '(rule `matchBy` applies only to unordered arrays of objects)';
const IDENTITY_VALUE_MISSING = '(identity value missing)';
const IDENTITY_VALUE_NOT_SCALAR = '(identity value must be a JSON scalar)';
const DUPLICATE_IDENTITY = '(duplicate identity)';

type IdentityAtom =
  | readonly ['s', string]
  | readonly ['n', number]
  | readonly ['b', boolean]
  | readonly ['z'];

export function normalizeExactDiffMatchBy(matchBy: string | readonly string[]): string[] {
  return (Array.isArray(matchBy) ? [...matchBy] : [matchBy]).map((path) => path.trim());
}

interface InternalComparisonOptions {
  unorderedPaths: ReadonlySet<string>;
  numericTolerance?: number;
  allowExtraFields: boolean;
  rules: ExactDiffRules | null;
  trackUnorderedWork: boolean;
  unorderedBudget: {
    remainingPairs: number;
    remainingOperations: number;
    exceeded: boolean;
    reason?: 'candidate-pairs' | 'recursive-operations';
    details?: Record<string, unknown>;
  };
}

export function tokenizeEvalPath(path: string): string[] {
  if (!path || path === '$') return [];
  return path.match(/[^.[\]]+|\[\]|\[\d+\]/g) ?? [];
}

export function normalizeEvalPath(path: string): string {
  if (!path || path === '$') return path || '$';
  return path.replace(/\[\d+\]/g, '[]');
}

function evalPathTokenMatches(pattern: string, candidate: string): boolean {
  return pattern === candidate || (pattern === '[]' && /^\[\d+\]$/.test(candidate));
}

/** True when `descendant` is strictly nested under `ancestor` (`$` is the full-output root). */
export function evalPathIsDescendant(descendant: string, ancestor: string): boolean {
  if (descendant === ancestor) return false;
  if (ancestor === '$' || ancestor === '') return descendant !== '$' && descendant !== '';
  const ancestorTokens = tokenizeEvalPath(ancestor);
  const descendantTokens = tokenizeEvalPath(descendant);
  return (
    descendantTokens.length > ancestorTokens.length &&
    ancestorTokens.every((token, index) =>
      evalPathTokenMatches(token, descendantTokens[index] ?? '')
    )
  );
}

/**
 * A sole trailing item path (`lineItems[]`, `groups[].members[]`) names the
 * parent array as the comparison root and keeps the `[]` key as an item
 * override. Leaf paths such as `lineItems[].qty` stay leaf selections.
 */
function scopeRootForRulePath(path: string): string {
  if (!path.endsWith('[]')) return path;
  const parent = path.slice(0, -2);
  return parent.length > 0 ? parent : path;
}

/**
 * Rule keys that should be compared as roots. `$` (or an empty map) means the full
 * output; descendant keys of an ancestor selection are overrides, not extra scopes.
 */
export function selectExactDiffRulePaths(rules: ExactDiffRules): string[] | null {
  const keys = Object.keys(rules);
  if (keys.length === 0 || keys.includes('$')) return null;
  const roots = keys.filter(
    (key) => !keys.some((other) => other !== key && evalPathIsDescendant(key, other))
  );
  const selected: string[] = [];
  for (const key of roots) {
    const scope = scopeRootForRulePath(key);
    if (!selected.includes(scope)) selected.push(scope);
  }
  return selected;
}

function ancestorRulePaths(path: string): string[] {
  const ancestors = ['$'];
  const tokens = tokenizeEvalPath(normalizeEvalPath(path));
  let current = '';
  for (const token of tokens) {
    current =
      token === '[]' || token.startsWith('[')
        ? `${current}${token}`
        : current
          ? `${current}.${token}`
          : token;
    ancestors.push(current);
  }
  return ancestors;
}

function effectiveRule(path: string, options: InternalComparisonOptions): EffectivePathRule {
  const normalized = normalizeEvalPath(path);
  const result: EffectivePathRule = {
    order: options.unorderedPaths.has(normalized) ? 'unordered' : 'ordered',
    items: options.allowExtraFields ? 'at-least' : 'exactly',
    allowExtraFields: options.allowExtraFields,
    numericTolerance: options.numericTolerance,
  };
  if (!options.rules) return result;

  result.order = options.unorderedPaths.has(normalized) ? 'unordered' : 'ordered';
  result.items = 'at-least';
  result.allowExtraFields = true;
  result.numericTolerance = undefined;

  for (const ancestor of ancestorRulePaths(path)) {
    const rule = options.rules[ancestor];
    if (!rule) continue;
    if (rule.order !== undefined) result.order = rule.order;
    if (rule.items !== undefined) result.items = rule.items;
    if (rule.allowExtraFields !== undefined) result.allowExtraFields = rule.allowExtraFields;
    if (rule.numericTolerance !== undefined) result.numericTolerance = rule.numericTolerance;
  }
  // matchBy is identity for this array path only — do not inherit from ancestors.
  const exactRule = options.rules[normalized] ?? options.rules[path];
  if (exactRule?.matchBy !== undefined) {
    result.matchBy = normalizeExactDiffMatchBy(exactRule.matchBy);
  }
  return result;
}

function valuesAtRulePath(tree: unknown, rulePath: string): unknown[] {
  if (rulePath === '$') return tree === undefined ? [] : [tree];
  let current: unknown[] = [tree];
  for (const token of tokenizeEvalPath(rulePath)) {
    const next: unknown[] = [];
    for (const value of current) {
      if (token === '[]') {
        if (Array.isArray(value)) next.push(...value);
        continue;
      }
      if (isPlainObject(value) && Object.hasOwn(value, token)) next.push(value[token]);
    }
    current = next;
    if (current.length === 0) return [];
  }
  return current;
}

function diagnoseMisappliedRules(
  expected: unknown,
  rules: ExactDiffRules
): OutputComparisonMismatch[] {
  const mismatches: OutputComparisonMismatch[] = [];
  for (const [path, rule] of Object.entries(rules)) {
    const values = valuesAtRulePath(expected, path);
    if (values.length === 0) continue;
    const allScalar = values.every((value) => !isPlainObject(value) && !Array.isArray(value));
    const allNonArray = values.every((value) => !Array.isArray(value));
    const sample = values[0];
    // Containers can inherit type-specific fields to descendants. Only flag
    // fields attached to scalar leaves where they cannot apply or inherit.
    if (path.endsWith('[]')) {
      const arrayPath = path.slice(0, -2);
      const itemActual = values[0] ?? '(item scope)';
      if (rule.order !== undefined) {
        mismatches.push({
          path,
          expected: `(rule \`order\` belongs on the array path \`${arrayPath}\`, not the item path \`${path}\`)`,
          actual: itemActual,
        });
      }
      if (rule.items !== undefined) {
        mismatches.push({
          path,
          expected: `(rule \`items\` belongs on the array path \`${arrayPath}\`, not the item path \`${path}\`)`,
          actual: itemActual,
        });
      }
      if (rule.matchBy !== undefined) {
        mismatches.push({
          path,
          expected: `(rule \`matchBy\` belongs on the array path \`${arrayPath}\`, not the item path \`${path}\`)`,
          actual: itemActual,
        });
      }
    } else if (allScalar) {
      if (rule.order !== undefined) {
        mismatches.push({
          path,
          expected: '(rule `order` applies only to arrays)',
          actual: sample,
        });
      }
      if (rule.items !== undefined) {
        mismatches.push({
          path,
          expected: '(rule `items` applies only to arrays)',
          actual: sample,
        });
      }
      if (rule.allowExtraFields !== undefined) {
        mismatches.push({
          path,
          expected: '(rule `allowExtraFields` applies only to objects)',
          actual: sample,
        });
      }
    }
    if (rule.matchBy !== undefined && allNonArray && !path.endsWith('[]')) {
      mismatches.push({
        path,
        expected: MATCH_BY_ONLY_UNORDERED_OBJECTS,
        actual: sample,
      });
    }
  }
  return mismatches;
}

function exceedUnorderedBudget(
  options: InternalComparisonOptions,
  reason: 'candidate-pairs' | 'recursive-operations',
  details: Record<string, unknown>
): void {
  if (options.unorderedBudget.exceeded) return;
  options.unorderedBudget.exceeded = true;
  options.unorderedBudget.reason = reason;
  options.unorderedBudget.details = details;
}

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

function numbersMatch(actual: number, expected: number, tolerance?: number): boolean {
  if (actual === expected) return true;
  if (!Number.isFinite(actual) || !Number.isFinite(expected)) return false;
  if (tolerance === undefined) {
    if (actual === 0 || expected === 0) return Math.abs(actual - expected) < NUM_EPSILON;
    const maxMagnitude = Math.max(Math.abs(actual), Math.abs(expected));
    return Math.abs(actual - expected) / maxMagnitude < NUM_EPSILON;
  }
  return Math.abs(actual - expected) <= tolerance;
}

function coerceStringToPrimitive(value: string): unknown {
  const lower = value.toLowerCase().trim();
  if (lower === 'true' || lower === 'yes') return true;
  if (lower === 'false' || lower === 'no') return false;
  if (value !== '' && !Number.isNaN(Number(value))) return Number(value);
  return value;
}

/** Compare two leaf values with type coercion and numeric tolerance. */
export function valuesMatch(
  actual: unknown,
  expected: unknown,
  options: { numericTolerance?: number } = {}
): boolean {
  const numericTolerance = options.numericTolerance;
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
    return numbersMatch(actual, expected, numericTolerance);
  }
  if (typeof actual === 'number' && typeof expected === 'string') {
    const coerced = coerceStringToPrimitive(expected);
    if (typeof coerced === 'number') return numbersMatch(actual, coerced, numericTolerance);
  }
  if (typeof expected === 'number' && typeof actual === 'string') {
    const coerced = coerceStringToPrimitive(actual);
    if (typeof coerced === 'number') return numbersMatch(expected, coerced, numericTolerance);
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
      return numbersMatch(actualNum, expectedNum, numericTolerance);
    }
    return expected === actual;
  }
  if (Array.isArray(actual) && Array.isArray(expected)) {
    if (actual.length !== expected.length) return false;
    return actual.every((val, idx) => valuesMatch(val, expected[idx], options));
  }
  if (isPlainObject(actual) && isPlainObject(expected)) {
    return Object.keys(expected).every((key) => valuesMatch(actual[key], expected[key], options));
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

function appendExtraFieldMismatches(
  entries: [string, unknown][],
  path: string,
  mismatches: OutputComparisonMismatch[]
): void {
  const visibleCount = Math.min(
    entries.length,
    Math.max(0, MAX_COMPARISON_MISMATCHES - mismatches.length)
  );
  for (const [key, actual] of entries.slice(0, visibleCount)) {
    mismatches.push({
      path: path ? `${path}.${key}` : key,
      expected: '(no extra field)',
      actual,
    });
  }

  const omittedCount = entries.length - visibleCount;
  if (omittedCount > 0 && mismatches.length <= MAX_COMPARISON_MISMATCHES) {
    mismatches.push({
      path,
      expected: `(${omittedCount} additional extra fields omitted)`,
      actual: '(details truncated)',
    });
  }
}

function partialMatch(
  expected: unknown,
  actual: unknown,
  path: string,
  mismatches: OutputComparisonMismatch[],
  options: InternalComparisonOptions
): boolean {
  if (options.trackUnorderedWork) {
    if (options.unorderedBudget.remainingOperations <= 0) {
      exceedUnorderedBudget(options, 'recursive-operations', {
        maxOperations: MAX_UNORDERED_COMPARISON_OPERATIONS,
      });
      return false;
    }
    options.unorderedBudget.remainingOperations--;
  }

  if (isEmptyExpected(expected)) return true;
  if (isWildcard(expected)) return true;

  const rule = effectiveRule(path, options);

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      mismatches.push({ path, expected, actual });
      return false;
    }
    if (rule.matchBy && rule.matchBy.length > 0 && rule.order !== 'unordered') {
      mismatches.push({
        path,
        expected: MATCH_BY_ONLY_UNORDERED_OBJECTS,
        actual: {
          order: rule.order,
          expectedItems: expected.length,
          actualItems: actual.length,
        },
      });
      return false;
    }
    if (rule.order === 'unordered') {
      return unorderedArrayMatch(expected, actual, path, mismatches, options, rule);
    }
    return orderedPrefixMatch(expected, actual, path, mismatches, options, rule.items);
  }

  if (isPlainObject(expected) && isPlainObject(actual)) {
    let allMatch = true;
    for (const [key, expectedVal] of Object.entries(expected)) {
      if (isEmptyExpected(expectedVal)) continue;
      const childPath = path ? `${path}.${key}` : key;
      if (!partialMatch(expectedVal, actual[key], childPath, mismatches, options)) {
        allMatch = false;
      }
      if (options.unorderedBudget.exceeded) return false;
    }
    if (!rule.allowExtraFields) {
      const extraEntries = Object.entries(actual).filter(([key]) => !Object.hasOwn(expected, key));
      if (extraEntries.length > 0) {
        appendExtraFieldMismatches(extraEntries, path, mismatches);
        allMatch = false;
      }
    }
    return allMatch;
  }

  if (valuesMatch(actual, expected, { numericTolerance: rule.numericTolerance })) return true;
  mismatches.push({ path, expected, actual });
  return false;
}

function childPath(path: string, index: number): string {
  return path ? `${path}[${index}]` : `[${index}]`;
}

function chargeArrayMatchBudget(
  expected: unknown[],
  actual: unknown[],
  path: string,
  mismatches: OutputComparisonMismatch[],
  options: InternalComparisonOptions
): boolean {
  if (expected.length > MAX_UNORDERED_ARRAY_ITEMS || actual.length > MAX_UNORDERED_ARRAY_ITEMS) {
    mismatches.push({
      path,
      expected: `(unordered comparison supports at most ${MAX_UNORDERED_ARRAY_ITEMS} items)`,
      actual: { expectedItems: expected.length, actualItems: actual.length },
    });
    return false;
  }
  const requiredPairs = expected.length * actual.length;
  if (requiredPairs > options.unorderedBudget.remainingPairs) {
    exceedUnorderedBudget(options, 'candidate-pairs', {
      maxPairComparisons: MAX_UNORDERED_PAIR_COMPARISONS,
      requiredPairComparisons: requiredPairs,
      remainingPairComparisons: options.unorderedBudget.remainingPairs,
    });
    return false;
  }
  options.unorderedBudget.remainingPairs -= requiredPairs;
  return true;
}

function appendCappedMismatches(
  path: string,
  mismatches: OutputComparisonMismatch[],
  extras: OutputComparisonMismatch[],
  omittedLabel: string
): void {
  const visible = extras.slice(0, Math.max(0, MAX_COMPARISON_MISMATCHES - mismatches.length));
  mismatches.push(...visible);
  const omitted = extras.length - visible.length;
  if (omitted > 0) {
    mismatches.push({
      path,
      expected: `(${omitted} additional ${omittedLabel} omitted)`,
      actual: '(details truncated)',
    });
  }
}

/**
 * Ordered positional matching. `at-least` requires expected to match actual from
 * index 0 (trailing actual extras allowed). `at-most` is the reverse: actual must
 * match expected from index 0 (trailing expected extras allowed). `exactly` is
 * equal-cardinality positional comparison.
 */
function orderedPrefixMatch(
  expected: unknown[],
  actual: unknown[],
  path: string,
  mismatches: OutputComparisonMismatch[],
  options: InternalComparisonOptions,
  items: ExactDiffArrayItems
): boolean {
  const pairCount =
    items === 'at-most' ? Math.min(expected.length, actual.length) : expected.length;
  let allMatch = true;
  for (let i = 0; i < pairCount; i++) {
    if (!partialMatch(expected[i], actual[i], childPath(path, i), mismatches, options)) {
      allMatch = false;
    }
    if (options.unorderedBudget.exceeded) return false;
  }
  if (items !== 'at-least' && actual.length > expected.length) {
    const extra: OutputComparisonMismatch[] = [];
    for (let i = expected.length; i < actual.length; i++) {
      extra.push({
        path: childPath(path, i),
        expected: '(no extra item)',
        actual: actual[i],
      });
    }
    appendCappedMismatches(path, mismatches, extra, 'extra items');
    allMatch = false;
  }
  return allMatch;
}

function identityAtom(value: unknown): IdentityAtom | null {
  if (value === null) return ['z'];
  if (typeof value === 'string') return ['s', value];
  if (typeof value === 'boolean') return ['b', value];
  if (typeof value === 'number' && Number.isFinite(value)) return ['n', value];
  return null;
}

function identityKey(atoms: IdentityAtom[]): string {
  return JSON.stringify(atoms);
}

function identityPreview(atoms: IdentityAtom[]): unknown[] {
  return atoms.map((atom) => {
    if (atom[0] === 's') {
      return atom[1].length > 80 ? `${atom[1].slice(0, 80)}...` : atom[1];
    }
    if (atom[0] === 'n') return atom[1];
    if (atom[0] === 'b') return atom[1];
    return null;
  });
}

function readRelativeObjectPath(
  item: Record<string, unknown>,
  relPath: string
): { kind: 'missing'; path: string } | { kind: 'ok'; value: unknown } {
  let current: unknown = item;
  let walked = '';
  for (const token of tokenizeEvalPath(relPath)) {
    walked = walked ? `${walked}.${token}` : token;
    if (
      token === '[]' ||
      /^\[\d+\]$/.test(token) ||
      !isPlainObject(current) ||
      !Object.hasOwn(current, token)
    ) {
      return { kind: 'missing', path: walked };
    }
    current = current[token];
  }
  if (current === undefined) return { kind: 'missing', path: relPath };
  return { kind: 'ok', value: current };
}

function extractItemIdentity(
  item: Record<string, unknown>,
  matchBy: string[],
  itemPath: string
):
  | { ok: true; key: string; atoms: IdentityAtom[] }
  | { ok: false; mismatches: OutputComparisonMismatch[] } {
  const atoms: IdentityAtom[] = [];
  const failures: OutputComparisonMismatch[] = [];
  for (const relPath of matchBy) {
    const read = readRelativeObjectPath(item, relPath);
    const fieldPath = `${itemPath}.${relPath}`;
    if (read.kind === 'missing') {
      failures.push({
        path: fieldPath,
        expected: IDENTITY_VALUE_MISSING,
        actual: '(missing)',
      });
      continue;
    }
    const atom = identityAtom(read.value);
    if (!atom) {
      failures.push({
        path: fieldPath,
        expected: IDENTITY_VALUE_NOT_SCALAR,
        actual: read.value,
      });
      continue;
    }
    atoms.push(atom);
  }
  if (failures.length > 0) return { ok: false, mismatches: failures };
  return { ok: true, key: identityKey(atoms), atoms };
}

function chargeIdentityMatchBudget(
  expected: unknown[],
  actual: unknown[],
  path: string,
  mismatches: OutputComparisonMismatch[],
  options: InternalComparisonOptions
): boolean {
  if (expected.length > MAX_UNORDERED_ARRAY_ITEMS || actual.length > MAX_UNORDERED_ARRAY_ITEMS) {
    mismatches.push({
      path,
      expected: `(unordered comparison supports at most ${MAX_UNORDERED_ARRAY_ITEMS} items)`,
      actual: { expectedItems: expected.length, actualItems: actual.length },
    });
    return false;
  }
  const requiredPairs = expected.length + actual.length;
  if (requiredPairs > options.unorderedBudget.remainingPairs) {
    exceedUnorderedBudget(options, 'candidate-pairs', {
      maxPairComparisons: MAX_UNORDERED_PAIR_COMPARISONS,
      requiredPairComparisons: requiredPairs,
      remainingPairComparisons: options.unorderedBudget.remainingPairs,
    });
    return false;
  }
  options.unorderedBudget.remainingPairs -= requiredPairs;
  return true;
}

type IndexedIdentity = { index: number; key: string; atoms: IdentityAtom[] };

type ClassifiedIdentity =
  | { kind: 'non-object'; index: number }
  | { kind: 'invalid'; index: number; mismatches: OutputComparisonMismatch[] }
  | { kind: 'ok'; identity: IndexedIdentity };

function classifyIdentityItems(
  items: unknown[],
  matchBy: string[],
  path: string
): ClassifiedIdentity[] {
  return items.map((item, index) => {
    if (!isPlainObject(item)) return { kind: 'non-object', index };
    const extracted = extractItemIdentity(item, matchBy, childPath(path, index));
    if (!extracted.ok) return { kind: 'invalid', index, mismatches: extracted.mismatches };
    return { kind: 'ok', identity: { index, key: extracted.key, atoms: extracted.atoms } };
  });
}

function okIdentities(classified: ClassifiedIdentity[]): IndexedIdentity[] {
  return classified.flatMap((entry) => (entry.kind === 'ok' ? [entry.identity] : []));
}

function groupIdentities(entries: IndexedIdentity[]): Map<string, IndexedIdentity[]> {
  const map = new Map<string, IndexedIdentity[]>();
  for (const entry of entries) {
    const group = map.get(entry.key) ?? [];
    group.push(entry);
    map.set(entry.key, group);
  }
  return map;
}

function requiredIdentityMismatches(
  classified: ClassifiedIdentity[],
  items: unknown[],
  path: string,
  matchBy: string[]
): OutputComparisonMismatch[] {
  const mismatches: OutputComparisonMismatch[] = [];
  const ok: IndexedIdentity[] = [];
  for (const entry of classified) {
    if (entry.kind === 'non-object') {
      mismatches.push({
        path: childPath(path, entry.index),
        expected: MATCH_BY_ONLY_UNORDERED_OBJECTS,
        actual: items[entry.index],
      });
      continue;
    }
    if (entry.kind === 'invalid') {
      mismatches.push(...entry.mismatches);
      continue;
    }
    ok.push(entry.identity);
  }
  const byKey = groupIdentities(ok);
  for (const group of byKey.values()) {
    if (group.length < 2) continue;
    const alsoAt = group.map((entry) => childPath(path, entry.index));
    for (const entry of group) {
      mismatches.push({
        path: childPath(path, entry.index),
        expected: DUPLICATE_IDENTITY,
        actual: {
          matchBy,
          identity: identityPreview(entry.atoms),
          alsoAt: alsoAt.slice(0, 20),
        },
      });
    }
  }
  return mismatches;
}

function pairRequiredIdentities(
  required: IndexedIdentity[],
  requiredItems: unknown[],
  optionalItems: unknown[],
  optionalByKey: Map<string, IndexedIdentity[]>,
  requiredIsExpected: boolean,
  path: string,
  extras: OutputComparisonMismatch[],
  options: InternalComparisonOptions
): boolean {
  const usedOptional = new Set<number>();
  for (const req of required) {
    const candidates = (optionalByKey.get(req.key) ?? []).filter(
      (candidate) => !usedOptional.has(candidate.index)
    );
    if (candidates.length === 0) {
      extras.push(
        requiredIsExpected
          ? {
              path: childPath(path, req.index),
              expected: requiredItems[req.index],
              actual: '(no matching item)',
            }
          : {
              path: childPath(path, req.index),
              expected: '(no extra item)',
              actual: requiredItems[req.index],
            }
      );
      continue;
    }

    let firstProbe: OutputComparisonMismatch[] | undefined;
    let paired = false;
    for (const candidate of candidates) {
      const probe: OutputComparisonMismatch[] = [];
      const expectedItem = requiredIsExpected
        ? requiredItems[req.index]
        : optionalItems[candidate.index];
      const actualItem = requiredIsExpected
        ? optionalItems[candidate.index]
        : requiredItems[req.index];
      const expectedPath = requiredIsExpected
        ? childPath(path, req.index)
        : childPath(path, candidate.index);
      if (partialMatch(expectedItem, actualItem, expectedPath, probe, options)) {
        usedOptional.add(candidate.index);
        paired = true;
        break;
      }
      if (options.unorderedBudget.exceeded) return false;
      firstProbe ??= probe;
    }
    if (paired) continue;
    if (firstProbe && firstProbe.length > 0) {
      extras.push(...firstProbe);
    } else {
      extras.push(
        requiredIsExpected
          ? {
              path: childPath(path, req.index),
              expected: requiredItems[req.index],
              actual: '(no matching item)',
            }
          : {
              path: childPath(path, req.index),
              expected: '(no extra item)',
              actual: requiredItems[req.index],
            }
      );
    }
  }
  return true;
}

/**
 * Pair unordered object-array items by exact composite identity, then
 * recursively compare each paired pair with inherited nested rules.
 *
 * `at-least` requires unique valid identities on expected items; extra actual
 * items may omit or duplicate identities. `at-most` requires unique valid
 * identities on actual items; missing expected identities are allowed.
 * `exactly` validates unique identities on both sides.
 */
function identityArrayMatch(
  expected: unknown[],
  actual: unknown[],
  path: string,
  mismatches: OutputComparisonMismatch[],
  options: InternalComparisonOptions,
  rule: EffectivePathRule
): boolean {
  const matchBy = rule.matchBy ?? [];
  if (!chargeIdentityMatchBudget(expected, actual, path, mismatches, options)) {
    return false;
  }

  const extras: OutputComparisonMismatch[] = [];
  const requireExpectedIdentity = rule.items !== 'at-most';
  const requireActualIdentity = rule.items !== 'at-least';
  const expectedClass = classifyIdentityItems(expected, matchBy, path);
  const actualClass = classifyIdentityItems(actual, matchBy, path);

  if (requireExpectedIdentity) {
    extras.push(...requiredIdentityMismatches(expectedClass, expected, path, matchBy));
  }
  if (requireActualIdentity) {
    extras.push(...requiredIdentityMismatches(actualClass, actual, path, matchBy));
  }
  if (extras.length > 0) {
    appendCappedMismatches(path, mismatches, extras, 'identity mismatches');
    return false;
  }

  const expectedOk = okIdentities(expectedClass);
  const actualOk = okIdentities(actualClass);

  if (rule.items === 'at-most') {
    if (
      !pairRequiredIdentities(
        actualOk,
        actual,
        expected,
        groupIdentities(expectedOk),
        false,
        path,
        extras,
        options
      )
    ) {
      return false;
    }
  } else if (
    !pairRequiredIdentities(
      expectedOk,
      expected,
      actual,
      groupIdentities(actualOk),
      true,
      path,
      extras,
      options
    )
  ) {
    return false;
  } else if (rule.items === 'exactly') {
    const usedActualKeys = new Set(expectedOk.map((entry) => entry.key));
    for (const entry of actualOk) {
      if (usedActualKeys.has(entry.key)) continue;
      extras.push({
        path: childPath(path, entry.index),
        expected: '(no extra item)',
        actual: actual[entry.index],
      });
    }
  }

  appendCappedMismatches(path, mismatches, extras, 'unordered mismatches');
  return extras.length === 0;
}

/**
 * Match expected array items injectively against actual items. The bipartite
 * maximum matching avoids greedy false negatives when broad expected values
 * (for example `__any__` or partial objects) overlap with specific ones.
 */
function unorderedArrayMatch(
  expected: unknown[],
  actual: unknown[],
  path: string,
  mismatches: OutputComparisonMismatch[],
  options: InternalComparisonOptions,
  rule: EffectivePathRule
): boolean {
  if (rule.matchBy && rule.matchBy.length > 0) {
    return identityArrayMatch(expected, actual, path, mismatches, options, rule);
  }
  if (!chargeArrayMatchBudget(expected, actual, path, mismatches, options)) {
    return false;
  }

  const edges: number[][] = [];
  for (let expectedIndex = 0; expectedIndex < expected.length; expectedIndex++) {
    const expectedItem = expected[expectedIndex];
    const candidates: number[] = [];
    for (let actualIndex = 0; actualIndex < actual.length; actualIndex++) {
      const probeMismatches: OutputComparisonMismatch[] = [];
      if (
        partialMatch(
          expectedItem,
          actual[actualIndex],
          childPath(path, expectedIndex),
          probeMismatches,
          options
        )
      ) {
        candidates.push(actualIndex);
      }
      if (options.unorderedBudget.exceeded) {
        return false;
      }
    }
    edges.push(candidates);
  }

  const expectedToActual = Array<number>(expected.length).fill(-1);
  const actualToExpected = Array<number>(actual.length).fill(-1);
  const distance = Array<number>(expected.length).fill(0);

  function findAugmentingLayers(): boolean {
    const queue: number[] = [];
    let cursor = 0;
    let foundFreeActual = false;
    for (let expectedIndex = 0; expectedIndex < expected.length; expectedIndex++) {
      if (expectedToActual[expectedIndex] === -1) {
        distance[expectedIndex] = 0;
        queue.push(expectedIndex);
      } else {
        distance[expectedIndex] = Number.POSITIVE_INFINITY;
      }
    }
    while (cursor < queue.length) {
      const expectedIndex = queue[cursor++];
      for (const actualIndex of edges[expectedIndex]) {
        const matchedExpected = actualToExpected[actualIndex];
        if (matchedExpected === -1) {
          foundFreeActual = true;
        } else if (distance[matchedExpected] === Number.POSITIVE_INFINITY) {
          distance[matchedExpected] = distance[expectedIndex] + 1;
          queue.push(matchedExpected);
        }
      }
    }
    return foundFreeActual;
  }

  function assignAugmentingPath(expectedIndex: number): boolean {
    for (const actualIndex of edges[expectedIndex]) {
      const matchedExpected = actualToExpected[actualIndex];
      if (
        matchedExpected === -1 ||
        (distance[matchedExpected] === distance[expectedIndex] + 1 &&
          assignAugmentingPath(matchedExpected))
      ) {
        expectedToActual[expectedIndex] = actualIndex;
        actualToExpected[actualIndex] = expectedIndex;
        return true;
      }
    }
    distance[expectedIndex] = Number.POSITIVE_INFINITY;
    return false;
  }

  while (findAugmentingLayers()) {
    for (let expectedIndex = 0; expectedIndex < expected.length; expectedIndex++) {
      if (expectedToActual[expectedIndex] === -1) {
        assignAugmentingPath(expectedIndex);
      }
    }
  }

  const extras: OutputComparisonMismatch[] = [];
  if (rule.items !== 'at-most') {
    for (let expectedIndex = 0; expectedIndex < expected.length; expectedIndex++) {
      if (expectedToActual[expectedIndex] !== -1) continue;
      extras.push({
        path: childPath(path, expectedIndex),
        expected: expected[expectedIndex],
        actual: '(no matching item)',
      });
    }
  }
  if (rule.items !== 'at-least') {
    for (let actualIndex = 0; actualIndex < actual.length; actualIndex++) {
      if (actualToExpected[actualIndex] !== -1) continue;
      extras.push({
        path: childPath(path, actualIndex),
        expected: '(no extra item)',
        actual: actual[actualIndex],
      });
    }
  }
  appendCappedMismatches(path, mismatches, extras, 'unordered mismatches');
  return extras.length === 0;
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
  expectedGoldenFileNames?: string[],
  options: OutputComparisonOptions = {}
): OutputComparisonResult {
  const golden = (expectedGoldenFileNames ?? []).filter(
    (n) => typeof n === 'string' && n.length > 0 && !n.includes('/')
  );
  const fileFieldSet = new Set(fileFields ?? []);
  const results = resultFileNames ?? [];
  const rules = options.rules ?? null;
  const trackUnorderedWork =
    (options.unorderedPaths?.length ?? 0) > 0 ||
    (rules != null &&
      Object.values(rules).some((rule) => (rule.order ?? 'ordered') === 'unordered'));
  const comparisonOptions: InternalComparisonOptions = {
    unorderedPaths: new Set(options.unorderedPaths ?? []),
    numericTolerance: options.numericTolerance,
    allowExtraFields: options.allowExtraFields ?? true,
    rules,
    trackUnorderedWork,
    unorderedBudget: {
      remainingPairs: MAX_UNORDERED_PAIR_COMPARISONS,
      remainingOperations: MAX_UNORDERED_COMPARISON_OPERATIONS,
      exceeded: false,
    },
  };

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

  if (rules) {
    const diagnostics = diagnoseMisappliedRules(data, rules);
    if (diagnostics.length > 0) {
      return {
        noExpectedData: false,
        passed: false,
        matchedFields: 0,
        totalFields: diagnostics.length,
        mismatches: diagnostics,
      };
    }
  }

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
    if (partialMatch(expectedValue, actual[field], field, mismatches, comparisonOptions)) {
      matchedFields++;
    }
    if (comparisonOptions.unorderedBudget.exceeded) {
      mismatches.push({
        path: field,
        expected: `(unordered comparison exceeded its ${comparisonOptions.unorderedBudget.reason} budget)`,
        actual: comparisonOptions.unorderedBudget.details,
      });
      break;
    }
  }

  const rootRule = effectiveRule('', comparisonOptions);
  if (!rootRule.allowExtraFields && !comparisonOptions.unorderedBudget.exceeded) {
    const extraEntries = Object.entries(actual).filter(
      ([field]) => !Object.hasOwn(data, field) && !fileFieldSet.has(field)
    );
    totalFields += extraEntries.length;
    appendExtraFieldMismatches(extraEntries, '', mismatches);
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
