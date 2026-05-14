import type { CliConfig } from './config';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown
  ) {
    const msg =
      typeof body === 'object' && body !== null && 'error' in body
        ? (body as { error: string }).error
        : `HTTP ${status}`;
    super(msg);
    this.name = 'ApiError';
  }
}

/**
 * Thrown when the server replies with `Content-Type: text/html` instead of
 * JSON. Almost always means the base URL points at the wrong port (e.g. the
 * dashboard's Next.js 404 page) — surface a one-line, agent-friendly message
 * instead of dumping 100 KB of HTML.
 */
export class HtmlResponseError extends Error {
  constructor(public readonly resolvedUrl: string) {
    super(
      `API not reachable at ${resolvedUrl} — got HTML response (likely wrong base URL or API not running)`
    );
    this.name = 'HtmlResponseError';
  }
}

/**
 * Throw a structured error when the server sends back HTML instead of the
 * expected JSON envelope. Skips reading the body — Next.js 404 pages weigh
 * ~100 KB and dumping them buries the actual problem.
 */
function assertNotHtml(res: Response, resolvedUrl: string): void {
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.toLowerCase().startsWith('text/html')) {
    throw new HtmlResponseError(resolvedUrl);
  }
}

export class ApiClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(config: CliConfig) {
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      ...extra,
    };
  }

  private async handleResponse(res: Response, resolvedUrl: string): Promise<unknown> {
    if (res.status === 204) return null;

    // HTML on the wire == wrong port / API down. Detect before we ever try to
    // parse the body — a Next.js 404 page is ~100 KB and the parsed-as-JSON
    // failure that follows hides the real problem.
    assertNotHtml(res, resolvedUrl);

    const contentType = res.headers.get('content-type') || '';

    if (!res.ok) {
      let body: unknown;
      try {
        body = contentType.includes('json') ? await res.json() : await res.text();
      } catch {
        body = `HTTP ${res.status}`;
      }
      throw new ApiError(res.status, body);
    }

    if (contentType.includes('json')) {
      return res.json();
    }

    return res;
  }

  async get(path: string, params?: Record<string, string>): Promise<unknown> {
    let url = `${this.baseUrl}${path}`;
    if (params) {
      const qs = new URLSearchParams(params).toString();
      if (qs) url += `?${qs}`;
    }
    const res = await fetch(url, { headers: this.headers() });
    return this.handleResponse(res, url);
  }

  async post(path: string, body?: unknown): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return this.handleResponse(res, url);
  }

  async put(path: string, body?: unknown): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method: 'PUT',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return this.handleResponse(res, url);
  }

  async patch(path: string, body: unknown): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
    return this.handleResponse(res, url);
  }

  async postFormData(path: string, formData: FormData): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: this.headers(),
      body: formData,
    });
    return this.handleResponse(res, url);
  }

  async putFormData(path: string, formData: FormData): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method: 'PUT',
      headers: this.headers(),
      body: formData,
    });
    return this.handleResponse(res, url);
  }

  async delete(path: string): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method: 'DELETE',
      headers: this.headers(),
    });
    return this.handleResponse(res, url);
  }

  async getStream(path: string): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      headers: this.headers(),
    });
    assertNotHtml(res, url);
    if (!res.ok) {
      throw new ApiError(res.status, `Failed to download: HTTP ${res.status}`);
    }
    return res;
  }

  /**
   * POST and return raw Response for streaming (e.g. SSE).
   * Caller must check res.ok and consume res.body.
   */
  async postStream(path: string, body: unknown): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    // Throw before the caller reads the body — a 404 HTML page from the wrong
    // base URL would otherwise look like a corrupt SSE stream.
    assertNotHtml(res, url);
    return res;
  }

  /**
   * POST a multipart form-data body and return the raw Response for streaming
   * (e.g. NDJSON import progress). Caller must check `res.ok` and consume the
   * body. HTML responses are caught up-front so a wrong base URL doesn't dump
   * a 100 KB Next.js 404 page into the import-progress parser.
   */
  async postFormDataStream(path: string, formData: FormData): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: this.headers(),
      body: formData,
    });
    assertNotHtml(res, url);
    return res;
  }
}
