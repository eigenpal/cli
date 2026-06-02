import { z } from 'zod';

/**
 * Classify Processor Schemas
 *
 * Single-label classification: given a text input and an enumerated label set,
 * the LLM picks exactly one. Under the hood the worker synthesizes an extract
 * schema with `label: enum(labels[].name)` and calls the existing extract
 * pipeline — no separate LLM contract to maintain.
 */

export const ClassifyInputSchema = z
  .object({
    content: z.string().optional().describe('Text content to classify'),
    text: z.string().optional().describe('Text content (alternative to content)'),
  })
  .refine((data) => !!(data.content || data.text), {
    message: 'Either content or text must be provided',
  });

export const ClassifyLabelSchema = z.object({
  name: z.string().min(1).describe('Label value returned in output.label'),
  description: z
    .string()
    .optional()
    .describe('What documents fall into this label. Fed to the LLM as guidance.'),
});

export const ClassifyConfigSchema = z.object({
  labels: z
    .array(ClassifyLabelSchema)
    .min(2)
    .describe('Allowed labels. The LLM is constrained to pick exactly one of these names.'),
  prompt: z
    .string()
    .optional()
    .describe(
      'Optional classification instructions appended to the system prompt. Use to clarify edge cases or emphasize evidence the model should weigh.'
    ),
  provider: z.string().optional().describe('Provider ID (e.g., "openai-gpt4o-mini")'),
  model: z.string().optional().describe('Model override'),
  maxInputTokens: z
    .number()
    .int()
    .optional()
    .describe('Max input tokens. Truncates input text when exceeded. Omit for no limit.'),
});

export const ClassifyOutputSchema = z.object({
  label: z.string().describe('The selected label name'),
  confidence: z.enum(['low', 'medium', 'high']).describe('Coarse confidence in the classification'),
  reason: z.string().describe('Short justification for the chosen label'),
});

export type ClassifyInput = z.infer<typeof ClassifyInputSchema>;
export type ClassifyOutput = z.infer<typeof ClassifyOutputSchema>;
export type ClassifyConfig = z.infer<typeof ClassifyConfigSchema>;
export type ClassifyLabel = z.infer<typeof ClassifyLabelSchema>;
