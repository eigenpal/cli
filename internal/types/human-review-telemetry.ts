import {
  HUMAN_REVIEW_CONTINUATION_EXPIRED_REASON,
  type HumanReviewSourceKind,
  type HumanReviewTaskStatus,
} from './human-review';

/** Closed event names for human-review logs. Do not interpolate caller strings. */
export const HUMAN_REVIEW_TELEMETRY_EVENTS = [
  'human-review-created',
  'human-review-bypassed',
  'human-review-waiting',
  'human-review-approved',
  'human-review-rejected',
  'human-review-cancelled',
  'human-review-conflict',
  'human-review-resume',
  'human-review-resume-failed',
  'human-review-queue',
] as const;

export type HumanReviewTelemetryEvent = (typeof HUMAN_REVIEW_TELEMETRY_EVENTS)[number];

/** Low-cardinality producer labels for resume metrics. */
export const HUMAN_REVIEW_TELEMETRY_PRODUCERS = ['workflow', 'agent'] as const;
export type HumanReviewTelemetryProducer = (typeof HUMAN_REVIEW_TELEMETRY_PRODUCERS)[number];

export const HUMAN_REVIEW_CONFLICT_CODES = [
  'not_found',
  'stale_version',
  'incomplete',
  'not_waiting',
  'idempotency_conflict',
  'terminal',
  'expired',
] as const;
export type HumanReviewConflictCode = (typeof HUMAN_REVIEW_CONFLICT_CODES)[number];

export const HUMAN_REVIEW_RESUME_FAILURE_CODES = [
  'missing',
  'corrupt',
  'oversized',
  'incompatible',
  'expired',
  'unknown',
] as const;
export type HumanReviewResumeFailureCode = (typeof HUMAN_REVIEW_RESUME_FAILURE_CODES)[number];

export const HUMAN_REVIEW_BYPASS_REASONS = [
  'evaluation_review_bypassed',
  'no_fields_selected',
] as const;
export type HumanReviewBypassReason = (typeof HUMAN_REVIEW_BYPASS_REASONS)[number];

export const HUMAN_REVIEW_TELEMETRY_OUTCOMES = ['approved', 'rejected', 'cancelled'] as const;
export type HumanReviewTelemetryOutcome = (typeof HUMAN_REVIEW_TELEMETRY_OUTCOMES)[number];

/**
 * Allowlisted log fields. Identifiers are fine in pino; Prometheus labels stay
 * on the closed `source_kind` / `status` sets in {@link formatHumanReviewMetricsText}.
 */
export const HUMAN_REVIEW_TELEMETRY_KEYS = [
  'event',
  'taskId',
  'executionId',
  'sourceKind',
  'producer',
  'selectedCount',
  'confirmedCount',
  'fileCount',
  'waitDurationMs',
  'outcomeLatencyMs',
  'continuationBytes',
  'sessionFileCount',
  'artifactCount',
  'outcome',
  'conflictCode',
  'resumeFailureCode',
  'bypassReason',
  'pendingCount',
  'oldestAgeSeconds',
] as const;

export type HumanReviewTelemetryKey = (typeof HUMAN_REVIEW_TELEMETRY_KEYS)[number];

const TELEMETRY_KEY_SET = new Set<string>(HUMAN_REVIEW_TELEMETRY_KEYS);

/** Keys that always carry reviewed values, files, session bodies, or field metadata. */
export const HUMAN_REVIEW_TELEMETRY_FORBIDDEN_KEYS = [
  'machineData',
  'draftData',
  'reviewedData',
  'data',
  'output',
  'fieldMetadata',
  'metadata',
  'originalValue',
  'currentValue',
  'value',
  'files',
  'fileContent',
  'content',
  'sessionFiles',
  'session',
  'instructions',
  'outcomeReason',
  'confidence',
  'label',
  'description',
  'display',
  'selectionReasons',
  'requiredPaths',
  'schema',
  'effectiveSchema',
] as const;

