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
  ApprovalConfigSchema,
  ApprovalInputSchema,
  ApprovalOutputSchema,
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
  type ApprovalConfig,
  type ApprovalInput,
  type ApprovalOutput,
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

// Workflow types (YAML-based sequential execution)
export * from './workflow';

// Eval primitives (shared by app + worker)
export * from './eval';

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
