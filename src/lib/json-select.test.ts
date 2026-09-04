import { describe, expect, test } from 'bun:test';
import { parseJsonSelectPath, selectJsonValue } from './json-select';

describe('JSON output selection', () => {
  const payload = {
    output: {
      subjects: [
        { name: 'A', score: 1 },
        { name: 'B', score: 2 },
      ],
    },
  };

  test('selects nested values and numeric array indexes', () => {
    expect(selectJsonValue(payload, 'output.subjects')).toEqual(payload.output.subjects);
    expect(selectJsonValue(payload, '$.output.subjects[1].name')).toBe('B');
  });

  test('projects through array wildcards', () => {
    expect(selectJsonValue(payload, 'output.subjects[].name')).toEqual(['A', 'B']);
    expect(selectJsonValue(payload, 'output.subjects[*].score')).toEqual([1, 2]);
  });

  test('rejects unsupported or unmatched paths clearly', () => {
    expect(() => parseJsonSelectPath('output["subjects"]')).toThrow('Invalid --select path');
    for (const malformed of [
      'output..subjects',
      'output.subjects.',
      '.output',
      'output.[0]',
      'output[0]name',
      '$output',
    ]) {
      expect(() => parseJsonSelectPath(malformed)).toThrow('Invalid --select path');
    }
    expect(() => selectJsonValue(payload, 'output.missing')).toThrow('did not match');
  });
});
