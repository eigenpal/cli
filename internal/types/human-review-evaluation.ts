import { z } from 'zod';
import {
  HumanReviewJsonPointerSchema,
  HumanReviewScalarSchema,
  HumanReviewSelectionReasonSchema,
} from './human-review';

export const HumanReviewEvaluationFieldFixtureSchema = z
  .object({
    expectedRoute: z.enum(['review', 'skip']).optional(),
    expectedReason: HumanReviewSelectionReasonSchema.optional(),
    expectedValue: HumanReviewScalarSchema.optional(),
  })
  .strict();

export const HumanReviewEvaluationStepFixtureSchema = z
  .object({
    fields: z
      .record(HumanReviewJsonPointerSchema, HumanReviewEvaluationFieldFixtureSchema)
      .default({}),
    simulate: z
      .object({
        outcome: z.literal('approved').optional(),
        edits: z.record(HumanReviewJsonPointerSchema, HumanReviewScalarSchema).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const HumanReviewEvaluationFixtureSchema = z
  .object({
    version: z.literal(1),
    steps: z.record(z.string().min(1), HumanReviewEvaluationStepFixtureSchema),
  })
  .strict();

export const HumanReviewEvaluationObservationSchema = z
  .object({
    version: z.literal(1),
    stepPath: z.string().min(1),
    fields: z.record(
      HumanReviewJsonPointerSchema,
      z
        .object({
          route: z.enum(['review', 'skip']),
          reason: HumanReviewSelectionReasonSchema,
          rawCorrect: z.boolean().optional(),
          corrected: z.boolean().optional(),
        })
        .strict()
    ),
    simulated: z.boolean(),
  })
  .strict();

export type HumanReviewEvaluationFixture = z.infer<typeof HumanReviewEvaluationFixtureSchema>;
export type HumanReviewEvaluationStepFixture = z.infer<
  typeof HumanReviewEvaluationStepFixtureSchema
>;
export type HumanReviewEvaluationObservation = z.infer<
  typeof HumanReviewEvaluationObservationSchema
>;
