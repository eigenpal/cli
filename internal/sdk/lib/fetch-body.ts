/** Request init for Node/Bun fetch when streaming a Node readable body. */
export type StreamableRequestInit = RequestInit & { duplex?: 'half' };

/** True when `body` is a Node.js readable stream (fs.createReadStream, etc.). */
export function isNodeReadableStream(body: unknown): body is NodeJS.ReadableStream {
  return typeof (body as { pipe?: unknown }).pipe === 'function';
}

/**
 * Copy a byte view into a standalone ArrayBuffer accepted by DOM `BodyInit`.
 * Avoids TS generic mismatches on `Uint8Array<ArrayBufferLike>`.
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
    // Node/Bun fetch accepts Node readables with `duplex: 'half'`.
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

type NodeReadableState = NodeJS.ReadableStream & {
  readableEnded?: boolean;
  destroyed?: boolean;
  destroy?: (error?: Error) => void;
};

/** Drop a Node readable that never started sending (fetch failed before upload). */
export function destroyUnreadNodeReadable(stream: NodeJS.ReadableStream): void {
  const readable = stream as NodeReadableState;
  if (!readable.readableEnded && !readable.destroyed && typeof readable.destroy === 'function') {
    readable.destroy();
  }
}

/**
 * Block until every byte of a Node readable PUT body has been consumed.
 * Real fetch/undici should drain the stream before resolving; mocks that
 * return early leave bytes unread and must be drained here so callers do
 * not destroy the stream while a retry or background upload is still running.
 */
export async function ensureNodeReadableFullySent(
  stream: NodeJS.ReadableStream,
  expectedByteLength?: number
): Promise<number> {
  const readable = stream as NodeReadableState;
  if (readable.readableEnded) {
    return expectedByteLength ?? 0;
  }
  if (readable.destroyed) {
    throw new Error('Upload stream was destroyed before the request body finished sending');
  }

  let bytes = 0;
  for await (const chunk of stream as AsyncIterable<Buffer | Uint8Array | string>) {
    bytes += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length;
  }
  if (expectedByteLength !== undefined && bytes !== expectedByteLength) {
    throw new Error(
      `Upload sent ${bytes} byte(s) but ${expectedByteLength} were expected for this part`
    );
  }
  return bytes;
}
