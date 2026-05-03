/**
 * Merge Processor Schemas
 *
 * Merges multiple named inputs into a single output.
 * Used for multi-document workflows where different paths
 * converge to combine their results.
 */

import { z } from 'zod';

/**
 * Merge processor config
 */
export const MergeConfigSchema = z.object({
  /** Whether to preserve port names as keys in the output (default: true) */
  preservePortNames: z.boolean().default(true),
  /** Custom key to wrap all outputs under (when not preserving port names) */
  outputKey: z.string().optional(),
});

export type MergeConfig = z.infer<typeof MergeConfigSchema>;

/**
 * Merge processor input
 *
 * Record of port name -> value from named port edges
 */
export const MergeInputSchema = z.record(z.string(), z.unknown());

export type MergeInput = z.infer<typeof MergeInputSchema>;

/**
 * Merge processor output
 *
 * - items: Array of all input values
 * - count: Number of inputs merged
 * - merged: Port name -> value mapping
 */
export const MergeOutputSchema = z.object({
  items: z.array(z.unknown()),
  count: z.number(),
  /** Original port mapping for named port inputs */
  merged: z.record(z.string(), z.unknown()).optional(),
});

export type MergeOutput = z.infer<typeof MergeOutputSchema>;
