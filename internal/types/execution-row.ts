/**
 * Durable `executions` table lifecycle — shared by workflow + agent runtimes.
 * Kept in @eigenpal/types so CLI and browser code can import without @eigenpal/db.
 */

/** `executions.type` — workflow vs agent (distinct from processor prod/eval/playground `ExecutionType`). */
export const DURABLE_EXECUTION_TYPES = ['workflow', 'agent'] as const;
export type DurableExecutionType = (typeof DURABLE_EXECUTION_TYPES)[number];

export const EXECUTION_STATUSES = [
  'created',
  'pending',
  'running',
  'waiting',
  'finalizing',
  'completed',
  'failed',
  'cancelled',
  'rejected',
] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

/**
 * Terminal statuses: no further lifecycle transitions except archival/cleanup.
 * Callers treating “finished” runs should accept all of these.
 */
export const TERMINAL_EXECUTION_STATUSES = [
  'completed',
  'failed',
  'cancelled',
  'rejected',
] as const satisfies readonly ExecutionStatus[];
export type TerminalExecutionStatus = (typeof TERMINAL_EXECUTION_STATUSES)[number];

const TERMINAL_STATUS_SET = new Set<string>(TERMINAL_EXECUTION_STATUSES);

/** True when `status` is one of {@link TERMINAL_EXECUTION_STATUSES}. */
export function isTerminalExecutionStatus(status: string | null | undefined): boolean {
  return status != null && TERMINAL_STATUS_SET.has(status);
}

/** Every `executions.status` value that is not {@link TERMINAL_EXECUTION_STATUSES}. */
export type ExecutionNonTerminalStatus = Exclude<ExecutionStatus, TerminalExecutionStatus>;
export const EXECUTION_NON_TERMINAL_STATUSES = EXECUTION_STATUSES.filter(
  (s) => !TERMINAL_STATUS_SET.has(s)
) as ExecutionNonTerminalStatus[];

/**
 * Terminal outcomes excluding successful completion (failure summaries, exit codes).
 */
export const NON_SUCCESS_TERMINAL_EXECUTION_STATUSES = [
  'failed',
  'cancelled',
  'rejected',
] as const satisfies readonly ExecutionStatus[];

const NON_SUCCESS_TERMINAL_SET = new Set<string>(NON_SUCCESS_TERMINAL_EXECUTION_STATUSES);

export function isNonSuccessTerminalExecutionStatus(status: string | null | undefined): boolean {
  return status != null && NON_SUCCESS_TERMINAL_SET.has(status);
}

/**
 * Rows that count toward tenant/type/batch concurrency while their lease is
 * still treated as active in queue queries (running work + post-run lease).
 */
export const EXECUTION_CONCURRENCY_ACTIVE_STATUSES = ['running', 'finalizing'] as const;
export type ExecutionConcurrencyActiveStatus =
  (typeof EXECUTION_CONCURRENCY_ACTIVE_STATUSES)[number];

/** Shared-queue rows where a cancel request may still be applied. */
export const EXECUTION_SHARED_CANCEL_REQUESTABLE_STATUSES = [
  'created',
  'pending',
  'running',
  'waiting',
  'finalizing',
] as const satisfies readonly ExecutionStatus[];

/** Agent executions: cancel may be requested before the row is terminal. */
export const EXECUTION_AGENT_CANCEL_REQUESTABLE_STATUSES = [
  'created',
  'pending',
  'running',
] as const satisfies readonly ExecutionStatus[];

/** Queued agent rows (not leased): {@link createAgentExecutionsRepo}.failQueuedCancel applies here. */
export const EXECUTION_AGENT_QUEUED_STATUSES = [
  'pending',
  'created',
] as const satisfies readonly ExecutionStatus[];

/** Agent reap / stale scan considers these non-terminal rows. */
export const EXECUTION_AGENT_REAP_SCAN_STATUSES = [
  'running',
  'finalizing',
  'pending',
  'created',
] as const satisfies readonly ExecutionStatus[];

/**
 * Agent rows included in cluster metrics breakdown by status.
 * Omits `waiting` (not used on the agent queue today).
 */
export const EXECUTION_AGENT_METRICS_STATUSES = [
  'created',
  'pending',
  'running',
  'finalizing',
  'completed',
  'failed',
  'cancelled',
  'rejected',
] as const satisfies readonly ExecutionStatus[];

/** Counted as “running” in lightweight eval aggregates (pending + running). */
export const EXECUTION_EVAL_RUNNING_STATUSES = [
  'running',
  'pending',
] as const satisfies readonly ExecutionStatus[];

/** Terminal-ish error outcomes sometimes aggregated separately from `failed`. */
export const EXECUTION_FAILED_OR_CANCELLED_STATUSES = [
  'failed',
  'cancelled',
] as const satisfies readonly ExecutionStatus[];

/**
 * Lifecycle semantics for {@link EXECUTION_STATUSES}:
 *
 * - `created` — Row inserted; worker-visible prep (e.g. agent sandbox wiring) before enqueue.
 * - `pending` — Eligible for dequeue / lease; not actively executing.
 * - `running` — Worker holds a lease and is executing.
 * - `waiting` — Workflow runtime paused (human/tool/step continuation); not used by all types.
 * - `finalizing` — Run finished in sandbox but post-run side effects / uploads still run.
 * - `completed` — Successful terminal state.
 * - `failed` — Error or timeout terminal state.
 * - `cancelled` — User/API cancelled before completion terminal state.
 * - `rejected` — Terminal state for runs refused before start (e.g. email policy).
 */

/** Wall-clock duration from timestamps when both ends are known (not persisted). */
export function executionWallClockMs(
  startedAt: Date | string | null | undefined,
  completedAt: Date | string | null | undefined
): number | null {
  if (startedAt == null || completedAt == null) return null;
  const start = typeof startedAt === 'string' ? Date.parse(startedAt) : startedAt.getTime();
  const end = typeof completedAt === 'string' ? Date.parse(completedAt) : completedAt.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const ms = end - start;
  return ms >= 0 ? ms : null;
}
