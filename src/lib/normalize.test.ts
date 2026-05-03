import { describe, expect, it } from 'bun:test';
import { normalizeJson, normalizeJsonString, normalizeYaml } from './normalize';

describe('normalizeJson', () => {
  it('sorts object keys recursively', () => {
    const input = { z: 1, a: 2, m: { y: 3, b: 4 } };
    const out = normalizeJson(input) as Record<string, unknown>;
    expect(Object.keys(out)).toEqual(['a', 'm', 'z']);
    expect(Object.keys(out.m as Record<string, unknown>)).toEqual(['b', 'y']);
  });

  it('preserves array order', () => {
    const input = { arr: [3, 1, 2] };
    const out = normalizeJson(input) as Record<string, unknown>;
    expect(out.arr).toEqual([3, 1, 2]);
  });

  it('returns primitives as-is', () => {
    expect(normalizeJson(null)).toBe(null);
    expect(normalizeJson(42)).toBe(42);
    expect(normalizeJson('hi')).toBe('hi');
  });
});

describe('normalizeJsonString', () => {
  it('produces identical strings for semantically equal objects with different key order', () => {
    const a = { b: 1, a: 2 };
    const b = { a: 2, b: 1 };
    expect(normalizeJsonString(a)).toBe(normalizeJsonString(b));
  });
});

describe('normalizeYaml', () => {
  it('sorts keys in YAML object', () => {
    const yaml = 'z: 1\na: 2\nm: 3\n';
    const out = normalizeYaml(yaml);
    expect(out).toContain('a:');
    expect(out).toContain('m:');
    expect(out).toContain('z:');
    expect(out.indexOf('a:')).toBeLessThan(out.indexOf('m:'));
    expect(out.indexOf('m:')).toBeLessThan(out.indexOf('z:'));
  });

  it('returns trimmed string when not parseable as object', () => {
    const yaml = '  plain scalar  ';
    expect(normalizeYaml(yaml)).toBe('plain scalar');
  });

  it('returns empty string for empty/whitespace input', () => {
    expect(normalizeYaml('')).toBe('');
    expect(normalizeYaml('   ')).toBe('');
  });
});
