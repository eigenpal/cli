import { z } from 'zod';

/**
 * Classify-Pages Processor Schemas
 *
 * Per-page MULTI-label tagging. Consumes parsed per-page text and a label set;
 * the LLM assigns zero or more labels to each page independently. Unlike split
 * / segment (contiguous boundary detection) this groups NON-contiguous pages by
 * label, so scattered pages of a type (every signature/stamp/photo page) can be
 * routed to a downstream step via the `byLabel` map + ai.vision `pageIndices`.
 *
 * Regex validity / duplicate-name checks live on the workflow-facing
 * AiClassifyPagesConfigSchema; by the time the worker runs, config already
 * passed — so this mirror carries no superRefine (same pattern as the classify
 * and split mirrors).
 */

export const ClassifyPagesInputSchema = z
  .object({
    pages: z
      .array(
        z.object({
          pageIndex: z.number().int().nonnegative().describe('0-based page index'),
          text: z.string().describe('Extracted text for this page'),
          pageName: z.string().optional(),
        })
      )
      .min(1)
      .describe('Per-page parsed content from a document parser'),
  })
  .passthrough()
  .describe('Document-parser-shaped input. Pass {{ steps.parse.output }} directly.');

/** A label is a bare name (sugar) or `{ name, description }`. */
export const ClassifyPagesLabelSchema = z.union([
  z.string().min(1),
  z.object({
    name: z.string().min(1),
    description: z.string().optional(),
  }),
]);

export const ClassifyPagesConfigSchema = z.object({
  labels: z.array(ClassifyPagesLabelSchema).min(1),
  prompt: z.string().optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
  windowTokenBudget: z.number().int().positive().optional(),
});

export const ClassifyPagesOutputSchema = z.object({
  pages: z.array(
    z.object({
      pageIndex: z.number().int(),
      labels: z.array(z.string()),
    })
  ),
  byLabel: z.record(z.string(), z.array(z.number().int())),
});

export type ClassifyPagesInput = z.infer<typeof ClassifyPagesInputSchema>;
export type ClassifyPagesConfig = z.infer<typeof ClassifyPagesConfigSchema>;
export type ClassifyPagesOutput = z.infer<typeof ClassifyPagesOutputSchema>;
export type ClassifyPagesLabel = z.infer<typeof ClassifyPagesLabelSchema>;
