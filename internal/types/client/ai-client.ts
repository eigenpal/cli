/**
 * AI Client Types
 *
 * Simplified interface focused on actual usage patterns:
 * - Vision parsing (images → text)
 * - Structured extraction (content → JSON)
 */

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
 */
export interface ExtractOptions {
  /** JSON Schema describing the expected output structure */
  schema: Record<string, unknown>;
  /** Custom prompt to guide extraction */
  prompt?: string;
  /** Model to use (overrides default) */
  model?: string;
  /** Temperature (0-2) */
  temperature?: number;
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
  vision(
    prompt: string,
    images: ImageInput[],
    options?: { model?: string; signal?: AbortSignal }
  ): Promise<AIResponse>;

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
   * Check if this client supports vision (image inputs)
   */
  supportsVision(): boolean;

  /**
   * Count the number of tokens in the given text using the model's tokenizer.
   */
  getNumTokens(text: string): Promise<number>;
}
