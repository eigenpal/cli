import { describe, expect, test } from 'bun:test';

import { ApiError, HtmlResponseError } from './client';
import { formatCliError, printApiError } from './format-error';

describe('formatCliError', () => {
  test('passes HtmlResponseError messages through verbatim (already friendly)', () => {
    const err = new HtmlResponseError('http://localhost:3001/api/v1/auth/check');
    const out = formatCliError(err);
    expect(out).toContain('API not reachable at http://localhost:3001/api/v1/auth/check');
    expect(out).toContain('HTML response');
    expect(out.length).toBeLessThan(150);
  });

  test('appends an auth-recovery hint to 401 responses', () => {
    const err = new ApiError(401, { error: 'Unauthorized' });
    const out = formatCliError(err);
    expect(out).toContain('Unauthorized');
    expect(out).toContain('eigenpal auth login');
    expect(out).toContain('EIGENPAL_API_KEY');
  });

  test('non-401 ApiErrors keep their message and skip the auth hint', () => {
    const err = new ApiError(404, { error: 'Not found' });
    const out = formatCliError(err);
    expect(out).toBe('Not found');
  });

  test('connection failures include the URL we tried + env hint', () => {
    const err = new TypeError('fetch failed');
    const out = formatCliError(err, { baseUrl: 'http://localhost:9999' });
    expect(out).toContain('http://localhost:9999');
    expect(out).toContain('EIGENPAL_BASE_URL');
    expect(out).toContain('--base-url');
  });

  test('connection failures without a baseUrl context still print the env hint', () => {
    const err = new TypeError('fetch failed');
    const out = formatCliError(err);
    expect(out).toContain('EIGENPAL_BASE_URL');
  });

  test('bare Error("ENOTFOUND") is treated as a connection failure', () => {
    const err = new Error('getaddrinfo ENOTFOUND nope.invalid');
    const out = formatCliError(err, { baseUrl: 'http://nope.invalid' });
    expect(out).toContain('http://nope.invalid');
    expect(out).toContain('Could not connect');
    expect(out).toContain('EIGENPAL_BASE_URL');
  });

  test('Error with code: ECONNREFUSED is treated as a connection failure', () => {
    const err = Object.assign(new Error('connect refused'), { code: 'ECONNREFUSED' });
    const out = formatCliError(err, { baseUrl: 'http://localhost:9999' });
    expect(out).toContain('http://localhost:9999');
    expect(out).toContain('Could not connect');
  });

  test('TypeError("fetch failed") with cause: ECONNREFUSED unwraps to connection failure', () => {
    const cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:9999'), {
      code: 'ECONNREFUSED',
    });
    const err = new TypeError('fetch failed', { cause });
    const out = formatCliError(err, { baseUrl: 'http://localhost:9999' });
    expect(out).toContain('http://localhost:9999');
    expect(out).toContain('Could not connect');
  });

  test('falls back to the raw message for unknown shapes', () => {
    expect(formatCliError(new Error('boom'))).toBe('boom');
    expect(formatCliError('string error')).toBe('string error');
  });
});

describe('printApiError', () => {
  test('renders modern { issues, hint } envelope with aligned field column', () => {
    const captured = captureStderr(() => {
      printApiError({
        body: {
          issues: [
            { field: 'steps.0.config.code', message: 'required' },
            { field: 'name', message: 'must be a string' },
          ],
          hint: 'see workflow step-type get transform.script',
        },
      });
    });
    const out = stripAnsi(captured);
    expect(out).toContain('Validation failed');
    expect(out).toContain('steps.0.config.code');
    expect(out).toContain('required');
    expect(out).toContain('name');
    // Field column is padded to the widest field name so issues align.
    const lines = out.split('\n');
    const issueLines = lines.filter((l) => /required|must be a string/.test(l));
    expect(issueLines.length).toBe(2);
    expect(out).toContain('see workflow step-type get transform.script');
  });

  test('renders legacy { error, details } envelope', () => {
    const captured = captureStderr(() => {
      printApiError({ body: { error: 'Invalid request', details: { foo: 'bar' } } });
    });
    const out = stripAnsi(captured);
    expect(out).toContain('Invalid request');
    expect(out).toContain('"foo": "bar"');
  });

  test('passes HtmlResponseError through with the friendly message', () => {
    const captured = captureStderr(() => {
      printApiError(new HtmlResponseError('http://localhost:3001'));
    });
    expect(stripAnsi(captured)).toContain('API not reachable at http://localhost:3001');
  });

  test('falls back to formatCliError for unknown shapes (uses baseUrl context)', () => {
    const captured = captureStderr(() => {
      printApiError(new TypeError('fetch failed'), { baseUrl: 'http://localhost:9999' });
    });
    const out = stripAnsi(captured);
    expect(out).toContain('http://localhost:9999');
    expect(out).toContain('Could not connect');
  });
});

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

function captureStderr(fn: () => void): string {
  let captured = '';
  const orig = process.stderr.write.bind(process.stderr);
  (process.stderr as { write: unknown }).write = (chunk: string | Uint8Array): boolean => {
    captured += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    return true;
  };
  try {
    fn();
  } finally {
    (process.stderr as { write: unknown }).write = orig;
  }
  return captured;
}
