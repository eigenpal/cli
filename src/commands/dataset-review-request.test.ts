import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import {
  assertSafeReviewExampleName,
  buildReviewItemFileFields,
  buildReviewItemPatchBody,
  datasetReviewRequestItemsPath,
  datasetReviewRequestsPath,
  encodeReviewFilePath,
  formatReviewItemFiles,
  parseFieldDecision,
  parseFileDecision,
} from './dataset-review-request';

const CLI = join(import.meta.dir, '../cli.ts');

describe('parseFieldDecision', () => {
  test('maps approved and rejected', () => {
    expect(parseFieldDecision({ decision: 'approved' })).toBe('approved');
    expect(parseFieldDecision({ decision: 'Rejected' })).toBe('rejected');
  });

  test('maps --clear and --decision null/clear to null', () => {
    expect(parseFieldDecision({ clear: true })).toBeNull();
    expect(parseFieldDecision({ decision: 'null' })).toBeNull();
    expect(parseFieldDecision({ decision: 'clear' })).toBeNull();
  });

  test('rejects conflicting or missing decision', () => {
    expect(() => parseFieldDecision({ clear: true, decision: 'approved' })).toThrow(
      /either --clear or --decision/
    );
    expect(() => parseFieldDecision({})).toThrow(/--decision or --clear/);
    expect(() => parseFieldDecision({ decision: 'maybe' })).toThrow(/approved, rejected, null/);
  });
});

describe('buildReviewItemPatchBody', () => {
  test('requires --expected-json for edit and parses it', () => {
    expect(() => buildReviewItemPatchBody('edit', { expectedUpdatedAt: 'v1' })).toThrow(
      /--expected-json is required/
    );
    expect(
      buildReviewItemPatchBody('edit', { expectedUpdatedAt: 'v1', expectedJson: '{"a":1}' })
    ).toEqual({ action: 'edit', expectedUpdatedAt: 'v1', expected: { a: 1 } });
  });

  test('rejects --expected-json outside edit', () => {
    expect(() =>
      buildReviewItemPatchBody('approve', { expectedUpdatedAt: 'v1', expectedJson: '{"a":1}' })
    ).toThrow(/only valid with --action edit/);
  });

  test('passes non-edit actions through without an expected key', () => {
    expect(buildReviewItemPatchBody('approve', { expectedUpdatedAt: 'v1', comment: 'ok' })).toEqual(
      { action: 'approve', expectedUpdatedAt: 'v1', comment: 'ok' }
    );
  });

  test('file-decision requires --file-path and a decision or note', () => {
    expect(() => buildReviewItemPatchBody('file-decision', { expectedUpdatedAt: 'v1' })).toThrow(
      /--file-path is required/
    );
    expect(() =>
      buildReviewItemPatchBody('file-decision', {
        expectedUpdatedAt: 'v1',
        filePath: 'expected/report.pdf',
      })
    ).toThrow(/--decision.*or a --comment note/);
    expect(
      buildReviewItemPatchBody('file-decision', {
        expectedUpdatedAt: 'v1',
        filePath: 'expected/report.pdf',
        decision: 'approved',
        comment: 'totals match',
      })
    ).toEqual({
      action: 'file-decision',
      expectedUpdatedAt: 'v1',
      comment: 'totals match',
      filePath: 'expected/report.pdf',
      decision: 'approved',
    });
    // A comment without a decision is a note on the file.
    expect(
      buildReviewItemPatchBody('file-decision', {
        expectedUpdatedAt: 'v1',
        filePath: 'expected/report.pdf',
        comment: 'please re-check',
      })
    ).toEqual({
      action: 'file-decision',
      expectedUpdatedAt: 'v1',
      comment: 'please re-check',
      filePath: 'expected/report.pdf',
    });
  });

  test('file-decision rejects field and upload flags', () => {
    expect(() =>
      buildReviewItemPatchBody('file-decision', {
        expectedUpdatedAt: 'v1',
        filePath: 'expected/report.pdf',
        decision: 'approved',
        fieldPath: 'total',
      })
    ).toThrow(/--field-path is only valid/);
    expect(() =>
      buildReviewItemPatchBody('file-decision', {
        expectedUpdatedAt: 'v1',
        filePath: 'expected/report.pdf',
        decision: 'approved',
        newPath: 'expected/appendix.pdf',
      })
    ).toThrow(/--new-path \/ --file are only valid/);
    expect(() =>
      buildReviewItemPatchBody('approve', {
        expectedUpdatedAt: 'v1',
        filePath: 'expected/report.pdf',
      })
    ).toThrow(/--file-path \/ --new-path \/ --file are only valid/);
  });

  test('edit-file refuses the JSON body builder', () => {
    expect(() =>
      buildReviewItemPatchBody('edit-file', {
        expectedUpdatedAt: 'v1',
        filePath: 'expected/report.pdf',
        file: './report.pdf',
      })
    ).toThrow(/multipart/);
  });
});

