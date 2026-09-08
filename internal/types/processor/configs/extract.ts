import { z } from 'zod';
import { ReasoningEffortSchema } from '../../client/ai-client';

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
    /**
     * Optional structured document from ai.parse (or a ParsedDocument).
     * Kept as unknown here so input validation does not weaken the type;
     * the worker validates `@openparser/schema` ParsedDocument at the use
     * boundary.
     */
    structured: z
      .unknown()
      .optional()
      .describe(
        'Optional structured document (ParsedDocument or parser-owned structured output). Validated at the extract use boundary.'
      ),
    contentType: z.enum(['text', 'image']).default('text'),
    /** Base64 image data (required if contentType is 'image') */
    imageData: z.string().optional(),
    imageMimeType: z.string().optional(),
  })
  .refine((data) => data.content || data.text || data.structured !== undefined, {
    message: 'Either content, text, or structured must be provided',
  });

export const ExtractOutputSchema = z
  .record(z.string(), z.unknown())
  .describe(
    'Extracted structured data matching the provided schema. Unless grounding is disabled (grounded: false), the output also carries a reserved `_grounding` map keyed by dotted field path: `_grounding["line_items.0.amount"] = { confidence: high|medium|low, score?, needsReview, reason?, quote?, citations?, source_span }`, plus reserved `_degraded: true` / `_reason` markers when grounding could not run the shared algorithm or the Eigenpal text pass. Lineage is never included in this JSON.'
  );

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
  reasoningEffort: ReasoningEffortSchema.optional().describe(
    'Reasoning effort for the extraction model. Omit to use the model default.'
  ),
  maxInputTokens: z
    .number()
    .int()
    .optional()
    .describe(
      'Max input tokens. Truncates input text and logs a warning when exceeded. Omit for no limit.'
    ),
  // --- Grounding (on by default) ---
  grounded: z
    .boolean()
    .optional()
    .describe(
      'Grounding is ON by default: a grounding pass runs over the schema fields and attaches per-field source spans + confidence under a reserved `_grounding` output key, flagging fields whose value cannot be located in the source for human review. The pass runs through the workspace LLM (any provider) and chunks long documents automatically. Tri-state: unset (default) = on, degrading gracefully to deterministic text alignment (`_grounding._degraded: true`) if no grounding model is available; `true` = strict, the step fails when the grounding model cannot be resolved; `false` = off, no `_grounding` key at all.'
    ),
  groundingModel: z
    .string()
    .optional()
    .describe(
      'Provider/model for the grounding pass. Defaults to the workspace default LLM. Any configured provider works; the pass only fails the step when `grounded: true` is set explicitly and no model resolves.'
    ),
  groundingReasoningEffort: ReasoningEffortSchema.optional().describe(
    'Reasoning effort for the grounding model. Omit to use the model default.'
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
    .describe(
      'Which grounding confidences set needsReview on a field. Default: low_only (only fields whose value could not be located in the source). Use medium_or_low to also flag approximate and derived matches.'
    ),
});

export type ExtractInput = z.infer<typeof ExtractInputSchema>;
export type ExtractOutput = z.infer<typeof ExtractOutputSchema>;
export type ExtractConfig = z.infer<typeof ExtractConfigSchema>;
