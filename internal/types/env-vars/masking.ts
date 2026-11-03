import { ENV_VAR_MASK_MIN_LENGTH } from './schema';

/**
 * Masks secret values in run data before it is stored: the database holds
 * `[secret:NAME]`, never the value.
 *
 * Unmasking is deliberately narrow. Stored data can hold text from documents
 * and other runs, so a placeholder in it is not proof that the secret belongs
 * there; `unmask` only restores the names a caller passes, which the worker
 * limits to the secrets the step's own configuration references (a retry
 * reusing its first attempt's resolved config).
 *
 * Only strings, arrays and plain objects are walked, and an object is copied
 * only when something in it changed.
 */
export interface SecretMasker {
  readonly names: readonly string[];
  mask<T>(value: T): T;
  unmask<T>(value: T, names: readonly string[]): T;
}

export function createSecretMasker(secrets: Record<string, string>): SecretMasker | null {
  // Longest first, so a secret that contains another is replaced whole.
  const entries = Object.entries(secrets)
    .filter(([, value]) => value.length >= ENV_VAR_MASK_MIN_LENGTH)
    .sort(([, a], [, b]) => b.length - a.length)
    .map(([name, value]) => ({ name, value, placeholder: `[secret:${name}]` }));
  if (entries.length === 0) return null;

  return {
    names: entries.map((e) => e.name),
    mask: (value) =>
      walk(value, (text) =>
        entries.reduce(
          (out, { value: secret, placeholder }) =>
            out.includes(secret) ? out.replaceAll(secret, placeholder) : out,
          text
        )
      ),
    unmask: (value, names) => {
      const restore = entries.filter((e) => names.includes(e.name));
      if (restore.length === 0) return value;
      return walk(value, (text) =>
        text.includes('[secret:')
          ? restore.reduce((out, e) => out.replaceAll(e.placeholder, e.value), text)
          : text
      );
    },
  };
}

function walk<T>(value: T, text: (s: string) => string): T {
  if (typeof value === 'string') return text(value) as T;
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((item) => {
      const next = walk(item, text);
      if (next !== item) changed = true;
      return next;
    });
    return (changed ? out : value) as T;
  }
  if (value && typeof value === 'object' && isPlainObject(value)) {
    let out: Record<string, unknown> | null = null;
    for (const [key, child] of Object.entries(value)) {
      const next = walk(child, text);
      if (next !== child) (out ??= { ...(value as Record<string, unknown>) })[key] = next;
    }
    return (out ?? value) as T;
  }
  return value;
}

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
