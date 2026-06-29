import type { Span } from '@opentelemetry/api';
import { SpanKind } from '@opentelemetry/api';
import { z } from 'zod';
import { JsonSchemaSchema } from '../core/common';

/**
 * Re-export SpanKind for convenience in processors
 */
export { SpanKind };

/**
 * Options for creating a span
 */
export interface SpanOptions {
  /** SpanKind - defaults to INTERNAL */
  kind?: SpanKind;
  /** Initial attributes for the span */
  attributes?: Record<string, unknown>;
}

/**
 * TracingContext interface - OTEL-native tracing API
 *
 * Provides automatic parent-child span linking through context propagation.
 * This interface is browser-safe (only depends on @opentelemetry/api).
 */
export interface TracingContext {
  /** The trace ID for this execution context */
  readonly traceId: string;

  /** Get the currently active span (if any) */
  getActiveSpan(): Span | undefined;

  /**
   * Execute a function within a new span.
   * Automatically links to parent span via context propagation.
   *
   * @param name - Span name (e.g., 'llm.complete', 'ocr.process')
   * @param options - Span options (kind, initial attributes)
   * @param fn - The async function to execute. Receives the span for adding attributes.
   */
  withSpan<T>(name: string, options: SpanOptions, fn: (span: Span) => Promise<T>): Promise<T>;
}

/**
 * No-op TracingContext for when tracing is disabled
 * Executes functions without creating spans
 */
export const noopTracingContext: TracingContext = {
  traceId: '',

  getActiveSpan(): Span | undefined {
    return undefined;
  },

  async withSpan<T>(
    _name: string,
    _options: SpanOptions,
    fn: (span: Span) => Promise<T>
  ): Promise<T> {
    // Create a minimal no-op span object
    const noopSpan: Span = {
      spanContext: () => ({
        traceId: '',
        spanId: '',
        traceFlags: 0,
      }),
      setAttribute: () => noopSpan,
      setAttributes: () => noopSpan,
      addEvent: () => noopSpan,
      addLink: () => noopSpan,
      addLinks: () => noopSpan,
      setStatus: () => noopSpan,
      updateName: () => noopSpan,
      end: () => {},
      isRecording: () => false,
      recordException: () => {},
    };
    return fn(noopSpan);
  },
};

/**
 * Processor port definition for multi-input/output processors
 */
export const ProcessorPortSchema = z.object({
  name: z.string(),
  schema: JsonSchemaSchema,
  required: z.boolean().default(true),
});

export type ProcessorPort = z.infer<typeof ProcessorPortSchema>;

/**
 * Processor definition schema
 * This is what gets registered in the processor registry
 */
export const ProcessorDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),

  // Schemas for validation (stored as JSON Schema in DB)
  inputSchema: JsonSchemaSchema,
  outputSchema: JsonSchemaSchema,
  configSchema: JsonSchemaSchema.optional(),

  // Multi-port support for processors with named inputs/outputs
  inputPorts: z.array(ProcessorPortSchema).optional(),
  outputPorts: z.array(ProcessorPortSchema).optional(),

  // Plugin metadata
  isBuiltin: z.boolean().default(true),
  pluginName: z.string().optional(),
});

export type ProcessorDefinition = z.infer<typeof ProcessorDefinitionSchema>;

/**
 * Processor execution context schema
 *
 * Runtime context for processor execution, including IDs for logging and tracing.
 * This is different from the workflow ExecutionContext which holds execution state (steps, input, scope).
 */
export const ProcessorExecutionContextSchema = z.object({
  jobId: z.string(),
  stepId: z.string(),
  tenantId: z.string(),
  automationId: z.string().optional(),
  workflowId: z.string(),
  workerId: z.string().optional(),
});

/**
 * Trace status for call tracing
 */
export enum TraceStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

/**
 * Span type for tracing (used for type inference in span naming)
 */
export type SpanType = 'llm_call' | 'ocr_call';

/**
 * Span attributes - flexible key-value pairs for type-specific metadata
 */
export type SpanAttributes = Record<string, unknown>;

/**
 * Minimal logger interface for processors
 * Matches @eigenpal/logger ILogger but defined here to avoid circular deps
 */
export interface ProcessorLogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  child(component: string): ProcessorLogger;
}

/**
 * Processor execution context with optional tracing
 *
 * Runtime context for a single processor execution. Contains IDs for logging/tracing
 * and an optional TracingContext for recording nested OTEL spans.
 *
 * Note: This is distinct from the workflow `ExecutionContext` which holds
 * workflow state (input, steps, scope) for template rendering.
 *
 * @example
 * ```typescript
 * // Within a processor
 * const result = await ctx.tracing?.withSpan('openai/gpt-4', {
 *   kind: SpanKind.CLIENT,
 *   attributes: { 'gen_ai.system': 'openai' }
 * }, async (span) => {
 *   const response = await client.complete(messages);
 *   span.setAttributes({ 'gen_ai.usage.input_tokens': response.usage?.promptTokens });
 *   return response;
 * });
 * ```
 */
export type ProcessorExecutionContext = z.infer<typeof ProcessorExecutionContextSchema> & {
  /** Optional OTEL-native tracing context for recording nested spans */
  tracing?: TracingContext;
  /** Optional logger with execution context (executionId, tenantId, workflowId) */
  logger?: ProcessorLogger;
  /** Optional abort signal for cancellation (not serializable, runtime-only) */
  signal?: AbortSignal;
};
