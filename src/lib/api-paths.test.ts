import { describe, expect, test } from 'bun:test';
import { API_PREFIX, apiPath } from './api-paths';

describe('apiPath', () => {
  test('prefixes bare suffixes with /v1', () => {
    expect(API_PREFIX).toBe('/v1');
    expect(apiPath('/runs')).toBe('/v1/runs');
    expect(apiPath('runs')).toBe('/v1/runs');
    expect(apiPath('/auth/check')).toBe('/v1/auth/check');
  });

  test('keeps already-canonical /v1 paths', () => {
    expect(apiPath('/v1/runs')).toBe('/v1/runs');
    expect(apiPath('/v1')).toBe('/v1');
  });

  test('projects legacy /api/v1 paths to canonical /v1', () => {
    expect(apiPath('/api/v1/runs')).toBe('/v1/runs');
    expect(apiPath('/api/v1/files/file_1/content')).toBe('/v1/files/file_1/content');
    expect(apiPath('/api/v1')).toBe('/v1');
  });
});
