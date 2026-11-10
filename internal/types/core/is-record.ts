/**
 * Any non-null, non-array object. Loose on purpose: class instances and
 * null-prototype objects pass. `@eigenpal/common`'s `isPlainObject` is the
 * strict prototype check.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
