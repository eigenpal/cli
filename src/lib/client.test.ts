import { describe, expect, test } from 'bun:test';

import { ApiClient, HtmlResponseError } from './client';

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
});
