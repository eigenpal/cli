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
    EIGENPAL_DIR: z.string().optional(),
    /** Per-shell profile override. See `eigenpal auth use <name>` for the
     *  persisted equivalent. */
    EIGENPAL_PROFILE: z.string().optional(),

    // LLM config for `workflow step exec ai.extract`. Mirrors the worker's
    // WORKER_LLM_* convention so a user with a working worker .env.local
    // can run the CLI extract command without any new config.
    WORKER_LLM_PROVIDER: z.string().optional(),
    WORKER_LLM_API_KEY: z.string().optional(),
    WORKER_LLM_MODEL: z.string().optional(),
    WORKER_LLM_BASE_URL: z.string().optional(),
    /** Fallback API key when WORKER_LLM_API_KEY is unset and provider is
     *  openai (matches every other tool in the openai ecosystem). */
    OPENAI_API_KEY: z.string().optional(),

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
