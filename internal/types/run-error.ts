import { z } from 'zod';
import { parseFailureEnvelope } from './eval/expected-error';
import type { InternalExecutionFailure } from './execution-row';

/** Processing outcome, independent of the HTTP status of the API request. */
export const RunErrorSchema = z
  .object({
    code: z.string().describe('Machine-readable failure code. Do not branch on message text.'),
    message: z.string().describe('Human-readable failure explanation.'),
    statusCode: z
      .number()
      .int()
      .min(400)
      .max(599)
      .optional()
      .describe(
        'HTTP-style business code configured by control.fail, not the API response status. Absent for untyped failures.'
      ),
    step: z
      .string()
      .optional()
      .describe('Name of the control.fail step that rejected the run, when known.'),
    retryable: z
      .boolean()
      .describe('Whether another attempt might succeed. Does not schedule a retry.'),
  })
  .meta({ id: 'RunError' });
export type RunError = z.infer<typeof RunErrorSchema>;

/** Inline JSON Schema for documentation consumers without a component registry. */
export function runErrorJsonSchema(): Record<string, unknown> {
  const { $schema: _dialect, ...schema } = z.toJSONSchema(z.object(RunErrorSchema.shape));
  return schema;
}

/** Project only public fields, including typed failures stored by older workers. */
export function publicRunError(
  error: string | null | undefined,
  failure?: InternalExecutionFailure | null
): RunError | null {
  if (!error && !failure) return null;
  const envelope = parseFailureEnvelope(failure?.rawMessage) ?? parseFailureEnvelope(error);
  const statusCode = failure?.statusCode ?? envelope?.code;
  const typed =
    statusCode !== undefined &&
    Number.isInteger(statusCode) &&
    statusCode >= 400 &&
    statusCode <= 599;
  const step = failure?.step ?? envelope?.step;
  return {
    code: typed ? 'workflow_rejected' : (failure?.code ?? 'unknown_error'),
    message: failure?.userMessage ?? envelope?.message ?? error ?? 'Run failed.',
    ...(typed ? { statusCode, ...(step ? { step } : {}) } : {}),
    retryable: typed ? false : (failure?.retryable ?? false),
  };
}

/** Display adapter for consumers of both current and older Runs API responses. */
export function runErrorMessage(error: unknown): string | null {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string')
    return error.message;
  return null;
}