describe('parseFileDecision', () => {
  test('maps approved, rejected, and clear forms', () => {
    expect(parseFileDecision({ decision: 'approved' })).toBe('approved');
    expect(parseFileDecision({ decision: 'Rejected' })).toBe('rejected');
    expect(parseFileDecision({ clear: true })).toBeNull();
    expect(parseFileDecision({ decision: 'null' })).toBeNull();
  });

  test('rejects conflicting or missing decision', () => {
    expect(() => parseFileDecision({ clear: true, decision: 'approved' })).toThrow(
      /either --clear or --decision/
    );
    expect(() => parseFileDecision({})).toThrow(/--action file-decision/);
    expect(() => parseFileDecision({ decision: 'maybe' })).toThrow(/approved, rejected, null/);
  });
});

describe('buildReviewItemFileFields', () => {
  test('requires exactly one of --file-path / --new-path plus --file', () => {
    expect(() => buildReviewItemFileFields({ expectedUpdatedAt: 'v1', file: './a.pdf' })).toThrow(
      /exactly one of --file-path/
    );
    expect(() =>
      buildReviewItemFileFields({
        expectedUpdatedAt: 'v1',
        filePath: 'expected/a.pdf',
        newPath: 'expected/b.pdf',
        file: './a.pdf',
      })
    ).toThrow(/exactly one of --file-path/);
    expect(() =>
      buildReviewItemFileFields({ expectedUpdatedAt: 'v1', filePath: 'expected/a.pdf' })
    ).toThrow(/--file <local path> is required/);
  });

  test('passes correct and brand-new uploads through', () => {
    expect(
      buildReviewItemFileFields({
        expectedUpdatedAt: 'v1',
        filePath: 'expected/a.pdf',
        file: './a.pdf',
        comment: 'fixed',
      })
    ).toEqual({
      filePath: 'expected/a.pdf',
      comment: 'fixed',
      expectedUpdatedAt: 'v1',
    });
    expect(
      buildReviewItemFileFields({
        expectedUpdatedAt: 'v1',
        newPath: 'expected/b.pdf',
        file: './b.pdf',
      })
    ).toEqual({ newPath: 'expected/b.pdf', expectedUpdatedAt: 'v1' });
  });
});

describe('encodeReviewFilePath', () => {
  test('encodes per segment and keeps separators', () => {
    expect(encodeReviewFilePath('expected/report final.pdf')).toBe('expected/report%20final.pdf');
  });

  test('rejects traversal and absolute escapes', () => {
    expect(() => encodeReviewFilePath('../secret')).toThrow(/unsafe review file path/);
    expect(() => encodeReviewFilePath('expected/../../x')).toThrow(/unsafe review file path/);
  });

  test('rejects backslashes and null bytes', () => {
    expect(() => encodeReviewFilePath('expected\\report.pdf')).toThrow(/unsafe review file path/);
    expect(() => encodeReviewFilePath('a\0b')).toThrow(/unsafe review file path/);
  });
});

