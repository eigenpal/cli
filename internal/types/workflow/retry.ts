import { z } from 'zod';

export const RetryCategorySchema = z.enum([
  'timeout',
  'rate_limited',
  'temporarily_unavailable',
  'invalid_provider_output',
  'validation',
  'authentication',
  'authorization',
  'not_found',
  'business',
  'cancelled',
  'unknown',
]);
export type RetryCategory = z.infer<typeof RetryCategorySchema>;

const AutomaticRetryPolicySchema = z.object({
  mode: z.literal('automatic'),
  maxAttempts: z.number().int().min(1).max(10).optional(),
});

const NeverRetryPolicySchema = z.object({
  mode: z.literal('never'),
});

export const ResolvedRetryPolicySchema = z.discriminatedUnion('mode', [
  AutomaticRetryPolicySchema,
  NeverRetryPolicySchema,
]);
export type ResolvedRetryPolicy = z.infer<typeof ResolvedRetryPolicySchema>;

export const StepRetryPolicySchema = z.union([
  z.literal('inherit'),
  z.literal('automatic'),
  z.literal('never'),
  ResolvedRetryPolicySchema,
]);
export type StepRetryPolicy = z.infer<typeof StepRetryPolicySchema>;

export const WorkflowRetryPolicySchema = z.union([
  z.literal('automatic'),
  z.literal('never'),
  ResolvedRetryPolicySchema,
]);
export type WorkflowRetryPolicy = z.infer<typeof WorkflowRetryPolicySchema>;

export const RetryPolicySourceSchema = z.enum(['step', 'workflow', 'step_type', 'tenant_ceiling']);
export type RetryPolicySource = z.infer<typeof RetryPolicySourceSchema>;

export const RetryTerminalReasonSchema = z.enum([
  'non_retryable',
  'unsafe_to_replay',
  'cancelled',
  'attempts_exhausted',
  'elapsed_time_exhausted',
  'retry_after_exceeds_budget',
  'operator_ceiling',
]);
export type RetryTerminalReason = z.infer<typeof RetryTerminalReasonSchema>;

export const ExecutionFailureSchema = z.object({
  code: z.string().min(1),
  category: RetryCategorySchema,
  message: z.string(),
  transient: z.boolean(),
  retryAfterMs: z.number().int().nonnegative().optional(),
  httpStatus: z.number().int().min(100).max(599).optional(),
  provider: z.string().optional(),
});
export type ExecutionFailure = z.infer<typeof ExecutionFailureSchema>;

export const RetryDecisionSchema = z.object({
  retry: z.boolean(),
  delayMs: z.number().int().nonnegative().optional(),
  nextAttemptAt: z.coerce.date().optional(),
  policySource: RetryPolicySourceSchema,
  terminalReason: RetryTerminalReasonSchema.optional(),
});
export type RetryDecision = z.infer<typeof RetryDecisionSchema>;

export const StepRetryCapabilitySchema = z.object({
  replaySafety: z.enum(['safe', 'requires-idempotency', 'never']),
  automaticCategories: z.array(RetryCategorySchema),
  hasProviderRequestRetries: z.boolean().optional(),
});
export type StepRetryCapability = z.infer<typeof StepRetryCapabilitySchema>;

export interface RetryPolicyCeilings {
  maxAttempts: number;
  maxElapsedMs: number;
}

export interface ResolvedRetryPolicyWithSource {
  policy: ResolvedRetryPolicy;
  source: RetryPolicySource;
  capped: boolean;
}

function normalizePolicy(
  policy: StepRetryPolicy | WorkflowRetryPolicy | undefined
): ResolvedRetryPolicy | 'inherit' | undefined {
  if (policy === undefined || policy === 'inherit') return policy;
  if (policy === 'automatic') return { mode: 'automatic' };
  if (policy === 'never') return { mode: 'never' };
  return policy;
}

export function resolveRetryPolicy(args: {
  step?: StepRetryPolicy;
  workflow?: WorkflowRetryPolicy;
  capability: StepRetryCapability;
  ceilings?: RetryPolicyCeilings;
}): ResolvedRetryPolicyWithSource {
  const step = normalizePolicy(args.step);
  const workflow = normalizePolicy(args.workflow);

  let policy: ResolvedRetryPolicy;
  let source: RetryPolicySource;

  if (step && step !== 'inherit') {
    policy = policyForCapability(step, args.capability);
    source = 'step';
  } else if (workflow && workflow !== 'inherit') {
    policy = policyForCapability(workflow, args.capability);
    source = 'workflow';
  } else {
    policy = { mode: 'never' };
    source = 'step_type';
  }

  const ceilings = args.ceilings ?? { maxAttempts: 10, maxElapsedMs: 86_400_000 };
  if (policy.mode === 'never') return { policy, source, capped: false };

  const maxAttempts = Math.min(policy.maxAttempts ?? 3, ceilings.maxAttempts);
  const capped = maxAttempts !== (policy.maxAttempts ?? 3);
  return {
    policy: { ...policy, maxAttempts },
    source: capped ? 'tenant_ceiling' : source,
    capped,
  };
}

function policyForCapability(
  policy: ResolvedRetryPolicy,
  capability: StepRetryCapability
): ResolvedRetryPolicy {
  if (policy.mode === 'never') return policy;
  if (capability.replaySafety === 'never') return { mode: 'never' };

  if (
    capability.hasProviderRequestRetries ||
    capability.automaticCategories.length === 0 ||
    capability.replaySafety === 'requires-idempotency'
  ) {
    return { mode: 'automatic', maxAttempts: 1 };
  }

  return policy;
}
