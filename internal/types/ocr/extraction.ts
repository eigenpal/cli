import { z } from 'zod';
import { ParsedDocumentSchema } from './parsed-document';

/**
 * Public OCR extraction terminal result wire shapes.
 * Normative companion: docs/OCR_API_OPENAPI.yaml
 */

export const EXTRACTION_ATTEMPT_KINDS = ['primary', 'repair'] as const;
export const ExtractionAttemptKindSchema = z.enum(EXTRACTION_ATTEMPT_KINDS);
export type ExtractionAttemptKind = z.infer<typeof ExtractionAttemptKindSchema>;

export const EXTRACTION_ATTEMPT_STATUSES = ['succeeded', 'failed', 'indeterminate'] as const;
export const ExtractionAttemptStatusSchema = z.enum(EXTRACTION_ATTEMPT_STATUSES);
export type ExtractionAttemptStatus = z.infer<typeof ExtractionAttemptStatusSchema>;

export const LlmModelSchema = z.string().min(1).max(200);
export type LlmModel = z.infer<typeof LlmModelSchema>;

export const ExtractionAttemptSchema = z
  .object({
    index: z.number().int().min(0),
    kind: ExtractionAttemptKindSchema,
    llm_model: LlmModelSchema,
    status: ExtractionAttemptStatusSchema,
    input_tokens: z.number().int().min(0).optional(),
    output_tokens: z.number().int().min(0).optional(),
    cost_usd: z.number().min(0).optional(),
  })
  .strict();

export type ExtractionAttempt = z.infer<typeof ExtractionAttemptSchema>;

export const ExtractionUsageTotalsSchema = z
  .object({
    input_tokens: z.number().int().min(0).optional(),
    output_tokens: z.number().int().min(0).optional(),
    cost_usd: z.number().min(0).optional(),
  })
  .strict();

export type ExtractionUsageTotals = z.infer<typeof ExtractionUsageTotalsSchema>;

/** Terminal extract success body for sync `200` and succeeded job `result`. */
export const ExtractionTerminalResultSchema = z
  .object({
    output: z.unknown(),
    parsed_document: ParsedDocumentSchema,
    llm_model: LlmModelSchema,
    attempts: z.array(ExtractionAttemptSchema).min(1),
    usage: ExtractionUsageTotalsSchema.optional(),
  })
  .strict();

export type ExtractionTerminalResult = z.infer<typeof ExtractionTerminalResultSchema>;
