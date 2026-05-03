import { z } from 'zod';

// ── Per-alias reply config ────────────────────────────────────────────────────

/**
 * Per-alias reply configuration schema (stored in `agent_workflow_email_aliases.reply_config`).
 *
 * Parse any raw DB value (including `{}`, `null`, or `undefined`) through this
 * schema to get a fully-populated, trusted object with correct defaults.
 * `.catch()` on every field means invalid stored values (e.g. `on: 42`) are
 * silently replaced by the default rather than throwing.
 */
export const aliasReplyConfigSchema = z
  .object({
    /** Whether to send an automated reply at all. Default: always. */
    on: z.enum(['never', 'always']).catch('always'),
    /**
     * Who receives the reply.
     * - `'sender'` (default): reply to the original sender only.
     * - `'all'`: reply-all — mirrors the original To/Cc recipients.
     */
    mode: z.enum(['sender', 'all']).catch('sender'),
  })
  .catch({ on: 'always', mode: 'sender' });

export type AliasReplyConfig = z.infer<typeof aliasReplyConfigSchema>;

// ── Workflow-level trigger config ─────────────────────────────────────────────

/**
 * Zod schema for `workflow.config.triggers`.
 *
 * This is the **workflow-level** trigger configuration — it controls whether
 * each trigger type is enabled and any workflow-wide policy for that trigger.
 * Per-alias settings (allowlist, requireSenderAuth, replyConfig) live on the
 * individual alias rows in `agent_workflow_email_aliases`, not here.
 *
 * **Always parse raw DB data through this schema before reading any field.**
 * Designed to be maximally graceful:
 * - Missing fields → correct default applied.
 * - Wrong type stored → default applied, no throw.
 * - Entire sub-object missing or wrong type → sub-object default applied.
 * - Entire config `null`/`undefined` → full default config returned.
 */
export const workflowTriggerConfigSchema = z
  .object({
    api: z
      .object({
        /** API trigger enabled. Default: true (on by default, must be explicitly disabled). */
        enabled: z.boolean().catch(true),
      })
      .catch({ enabled: true }),

    email: z
      .object({
        /** Email trigger enabled. Default: false (must be explicitly turned on). */
        enabled: z.boolean().catch(false),
      })
      .catch({ enabled: false }),
  })
  .catch({
    api: { enabled: true },
    email: { enabled: false },
  });

/** Fully-resolved workflow trigger config. All fields guaranteed present after parsing. */
export type WorkflowTriggerConfig = z.infer<typeof workflowTriggerConfigSchema>;
