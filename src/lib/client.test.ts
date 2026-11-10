import { describe, expect, test } from 'bun:test';

import { ApiClient, ApiError, HtmlResponseError } from './client';

const HTML_BODY =
  '<!DOCTYPE html><html><head><title>404</title></head><body><h1>This page could not be found</h1></body></html>';

function htmlResponse(): Response {
  return new Response(HTML_BODY, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('ApiClient HTML detection', () => {
  test('throws HtmlResponseError when GET returns text/html', async () => {
    const origFetch = global.fetch;
    global.fetch = (async () => htmlResponse()) as unknown as typeof fetch;
    try {
      const client = new ApiClient({
        baseUrl: 'http://localhost:9999',
        apiKey: 'k',
        dir: '.',
      });
      await expect(client.get('/v1/auth/check')).rejects.toBeInstanceOf(HtmlResponseError);
    } finally {
      global.fetch = origFetch;
    }
  });

  test('the error message is short and includes the resolved URL', async () => {
    const origFetch = global.fetch;
    global.fetch = (async () => htmlResponse()) as unknown as typeof fetch;
    try {
      const client = new ApiClient({
        baseUrl: 'http://localhost:9999',
        apiKey: 'k',
        dir: '.',
      });
      try {
        await client.get('/v1/auth/check');
      } catch (err) {
        expect(err).toBeInstanceOf(HtmlResponseError);
        const e = err as HtmlResponseError;
        expect(e.resolvedUrl).toBe('http://localhost:9999/v1/auth/check');
        // Acceptance: <100 chars; no body dump.
        expect(e.message.length).toBeLessThan(150);
        expect(e.message).not.toContain('<!DOCTYPE');
      }
    } finally {
      global.fetch = origFetch;
    }
  });

  test('JSON responses still parse normally', async () => {
    const origFetch = global.fetch;
    global.fetch = (async () => jsonResponse({ ok: true })) as unknown as typeof fetch;
    try {
      const client = new ApiClient({
        baseUrl: 'http://localhost:9999',
        apiKey: 'k',
        dir: '.',
      });
      const result = await client.get('/v1/auth/check');
      expect(result).toEqual({ ok: true });
    } finally {
      global.fetch = origFetch;
    }
  });

  test('streaming download (getStream) also rejects HTML', async () => {
    const origFetch = global.fetch;
    global.fetch = (async () => htmlResponse()) as unknown as typeof fetch;
    try {
      const client = new ApiClient({
        baseUrl: 'http://localhost:9999',
        apiKey: 'k',
        dir: '.',
      });
      await expect(client.getStream('/v1/foo/export')).rejects.toBeInstanceOf(HtmlResponseError);
    } finally {
      global.fetch = origFetch;
    }
  });

  test('projects legacy /api/v1 call sites onto canonical /v1', async () => {
    const origFetch = global.fetch;
    let requested: string | undefined;
    global.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      requested = String(input);
      return jsonResponse({ ok: true });
    }) as unknown as typeof fetch;
    try {
      const client = new ApiClient({
        baseUrl: 'http://localhost:9999',
        apiKey: 'k',
        dir: '.',
      });
      await client.get('/api/v1/auth/check');
      expect(requested).toBe('http://localhost:9999/v1/auth/check');
    } finally {
      global.fetch = origFetch;
    }
  });

  test('dataset import uses /api/v1 once when baseUrl already includes /api/v1', async () => {
    const origFetch = global.fetch;
    let requested: string | undefined;
    global.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      requested = String(input);
      return jsonResponse({ created: 1, mode: 'append' });
    }) as unknown as typeof fetch;
    try {
      const client = new ApiClient({
        baseUrl: 'https://studio.eigenpal.com/api/v1',
        apiKey: 'k',
        dir: '.',
      });
      const form = new FormData();
      form.set('file', new Blob(['zip']), 'dataset.zip');
      form.set('mode', 'append');
      await client.postFormData('/v1/automations/wf_abc/dataset/import', form);
      expect(requested).toBe(
        'https://studio.eigenpal.com/api/v1/automations/wf_abc/dataset/import'
      );
      expect(requested).not.toContain('/v1/v1/');
    } finally {
      global.fetch = origFetch;
    }
  });
});

