import { describe, expect, test } from 'bun:test';

import { ApiClient, ApiError, HtmlResponseError } from './client';
import { resolveWorkflowId } from './resolve-workflow';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeClient(handler: (url: string) => Response): ApiClient {
  global.fetch = (async (input: string | URL | Request) =>
    handler(typeof input === 'string' ? input : input.toString())) as unknown as typeof fetch;
  return new ApiClient({ baseUrl: 'http://localhost:9999', apiKey: 'k', dir: '.' });
}

describe('resolveWorkflowId', () => {
  test('id form (wf_…) hits GET /api/workflows/<id> and returns the id', async () => {
    const seenUrls: string[] = [];
    const client = makeClient((url) => {
      seenUrls.push(url);
      // Root authoring detail shape: flat name/version/yamlContent.
      return jsonResponse({
        id: 'wf_abc',
        name: 'foo',
        version: '1.0.0',
        yamlContent: 'name: foo',
      });
    });
    try {
      const out = await resolveWorkflowId(client, 'wf_abc');
      expect(out).toBe('wf_abc');
      expect(seenUrls).toEqual(['http://localhost:9999/api/workflows/wf_abc']);
    } finally {
      global.fetch = fetch;
    }
  });

  test('slug form goes through ?name=<slug> exact match', async () => {
    const seenUrls: string[] = [];
    const client = makeClient((url) => {
      seenUrls.push(url);
      // Root authoring list shape: flat name (no nested currentVersion).
      return jsonResponse({
        data: [{ id: 'wf_xyz', name: 'my-extraction', version: '1.0.0' }],
        total: 1,
      });
    });
    try {
      const out = await resolveWorkflowId(client, 'my-extraction');
      expect(out).toBe('wf_xyz');
      expect(seenUrls).toEqual(['http://localhost:9999/api/workflows?name=my-extraction']);
    } finally {
      global.fetch = fetch;
    }
  });

  test('id 404 throws actionable error pointing at workflow push', async () => {
    const client = makeClient(() => new Response('not found', { status: 404 }));
    try {
      await expect(resolveWorkflowId(client, 'wf_missing')).rejects.toThrow(
        /not found on the server.*Push it first/
      );
    } finally {
      global.fetch = fetch;
    }
  });

  test('slug with no matching row throws actionable error', async () => {
    const client = makeClient(() => jsonResponse({ data: [], total: 0 }));
    try {
      await expect(resolveWorkflowId(client, 'never-pushed')).rejects.toThrow(
        /"never-pushed".*not found on the server/
      );
    } finally {
      global.fetch = fetch;
    }
  });

  test('slug miss surfaces a "did you mean?" hint when a close match exists', async () => {
    // First call (`?name=`) misses; second call (`?search=`) finds a typo.
    let call = 0;
    const client = makeClient((url) => {
      call++;
      if (url.includes('?name=')) {
        return jsonResponse({ data: [], total: 0 });
      }
      // search hit — flat `name` is the field the v1 list emits.
      return jsonResponse({
        data: [{ id: 'wf_close', name: 'parse-invoices', version: '1.0.0' }],
        total: 1,
      });
    });
    try {
      await expect(resolveWorkflowId(client, 'parse-invocies')).rejects.toThrow(
        /Did you mean "parse-invoices"\?/
      );
      expect(call).toBe(2);
    } finally {
      global.fetch = fetch;
    }
  });

  describe('outage errors propagate (id path)', () => {
    test('fetch failure is not misclassified as workflow-not-found', async () => {
      global.fetch = (async () => {
        throw new TypeError('fetch failed', { cause: new Error('ECONNREFUSED') });
      }) as unknown as typeof fetch;
      const client = new ApiClient({ baseUrl: 'http://localhost:9999', apiKey: 'k', dir: '.' });
      try {
        await expect(resolveWorkflowId(client, 'wf_abc')).rejects.toMatchObject({
          message: 'fetch failed',
        });
      } finally {
        global.fetch = fetch;
      }
    });

    test('HTML response is not misclassified as workflow-not-found', async () => {
      const client = makeClient(
        () =>
          new Response('<html><body>404</body></html>', {
            status: 404,
            headers: { 'content-type': 'text/html' },
          })
      );
      try {
        await expect(resolveWorkflowId(client, 'wf_abc')).rejects.toBeInstanceOf(HtmlResponseError);
      } finally {
        global.fetch = fetch;
      }
    });

    test('401 auth error propagates', async () => {
      const client = makeClient(() => jsonResponse({ error: 'Unauthorized' }, 401));
      try {
        await resolveWorkflowId(client, 'wf_abc');
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).status).toBe(401);
      } finally {
        global.fetch = fetch;
      }
    });

    test('5xx server error propagates', async () => {
      const client = makeClient(() => jsonResponse({ error: 'Internal server error' }, 500));
      try {
        await resolveWorkflowId(client, 'wf_abc');
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).status).toBe(500);
      } finally {
        global.fetch = fetch;
      }
    });
  });

  describe('outage errors propagate (slug path)', () => {
    test('fetch failure is not misclassified as workflow-not-found', async () => {
      global.fetch = (async () => {
        throw new TypeError('fetch failed', { cause: new Error('ECONNREFUSED') });
      }) as unknown as typeof fetch;
      const client = new ApiClient({ baseUrl: 'http://localhost:9999', apiKey: 'k', dir: '.' });
      try {
        await expect(resolveWorkflowId(client, 'my-slug')).rejects.toMatchObject({
          message: 'fetch failed',
        });
      } finally {
        global.fetch = fetch;
      }
    });

    test('HTML response is not misclassified as workflow-not-found', async () => {
      const client = makeClient(
        () =>
          new Response('<html><body>404</body></html>', {
            status: 404,
            headers: { 'content-type': 'text/html' },
          })
      );
      try {
        await expect(resolveWorkflowId(client, 'my-slug')).rejects.toBeInstanceOf(
          HtmlResponseError
        );
      } finally {
        global.fetch = fetch;
      }
    });

    test('401 auth error propagates', async () => {
      const client = makeClient(() => jsonResponse({ error: 'Unauthorized' }, 401));
      try {
        await resolveWorkflowId(client, 'my-slug');
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).status).toBe(401);
      } finally {
        global.fetch = fetch;
      }
    });

    test('5xx server error propagates', async () => {
      const client = makeClient(() => jsonResponse({ error: 'Internal server error' }, 500));
      try {
        await resolveWorkflowId(client, 'my-slug');
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).status).toBe(500);
      } finally {
        global.fetch = fetch;
      }
    });
  });
});
