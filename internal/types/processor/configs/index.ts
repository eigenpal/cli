/**
 * Processor Config Schemas
 *
 * Shared Zod schemas for processor configurations.
 * Used by:
 * - Frontend: React Hook Form validation
 * - API: Validation before saving workflows
 * - Worker: Runtime validation
 *
 * These are the SOURCE OF TRUTH for processor schemas.
 */

import { z } from 'zod';
import { toJsonSchema, type JsonSchema7Type } from '../../core/common';
import { PROCESSOR_IDS } from '../../core/ids';

// Re-export individual processor schemas
export * from './classify';
export * from './document-parser';
export * from './extract';
export * from './merge';
export * from './pdf-embedder';
export * from './split';
export * from './template';
export * from './xlsx-to-json';

// Import for registry
import { ClassifyConfigSchema, ClassifyInputSchema, ClassifyOutputSchema } from './classify';
import {
  DocumentParserConfigSchema,
  DocumentParserInputSchema,
  DocumentParserOutputSchema,
} from './document-parser';
import { ExtractConfigSchema, ExtractInputSchema, ExtractOutputSchema } from './extract';
import { MergeConfigSchema, MergeInputSchema, MergeOutputSchema } from './merge';
import {
  PdfEmbedderConfigSchema,
  PdfEmbedderInputSchema,
  PdfEmbedderOutputSchema,
} from './pdf-embedder';
import { SplitConfigSchema, SplitInputSchema, SplitOutputSchema } from './split';
import { TemplateConfigSchema, TemplateInputSchema, TemplateOutputSchema } from './template';
import {
  XlsxToJsonConfigSchema,
  XlsxToJsonInputSchema,
  XlsxToJsonOutputSchema,
} from './xlsx-to-json';

/**
 * Processor schema definition
 */
export interface ProcessorSchemas {
  id: string;
  inputSchema: z.ZodType;
  outputSchema: z.ZodType;
  configSchema: z.ZodType;
}

/**
 * Registry of all builtin processor schemas
 */
export const PROCESSOR_SCHEMAS: Record<string, ProcessorSchemas> = {
  [PROCESSOR_IDS.EXTRACT]: {
    id: PROCESSOR_IDS.EXTRACT,
    inputSchema: ExtractInputSchema,
    outputSchema: ExtractOutputSchema,
    configSchema: ExtractConfigSchema,
  },
  [PROCESSOR_IDS.DOCUMENT_PARSER]: {
    id: PROCESSOR_IDS.DOCUMENT_PARSER,
    inputSchema: DocumentParserInputSchema,
    outputSchema: DocumentParserOutputSchema,
    configSchema: DocumentParserConfigSchema,
  },
  [PROCESSOR_IDS.MERGE]: {
    id: PROCESSOR_IDS.MERGE,
    inputSchema: MergeInputSchema,
    outputSchema: MergeOutputSchema,
    configSchema: MergeConfigSchema,
  },
  [PROCESSOR_IDS.TEMPLATE]: {
    id: PROCESSOR_IDS.TEMPLATE,
    inputSchema: TemplateInputSchema,
    outputSchema: TemplateOutputSchema,
    configSchema: TemplateConfigSchema,
  },
  [PROCESSOR_IDS.PDF_EMBEDDER]: {
    id: PROCESSOR_IDS.PDF_EMBEDDER,
    inputSchema: PdfEmbedderInputSchema,
    outputSchema: PdfEmbedderOutputSchema,
    configSchema: PdfEmbedderConfigSchema,
  },
  [PROCESSOR_IDS.SPLIT]: {
    id: PROCESSOR_IDS.SPLIT,
    inputSchema: SplitInputSchema,
    outputSchema: SplitOutputSchema,
    configSchema: SplitConfigSchema,
  },
  [PROCESSOR_IDS.CLASSIFY]: {
    id: PROCESSOR_IDS.CLASSIFY,
    inputSchema: ClassifyInputSchema,
    outputSchema: ClassifyOutputSchema,
    configSchema: ClassifyConfigSchema,
  },
  [PROCESSOR_IDS.XLSX_TO_JSON]: {
    id: PROCESSOR_IDS.XLSX_TO_JSON,
    inputSchema: XlsxToJsonInputSchema,
    outputSchema: XlsxToJsonOutputSchema,
    configSchema: XlsxToJsonConfigSchema,
  },
};

/**
 * Get processor schemas by ID
 */
export function getProcessorSchemas(processorId: string): ProcessorSchemas | undefined {
  return PROCESSOR_SCHEMAS[processorId];
}

/**
 * Get config schema for a processor (Zod)
 * Use this with React Hook Form's zodResolver
 */
export function getConfigSchema(processorId: string): z.ZodType | undefined {
  return PROCESSOR_SCHEMAS[processorId]?.configSchema;
}

/**
 * Get all processor schemas as JSON Schema (for DB sync)
 */
export function getAllProcessorJsonSchemas(): Array<{
  id: string;
  inputSchema: JsonSchema7Type;
  outputSchema: JsonSchema7Type;
  configSchema: JsonSchema7Type;
}> {
  return Object.values(PROCESSOR_SCHEMAS).map((p) => ({
    id: p.id,
    inputSchema: toJsonSchema(p.inputSchema),
    outputSchema: toJsonSchema(p.outputSchema),
    configSchema: toJsonSchema(p.configSchema),
  }));
}

/**
 * List all registered processor IDs
 */
export function listProcessorIds(): string[] {
  return Object.keys(PROCESSOR_SCHEMAS);
}

// React Hook Form integration
export {
  extractFieldMetadata,
  getConfigDefaults,
  getConfigFieldMetadata,
  validateConfig,
  type FieldMetadata,
} from './react-hook-form';
