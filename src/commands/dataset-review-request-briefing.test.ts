import { describe, expect, test } from 'bun:test';
import {
  mergeFocusFields,
  mergeItemNotes,
  parseFieldNoteFlag,
  parseFocusReasonFlag,
  parseItemNoteFlag,
} from './dataset-review-request-briefing';

describe('dataset review request briefing flags', () => {
  test('parses focus reasons, item notes, and field notes', () => {
    expect(parseFocusReasonFlag('vendor.iban=OCR often mangles IBANs')).toEqual({
      path: 'vendor.iban',
      reason: 'OCR often mangles IBANs',
    });
    expect(parseItemNoteFlag('acme-metals-2044=Check the totals')).toEqual({
      exampleName: 'acme-metals-2044',
      comment: 'Check the totals',
    });
    expect(parseFieldNoteFlag('acme-metals-2044.vendor.iban=checksum failed last run')).toEqual({
      exampleName: 'acme-metals-2044',
      fields: [{ path: 'vendor.iban', comment: 'checksum failed last run' }],
    });
  });

  test('merges repeated focus and note flags by path/example', () => {
    expect(
      mergeFocusFields(
        ['total', 'vendor.iban'],
        [{ path: 'vendor.iban', reason: 'checksum often fails' }]
      )
    ).toEqual([
      { path: 'total', reason: null },
      { path: 'vendor.iban', reason: 'checksum often fails' },
    ]);
    expect(
      mergeItemNotes([
        { exampleName: 'invoice-a', comment: 'looks off' },
        {
          exampleName: 'invoice-a',
          fields: [{ path: 'total', comment: 'off by 0.01' }],
        },
      ])
    ).toEqual([
      {
        exampleName: 'invoice-a',
        comment: 'looks off',
        fields: [{ path: 'total', comment: 'off by 0.01' }],
      },
    ]);
  });
});
