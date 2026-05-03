import { z } from 'zod';

/**
 * Approval Processor Schemas
 *
 * Pauses workflow execution for human approval.
 */

export const ApprovalInputSchema = z.object({
  data: z.record(z.string(), z.unknown()).describe('Data to review'),
  message: z.string().optional().describe('Message to show to approver'),
});

export const ApprovalOutputSchema = z.object({
  approved: z.boolean().describe('Whether the request was approved'),
  approvedBy: z.string().optional().describe('Who approved'),
  approvedAt: z.string().optional().describe('When approved'),
  comment: z.string().optional().describe('Approver comment'),
});

export const ApprovalConfigSchema = z.object({
  timeoutMinutes: z
    .number()
    .default(60 * 24)
    .describe('Auto-reject after timeout (minutes)'),
  notifyEmail: z.string().email().optional().describe('Email to notify for approval'),
});

export type ApprovalInput = z.infer<typeof ApprovalInputSchema>;
export type ApprovalOutput = z.infer<typeof ApprovalOutputSchema>;
export type ApprovalConfig = z.infer<typeof ApprovalConfigSchema>;