export interface HumanReviewTelemetryFields {
  taskId?: string;
  executionId?: string;
  sourceKind?: HumanReviewSourceKind;
  producer?: HumanReviewTelemetryProducer;
  selectedCount?: number;
  confirmedCount?: number;
  fileCount?: number;
  waitDurationMs?: number;
  outcomeLatencyMs?: number;
  continuationBytes?: number;
  sessionFileCount?: number;
  artifactCount?: number;
  outcome?: HumanReviewTelemetryOutcome;
  conflictCode?: HumanReviewConflictCode;
  resumeFailureCode?: HumanReviewResumeFailureCode;
  bypassReason?: HumanReviewBypassReason;
  pendingCount?: number;
  oldestAgeSeconds?: number;
}

export interface HumanReviewTelemetryLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

const EVENT_LEVEL: Record<HumanReviewTelemetryEvent, 'info' | 'warn' | 'error'> = {
  'human-review-created': 'info',
  'human-review-bypassed': 'info',
  'human-review-waiting': 'info',
  'human-review-approved': 'info',
  'human-review-rejected': 'info',
  'human-review-cancelled': 'info',
  'human-review-conflict': 'warn',
  'human-review-resume': 'info',
  'human-review-resume-failed': 'error',
  'human-review-queue': 'info',
};

const EVENT_MESSAGE: Record<HumanReviewTelemetryEvent, string> = {
  'human-review-created': 'Human review task created',
  'human-review-bypassed': 'Human review bypassed',
  'human-review-waiting': 'Agent execution parked for human review',
  'human-review-approved': 'Human review approved',
  'human-review-rejected': 'Human review rejected',
  'human-review-cancelled': 'Human review cancelled',
  'human-review-conflict': 'Human review conflict',
  'human-review-resume': 'Resuming from human-review continuation',
  'human-review-resume-failed': 'Human-review continuation restore failed',
  'human-review-queue': 'Human review queue health',
};

export interface HumanReviewQueueMetrics {
  sourceKind: HumanReviewSourceKind;
  pendingCount: number;
  oldestAgeSeconds: number;
  selectedCount: number;
  confirmedCount: number;
}

export interface HumanReviewStoredMetrics {
  sourceKind: HumanReviewSourceKind;
  status: Extract<HumanReviewTaskStatus, 'approved' | 'rejected' | 'cancelled'>;
  count: number;
}

export interface HumanReviewMetricsSnapshot {
  pending: HumanReviewQueueMetrics[];
  stored: HumanReviewStoredMetrics[];
}

const SOURCE_KINDS: HumanReviewSourceKind[] = ['workflow_step', 'agent_tool'];
const STORED_STATUSES: HumanReviewStoredMetrics['status'][] = ['approved', 'rejected', 'cancelled'];

export function humanReviewWaitDurationMs(
  createdAt: Date | string | null | undefined,
  completedAt: Date | string | null | undefined = new Date()
): number {
  const start =
    createdAt instanceof Date ? createdAt.getTime() : Date.parse(String(createdAt ?? ''));
  const end =
    completedAt instanceof Date ? completedAt.getTime() : Date.parse(String(completedAt ?? ''));
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.round(end - start));
}

export function classifyHumanReviewConflict(message: string): HumanReviewConflictCode {
  if (message === 'Human review task not found') return 'not_found';
  if (message.startsWith('Every required field')) return 'incomplete';
  if (message.startsWith('The paused run is no longer waiting')) return 'not_waiting';
  if (message.includes('idempotency key')) return 'idempotency_conflict';
  if (message === 'Human review task is no longer pending') return 'terminal';
  if (message === HUMAN_REVIEW_CONTINUATION_EXPIRED_REASON) return 'expired';
  return 'stale_version';
}

