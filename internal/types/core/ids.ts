/**
 * Processor IDs
 *
 * Centralized constants for built-in processor IDs.
 * Use these instead of hardcoded strings to prevent silent breakage.
 */

export const PROCESSOR_IDS = {
  // Core processors
  MERGE: 'builtin/merge',

  // Document processing
  DOCUMENT_PARSER: 'builtin/parser',
  EXTRACT: 'builtin/extract',
  SPLIT: 'builtin/split',
  SEGMENT: 'builtin/segment',
  CLASSIFY: 'builtin/classify',
  VISION: 'builtin/vision',
  TEMPLATE: 'builtin/template',
  PDF_EMBEDDER: 'builtin/pdf-embedder',
  XLSX_TO_JSON: 'builtin/xlsx-to-json',
} as const;

export type ProcessorId = (typeof PROCESSOR_IDS)[keyof typeof PROCESSOR_IDS];

/**
 * Parser IDs
 *
 * Centralized constants for built-in parser IDs.
 * Use these instead of hardcoded strings to prevent silent breakage.
 */

export const PARSER_IDS = {
  KREUZBERG: 'builtin/kreuzberg',
  OCR: 'builtin/ocr',
  LLM_VISION: 'builtin/llm-vision',
} as const;

export type ParserId = (typeof PARSER_IDS)[keyof typeof PARSER_IDS];

/**
 * Input Port Kinds
 *
 * Centralized constants for workflow input port kinds.
 * Used in multi-entry workflows to specify how inputs are handled.
 *
 * - DOCUMENT: File upload stored to blob storage, passed as {ref, filename, mimeType}
 * - PAYLOAD: Direct JSON payload passed as-is
 */
export const INPUT_KINDS = {
  DOCUMENT: 'document',
  PAYLOAD: 'payload',
} as const;

export type InputPortKind = (typeof INPUT_KINDS)[keyof typeof INPUT_KINDS];
