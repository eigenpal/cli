import { z } from 'zod';

/** Exact, case-sensitive execution labels. Whitespace is preserved, never normalized. */
export const ExecutionTagSchema = z
  .string()
  .min(1)
  .max(256)
  .refine((tag) => tag.trim().length > 0, 'Tags must not be blank');

/** Run APIs accept one tag or a list; persisted executions always have a unique list. */
export const ExecutionTagsSchema = z
  .union([ExecutionTagSchema, z.array(ExecutionTagSchema).max(100)])
  .transform((tags) => [...new Set(typeof tags === 'string' ? [tags] : tags)]);
