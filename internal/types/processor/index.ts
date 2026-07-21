/**
 * Processor types - processor definitions, execution, and configs
 */

// Processor definitions and tracing
export {
  ProcessorDefinitionSchema,
  ProcessorExecutionContextSchema,
  ProcessorPortSchema,
  SpanKind,
  TraceStatus,
  noopTracingContext,
  type ProcessorDefinition,
  type ProcessorExecutionContext,
  type ProcessorLogger,
  type ProcessorPort,
  type SpanAttributes,
  type SpanOptions,
  type SpanType,
  type TracingContext,
} from './processor';

// Extract input normalization (shared with the app's grounding viewer)
export {
  extractSourceTextFromResolvedConfig,
  normalizeExtractInputToText,
} from './normalize-extract-input';

// Grounding result types (produced by the worker, consumed by the app)
export { stripGroundingMetadata } from './grounding';
export type { FieldGrounding, GroundingConfidence, GroundingResult } from './grounding';

// Execution status
export {
  // Execution types (mode: prod/eval/playground)
  EXECUTION_TYPES,
  ExecutionTypeSchema,
  ExecutionTypeValue,
  // Step execution statuses
  STEP_EXECUTION_STATUSES,
  StepExecutionStatusSchema,
  StepExecutionStatusValue,
  // Trigger types (how workflow is invoked)
  TRIGGER_TYPES,
  TriggerTypeSchema,
  TriggerTypeValue,
  // Workflow execution statuses
  WORKFLOW_EXECUTION_STATUSES,
  WorkflowExecutionStatusSchema,
  WorkflowExecutionStatusValue,
  type ExecutionType,
  type StepExecutionStatus,
  type TriggerType,
  type WorkflowExecutionStatus,
} from './execution';

// Processor configs
export {
  // Individual schemas
  ClassifyConfigSchema,
  ClassifyInputSchema,
  ClassifyLabelSchema,
  ClassifyOutputSchema,
  DocumentParserConfigSchema,
  DocumentParserInputSchema,
  DocumentParserOutputSchema,
  ExtractConfigSchema,
  ExtractInputSchema,
  ExtractOutputSchema,
  FilePathDescriptorSchema,
  MergeConfigSchema,
  MergeInputSchema,
  MergeOutputSchema,
  PROCESSOR_SCHEMAS,
  PdfEmbedderConfigSchema,
  PdfEmbedderInputSchema,
  PdfEmbedderOutputSchema,
  SEGMENT_UNKNOWN_TYPE,
  SegmentConfigSchema,
  SegmentInputSchema,
  SegmentOutputSchema,
  SplitConfigSchema,
  SplitInputSchema,
  SplitOutputSchema,
  TemplateConfigSchema,
  TemplateInputSchema,
  TemplateOutputSchema,
  XlsxToJsonConfigSchema,
  XlsxToJsonInputSchema,
  XlsxToJsonOutputSchema,
  // React Hook Form helpers
  extractFieldMetadata,
  // Registry & utilities
  getAllProcessorJsonSchemas,
  getConfigDefaults,
  getConfigFieldMetadata,
  getConfigSchema,
  getProcessorSchemas,
  isFilePathDescriptor,
  listProcessorIds,
  validateConfig,
  // Types
  type ClassifyConfig,
  type ClassifyInput,
  type ClassifyLabel,
  type ClassifyOutput,
  type DocumentParserConfig,
  type DocumentParserInput,
  type DocumentParserOutput,
  type ExtractConfig,
  type ExtractInput,
  type ExtractOutput,
  type FieldMetadata,
  type FilePathDescriptor,
  type LocalFileRef,
  type MergeConfig,
  type MergeInput,
  type MergeOutput,
  type PdfEmbedderConfig,
  type PdfEmbedderInput,
  type PdfEmbedderOutput,
  type ProcessorSchemas,
  type S3FileRef,
  type SegmentConfig,
  type SegmentInput,
  type SegmentOutput,
  type SplitConfig,
  type SplitInput,
  type SplitOutput,
  type TemplateConfig,
  type TemplateInput,
  type TemplateOutput,
  type XlsxToJsonConfig,
  type XlsxToJsonInput,
  type XlsxToJsonOutput,
} from './configs';
