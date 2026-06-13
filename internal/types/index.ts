/**
 * @eigenpal/types
 *
 * Core type definitions for Eigenpal.
 * Uses Zod for runtime validation + TypeScript types.
 */

// Core utilities (ID generation, timestamps, pagination, JSON Schema)
export {
  BaseEntitySchema,
  DEFAULT_PAGE_SIZE,
  ID_PREFIXES,
  INPUT_KINDS,
  JsonSchemaSchema,
  MAX_PAGE_SIZE,
  PARSER_IDS,
  PROCESSOR_IDS,
  PaginationParamsSchema,
  TimestampSchema,
  generateId,
  toJsonSchema,
  type BaseEntity,
  type IdPrefix,
  type InputPortKind,
  type JsonSchema,
  type JsonSchema7Type,
  type PaginatedResponse,
  type PaginationParams,
  type ParserId,
  type ProcessorId,
  type TemplatePlaceholder,
} from './core';

// Processor types (definitions, execution, configs)
export {
  // Processor configs
  ClassifyConfigSchema,
  ClassifyInputSchema,
  ClassifyLabelSchema,
  ClassifyOutputSchema,
  DocumentParserConfigSchema,
  DocumentParserInputSchema,
  DocumentParserOutputSchema,
  // Execution types (mode: prod/eval/playground)
  EXECUTION_TYPES,
  ExecutionTypeSchema,
  ExecutionTypeValue,
  // Processor definitions
  ExtractConfigSchema,
  ExtractInputSchema,
  ExtractOutputSchema,
  FilePathDescriptorSchema,
  MergeConfigSchema,
  MergeInputSchema,
  MergeOutputSchema,
  PROCESSOR_SCHEMAS,
  // PDF Embedder processor
  PdfEmbedderConfigSchema,
  PdfEmbedderInputSchema,
  PdfEmbedderOutputSchema,
  ProcessorDefinitionSchema,
  ProcessorExecutionContextSchema,
  ProcessorPortSchema,
  // Step execution statuses
  STEP_EXECUTION_STATUSES,
  SpanKind,
  SplitConfigSchema,
  SplitInputSchema,
  SplitOutputSchema,
  StepExecutionStatusSchema,
  StepExecutionStatusValue,
  // Trigger types (how workflow is invoked)
  TRIGGER_TYPES,
  // Template processor
  TemplateConfigSchema,
  TemplateInputSchema,
  TemplateOutputSchema,
  TraceStatus,
  TriggerTypeSchema,
  TriggerTypeValue,
  // Workflow execution statuses
  WORKFLOW_EXECUTION_STATUSES,
  WorkflowExecutionStatusSchema,
  WorkflowExecutionStatusValue,
  XlsxToJsonConfigSchema,
  XlsxToJsonInputSchema,
  XlsxToJsonOutputSchema,
  extractFieldMetadata,
  getAllProcessorJsonSchemas,
  getConfigDefaults,
  getConfigFieldMetadata,
  getConfigSchema,
  getProcessorSchemas,
  isFilePathDescriptor,
  listProcessorIds,
  noopTracingContext,
  validateConfig,
  type ClassifyConfig,
  type ClassifyInput,
  type ClassifyLabel,
  type ClassifyOutput,
  type DocumentParserConfig,
  type DocumentParserInput,
  type DocumentParserOutput,
  type ExecutionType,
  type ExtractConfig,
  type ExtractInput,
  type ExtractOutput,
  type FieldMetadata,
  type FilePathDescriptor,
  type MergeConfig,
  type MergeInput,
  type MergeOutput,
  type PdfEmbedderConfig,
  type PdfEmbedderInput,
  type PdfEmbedderOutput,
  type ProcessorDefinition,
  type ProcessorExecutionContext,
  type ProcessorPort,
  type ProcessorSchemas,
  type SpanAttributes,
  type SpanOptions,
  type SpanType,
  type SplitConfig,
  type SplitInput,
  type SplitOutput,
  type StepExecutionStatus,
  type TemplateConfig,
  type TemplateInput,
  type TemplateOutput,
  type TracingContext,
  type TriggerType,
  type WorkflowExecutionStatus,
  type XlsxToJsonConfig,
  type XlsxToJsonInput,
  type XlsxToJsonOutput,
} from './processor';

// Parser types (document parsing)
export {
  // Schemas
  BoundingRegionSchema,
  CoordinateUnitSchema,
  DocumentMetadataSchema,
  ExtractedTableSchema,
  LayoutElementSchema,
  LayoutElementTypeSchema,
  OFFICE_MIME_TYPES,
  PageResultSchema,
  ParseOptionsSchema,
  ParseResultSchema,
  ParseUsageSchema,
  ParserCategory,
  ParserInputSchema,
  ParserTypeSchema,
  PointSchema,
  PositionedTextSchema,
  TableCellSchema,
  getAllSupportedMimeTypes,
  getParserCategory,
  getSupportedFormatsLabel,
  requiresSpecializedParser,
  resolveEffectiveMimeType,
  // Types
  type BoundingRegion,
  type CoordinateUnit,
  type DocumentMetadata,
  type ExtractedTable,
  type LayoutElement,
  type LayoutElementType,
  type PageResult,
  type ParseOptions,
  type ParseResult,
  type ParseUsage,
  type ParserInput,
  type ParserType,
  type Point,
  type PositionedText,
  type TableCell,
} from './parser';

