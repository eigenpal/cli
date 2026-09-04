/**
 * AI Client Types
 *
 * Simplified interface focused on actual usage patterns:
 * - Vision parsing (images → text)
 * - Structured extraction (content → JSON)
 */
import { z } from 'zod';

export const REASONING_EFFORTS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;
export const ReasoningEffortSchema = z.enum(REASONING_EFFORTS);
export type ReasoningEffort = z.infer<typeof ReasoningEffortSchema>;

export const ModelReasoningConfigSchema = z
  .object({
    supportedEfforts: z.array(ReasoningEffortSchema).min(1),
  })
  .strict();
export type ModelReasoningConfig = z.infer<typeof ModelReasoningConfigSchema>;

/**
 * Token usage information
 */
export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  /** Tokens served from the provider cache (Anthropic `cache_read_input_tokens`, OpenAI `prompt_tokens_details.cached_tokens`). */
  cacheReadInputTokens?: number;
  /** Tokens newly written to the provider cache this call (Anthropic `cache_creation_input_tokens`). */
  cacheWriteInputTokens?: number;
}

/**
 * Image input for vision models
 */
export interface ImageInput {
  /** Base64 encoded image data */
  data: string;
  /** MIME type (e.g., 'image/png', 'image/jpeg') */
  mimeType?: string;
}

/**
 * Response from AI operations
 */
export interface AIResponse {
  content: string;
  model: string;
  usage?: TokenUsage;
  /** The actual prompt sent to the LLM (for tracing) */
  inputPrompt?: string;
  /** The raw LLM response (for tracing) */
  outputResponse?: string;
}

/**
 * Response from extraction operations
 */
export interface ExtractResponse {
  data: Record<string, unknown>;
  model: string;
  usage?: TokenUsage;
  /** The actual prompt sent to the LLM (for tracing) */
  inputPrompt?: string;
  /** The raw LLM response before parsing (for tracing) */
  outputResponse?: string;
}

/**
 * Options for extraction
 *
 * `temperature` is intentionally NOT here — Eigenpal is a deterministic
 * framework, so every LLM call uses the shared `DETERMINISTIC_TEMPERATURE`
 * constant inside the client. Callers cannot override it.
 */
export interface ExtractOptions {
  /** JSON Schema describing the expected output structure */
  schema: Record<string, unknown>;
  /** Custom prompt to guide extraction */
  prompt?: string;
  /** Model to use (overrides default) */
  model?: string;
  /** Provider reasoning effort. Omit to preserve the model's existing default behavior. */
  reasoningEffort?: ReasoningEffort;
  /**
   * Best-effort reproducibility seed. OpenAI documents seed as "mostly
   * deterministic" given the same `system_fingerprint`. openai-compatible
   * providers ignore it silently. Pin in callers that need deterministic
   * output (e.g. anchor detection in ai.split).
   */
  seed?: number;
  /**
   * Cancels the in-flight LLM request when aborted. The OpenAI SDK
   * forwards this to fetch, so a 30s call dies on the next OS-level
   * network round-trip rather than running to completion — load-bearing
   * for snappy cooperative cancellation in the worker.
   */
  signal?: AbortSignal;
}

/**
 * Options for raw completions
 *
 * `temperature` is intentionally NOT here — same deterministic-framework
 * rationale as ExtractOptions: every call uses `DETERMINISTIC_TEMPERATURE`.
 */
export interface CompleteOptions {
  /** Model to use (overrides default) */
  model?: string;
  /** Provider reasoning effort. Omit to preserve the model's existing default behavior. */
  reasoningEffort?: ReasoningEffort;
  /** Cancels the in-flight LLM request when aborted. */
  signal?: AbortSignal;
}

export interface VisionOptions {
  /** Model to use (overrides default) */
  model?: string;
  /** Provider reasoning effort. Omit to preserve the model's existing default behavior. */
  reasoningEffort?: ReasoningEffort;
  /** Cancels the in-flight LLM request when aborted. */
  signal?: AbortSignal;
  /**
   * Whether a request *timeout* should be retried by the client.
   *
   * Defaults to `true` (a timeout retries per the client's configured
   * `maxRetries`, like every other transient error). The LLM-vision parser sets
   * this to `false` on multi-page batches: re-sending the identical hung
   * multi-page request wastes another full request timeout, so instead the
   * parser lets the timeout propagate and bisects the batch into smaller
   * requests. Single-page leaves keep the default (`true`) so an isolated page
   * still gets its retry budget. Only *timeout* retries are affected — 429s,
   * 5xx, and connection resets still retry regardless of this flag.
   */
  retryTimeouts?: boolean;
}

/**
 * AI Client interface
 *
 * Simplified interface focused on document processing use cases.
 * Implementations handle provider-specific details internally.
 */
export interface AIClient {
  /** Provider identifier (e.g., 'openai', 'anthropic', 'azure-openai') */
  readonly provider: string;

  /** Default model for this client */
  readonly defaultModel: string;

  /**
   * Vision completion - process images with a text prompt
   *
   * @param prompt - Text prompt describing what to extract/analyze
   * @param images - Array of images to process
   * @param options - Optional model override
   */
  vision(prompt: string, images: ImageInput[], options?: VisionOptions): Promise<AIResponse>;

  /**
   * Extract structured data from content
   *
   * @param content - Text content, or text with images
   * @param options - Extraction options including output schema
   */
  extract(
    content: string | { text: string; images?: ImageInput[] },
    options: ExtractOptions
  ): Promise<ExtractResponse>;

  /**
   * Raw text completion — send a single prompt, get the model's text back.
   *
   * Used where the caller owns the full prompt and parses the response
   * itself (e.g. the extract grounding pass hands langextract-generated
   * prompts to the workspace model).
   */
  complete(prompt: string, options?: CompleteOptions): Promise<AIResponse>;

  /**
   * Check if this client supports vision (image inputs)
   */
  supportsVision(): boolean;

  /**
   * Count the number of tokens in the given text using the model's tokenizer.
   */
  getNumTokens(text: string): Promise<number>;
}
