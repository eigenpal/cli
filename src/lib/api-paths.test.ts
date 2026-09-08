import { describe, expect, test } from 'bun:test';
import { API_PREFIX, apiPath, resolveRequestUrl } from './api-paths';

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

describe('resolveRequestUrl', () => {
  const importPath = '/v1/automations/wf_abc/dataset/import';
  const legacyImportPath = '/api/v1/automations/wf_abc/dataset/import';

  test('origin-only base uses canonical /v1 (server rewrites to /api/v1)', () => {
    expect(resolveRequestUrl('https://studio.eigenpal.com', importPath)).toBe(
      'https://studio.eigenpal.com/v1/automations/wf_abc/dataset/import'
    );
    expect(resolveRequestUrl('http://localhost:3000', legacyImportPath)).toBe(
      'http://localhost:3000/v1/automations/wf_abc/dataset/import'
    );
  });

  test('/api base joins without duplicating the prefix', () => {
    expect(resolveRequestUrl('http://localhost:3000/api', importPath)).toBe(
      'http://localhost:3000/api/v1/automations/wf_abc/dataset/import'
    );
  });

  test('/api/v1 base does not double the /v1 segment', () => {
    expect(resolveRequestUrl('https://studio.eigenpal.com/api/v1', importPath)).toBe(
      'https://studio.eigenpal.com/api/v1/automations/wf_abc/dataset/import'
    );
    expect(resolveRequestUrl('https://studio.eigenpal.com/api/v1/', legacyImportPath)).toBe(
      'https://studio.eigenpal.com/api/v1/automations/wf_abc/dataset/import'
    );
  });

  test('dashboard /api/* routes stay origin-rooted when base carries /api', () => {
    expect(resolveRequestUrl('http://localhost:3000/api/v1', '/api/workflows/wf_abc')).toBe(
      'http://localhost:3000/api/workflows/wf_abc'
    );
  });

  test('absolute URLs pass through unchanged', () => {
    expect(
      resolveRequestUrl('http://localhost:3000', 'https://storage.example.com/upload?sig=abc')
    ).toBe('https://storage.example.com/upload?sig=abc');
  });
});
