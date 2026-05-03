import { describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeEvalJson } from './fs-helpers';

describe('writeEvalJson', () => {
  it('writes formatted JSON when value is present', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eigenpal-writeEvalJson-'));
    const path = join(dir, 'input.json');
    try {
      writeEvalJson(path, { a: 1, b: 2 });
      expect(existsSync(path)).toBe(true);
      expect(readFileSync(path, 'utf-8')).toBe('{\n  "a": 1,\n  "b": 2\n}\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('removes file when value is null', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eigenpal-writeEvalJson-'));
    const path = join(dir, 'input.json');
    try {
      writeFileSync(path, '{}', 'utf-8');
      expect(existsSync(path)).toBe(true);
      writeEvalJson(path, null);
      expect(existsSync(path)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('removes file when value is undefined', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eigenpal-writeEvalJson-'));
    const path = join(dir, 'expected.json');
    try {
      writeFileSync(path, '{}', 'utf-8');
      expect(existsSync(path)).toBe(true);
      writeEvalJson(path, undefined);
      expect(existsSync(path)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('no-ops when value is null and file does not exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eigenpal-writeEvalJson-'));
    const path = join(dir, 'missing.json');
    try {
      writeEvalJson(path, null);
      expect(existsSync(path)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
