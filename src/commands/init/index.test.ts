import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { __testing, init } from './index';

function mkTmp(): string {
  return mkdtempSync(join(tmpdir(), 'eigenpal-init-test-'));
}

describe('isValidProjectName', () => {
  const { isValidProjectName } = __testing;

  it('accepts kebab-case', () => {
    expect(isValidProjectName('parse-invoices')).toBe(true);
  });

  it('accepts snake_case', () => {
    expect(isValidProjectName('parse_invoices_v2')).toBe(true);
  });

  it('rejects uppercase', () => {
    expect(isValidProjectName('ParseInvoices')).toBe(false);
  });

  it('rejects spaces', () => {
    expect(isValidProjectName('parse invoices')).toBe(false);
  });

  it('rejects names starting with a hyphen', () => {
    expect(isValidProjectName('-parse')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidProjectName('')).toBe(false);
  });

  it('rejects very long names', () => {
    expect(isValidProjectName('a'.repeat(61))).toBe(false);
  });
});

describe('resolveTemplatesRoot', () => {
  it('finds the bundled templates directory', () => {
    const root = __testing.resolveTemplatesRoot();
    expect(root).toContain('templates');
    // All declared templates exist on disk.
    for (const name of __testing.TEMPLATE_NAMES) {
      expect(statSync(join(root, name)).isDirectory()).toBe(true);
    }
  });
});

describe('init scaffold', () => {
  it('writes the blank template into a fresh directory', async () => {
    const root = mkTmp();
    try {
      await init('parse-invoices', {
        template: 'blank',
        yes: true,
        dir: join(root, 'parse-invoices'),
      });
      const target = join(root, 'parse-invoices');

      expect(statSync(target).isDirectory()).toBe(true);
      expect(statSync(join(target, 'workflow.yaml')).isFile()).toBe(true);
      expect(statSync(join(target, 'evaluators.yaml')).isFile()).toBe(true);
      expect(statSync(join(target, 'README.md')).isFile()).toBe(true);
      expect(
        statSync(join(target, 'dataset', 'examples', 'sample', 'input', 'arguments.json')).isFile()
      ).toBe(true);

      // __NAME__ placeholder is rewritten to the project name.
      const yaml = readFileSync(join(target, 'workflow.yaml'), 'utf-8');
      expect(yaml).toContain('name: parse-invoices');
      expect(yaml).not.toContain('__NAME__');

      // README has the project name too.
      const readme = readFileSync(join(target, 'README.md'), 'utf-8');
      expect(readme).toContain('parse-invoices');
      expect(readme).not.toContain('__NAME__');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('writes the pdf-extraction template with sample folder', async () => {
    const root = mkTmp();
    try {
      await init('extract', {
        template: 'pdf-extraction',
        yes: true,
        dir: join(root, 'extract'),
      });
      const target = join(root, 'extract');
      expect(
        statSync(
          join(target, 'dataset', 'examples', 'sample-invoice', 'input', 'arguments.json')
        ).isFile()
      ).toBe(true);
      expect(
        statSync(
          join(target, 'dataset', 'examples', 'sample-invoice', 'expected', 'output.json')
        ).isFile()
      ).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('writes the text-classification template with two examples', async () => {
    const root = mkTmp();
    try {
      await init('sentiment', {
        template: 'text-classification',
        yes: true,
        dir: join(root, 'sentiment'),
      });
      const examples = readdirSync(join(root, 'sentiment', 'dataset', 'examples'));
      expect(examples.sort()).toEqual(['negative', 'positive']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects an invalid project name', async () => {
    const root = mkTmp();
    try {
      await expect(
        init('Bad Name', { template: 'blank', yes: true, dir: join(root, 'bad') })
      ).rejects.toThrow(/Invalid project name/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects an unknown template', async () => {
    const root = mkTmp();
    try {
      await expect(
        init('parse', { template: 'no-such-template', yes: true, dir: join(root, 'parse') })
      ).rejects.toThrow(/Unknown template/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects --dir containing .. (would scaffold outside cwd)', async () => {
    const root = mkTmp();
    try {
      await expect(
        init('parse', { template: 'blank', yes: true, dir: '../escape' })
      ).rejects.toThrow(/--dir contains/);
      await expect(
        init('parse', { template: 'blank', yes: true, dir: 'foo/../../bar' })
      ).rejects.toThrow(/--dir contains/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('accepts absolute --dir paths (user is being explicit)', async () => {
    const root = mkTmp();
    try {
      await init('parse', { template: 'blank', yes: true, dir: join(root, 'absolute') });
      expect(statSync(join(root, 'absolute', 'workflow.yaml')).isFile()).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses to overwrite a non-empty directory', async () => {
    const root = mkTmp();
    try {
      // Run init twice into the same target — second should reject.
      await init('first', { template: 'blank', yes: true, dir: join(root, 'twice') });
      await expect(
        init('first', { template: 'blank', yes: true, dir: join(root, 'twice') })
      ).rejects.toThrow(/exists and is not empty/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
