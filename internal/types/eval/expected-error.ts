import { z } from 'zod';

/**
 * Expected-failure assertion for an eval example.
 *
 * Lives alongside `expectedOutput.data` on the `eval_examples.expectedOutput`
 * JSON envelope:
 *
 *   {
 *     data?: <success-expected JSON>,
 *     expectedDocuments?: { ... },
 *     error?: ExpectedError,        // failure-expected (mutually exclusive with data)
 *   }
 *
 * Dataset archives store it as `examples/<name>/expected.json` with a single
 * `$error` key.
 *
 * The scorer reads the typed envelope persisted to `executions.error` by the
 * worker's `control.fail` handler (`{ code, message, step }`) and matches
 * against the fields the user set here. Unspecified fields are not checked.
 */
export const ExpectedErrorSchema = z
  .object({
    /** Exact HTTP-style status code that the execution must fail with. */
    code: z.number().int().min(400).max(599).optional(),
    /**
     * Substring expected to appear in the failure message. **Case-sensitive
     * substring match** — `"REJECTED"` will NOT match a message containing
     * `"rejected"`. Use when you care about *which* failure was raised, not
     * just the code.
     */
    messageContains: z.string().min(1).max(1000).optional(),
    /**
     * Name of the step expected to trigger the fail. Useful when multiple
     * `control.fail` steps could fire under different conditions and you
     * want to assert which one was reached.
     */
    step: z.string().min(1).max(200).optional(),
  })
  .refine((v) => v.code != null || v.messageContains != null || v.step != null, {
    message:
      'expected.json $error must specify at least one of: code, messageContains, step (otherwise any failure would match)',
  });

export type ExpectedError = z.infer<typeof ExpectedErrorSchema>;

/**
 * Parse the JSON envelope persisted to `executions.error` by the
 * `control.fail` handler. Legacy/crash failures store a plain string in
 * the same column — JSON.parse throws, and we return null so the scorer
 * treats them as "no typed envelope, can't match expected.error".
 */
export function parseFailureEnvelope(
  error: string | null | undefined
): { code?: number; message?: string; step?: string } | null {
  if (!error) return null;
  try {
    const parsed = JSON.parse(error);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const out: { code?: number; message?: string; step?: string } = {};
    if (typeof parsed.code === 'number') out.code = parsed.code;
    if (typeof parsed.message === 'string') out.message = parsed.message;
    if (typeof parsed.step === 'string') out.step = parsed.step;
    return out;
  } catch {
    return null;
  }
}

export interface ExpectedErrorComparison {
  /** True when every set field on the expectation matched the actual envelope. */
  passed: boolean;
  /** True when the actual execution completed successfully (failure was expected). */
  expectedFailureButSucceeded: boolean;
  /**
   * True when the actual execution ended in a terminal status other than
   * `completed` or `failed` — currently `cancelled`. The UI should surface
   * this distinctly from a "wrong code/message" mismatch.
   */
  unexpectedTerminalStatus: boolean;
  /** True when the actual error wasn't a typed control.fail envelope (e.g. a crash). */
  actualWasUntypedError: boolean;
  /** The actual execution status when assertion couldn't proceed (debug aid). */
  actualStatus: string;
  /** Field-level mismatches for UI display. */
  mismatches: Array<{
    field: 'code' | 'messageContains' | 'step';
    expected: unknown;
    actual: unknown;
  }>;
}

/**
 * Compare an expected-error assertion to an actual execution outcome.
 *
 * `actualStatus` is the execution's terminal status; `actualError` is the
 * raw `executions.error` column (which control.fail stores as JSON,
 * other failures as a plain string).
 *
 * Pass when all set fields on the expectation match the parsed envelope.
 * Distinguishes three failure modes for the UI:
 *   - expectedFailureButSucceeded: execution completed → no error to match.
 *   - actualWasUntypedError:       execution crashed → no typed envelope.
 *   - mismatches:                  envelope present but fields disagree.
 */
export function compareExpectedError(
  expected: ExpectedError,
  actualStatus: string,
  actualError: string | null | undefined
): ExpectedErrorComparison {
  // The only terminal status that gives us an envelope to match against is
  // `failed`. `completed` means the workflow never reached the fail step;
  // `cancelled` (or anything else) means the run ended in an unexpected
  // way — distinguish so the UI can render the right hint.
  if (actualStatus !== 'failed') {
    return {
      passed: false,
      expectedFailureButSucceeded: actualStatus === 'completed',
      unexpectedTerminalStatus: actualStatus !== 'completed',
      actualWasUntypedError: false,
      actualStatus,
      mismatches: [],
    };
  }

  const envelope = parseFailureEnvelope(actualError);
  if (!envelope) {
    return {
      passed: false,
      expectedFailureButSucceeded: false,
      unexpectedTerminalStatus: false,
      actualWasUntypedError: true,
      actualStatus,
      mismatches: [],
    };
  }

  const mismatches: ExpectedErrorComparison['mismatches'] = [];
  if (expected.code != null && envelope.code !== expected.code) {
    mismatches.push({ field: 'code', expected: expected.code, actual: envelope.code });
  }
  if (
    expected.messageContains != null &&
    !(envelope.message ?? '').includes(expected.messageContains)
  ) {
    mismatches.push({
      field: 'messageContains',
      expected: expected.messageContains,
      actual: envelope.message ?? null,
    });
  }
  if (expected.step != null && envelope.step !== expected.step) {
    mismatches.push({ field: 'step', expected: expected.step, actual: envelope.step });
  }

  return {
    passed: mismatches.length === 0,
    expectedFailureButSucceeded: false,
    unexpectedTerminalStatus: false,
    actualWasUntypedError: false,
    actualStatus,
    mismatches,
  };
}