export function classifyHumanReviewResumeFailure(message: string): HumanReviewResumeFailureCode {
  const lower = message.toLowerCase();
  if (lower.includes('missing')) return 'missing';
  if (lower.includes('corrupt')) return 'corrupt';
  if (lower.includes('exceeds') || lower.includes('byte limit') || lower.includes('oversized')) {
    return 'oversized';
  }
  if (lower.includes('expired')) return 'expired';
  if (lower.includes('incompatible') || lower.includes('unsafe')) return 'incompatible';
  return 'unknown';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Copy only allowlisted identifiers, counts, durations, and closed enums.
 * Extra keys — including reviewed values — are dropped.
 */
export function buildHumanReviewLogFields(
  event: HumanReviewTelemetryEvent,
  fields: HumanReviewTelemetryFields & Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = { event };
  for (const [key, value] of Object.entries(fields)) {
    if (key === 'event' || !TELEMETRY_KEY_SET.has(key) || value === undefined || value === null) {
      continue;
    }
    if (
      key === 'selectedCount' ||
      key === 'confirmedCount' ||
      key === 'fileCount' ||
      key === 'waitDurationMs' ||
      key === 'outcomeLatencyMs' ||
      key === 'continuationBytes' ||
      key === 'sessionFileCount' ||
      key === 'artifactCount' ||
      key === 'pendingCount' ||
      key === 'oldestAgeSeconds'
    ) {
      if (!isFiniteNumber(value)) continue;
      out[key] = value;
      continue;
    }
    if (typeof value === 'string' || typeof value === 'boolean') {
      out[key] = value;
    }
  }
  return out;
}

export function logHumanReviewTelemetry(
  logger: HumanReviewTelemetryLogger,
  event: HumanReviewTelemetryEvent,
  fields: HumanReviewTelemetryFields & Record<string, unknown> = {}
): Record<string, unknown> {
  const meta = buildHumanReviewLogFields(event, fields);
  logger[EVENT_LEVEL[event]](EVENT_MESSAGE[event], meta);
  return meta;
}

export function emptyHumanReviewMetricsSnapshot(): HumanReviewMetricsSnapshot {
  return {
    pending: SOURCE_KINDS.map((sourceKind) => ({
      sourceKind,
      pendingCount: 0,
      oldestAgeSeconds: 0,
      selectedCount: 0,
      confirmedCount: 0,
    })),
    stored: SOURCE_KINDS.flatMap((sourceKind) =>
      STORED_STATUSES.map((status) => ({ sourceKind, status, count: 0 }))
    ),
  };
}

export function normalizeHumanReviewMetricsSnapshot(
  snapshot: HumanReviewMetricsSnapshot
): HumanReviewMetricsSnapshot {
  const pendingByKind = new Map(snapshot.pending.map((row) => [row.sourceKind, row]));
  const storedKey = (sourceKind: string, status: string) => `${sourceKind}:${status}`;
  const storedByKey = new Map(
    snapshot.stored.map((row) => [storedKey(row.sourceKind, row.status), row])
  );
  return {
    pending: SOURCE_KINDS.map((sourceKind) => {
      const row = pendingByKind.get(sourceKind);
      return {
        sourceKind,
        pendingCount: row?.pendingCount ?? 0,
        oldestAgeSeconds: row?.oldestAgeSeconds ?? 0,
        selectedCount: row?.selectedCount ?? 0,
        confirmedCount: row?.confirmedCount ?? 0,
      };
    }),
    stored: SOURCE_KINDS.flatMap((sourceKind) =>
      STORED_STATUSES.map((status) => ({
        sourceKind,
        status,
        count: storedByKey.get(storedKey(sourceKind, status))?.count ?? 0,
      }))
    ),
  };
}

/**
 * Prometheus text for human-review gauges. Labels are only `source_kind` and
 * `status` (closed sets) so scrape cardinality stays bounded.
 */
export function formatHumanReviewMetricsText(snapshot: HumanReviewMetricsSnapshot): string {
  const normalized = normalizeHumanReviewMetricsSnapshot(snapshot);
  const lines: string[] = [
    '# HELP eigenpal_human_review_pending Pending human-review tasks.',
    '# TYPE eigenpal_human_review_pending gauge',
  ];
  for (const row of normalized.pending) {
    lines.push(
      `eigenpal_human_review_pending{source_kind="${row.sourceKind}"} ${row.pendingCount}`
    );
  }
  lines.push(
    '# HELP eigenpal_human_review_oldest_age_seconds Age of the oldest pending human-review task.',
    '# TYPE eigenpal_human_review_oldest_age_seconds gauge'
  );
  for (const row of normalized.pending) {
    lines.push(
      `eigenpal_human_review_oldest_age_seconds{source_kind="${row.sourceKind}"} ${row.oldestAgeSeconds}`
    );
  }
  lines.push(
    '# HELP eigenpal_human_review_selected_fields Required fields on pending human-review tasks.',
    '# TYPE eigenpal_human_review_selected_fields gauge'
  );
  for (const row of normalized.pending) {
    lines.push(
      `eigenpal_human_review_selected_fields{source_kind="${row.sourceKind}"} ${row.selectedCount}`
    );
  }
  lines.push(
    '# HELP eigenpal_human_review_confirmed_fields Confirmed fields on pending human-review tasks.',
    '# TYPE eigenpal_human_review_confirmed_fields gauge'
  );
  for (const row of normalized.pending) {
    lines.push(
      `eigenpal_human_review_confirmed_fields{source_kind="${row.sourceKind}"} ${row.confirmedCount}`
    );
  }
  lines.push(
    '# HELP eigenpal_human_review_tasks_stored Terminal human-review tasks currently stored.',
    '# TYPE eigenpal_human_review_tasks_stored gauge'
  );
  for (const row of normalized.stored) {
    lines.push(
      `eigenpal_human_review_tasks_stored{source_kind="${row.sourceKind}",status="${row.status}"} ${row.count}`
    );
  }
  return `${lines.join('\n')}\n`;
}

export interface HumanReviewLifecycleEventInput {
  id: string;
  status: string;
  sourceKind: string;
  sourceLabel: string;
  requiredCount: number;
  confirmedCount: number;
  createdAt: Date;
  completedAt: Date | null;
}

export interface HumanReviewLifecycleEvent {
  type: string;
  timestamp: string;
  status: string;
  metadata: {
    taskId: string;
    sourceKind: string;
    sourceLabel: string;
    requiredCount: number;
    confirmedCount?: number;
  };
}

/** Value-free run-timeline events for human-review create and outcome. */
export function buildHumanReviewLifecycleEvents(
  reviews: HumanReviewLifecycleEventInput[]
): HumanReviewLifecycleEvent[] {
  const events: HumanReviewLifecycleEvent[] = [];
  for (const review of reviews) {
    events.push({
      type: 'human_review.created',
      timestamp: review.createdAt.toISOString(),
      status: 'pending',
      metadata: {
        taskId: review.id,
        sourceKind: review.sourceKind,
        sourceLabel: review.sourceLabel,
        requiredCount: review.requiredCount,
      },
    });
    if (review.completedAt) {
      events.push({
        type: `human_review.${review.status}`,
        timestamp: review.completedAt.toISOString(),
        status: review.status,
        metadata: {
          taskId: review.id,
          sourceKind: review.sourceKind,
          sourceLabel: review.sourceLabel,
          requiredCount: review.requiredCount,
          confirmedCount: review.confirmedCount,
        },
      });
    }
  }
  return events;
}

export function serializedHumanReviewSurfaceContains(
  serialized: string,
  fragments: readonly string[]
): string[] {
  return fragments.filter((fragment) => fragment.length > 0 && serialized.includes(fragment));
}

export function collectSensitiveHumanReviewFragments(input: {
  reviewedData?: unknown;
  fileContents?: readonly string[];
  sessionContents?: readonly string[];
  fieldMetadata?: unknown;
}): string[] {
  const fragments: string[] = [];
  const visit = (value: unknown) => {
    if (typeof value === 'string' && value.length > 0) fragments.push(value);
    else if (typeof value === 'number' && Number.isFinite(value)) fragments.push(String(value));
    else if (Array.isArray(value)) for (const item of value) visit(item);
    else if (value && typeof value === 'object') {
      for (const nested of Object.values(value as Record<string, unknown>)) visit(nested);
    }
  };
  visit(input.reviewedData);
  visit(input.fieldMetadata);
  for (const content of input.fileContents ?? []) {
    if (content.length > 0) fragments.push(content);
  }
  for (const content of input.sessionContents ?? []) {
    if (content.length > 0) fragments.push(content);
  }
  return [...new Set(fragments)];
}
