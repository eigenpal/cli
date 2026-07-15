/**
 * CLI env — validated at module load via @t3-oss/env-core.
 *
 * Every `process.env.*` read in this package goes through this file.
 */

import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export const env = createEnv({
  server: {
    EIGENPAL_BASE_URL: z.string().optional(),
    EIGENPAL_API_KEY: z.string().optional(),
    EIGENPAL_TENANT_ID: z.string().optional(),
    EIGENPAL_DIR: z.string().optional(),
    /** Per-shell profile override. See `eigenpal auth use <name>` for the
     *  persisted equivalent. */
    EIGENPAL_PROFILE: z.string().optional(),
    /** Test-only override (milliseconds) for the evaluator-rollup grace
     *  window. Lets integration tests exercise the rollup-timeout path
     *  without waiting the real 90s. Not documented for end users. */
    EIGENPAL_EVAL_GRACE_MS: z.string().optional(),

    // Standard Node vars — declared for consistency.
    DEBUG: z.string().optional(),
    NO_COLOR: z.string().optional(),
    CI: z.string().optional(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
  skipValidation:
    process.env.SKIP_ENV_VALIDATION === 'true' || process.env.npm_lifecycle_event === 'lint',
});

export function getProcessEnv(): NodeJS.ProcessEnv {
  return process.env;
}
