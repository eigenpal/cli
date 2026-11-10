import { resolveRequestUrl } from './api-paths';
import type { CliConfig } from './config';
import { isNodeReadableStream, type StreamableRequestInit } from './fetch-body';
import { buildCliTelemetryHeaders } from './telemetry';
import { dim } from './ui';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    /** Seconds from the `Retry-After` header, when the server sent one (429). */
    public readonly retryAfterSeconds?: number
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

/**
 * 429 retry policy. A rate-limited request was refused before the server did
 * any work, so every replayable request (all but streamed uploads) is sent
 * again: after `Retry-After` when the server names one, else after an
 * exponential backoff. Bounded: a few attempts, and a `Retry-After` longer
 * than `maxDelayMs` fails at once so the caller sees how long to wait.
 */
export interface RateLimitRetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  sleep: (ms: number) => Promise<void>;
}

const DEFAULT_RATE_LIMIT_RETRY: RateLimitRetryOptions = {
  maxRetries: 3,
  baseDelayMs: 1_000,
  maxDelayMs: 30_000,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** `Retry-After` as seconds (delta-seconds or an HTTP date), or undefined. */
export function parseRetryAfterSeconds(
  header: string | null,
  now = Date.now()
): number | undefined {
  if (!header) return undefined;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, Math.ceil((at - now) / 1000));
}

export class ApiClient {
  private baseUrl: string;
  private apiKey: string;
  private tenantId?: string;
  private retry: RateLimitRetryOptions;

  constructor(
    config: CliConfig,
    options: { rateLimitRetry?: Partial<RateLimitRetryOptions> } = {}
  ) {
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
    this.tenantId = config.tenantId;
    this.retry = { ...DEFAULT_RATE_LIMIT_RETRY, ...options.rateLimitRetry };
  }

  /**
   * `fetch` with the 429 retry policy. Pass `replayable: false` for bodies
   * that can only be read once (Node streams); those return the 429 as is.
   */
  private async send(url: string, init: RequestInit, replayable = true): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, init);
      if (res.status !== 429 || !replayable || attempt >= this.retry.maxRetries) return res;
      const retryAfter = parseRetryAfterSeconds(res.headers.get('retry-after'));
      const delayMs =
        retryAfter !== undefined
          ? retryAfter * 1000
          : Math.min(this.retry.baseDelayMs * 2 ** attempt, this.retry.maxDelayMs);
      if (delayMs > this.retry.maxDelayMs) return res;
      await res.body?.cancel().catch(() => undefined);
      dim(
        `Rate limited by the server, retrying in ${Math.ceil(delayMs / 1000)}s (${attempt + 1} of ${this.retry.maxRetries})`
      );
      await this.retry.sleep(delayMs);
    }
  }

  private buildUrl(path: string): string {
    return resolveRequestUrl(this.baseUrl, path);
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      ...buildCliTelemetryHeaders(),
      Authorization: `Bearer ${this.apiKey}`,
      // Run-start endpoints record this as the run's trigger provenance so
      // CLI-started runs show up as `cli` (not `api`) in run history.
      'X-Eigenpal-Trigger': 'cli',
      ...(this.tenantId ? { 'x-eigenpal-tenant-id': this.tenantId } : {}),
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
      throw new ApiError(res.status, body, parseRetryAfterSeconds(res.headers.get('retry-after')));
    }

    if (contentType.includes('json')) {
      return res.json();
    }

    return res;
  }

  async get(path: string, params?: Record<string, string>): Promise<unknown> {
    let url = this.buildUrl(path);
    if (params) {
      const qs = new URLSearchParams(params).toString();
      if (qs) url += `?${qs}`;
    }
    const res = await this.send(url, { headers: this.headers() });
    return this.handleResponse(res, url);
  }

  async post(path: string, body?: unknown): Promise<unknown> {
    const url = this.buildUrl(path);
    const res = await this.send(url, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return this.handleResponse(res, url);
  }

  async put(path: string, body?: unknown): Promise<unknown> {
    const url = this.buildUrl(path);
    const res = await this.send(url, {
      method: 'PUT',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return this.handleResponse(res, url);
  }

  /** Authenticated PUT of raw bytes (http-chunked file uploads). */
  async putBytes(path: string, body: BodyInit): Promise<unknown> {
    const url = this.buildUrl(path);
    const stream = isNodeReadableStream(body);
    const init: StreamableRequestInit = {
      method: 'PUT',
      headers: this.headers({ 'Content-Type': 'application/octet-stream' }),
      body,
      ...(stream ? { duplex: 'half' as const } : {}),
    };
    const res = await this.send(url, init, !stream);
    return this.handleResponse(res, url);
  }

  async patch(path: string, body: unknown): Promise<unknown> {
    const url = this.buildUrl(path);
    const res = await this.send(url, {
      method: 'PATCH',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
    return this.handleResponse(res, url);
  }

  async postFormData(path: string, formData: FormData): Promise<unknown> {
    const url = this.buildUrl(path);
    const res = await this.send(url, {
      method: 'POST',
      headers: this.headers(),
      body: formData,
    });
    return this.handleResponse(res, url);
  }

  async putFormData(path: string, formData: FormData): Promise<unknown> {
    const url = this.buildUrl(path);
    const res = await this.send(url, {
      method: 'PUT',
      headers: this.headers(),
      body: formData,
    });
    return this.handleResponse(res, url);
  }

  async patchFormData(path: string, formData: FormData): Promise<unknown> {
    const url = this.buildUrl(path);
    const res = await this.send(url, {
      method: 'PATCH',
      headers: this.headers(),
      body: formData,
    });
    return this.handleResponse(res, url);
  }

  async delete(path: string): Promise<unknown> {
    const url = this.buildUrl(path);
    const res = await this.send(url, {
      method: 'DELETE',
      headers: this.headers(),
    });
    return this.handleResponse(res, url);
  }

  async getStream(path: string): Promise<Response> {
    const url = this.buildUrl(path);
    const res = await this.send(url, {
      headers: this.headers(),
    });
    assertNotHtml(res, url);
    if (!res.ok) {
      throw new ApiError(
        res.status,
        `Failed to download: HTTP ${res.status}`,
        parseRetryAfterSeconds(res.headers.get('retry-after'))
      );
    }
    return res;
  }

  /**
   * POST and return raw Response for streaming (e.g. SSE).
   * Caller must check res.ok and consume res.body.
   */
  async postStream(path: string, body: unknown): Promise<Response> {
    const url = this.buildUrl(path);
    const res = await this.send(url, {
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
    const url = this.buildUrl(path);
    const res = await this.send(url, {
      method: 'POST',
      headers: this.headers(),
      body: formData,
    });
    assertNotHtml(res, url);
    return res;
  }
}
