/**
 * Semantic Conventions for Eigenpal OTEL Spans
 *
 * Maps internal attributes to OTEL GenAI and custom eigenpal conventions.
 * This file is browser-safe and has no Node.js dependencies.
 */

/**
 * GenAI Semantic Conventions (OTEL standard)
 * @see https://opentelemetry.io/docs/specs/semconv/gen-ai/
 */
export const GenAI = {
  /** The provider of the LLM (e.g., 'openai', 'anthropic') */
  SYSTEM: 'gen_ai.system',
  /** The model name (e.g., 'gpt-4', 'claude-3-opus') */
  REQUEST_MODEL: 'gen_ai.request.model',
  /** The response model name */
  RESPONSE_MODEL: 'gen_ai.response.model',
  /** Input tokens used (total, including any served from cache) */
  USAGE_INPUT_TOKENS: 'gen_ai.usage.input_tokens',
  /** Output tokens used */
  USAGE_OUTPUT_TOKENS: 'gen_ai.usage.output_tokens',
  /** Subset of input tokens read from the provider cache. */
  USAGE_CACHED_INPUT_TOKENS: 'gen_ai.usage.cached_input_tokens',
  /** Input tokens written to the provider cache this call (Anthropic cache creation). */
  USAGE_CACHE_WRITE_INPUT_TOKENS: 'gen_ai.usage.cache_write_input_tokens',
} as const;

export const OpenInference = {
  /** Project name for Phoenix/Arize (resource attribute) */
  PROJECT_NAME: 'openinference.project.name',

  /** Marks the span as an LLM invocation */
  SPAN_KIND: 'openinference.span.kind',

  /** LLM provider (e.g., 'openai', 'anthropic') */
  PROVIDER: 'llm.provider',

  /** Model name used for the request */
  MODEL_NAME: 'llm.model_name',

  /** Prompt tokens used (Phoenix format) */
  TOKEN_COUNT_PROMPT: 'llm.token_count.prompt',

  /** Completion tokens used (Phoenix format) */
  TOKEN_COUNT_COMPLETION: 'llm.token_count.completion',

  /** Total tokens used (Phoenix format) */
  TOKEN_COUNT_TOTAL: 'llm.token_count.total',

  /** Input messages / prompt (JSON-serialized array of messages) */
  INPUT_MESSAGES: 'llm.input_messages',

  /** Output messages / response (JSON-serialized array of messages) */
  OUTPUT_MESSAGES: 'llm.output_messages',

  /** Generic input value (string or JSON) - displayed in Phoenix Input tab */
  INPUT_VALUE: 'input.value',

  /** Generic output value (string or JSON) - displayed in Phoenix Output tab */
  OUTPUT_VALUE: 'output.value',

  /** MIME type of input value */
  INPUT_MIME_TYPE: 'input.mime_type',

  /** MIME type of output value */
  OUTPUT_MIME_TYPE: 'output.mime_type',

  /** Sampling temperature */
  TEMPERATURE: 'llm.temperature',
} as const;

/**
 * Eigenpal Custom Semantic Conventions
 * Prefixed with 'eigenpal.' to avoid conflicts
 */
export const Eigenpal = {
  /** Span type: workflow, processor, llm_call, ocr_call, api_call, function_call */
  SPAN_TYPE: 'eigenpal.span.type',
  /** Tenant ID */
  TENANT_ID: 'eigenpal.tenant.id',
  /** Workflow execution ID (links back to our internal ID) */
  EXECUTION_ID: 'eigenpal.execution.id',
  /** Workflow ID (workflow definition) */
  WORKFLOW_ID: 'eigenpal.workflow.id',
  /** Workflow name */
  WORKFLOW_NAME: 'eigenpal.workflow.name',
  /** Step ID within workflow */
  STEP_ID: 'eigenpal.step.id',
  /** Step execution ID */
  STEP_EXECUTION_ID: 'eigenpal.step_execution.id',
  /** Processor ID */
  PROCESSOR_ID: 'eigenpal.processor.id',
  /** OCR provider */
  OCR_PROVIDER: 'eigenpal.ocr.provider',
  /** Pages processed by OCR */
  OCR_PAGES_PROCESSED: 'eigenpal.ocr.pages_processed',
  /** Page index for multi-page processing */
  PAGE_INDEX: 'eigenpal.page_index',

  // -- LLM attempts -------------------------------------------------------
  // A retried request used to be invisible: the retry loop lives under the
  // caller's single `llm.*` span, so N attempts collapsed into one bar whose
  // duration was `attempts x requestTimeout` with nothing saying why.

  /** 1-based attempt number on an `llm.attempt` span */
  LLM_ATTEMPT: 'eigenpal.llm.attempt',
  /** Attempts this request is allowed (maxRetries + 1) */
  LLM_MAX_ATTEMPTS: 'eigenpal.llm.max_attempts',
  /** How it ended: 'ok' | 'timeout' | 'error' */
  LLM_OUTCOME: 'eigenpal.llm.outcome',
  /** Per-request deadline in ms (provider `requestTimeout`) */
  LLM_TIMEOUT_MS: 'eigenpal.llm.timeout_ms',
  /** Time spent waiting for a concurrency slot before the request was sent */
  LLM_QUEUE_WAIT_MS: 'eigenpal.llm.queue_wait_ms',
  /** Concurrency lane admitted through: 'low' (first try) | 'high' (retry) */
  LLM_LANE: 'eigenpal.llm.lane',

  // -- Page batches -------------------------------------------------------

  /** 1-based page numbers in this request's batch */
  PAGE_NUMBERS: 'eigenpal.page_numbers',
  /** Pages in this request's batch */
  PAGE_COUNT: 'eigenpal.page_count',
  /** Bisect recursion depth; 0 is the original batch */
  BISECT_DEPTH: 'eigenpal.bisect.depth',
} as const;

