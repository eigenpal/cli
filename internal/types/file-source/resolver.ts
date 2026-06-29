import type { FileSourceConfig, FileSourceDescriptor } from './descriptor';

/**
 * Result of resolving an external file id to its bytes. `contentType` and
 * `filename` are best-effort hints from the source used to name the stored
 * artifact (the worker also falls back to magic-byte detection).
 */
export interface FileSourceResolveResult {
  /** Raw file bytes. */
  body: Buffer;
  /** Response Content-Type, if the source reported one. */
  contentType?: string;
  /** Filename reported by the source, if any. */
  filename?: string;
}

/** Context handed to a resolver for logging / scoping. */
export interface FileSourceResolveContext {
  tenantId: string;
  automationId: string;
  workflowId: string;
  runId: string;
  /** The workflow input field name this id was supplied for. */
  fieldName: string;
  /**
   * The worker's lease/stop abort signal. Resolvers should abort in-flight I/O
   * when this fires (combined with their own timeout) so a lost lease or a
   * stopping worker doesn't keep downloading — and uploading — orphaned bytes.
   */
  signal?: AbortSignal;
}

/**
 * A named external file source. Implementations live in the worker and are
 * registered into the worker file-source registry (built-in or via a
 * `WorkerPlugin`). `config` is the validated, decrypted instance configuration
 * (see {@link FileSourceConfig}).
 */
export interface FileSourceResolver {
  /** Resolver name — matches the descriptor and the workflow input `source`. */
  readonly name: string;
  /**
   * Config descriptor for this resolver. Built-in resolvers omit it (the worker
   * looks them up in {@link BUILTIN_FILE_SOURCE_DESCRIPTORS}); a plugin resolver
   * that wants DB-stored, secret-encrypted instance config supplies its own
   * descriptor here so the worker knows which fields to decrypt. Plugin
   * resolvers without a descriptor are handed an empty config and self-source.
   */
  readonly descriptor?: FileSourceDescriptor;
  /** Fetch the bytes for `id`. Throw on not-found / transport errors. */
  resolve(
    id: string,
    ctx: FileSourceResolveContext,
    config: FileSourceConfig
  ): Promise<FileSourceResolveResult>;
}
