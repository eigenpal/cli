export type JsonSelectToken = string | number | '*';

/**
 * Read a small, deterministic JSON-path subset without requiring jq:
 * `output.subjects`, `items[0].name`, and `items[].name` / `items[*].name`.
 */
export function selectJsonValue(value: unknown, path: string): unknown {
  const tokens = parseJsonSelectPath(path);
  let values: unknown[] = [value];
  let usedWildcard = false;

  for (const token of tokens) {
    const next: unknown[] = [];
    for (const current of values) {
      if (token === '*') {
        usedWildcard = true;
        if (Array.isArray(current)) next.push(...current);
        continue;
      }
      if (typeof token === 'number') {
        if (Array.isArray(current) && token < current.length) next.push(current[token]);
        continue;
      }
      if (current && typeof current === 'object' && !Array.isArray(current)) {
        const object = current as Record<string, unknown>;
        if (Object.hasOwn(object, token)) next.push(object[token]);
      }
    }
    values = next;
  }

  if (values.length === 0) {
    throw new Error(`--select path "${path}" did not match the JSON payload`);
  }
  return usedWildcard ? values : values[0];
}

export function parseJsonSelectPath(path: string): JsonSelectToken[] {
  const trimmed = path.trim();
  if (
    trimmed.startsWith('$') &&
    trimmed !== '$' &&
    !trimmed.startsWith('$.') &&
    !trimmed.startsWith('$[')
  ) {
    throw invalidPath(path);
  }
  const source = trimmed.replace(/^\$(?:\.)?/, '');
  if (!source) return [];

  const tokens: JsonSelectToken[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    if (source[cursor] === '.') {
      if (
        cursor === 0 ||
        cursor === source.length - 1 ||
        source[cursor - 1] === '.' ||
        source[cursor + 1] === '.' ||
        source[cursor + 1] === '['
      ) {
        throw invalidPath(path);
      }
      cursor++;
      continue;
    }
    if (source[cursor] === '[') {
      if (cursor > 0 && source[cursor - 1] === '.') throw invalidPath(path);
      const close = source.indexOf(']', cursor + 1);
      if (close === -1) throw invalidPath(path);
      const inner = source.slice(cursor + 1, close);
      if (inner === '' || inner === '*') tokens.push('*');
      else if (/^(0|[1-9]\d*)$/.test(inner)) tokens.push(Number(inner));
      else throw invalidPath(path);
      cursor = close + 1;
      if (cursor < source.length && source[cursor] !== '.' && source[cursor] !== '[') {
        throw invalidPath(path);
      }
      continue;
    }

    if (cursor > 0 && source[cursor - 1] !== '.') throw invalidPath(path);
    const match = /^[A-Za-z_$][A-Za-z0-9_$-]*/.exec(source.slice(cursor));
    if (!match) throw invalidPath(path);
    tokens.push(match[0]);
    cursor += match[0].length;
  }
  return tokens;
}

function invalidPath(path: string): Error {
  return new Error(
    `Invalid --select path "${path}". Use dot keys, numeric indexes, or [] wildcards (for example output.subjects[].name).`
  );
}