export const OpenInferenceSpanKinds = {
  /** A single LLM invocation (chat / completion) */
  LLM: 'llm',

  /** A chain, agent, or orchestration step */
  CHAIN: 'chain',

  /** A tool or function call invoked by an LLM */
  TOOL: 'tool',

  /** A retrieval step (vector DB, search, hybrid search) */
  RETRIEVER: 'retriever',

  /** Embedding generation */
  EMBEDDING: 'embedding',

  /** Reranking results */
  RERANKER: 'reranker',
} as const;

/**
 * Span type values for eigenpal
 */
export const SpanTypes = {
  WORKFLOW: 'workflow',
  STEP: 'step',
  LLM_CALL: 'llm_call',
  OCR_CALL: 'ocr_call',
  API_CALL: 'api_call',
  FUNCTION_CALL: 'function_call',
} as const;

/** Valid span types for eigenpal */
export type SpanTypeValue = (typeof SpanTypes)[keyof typeof SpanTypes];

/**
 * SpanKind mapping for eigenpal span types
 */
export const SpanKindMap = {
  /** Workflow execution - internal orchestration */
  workflow_execution: 'internal',
  /** Step execution - internal processing */
  step_execution: 'internal',
  /** LLM call - outbound call to LLM API */
  llm_call: 'client',
  /** OCR call - outbound call to OCR service */
  ocr_call: 'client',
  /** API call - outbound HTTP call */
  api_call: 'client',
  /** Function call - internal function execution */
  function_call: 'internal',
} as const;

export type EigenpalSpanType = keyof typeof SpanKindMap;

/** Valid SpanKind string values for database storage */
export type SpanKindString = 'internal' | 'server' | 'client' | 'producer' | 'consumer';

/**
 * Convert internal LLM attributes to OTEL GenAI conventions
 */
export function mapLLMAttributes(attrs: {
  provider?: string;
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
}): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};

  if (attrs.provider) mapped[GenAI.SYSTEM] = attrs.provider;
  if (attrs.model) mapped[GenAI.REQUEST_MODEL] = attrs.model;
  if (attrs.tokensIn !== undefined) mapped[GenAI.USAGE_INPUT_TOKENS] = attrs.tokensIn;
  if (attrs.tokensOut !== undefined) mapped[GenAI.USAGE_OUTPUT_TOKENS] = attrs.tokensOut;

  return mapped;
}

/**
 * Convert internal OCR attributes to eigenpal conventions
 */
export function mapOCRAttributes(attrs: {
  provider?: string;
  pagesProcessed?: number;
}): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};

  if (attrs.provider) mapped[Eigenpal.OCR_PROVIDER] = attrs.provider;
  if (attrs.pagesProcessed !== undefined)
    mapped[Eigenpal.OCR_PAGES_PROCESSED] = attrs.pagesProcessed;

  return mapped;
}

/**
 * Add eigenpal context attributes to a span
 */
export function addEigenpalContext(attrs: {
  tenantId?: string;
  workflowId?: string;
  workflowName?: string;
  stepId?: string;
  stepExecutionId?: string;
  processorId?: string;
}): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};

  if (attrs.tenantId) mapped[Eigenpal.TENANT_ID] = attrs.tenantId;
  if (attrs.workflowId) mapped[Eigenpal.WORKFLOW_ID] = attrs.workflowId;
  if (attrs.workflowName) mapped[Eigenpal.WORKFLOW_NAME] = attrs.workflowName;
  if (attrs.stepId) mapped[Eigenpal.STEP_ID] = attrs.stepId;
  if (attrs.stepExecutionId) mapped[Eigenpal.STEP_EXECUTION_ID] = attrs.stepExecutionId;
  if (attrs.processorId) mapped[Eigenpal.PROCESSOR_ID] = attrs.processorId;

  return mapped;
}
