/** Request init for Node/Bun fetch when streaming a Node readable body. */
export type StreamableRequestInit = RequestInit & { duplex?: 'half' };

/** True when `body` is a Node.js readable stream (fs.createReadStream, etc.). */
export function isNodeReadableStream(body: unknown): body is NodeJS.ReadableStream {
  return typeof (body as { pipe?: unknown }).pipe === 'function';
}

/**
 * Copy a byte view into a standalone ArrayBuffer accepted by DOM `BodyInit`.
 * Avoids TS generic mismatches on `Uint8Array<ArrayBufferLike>` / Buffer.
 */
export function byteViewToArrayBuffer(view: Uint8Array): ArrayBuffer {
  if (
    view.buffer instanceof ArrayBuffer &&
    view.byteOffset === 0 &&
    view.byteLength === view.buffer.byteLength
  ) {
    return view.buffer;
  }
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  return copy.buffer;
}

/** Convert bytes or a Node readable into a fetch-compatible PUT body. */
export function toPutBody(body: Uint8Array | NodeJS.ReadableStream): BodyInit {
  if (isNodeReadableStream(body)) {
    return body as unknown as BodyInit;
  }
  return byteViewToArrayBuffer(body);
}

export function putRequestInit(
  body: Uint8Array | NodeJS.ReadableStream,
  headers: HeadersInit,
  signal?: AbortSignal
): StreamableRequestInit {
  const stream = isNodeReadableStream(body);
  return {
    method: 'PUT',
    headers,
    body: toPutBody(body),
    signal,
    ...(stream ? { duplex: 'half' as const } : {}),
  };
}

/** Minimal fetch mock shape for tests (DOM lib requires `preconnect`). */
export function asFetchMock(
  impl: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>
): typeof fetch {
  return Object.assign(impl, { preconnect: () => undefined }) as typeof fetch;
}