describe('assertSafeReviewExampleName', () => {
  test('passes ordinary names through', () => {
    expect(assertSafeReviewExampleName('invoice-a')).toBe('invoice-a');
  });

  test('refuses directory escapes before mkdir', () => {
    expect(() => assertSafeReviewExampleName('..')).toThrow(/unsafe review example name/);
    expect(() => assertSafeReviewExampleName('../secret')).toThrow(/unsafe review example name/);
    expect(() => assertSafeReviewExampleName('a/../../x')).toThrow(/unsafe review example name/);
    expect(() => assertSafeReviewExampleName('a\\b')).toThrow(/unsafe review example name/);
    expect(() => assertSafeReviewExampleName('')).toThrow(/unsafe review example name/);
  });
});

describe('formatReviewItemFiles', () => {
  test('summarizes overlay files and decisions', () => {
    expect(formatReviewItemFiles({})).toBe('-');
    expect(
      formatReviewItemFiles({
        currentExpectedFiles: [{ path: 'a.pdf' }, { path: 'b.pdf' }],
        fileDecisions: {},
      })
    ).toBe('2 files, undecided');
    expect(
      formatReviewItemFiles({
        currentExpectedFiles: [{ path: 'a.pdf' }, { path: 'b.pdf' }],
        fileDecisions: { 'a.pdf': { decision: 'approved' }, 'b.pdf': { decision: 'rejected' } },
      })
    ).toBe('1/2 approved, 1 rejected');
  });

  test('falls back to the snapshot manifest when the overlay is null', () => {
    expect(
      formatReviewItemFiles({
        currentExpectedFiles: null,
        snapshotManifest: { expectedFiles: [{ name: 'a.pdf' }] },
      })
    ).toBe('1 file, undecided');
  });
});

describe('dataset review-request paths', () => {
  test('builds collection, detail, and item paths', () => {
    expect(datasetReviewRequestsPath('wf_abc')).toBe(
      '/v1/automations/wf_abc/dataset-review-requests'
    );
    expect(datasetReviewRequestsPath('wf_abc', 'dsr_1')).toBe(
      '/v1/automations/wf_abc/dataset-review-requests/dsr_1'
    );
    expect(datasetReviewRequestItemsPath('wf_abc', 'dsr_1', 'dsri_2')).toBe(
      '/v1/automations/wf_abc/dataset-review-requests/dsr_1/items/dsri_2'
    );
  });
});

describe('dataset review-request --help', () => {
  test('lists update and item actions without lock or flag', () => {
    const root = spawnSync('bun', [CLI, 'workflow', 'dataset', 'review-request', '--help'], {
      encoding: 'utf8',
    });
    expect(root.status).toBe(0);
    expect(root.stdout).toContain('update');
    expect(root.stdout).toContain('item');
    expect(root.stdout).toContain('pull');
    expect(root.stdout).not.toMatch(/\block\b/);
    expect(root.stdout).not.toMatch(/\bflag\b/);

    const item = spawnSync(
      'bun',
      [CLI, 'workflow', 'dataset', 'review-request', 'item', '--help'],
      { encoding: 'utf8' }
    );
    expect(item.status).toBe(0);
    expect(item.stdout).toContain('field-decision');
    expect(item.stdout).toContain('file-decision');
    expect(item.stdout).toContain('edit-file');
    expect(item.stdout).toContain('--file-path');
    expect(item.stdout).toContain('--new-path');
    expect(item.stdout).toContain('reject');
    expect(item.stdout).toContain('--clear');
    expect(item.stdout).not.toMatch(/\bflag\b/);
    expect(item.stdout).not.toMatch(/\block\b/);

    const update = spawnSync(
      'bun',
      [CLI, 'workflow', 'dataset', 'review-request', 'update', '--help'],
      { encoding: 'utf8' }
    );
    expect(update.status).toBe(0);
    expect(update.stdout).toContain('--status');
    expect(update.stdout).toContain('closed');
    expect(update.stdout).not.toMatch(/\block\b/);
  });
});
