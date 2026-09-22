import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import {
  buildReviewItemPatchBody,
  datasetReviewRequestItemsPath,
  datasetReviewRequestsPath,
  parseFieldDecision,
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
    expect(root.stdout).not.toMatch(/\block\b/);
    expect(root.stdout).not.toMatch(/\bflag\b/);

    const item = spawnSync(
      'bun',
      [CLI, 'workflow', 'dataset', 'review-request', 'item', '--help'],
      { encoding: 'utf8' }
    );
    expect(item.status).toBe(0);
    expect(item.stdout).toContain('field-decision');
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
