import { z } from 'zod';

/**
 * Extract Processor Schemas
 *
 * Extracts structured data from text/document using AI.
 *
 * For per-page extraction, use control.parallel_map with ai.extract inside to
 * iterate over pages concurrently.
 */

export const ExtractInputSchema = z
  .object({
    // Support both 'content' (direct) and 'text' (from document parser output)
    content: z.string().optional().describe('Text content to extract from'),
    text: z
      .string()
      .optional()
      .describe('Text content (alternative to content, e.g., from document parser)'),
    contentType: z.enum(['text', 'image']).default('text'),
    /** Base64 image data (required if contentType is 'image') */
    imageData: z.string().optional(),
    imageMimeType: z.string().optional(),
  })
  .refine((data) => data.content || data.text, {
    message: 'Either content or text must be provided',
  });

export const ExtractOutputSchema = z
  .record(z.string(), z.unknown())
  .describe('Extracted structured data matching the provided schema');

export const ExtractConfigSchema = z.object({
  schema: z
    .record(z.string(), z.unknown())
    .describe('JSON Schema defining the structure to extract'),
  prompt: z.string().optional().describe('Custom prompt template for extraction'),
  provider: z
    .string()
    .optional()
    .describe('Provider ID to use (e.g., "openai-gpt4o", "anthropic-claude")'),
  model: z.string().optional().describe('Model to use (overrides provider default)'),
  temperature: z
    .number()
    .min(0)
    .max(2)
    .default(0)
    .describe('Model temperature (0 = deterministic)'),
  maxInputTokens: z
    .number()
    .int()
    .optional()
    .describe(
      'Max input tokens. Truncates input text and logs a warning when exceeded. Omit for no limit.'
    ),
});

export type ExtractInput = z.infer<typeof ExtractInputSchema>;
export type ExtractOutput = z.infer<typeof ExtractOutputSchema>;
export type ExtractConfig = z.infer<typeof ExtractConfigSchema>;
