import type {
  HumanReviewFieldDecision,
  HumanReviewFile,
  HumanReviewTaskSummary,
} from '@eigenpal/types';
import { formatTimestamp, type TableColumn } from './ui';
import { newIdempotencyKey } from './upload-reusable-file';

export type ReviewTaskRow = HumanReviewTaskSummary & Record<string, unknown>;
export type ReviewTaskDetail = HumanReviewTaskSummary & {
  files: HumanReviewFile[];
  decisions: HumanReviewFieldDecision[];
  instructions: string | null;
};
export type ReviewDecisionRow = {
  path: string;
  required: boolean;
  currentValue: unknown;
  confirmed: string;
  reason?: string;
};

export const REVIEW_LIST_COLUMNS: TableColumn<ReviewTaskRow>[] = [
  { key: 'id', header: 'ID' },
  { key: 'status', header: 'STATUS' },
  {
    key: 'confirmedCount',
    header: 'CONFIRMED',
    format: (_value, row) => `${row.confirmedCount}/${row.requiredCount}`,
  },
  { key: 'automationName', header: 'AUTOMATION' },
  { key: 'sourceLabel', header: 'SOURCE' },
  { key: 'executionId', header: 'RUN' },
  { key: 'version', header: 'VER' },
  { key: 'createdAt', header: 'CREATED', format: formatTimestamp },
];

export const REVIEW_DECISION_COLUMNS: TableColumn<ReviewDecisionRow>[] = [
  { key: 'path', header: 'PATH' },
  {
    key: 'required',
    header: 'REQ',
    format: (value) => (value ? 'yes' : 'no'),
  },
  {
    key: 'currentValue',
    header: 'VALUE',
    format: (value) => formatScalarForDisplay(value),
  },
  { key: 'confirmed', header: 'CONFIRMED' },
  { key: 'reason', header: 'REASON' },
];

export function buildReviewListParams(opts: {
  automationId?: string;
  waitingBefore?: string;
  cursor?: string;
  limit?: number;
}): Record<string, string> {
  const params: Record<string, string> = {};
  if (opts.automationId) params.automationId = opts.automationId;
  if (opts.waitingBefore) params.waitingBefore = opts.waitingBefore;
  if (opts.cursor) params.cursor = opts.cursor;
  if (opts.limit != null) params.limit = String(opts.limit);
  return params;
}

/** Parse a CLI scalar for PUT /v1/human-reviews/:id/fields. */
export function parseReviewScalarValue(raw: string): string | number | boolean | null {
  const trimmed = raw.trim();
  if (trimmed === 'null') return null;
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    const asNumber = Number(trimmed);
    if (Number.isFinite(asNumber)) return asNumber;
  }
  return raw;
}

export function parseReviewJsonScalar(value: unknown): string | number | boolean | null {
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  throw new Error('Review field values must be scalar JSON: string, number, boolean, or null.');
}

export function resolveReviewIdempotencyKey(explicit?: string): string {
  const key = explicit?.trim();
  if (key) return key;
  return newIdempotencyKey();
}

export function formatScalarForDisplay(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

export function decisionRows(task: ReviewTaskDetail): ReviewDecisionRow[] {
  return (task.decisions ?? []).map((decision) => ({
    path: decision.path,
    required: decision.required,
    currentValue: decision.currentValue,
    confirmed: decision.confirmedAt ? 'yes' : 'no',
    reason: decision.reason,
  }));
}

export function formatReviewTaskSummary(task: HumanReviewTaskSummary): string {
  return [
    `ID           ${task.id}`,
    `Status       ${task.status}`,
    `Automation   ${task.automationName} (${task.automationId})`,
    `Run          ${task.executionId}`,
    `Source       ${task.sourceKind} · ${task.sourceLabel}`,
    `Progress     ${task.confirmedCount}/${task.requiredCount} confirmed · version ${task.version}`,
    `Created      ${formatTimestamp(task.createdAt)}`,
    `Updated      ${formatTimestamp(task.updatedAt)}`,
  ].join('\n');
}

export function formatReviewTaskDetail(task: ReviewTaskDetail): string {
  const lines = [formatReviewTaskSummary(task)];
  if (task.instructions) {
    lines.push('', 'Instructions', task.instructions);
  }
  if (task.files?.length) {
    lines.push('', 'Files');
    for (const file of task.files) {
      lines.push(
        `  ${file.fileId}  ${file.filename}${file.fieldName ? ` (${file.fieldName})` : ''}`
      );
    }
  }
  return lines.join('\n');
}