// Client types (AI & OCR interfaces)
export type {
  AIClient,
  AIResponse,
  ExtractOptions,
  ExtractResponse,
  ImageInput,
  OCRClient,
  OCRClientConfig,
  OCRFigure,
  OCRKeyValue,
  OCRLine,
  OCROptions,
  OCRPageResult,
  OCRParagraph,
  OCRResult,
  OCRTable,
  OCRTableCell,
  OCRWord,
  ParagraphRole,
  TokenUsage,
} from './client';

// OTEL Semantic Conventions (browser-safe)
export {
  Eigenpal,
  GenAI,
  OpenInference,
  OpenInferenceSpanKinds,
  SpanKindMap,
  SpanTypes,
  addEigenpalContext,
  mapLLMAttributes,
  mapOCRAttributes,
  type EigenpalSpanType,
  type SpanKindString,
  type SpanTypeValue,
} from './otel';

// Durable `executions` row statuses (workflow + agent shared queue)
export {
  DURABLE_EXECUTION_TYPES,
  EXECUTION_AGENT_CANCEL_REQUESTABLE_STATUSES,
  EXECUTION_AGENT_METRICS_STATUSES,
  EXECUTION_AGENT_QUEUED_STATUSES,
  EXECUTION_AGENT_REAP_SCAN_STATUSES,
  EXECUTION_CONCURRENCY_ACTIVE_STATUSES,
  EXECUTION_EVAL_RUNNING_STATUSES,
  EXECUTION_FAILED_OR_CANCELLED_STATUSES,
  EXECUTION_FAILURE_CATEGORIES,
  EXECUTION_NON_TERMINAL_STATUSES,
  EXECUTION_PHASES,
  EXECUTION_PHASE_LABELS,
  EXECUTION_PHASE_ORDER,
  EXECUTION_PHASE_STATUSES,
  EXECUTION_SHARED_CANCEL_REQUESTABLE_STATUSES,
  EXECUTION_STATUSES,
  NON_SUCCESS_TERMINAL_EXECUTION_STATUSES,
  RUNS_TRIGGERED_BY_SYSTEM,
  TERMINAL_EXECUTION_STATUSES,
  executionPhaseDurationMs,
  executionPhaseLabel,
  executionWallClockMs,
  isNonSuccessTerminalExecutionStatus,
  isTerminalExecutionStatus,
  publicExecutionFailure,
  type DurableExecutionType,
  type ExecutionConcurrencyActiveStatus,
  type ExecutionFailureCategory,
  type ExecutionNonTerminalStatus,
  type ExecutionObservability,
  type ExecutionPhase,
  type ExecutionPhaseSpan,
  type ExecutionPhaseStatus,
  type ExecutionStatus,
  type InternalExecutionFailure,
  type PublicExecutionFailure,
  type TerminalExecutionStatus,
} from './execution-row';

// Expand sections for GET /api/v1/runs/{id} — shared by API route, CLI, and docs.
export {
  LEGACY_RUN_EXPAND_MIGRATION,
  RUN_DETAIL_EXPAND_PRESET,
  RUN_EXPAND_SECTIONS,
  isRunExpandSection,
  parseRunExpand,
  runExpandErrorMessage,
  runIncludeErrorMessage,
  type RunExpandSection,
} from './run-expand';

// Single source of truth for the LLM temperature on every model call.
export { DETERMINISTIC_TEMPERATURE } from './llm-determinism';

// Validation: shared AJV instance + input/output/workspace-schema helpers.
// One module used by /run endpoints, the worker, the inference session, and
// the CLI pre-flight so all four call sites reach the same verdict.
export * from './validation';

// Workflow types (YAML-based sequential execution)
export * from './workflow';

// Eval primitives (shared by app + worker)
export * from './eval';

// Git-backed source repository grammar and manifests
export * from './git-source';

// Automation runtime trigger projection
export * from './automation/triggers';

// API path display helpers (`:id` in docs/UI vs `{id}` in OpenAPI)
export * from './api/display-path';

// Typed-TS function compile pipeline (transform.script + custom-script eval)
export * from './typed-script';

// Canonical S3/R2 key constructors for workflow-scoped files
export {
  evalExpectedKey,
  evalInputKey,
  parseFileKey,
  runInputKey,
  runOutputKey,
  stripTenantPrefix,
  type ParsedKey,
} from './storage/paths';

// Canonical typed S3/R2 path grammar and recursive builder
export {
  S3_PATH_GRAMMAR,
  buildS3Path,
  rootS3Path,
  type RootS3PathBuilder,
  type RootS3PathParams,
  type S3PathBuilder,
  type S3PathGrammar,
  type S3PathNodeAfter,
  type S3PathParams,
  type S3PathTemplate,
  type S3PathTemplateNode,
  type S3PathTemplateParams,
  type TenantS3PathBuilder,
} from './storage/s3-path-grammar';
