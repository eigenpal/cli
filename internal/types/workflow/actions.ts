import { z } from 'zod';

/**
 * Action types for action steps
 */
export const ActionTypeSchema = z.enum(['http', 'invoke-workflow', 'website-reader', 'email']);
export type ActionType = z.infer<typeof ActionTypeSchema>;

/**
 * Action type value constants for type-safe comparisons
 */
export const ActionTypeValue = {
  HTTP: 'http',
  INVOKE_WORKFLOW: 'invoke-workflow',
  WEBSITE_READER: 'website-reader',
  EMAIL: 'email',
} as const;

/**
 * Array of all action types for iteration
 */
export const ACTION_TYPES = ActionTypeSchema.options;
