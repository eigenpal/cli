/**
 * Core types - ID generation, timestamps, pagination
 */

// Common utilities
export {
  BaseEntitySchema,
  ID_PREFIXES,
  JsonSchemaSchema,
  TemplateIdSchema,
  TemplateRevisionIdSchema,
  TimestampSchema,
  generateId,
  toJsonSchema,
  type BaseEntity,
  type IdPrefix,
  type JsonSchema,
  type JsonSchema7Type,
  type TemplatePlaceholder,
} from './common';

// Processor IDs, Parser IDs, and Input Kinds
export {
  INPUT_KINDS,
  PARSER_IDS,
  PROCESSOR_IDS,
  type InputPortKind,
  type ParserId,
  type ProcessorId,
} from './ids';

// Pagination
export {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  PaginationParamsSchema,
  type PaginatedResponse,
  type PaginationParams,
} from './pagination';
