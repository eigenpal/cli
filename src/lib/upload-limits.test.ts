import { describe, expect, test } from 'bun:test';
import {
  indicesRequiringPreUpload,
  keysRequiringPreUpload,
  multipartFileByteBudget,
} from './upload-limits';

describe('indicesRequiringPreUpload', () => {
  test('keeps small files on multipart when aggregate fits', () => {
    expect(indicesRequiringPreUpload([{ size: 1024 }])).toEqual(new Set());
  });

  test('pre-uploads a single file over the multipart budget', () => {
    const over = multipartFileByteBudget()! + 1;
    expect(indicesRequiringPreUpload([{ size: over }])).toEqual(new Set([0]));
  });

  test('sheds largest files first when aggregate exceeds budget', () => {
    const half = Math.floor(multipartFileByteBudget()! / 2) + 1;
    expect(indicesRequiringPreUpload([{ size: half }, { size: half }])).toEqual(new Set([0]));
  });

  test('budgets repeated values for the same field independently by index', () => {
    const half = Math.floor(multipartFileByteBudget()! / 2) + 1;
    expect(indicesRequiringPreUpload([{ size: half }, { size: half }])).toEqual(new Set([0]));
  });

  test('keeps every file on multipart when pre-uploading is disabled', () => {
    expect(indicesRequiringPreUpload([{ size: 100 * 1024 * 1024 }], null)).toEqual(new Set());
  });
});

describe('keysRequiringPreUpload', () => {
  test('marks every same-key file when aggregate shedding selects one index', () => {
    const half = Math.floor(multipartFileByteBudget()! / 2) + 1;
    expect(
      keysRequiringPreUpload([
        { key: 'document', size: half },
        { key: 'document', size: half },
      ])
    ).toEqual(new Set(['document']));
  });
});
