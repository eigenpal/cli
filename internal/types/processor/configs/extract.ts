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

/**
 * `temperature` is intentionally NOT exposed here — Eigenpal is a
 * deterministic framework, so the worker hardcodes `temperature: 0` on every
 * LLM call. Older YAMLs that include `temperature: …` parse cleanly because
 * Zod strips unknown keys by default; the value is silently ignored.
 */
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
  maxInputTokens: z
    .number()
    .int()
    .optional()
    .describe(
      'Max input tokens. Truncates input text and logs a warning when exceeded. Omit for no limit.'
    ),
  // --- Optional langextract grounding (opt-in) ---
  grounded: z
    .boolean()
    .optional()
    .describe(
      'When true, run a grounding pass over the schema fields and attach per-field source spans + confidence under a `_grounding` key, flagging ungrounded/fuzzy fields for human review. Grounding is OpenAI-only: the pass (langextract) always calls OpenAI directly (independent of the extract provider) and requires OPENAI_API_KEY on the worker. If the key is missing or the grounding model resolves to a non-OpenAI provider, the step fails at runtime instead of silently skipping grounding.'
    ),
  groundingModel: z
    .string()
    .optional()
    .describe(
      'Provider/model for the grounding pass. Defaults to the workspace default LLM. Grounding is OpenAI-only, so this must resolve to an OpenAI model; a non-OpenAI model fails the step at runtime.'
    ),
  groundingExamples: z
    .array(
      z.object({
        text: z.string(),
        extractions: z.array(z.object({ field: z.string(), text: z.string() })),
      })
    )
    .optional()
    .describe('Few-shot examples for grounding (verbatim source text per field). Optional.'),
  reviewOn: z
    .enum(['medium_or_low', 'low_only'])
    .optional()
    .describe('Which grounding confidences flag a field for review. Default: medium_or_low.'),
});

export type ExtractInput = z.infer<typeof ExtractInputSchema>;
export type ExtractOutput = z.infer<typeof ExtractOutputSchema>;
export type ExtractConfig = z.infer<typeof ExtractConfigSchema>;
