/**
 * Model-aware public OCR / LLM option contracts.
 */
import { z } from 'zod';
import { OcrLlmReasoningEffortRequestSchema } from './llm-models';

export const OcrFigureAssetsModeSchema = z.enum(['none', 'stored']);
export type OcrFigureAssetsMode = z.infer<typeof OcrFigureAssetsModeSchema>;

export const PaddleOcrOptionsRequestSchema = z
  .object({
    image_block_ocr: z.boolean().optional(),
    chart_recognition: z.boolean().optional(),
    figure_assets: OcrFigureAssetsModeSchema.optional(),
  })
  .strict();
export type PaddleOcrOptionsRequest = z.infer<typeof PaddleOcrOptionsRequestSchema>;

export const PaddleOcrOptionsEffectiveSchema = z
  .object({
    image_block_ocr: z.boolean(),
    chart_recognition: z.boolean(),
    figure_assets: OcrFigureAssetsModeSchema,
  })
  .strict();
export type PaddleOcrOptionsEffective = z.infer<typeof PaddleOcrOptionsEffectiveSchema>;

export const PADDLE_OCR_OPTION_DEFAULTS = {
  image_block_ocr: false,
  chart_recognition: true,
  figure_assets: 'none',
} as const satisfies PaddleOcrOptionsEffective;

export const OcrOptionsRequestSchema = PaddleOcrOptionsRequestSchema;
export type OcrOptionsRequest = z.infer<typeof OcrOptionsRequestSchema>;
export const OcrOptionsEffectiveSchema = PaddleOcrOptionsEffectiveSchema;
export type OcrOptionsEffective = z.infer<typeof OcrOptionsEffectiveSchema>;

export const LlmOptionsRequestSchema = z
  .object({ reasoning_effort: OcrLlmReasoningEffortRequestSchema.optional() })
  .strict();
export type LlmOptionsRequest = z.infer<typeof LlmOptionsRequestSchema>;

export const LlmOptionsStoredSchema = z
  .object({ reasoning_effort: OcrLlmReasoningEffortRequestSchema.nullable() })
  .strict();
export type LlmOptionsStored = z.infer<typeof LlmOptionsStoredSchema>;

export const OcrModelOptionCapabilitySchema = z
  .object({
    image_block_ocr: z.boolean(),
    chart_recognition: z.boolean(),
    figure_assets: z.boolean(),
  })
  .strict();
export type OcrModelOptionCapability = z.infer<typeof OcrModelOptionCapabilitySchema>;

export function applyPaddleOcrOptionDefaults(
  requested?: OcrOptionsRequest | null
): PaddleOcrOptionsEffective {
  return {
    image_block_ocr: requested?.image_block_ocr ?? PADDLE_OCR_OPTION_DEFAULTS.image_block_ocr,
    chart_recognition: requested?.chart_recognition ?? PADDLE_OCR_OPTION_DEFAULTS.chart_recognition,
    figure_assets: requested?.figure_assets ?? PADDLE_OCR_OPTION_DEFAULTS.figure_assets,
  };
}
