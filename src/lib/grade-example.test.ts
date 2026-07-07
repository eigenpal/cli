import { describe, expect, it } from 'bun:test';
import { gradeAgainstExpected } from './grade-example';

describe('gradeAgainstExpected', () => {
  it('matches when actual deep-equals expected', () => {
    const res = gradeAgainstExpected({ a: 1, b: 'x' }, { a: 1, b: 'x' });
    expect(res.matched).toBe(true);
    expect(res.diffs).toEqual([]);
  });

  it('ignores extra keys present only in actual (partial match)', () => {
    const res = gradeAgainstExpected({ a: 1 }, { a: 1, extra: 'ignored', nested: { z: 9 } });
    expect(res.matched).toBe(true);
    expect(res.diffs).toEqual([]);
  });

  it('flags a differing primitive with a path', () => {
    const res = gradeAgainstExpected({ total: 100 }, { total: 99 });
    expect(res.matched).toBe(false);
    expect(res.diffs).toHaveLength(1);
    expect(res.diffs[0]).toContain('total');
  });

  it('flags a missing expected key', () => {
    const res = gradeAgainstExpected({ a: 1, b: 2 }, { a: 1 });
    expect(res.matched).toBe(false);
    expect(res.diffs.some((d) => d.includes('b'))).toBe(true);
    expect(res.diffs.some((d) => d.toLowerCase().includes('missing'))).toBe(true);
  });

  it('recurses into nested objects and reports the full path', () => {
    const res = gradeAgainstExpected(
      { invoice: { vendor: 'Acme', amount: 10 } },
      { invoice: { vendor: 'Acme', amount: 12 } }
    );
    expect(res.matched).toBe(false);
    expect(res.diffs[0]).toContain('invoice.amount');
  });

  it('grades arrays by index and requires equal length', () => {
    const ok = gradeAgainstExpected(
      { items: [{ q: 1 }, { q: 2 }] },
      { items: [{ q: 1 }, { q: 2 }] }
    );
    expect(ok.matched).toBe(true);

    const lenDiff = gradeAgainstExpected({ items: [{ q: 1 }] }, { items: [{ q: 1 }, { q: 2 }] });
    expect(lenDiff.matched).toBe(false);
    expect(lenDiff.diffs.some((d) => d.includes('items') && /length/i.test(d))).toBe(true);

    const elemDiff = gradeAgainstExpected(
      { items: [{ q: 1 }, { q: 2 }] },
      { items: [{ q: 1 }, { q: 9 }] }
    );
    expect(elemDiff.matched).toBe(false);
    expect(elemDiff.diffs[0]).toContain('items[1].q');
  });

  it('treats type mismatches as differences', () => {
    const res = gradeAgainstExpected({ a: 1 }, { a: '1' });
    expect(res.matched).toBe(false);
    const objVsScalar = gradeAgainstExpected({ a: { b: 1 } }, { a: 5 });
    expect(objVsScalar.matched).toBe(false);
  });

  it('handles null and boolean leaves exactly', () => {
    expect(gradeAgainstExpected({ a: null }, { a: null }).matched).toBe(true);
    expect(gradeAgainstExpected({ a: null }, { a: 0 }).matched).toBe(false);
    expect(gradeAgainstExpected({ ok: false }, { ok: false }).matched).toBe(true);
    expect(gradeAgainstExpected({ ok: false }, { ok: true }).matched).toBe(false);
  });

  it('matches two empty objects', () => {
    expect(gradeAgainstExpected({}, { anything: 1 }).matched).toBe(true);
  });

  it('caps and counts diffs without throwing on large mismatches', () => {
    const res = gradeAgainstExpected({ a: 1, b: 2, c: 3 }, { a: 9, b: 9, c: 9 });
    expect(res.matched).toBe(false);
    expect(res.diffs).toHaveLength(3);
  });
});