describe('ApiClient client identity', () => {
  test('every request identifies itself as the CLI', async () => {
    const origFetch = global.fetch;
    let sent: Headers | undefined;
    global.fetch = (async (_url: string, init?: RequestInit) => {
      sent = new Headers(init?.headers);
      return jsonResponse({ ok: true });
    }) as unknown as typeof fetch;
    try {
      const client = new ApiClient({ baseUrl: 'http://localhost:9999', apiKey: 'k', dir: '.' });
      await client.post('/v1/runs', {});
      expect(sent?.get('x-eigenpal-sdk')).toBe('cli');
      expect(sent?.get('user-agent')).toMatch(/^eigenpal-cli\/\S+ \((bun|node)-/);
      expect(sent?.get('authorization')).toBe('Bearer k');
    } finally {
      global.fetch = origFetch;
    }
  });
});

describe('ApiClient 429 retry', () => {
  const config = { baseUrl: 'http://localhost:9999', apiKey: 'k', dir: '.' };

  function rateLimited(retryAfter?: string): Response {
    return new Response(
      JSON.stringify({
        issues: [{ field: '<root>', message: 'rate limit exceeded', code: 'rate_limited' }],
      }),
      {
        status: 429,
        headers: {
          'content-type': 'application/json',
          ...(retryAfter !== undefined ? { 'retry-after': retryAfter } : {}),
        },
      }
    );
  }

  async function withFetch<T>(responses: Response[], fn: () => Promise<T>): Promise<T> {
    const origFetch = global.fetch;
    let i = 0;
    global.fetch = (async () => responses[i++]) as unknown as typeof fetch;
    try {
      return await fn();
    } finally {
      global.fetch = origFetch;
    }
  }

  test('waits for Retry-After, then returns the successful response', async () => {
    const waits: number[] = [];
    const client = new ApiClient(config, {
      rateLimitRetry: { sleep: async (ms) => void waits.push(ms) },
    });
    const result = await withFetch([rateLimited('2'), jsonResponse({ ok: true })], () =>
      client.post('/v1/runs', { a: 1 })
    );
    expect(result).toEqual({ ok: true });
    expect(waits).toEqual([2000]);
  });

  test('backs off exponentially without Retry-After and gives up after maxRetries', async () => {
    const waits: number[] = [];
    const client = new ApiClient(config, {
      rateLimitRetry: { maxRetries: 3, baseDelayMs: 100, sleep: async (ms) => void waits.push(ms) },
    });
    const err = await withFetch(
      [rateLimited(), rateLimited(), rateLimited(), rateLimited('7')],
      () => client.get('/v1/runs').catch((e: unknown) => e)
    );
    expect(waits).toEqual([100, 200, 400]);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(429);
    expect((err as ApiError).retryAfterSeconds).toBe(7);
  });

  test('a Retry-After longer than the cap fails at once instead of hanging', async () => {
    const waits: number[] = [];
    const client = new ApiClient(config, {
      rateLimitRetry: { maxDelayMs: 30_000, sleep: async (ms) => void waits.push(ms) },
    });
    const err = await withFetch([rateLimited('600')], () =>
      client.get('/v1/runs').catch((e: unknown) => e)
    );
    expect(waits).toEqual([]);
    expect((err as ApiError).retryAfterSeconds).toBe(600);
  });
});

describe('ApiError message', () => {
  test('uses the first issue of the modern envelope and appends the request id', () => {
    const err = new ApiError(409, {
      issues: [{ field: 'name', message: 'Name already in use' }],
      requestId: 'req_123',
    });
    expect(err.message).toBe('Name already in use (request id: req_123)');
  });

  test('falls back to the legacy error field, then to the status', () => {
    expect(new ApiError(400, { error: 'Bad input' }).message).toBe('Bad input');
    expect(new ApiError(500, { issues: [] }).message).toBe('HTTP 500');
    expect(new ApiError(502, null).message).toBe('HTTP 502');
  });
});
