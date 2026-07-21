import { z } from 'zod';

export const OCR_OUTPUT_FORMATS = ['openparser@1', 'raw'] as const;
export const OcrOutputFormatSchema = z.enum(OCR_OUTPUT_FORMATS);
export type OcrOutputFormat = z.infer<typeof OcrOutputFormatSchema>;

export const PaddleRawProfileSchema = z
  .object({
    name: z.literal('eigenpal-paddle-layout-v1'),
    options: z
      .object({
        format_block_content: z.literal(true),
        use_chart_recognition: z.literal(true),
        return_markdown_images: z.literal(false),
        visualize: z.literal(false),
      })
      .strict(),
  })
  .strict();

/**
 * Provider-specific parse output. `result` is the successful Paddle HPS
 * `payload.result` object, preserved without canonicalization. The outer HPS
 * transport response is intentionally excluded so errorCode/errorMsg cannot be
 * mistaken for parse data.
 */
export const RawParseResultSchema = z
  .object({
    output_format: z.literal('raw'),
    provider: z.literal('paddle'),
    model: z.literal('paddleocr-vl-1.6'),
    profile: PaddleRawProfileSchema,
    result: z.record(z.string(), z.unknown()),
  })
  .strict();

export type RawParseResult = z.infer<typeof RawParseResultSchema>;
