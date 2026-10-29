import { EXECUTION_PHASES } from './execution-row';
import type { RunError } from './run-error';

/** Representative outcomes, not a closed enum or a promise of retryability. */
export const STANDARD_RUN_FAILURE_EXAMPLES: ReadonlyArray<{
  error: RunError;
  status: 'failed' | 'cancelled';
  description: string;
}> = [
  ...[
    ['input_validation_failed', 'Run inputs do not match the workflow input schema.'],
    ['input_file_resolution_failed', 'An input file could not be retrieved.'],
    ['input_file_not_found', 'An input file is missing from this run.'],
    ['input_file_reference_invalid', 'An input file reference is invalid.'],
    ['input_file_reference_mismatch', 'An input file reference does not match its run-owned file.'],
    [
      'input_scoped_file_resolution_failed',
      'An input file reference could not be resolved in this run.',
    ],
    ['output_schema_validation_failed', 'Run output did not match the expected schema.'],
    ['llm_model_mismatch', 'The configured model belongs to a different provider.'],
    ['llm_model_not_found', 'The model provider does not recognize the requested model.'],
    ['agent_limit_reached', 'The agent reached its execution limit.'],
    ['unknown_error', 'A failure without a classified code was recorded.'],
  ].map(([code, message]) => ({
    error: { code, message, retryable: false },
    status: 'failed' as const,
    description: message,
  })),
  ...EXECUTION_PHASES.flatMap((phase) => [
    {
      error: { code: `${phase}_failed`, message: `Run failed during ${phase}.`, retryable: false },
      status: 'failed' as const,
      description: `Failure during ${phase}. Inspect diagnostics and retryability.`,
    },
    {
      error: {
        code: `${phase}_timeout`,
        message: `Run timed out during ${phase}.`,
        retryable: true,
      },
      status: 'failed' as const,
      description: `Timeout during ${phase}. Inspect diagnostics and retryability.`,
    },
  ]),
  {
    error: { code: 'cancelled_by_user', message: 'Run was cancelled.', retryable: false },
    status: 'cancelled',
    description: 'The run was cancelled by a user.',
  },
];
