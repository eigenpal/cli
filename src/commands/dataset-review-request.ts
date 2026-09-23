import { type Command } from 'commander';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { ApiClient } from '../lib/client';
import { action } from '../lib/format-error';
import {
  addJsonFlag,
  formatTimestamp,
  renderListResult,
  success,
  table,
  ui,
  withBaseUrl,
  withPagination,
  type PaginationOpts,
} from '../lib/ui';
import { printJson } from './agents/shared';
import {
  mergeFocusFields,
  mergeItemNotes,
  parseFieldNoteFlag,
  parseFocusReasonFlag,
  parseItemNoteFlag,
  parseJsonObjectFlag,
  type DatasetReviewFocusFieldInput,
  type DatasetReviewItemNoteInput,
} from './dataset-review-request-briefing';

type ReviewRequestOpts = {
  baseUrl?: string;
  json?: boolean;
};

export type ResolveAutomationForReviewRequest = (
  automationRef: string,
  opts: ReviewRequestOpts
) => Promise<{ client: ApiClient; automationId: string }>;

/** Base path for dataset review request collection routes (exported for tests). */
export function datasetReviewRequestsPath(automationId: string, reviewId?: string): string {
  const base = `/v1/automations/${automationId}/dataset-review-requests`;
  return reviewId ? `${base}/${reviewId}` : base;
}

export function datasetReviewRequestEventsPath(automationId: string, reviewId: string): string {
  return `${datasetReviewRequestsPath(automationId, reviewId)}/events`;
}

export function datasetReviewRequestItemsPath(
  automationId: string,
  reviewId: string,
  itemId?: string
): string {
  const base = `${datasetReviewRequestsPath(automationId, reviewId)}/items`;
  return itemId ? `${base}/${itemId}` : base;
}

type ReviewProgress = {
  remaining?: number;
  total?: number;
  complete?: boolean;
  removed?: number;
};

type ReviewRequestRow = {
  id?: string;
  title?: string;
  status?: string;
  exampleNames?: string[];
  progress?: ReviewProgress;
  createdAt?: string;
};

type ItemAction =
  | 'approve'
  | 'remove'
  | 'reopen'
  | 'comment'
  | 'edit'
  | 'field-decision'
  | 'file-decision'
  | 'edit-file';

/** Max edit-file upload the server accepts (mirrors MAX_EXPECTED_FILE_SIZE). */
export const REVIEW_EDIT_FILE_MAX_BYTES = 50 * 1024 * 1024;

function collectRepeatable(val: string, prev: string[]): string[] {
  return [...prev, val];
}

function formatProgress(progress: ReviewProgress | undefined): string {
  if (!progress) return '-';
  if (progress.complete) {
    return progress.removed ? `complete (${progress.removed} removed)` : 'complete';
  }
  const remaining = progress.remaining ?? 0;
  const total = progress.total ?? remaining;
  return `${remaining}/${total} remaining`;
}

/** Shared approved/removed/null parsing for field- and file-decisions. */
function parseApprovalDecision(
  opts: { decision?: string; clear?: boolean },
  action: 'field-decision' | 'file-decision'
): 'approved' | 'removed' | null {
  if (opts.clear) {
    if (opts.decision !== undefined) {
      throw new Error('pass either --clear or --decision, not both');
    }
    return null;
  }
  if (opts.decision === undefined) {
    throw new Error(`--decision or --clear is required when --action ${action}`);
  }
  const normalized = opts.decision.trim().toLowerCase();
  if (normalized === 'null' || normalized === 'clear') {
    return null;
  }
  if (normalized === 'approved' || normalized === 'removed') {
    return normalized;
  }
  throw new Error('--decision must be approved, removed, null, or clear');
}

/** Resolve field-decision payload; `null` clears the recorded decision on the server. */
export function parseFieldDecision(opts: {
  decision?: string;
  clear?: boolean;
}): 'approved' | 'removed' | null {
  return parseApprovalDecision(opts, 'field-decision');
}

/** Resolve file-decision payload; `null` clears the recorded decision on the server. */
export function parseFileDecision(opts: {
  decision?: string;
  clear?: boolean;
}): 'approved' | 'removed' | null {
  return parseApprovalDecision(opts, 'file-decision');
}

/** Build the item PATCH body, failing fast on flag/action mismatches. Exported for tests. */
export function buildReviewItemPatchBody(
  action: ItemAction,
  opts: {
    expectedUpdatedAt: string;
    comment?: string;
    fieldPath?: string;
    filePath?: string;
    newPath?: string;
    file?: string;
    decision?: string;
    clear?: boolean;
    expectedJson?: string;
  }
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    action,
    expectedUpdatedAt: opts.expectedUpdatedAt,
  };
  if (opts.comment !== undefined) body.comment = opts.comment;
  if (opts.fieldPath !== undefined) body.fieldPath = opts.fieldPath;
  if (opts.filePath !== undefined) body.filePath = opts.filePath;
  if (action === 'edit') {
    if (opts.expectedJson === undefined) {
      throw new Error('--expected-json is required when --action edit');
    }
    body.expected = parseJsonObjectFlag(opts.expectedJson, '--expected-json');
  } else if (opts.expectedJson !== undefined) {
    throw new Error('--expected-json is only valid with --action edit');
  }
  if (action === 'field-decision') {
    if (!opts.fieldPath?.trim()) {
      throw new Error('--field-path is required when --action field-decision');
    }
    body.decision = parseFieldDecision({ decision: opts.decision, clear: opts.clear });
  } else if (opts.decision !== undefined || opts.clear) {
    if (action !== 'file-decision') {
      throw new Error(
        '--decision / --clear are only valid with --action field-decision or file-decision'
      );
    }
  }
  if (action === 'file-decision') {
    if (!opts.filePath?.trim()) {
      throw new Error('--file-path is required when --action file-decision');
    }
    if (opts.fieldPath !== undefined) {
      throw new Error('--field-path is only valid with --action comment or field-decision');
    }
    if (opts.newPath !== undefined || opts.file !== undefined) {
      throw new Error('--new-path / --file are only valid with --action edit-file');
    }
    // A comment without a decision is a note on the file — allowed only when
    // a decision already exists server-side. Otherwise a decision is required.
    if (opts.decision !== undefined || opts.clear) {
      body.decision = parseFileDecision({ decision: opts.decision, clear: opts.clear });
    } else if (!opts.comment?.trim()) {
      throw new Error(
        'pass --decision approved|removed (or --clear) or a --comment note when --action file-decision'
      );
    }
  } else if (opts.filePath !== undefined || opts.newPath !== undefined || opts.file !== undefined) {
    if (action !== 'edit-file') {
      throw new Error(
        '--file-path / --new-path / --file are only valid with --action file-decision or edit-file'
      );
    }
  }
  if (action === 'edit-file') {
    throw new Error(
      '--action edit-file uploads bytes and needs multipart; use buildReviewItemFileFields'
    );
  }
  return body;
}

/**
 * Validate `--action edit-file` flags and return the multipart fields (minus
 * the file bytes). Exactly one of `filePath` (correct an existing expected
 * file) or `newPath` (upload a brand-new expected file) is required, plus
 * `--file` pointing at the local bytes. Exported for tests.
 */
export function buildReviewItemFileFields(opts: {
  expectedUpdatedAt: string;
  filePath?: string;
  newPath?: string;
  file?: string;
  comment?: string;
}): { filePath?: string; newPath?: string; comment?: string; expectedUpdatedAt: string } {
  const hasFilePath = !!opts.filePath?.trim();
  const hasNewPath = !!opts.newPath?.trim();
  if (hasFilePath === hasNewPath) {
    throw new Error(
      'pass exactly one of --file-path (correct an existing expected file) or --new-path (upload a brand-new expected file) when --action edit-file'
    );
  }
  if (!opts.file?.trim()) {
    throw new Error('--file <local path> is required when --action edit-file');
  }
  return {
    ...(hasFilePath ? { filePath: opts.filePath!.trim() } : {}),
    ...(hasNewPath ? { newPath: opts.newPath!.trim() } : {}),
    ...(opts.comment !== undefined ? { comment: opts.comment } : {}),
    expectedUpdatedAt: opts.expectedUpdatedAt,
  };
}

/**
 * Encode a review file path per segment for the item files route. Exported
 * for tests.
 */
export function encodeReviewFilePath(path: string): string {
  const segments = path.replace(/^\/+/, '').split('/');
  for (const segment of segments) {
    if (
      !segment ||
      segment === '.' ||
      segment === '..' ||
      segment.includes('\\') ||
      segment.includes('\0')
    ) {
      throw new Error(`refusing to download unsafe review file path: ${path}`);
    }
  }
  return segments.map((segment) => encodeURIComponent(segment)).join('/');
}

/**
 * Validate a server-supplied example name before using it as a local
 * directory: same per-segment rules as `encodeReviewFilePath` so a hostile
 * or corrupted `exampleName` (`..`, `/`, `\`) cannot escape `--out`.
 * Returns the name unchanged when safe. Exported for tests.
 */
export function assertSafeReviewExampleName(exampleName: string): string {
  const segments = exampleName.split('/');
  for (const segment of segments) {
    if (
      !segment ||
      segment === '.' ||
      segment === '..' ||
      segment.includes('\\') ||
      segment.includes('\0')
    ) {
      throw new Error(`refusing to materialize unsafe review example name: ${exampleName}`);
    }
  }
  return exampleName;
}

/** Summarize an item's expected files + file decisions for human tables. */
export function formatReviewItemFiles(item: {
  currentExpectedFiles?: Array<{ path?: string; name?: string; origin?: string }> | null;
  snapshotManifest?: { expectedFiles?: Array<{ path?: string; name?: string }> };
  fileDecisions?: Record<string, { decision?: string }>;
}): string {
  const overlay = item.currentExpectedFiles;
  const files = overlay ?? item.snapshotManifest?.expectedFiles ?? null;
  if (!files || files.length === 0) return '-';
  const decisions = item.fileDecisions ?? {};
  let approved = 0;
  let removed = 0;
  for (const file of files) {
    const key = file.path ?? file.name ?? '';
    const decision = decisions[key]?.decision;
    if (decision === 'approved') approved += 1;
    else if (decision === 'removed') removed += 1;
  }
  const total = files.length;
  const decided = approved + removed;
  if (decided === 0) return `${total} file${total === 1 ? '' : 's'}, undecided`;
  return `${approved}/${total} approved${removed ? `, ${removed} removed` : ''}`;
}

export function registerDatasetReviewRequestCommands(
  dataset: Command,
  resolveAutomation: ResolveAutomationForReviewRequest
): void {
  const reviewRequest = dataset
    .command('review-request')
    .description(
      'Review dataset ground truth with a human. Snapshot examples for review and poll progress until reviewers finish.'
    )
    .action(() => {
      process.stderr.write(
        '`dataset review-request` requires a subcommand. Run `dataset review-request --help`.\n'
      );
      process.exit(2);
    });

  addJsonFlag(
    withPagination(
      withBaseUrl(reviewRequest.command('list <automation-id>')).option(
        '--status <csv>',
        'Filter by review status (comma-separated: draft,open,paused,closed)'
      ),
      50
    )
  ).action(
    action(
      async (
        automationRef: string,
        opts: ReviewRequestOpts & PaginationOpts & { status?: string; json?: boolean }
      ) => {
        const { client, automationId } = await resolveAutomation(automationRef, opts);
        const params: Record<string, string> = {
          limit: String(opts.limit),
          offset: String(opts.offset),
        };
        if (opts.status) params.status = opts.status;
        const raw = await client.get(datasetReviewRequestsPath(automationId), params);
        renderListResult<ReviewRequestRow>(
          raw,
          [
            { key: 'id', header: 'id' },
            { key: 'title', header: 'title' },
            { key: 'status', header: 'status' },
            {
              key: 'progress',
              header: 'progress',
              format: (value) => formatProgress(value as ReviewProgress | undefined),
            },
            { key: 'createdAt', header: 'createdAt', format: formatTimestamp },
          ],
          { ...opts, entityLabel: 'review request' }
        );
      }
    )
  );

  addJsonFlag(withBaseUrl(reviewRequest.command('create <automation-id>')))
    .description(
      'Request human review of dataset ground truth. Snapshot examples and poll progress until review is complete.'
    )
    .requiredOption('--title <title>', 'Review request title')
    .requiredOption(
      '--example-name <name>',
      'Example folder name to include (repeatable)',
      collectRepeatable,
      [] as string[]
    )
    .option('--instructions <text>', 'Note shown to the reviewer for the whole request')
    .option(
      '--focus <path>',
      'Expected-output path to highlight (repeatable)',
      collectRepeatable,
      [] as string[]
    )
    .option(
      '--focus-reason <spec>',
      'Reason a focus path needs review, as path=reason (repeatable)',
      collectRepeatable,
      [] as string[]
    )
    .option(
      '--ignore <path>',
      'Expected-output path reviewers can skip (repeatable)',
      collectRepeatable,
      [] as string[]
    )
    .option(
      '--item-note <spec>',
      'Example-level note seeded at create time, as exampleName=comment (repeatable)',
      collectRepeatable,
      [] as string[]
    )
    .option(
      '--field-note <spec>',
      'Field-level note seeded at create time, as exampleName.path=comment (repeatable)',
      collectRepeatable,
      [] as string[]
    )
    .option('--focus-json <json>', 'JSON array of { path, reason? } focus fields')
    .option(
      '--notes-json <json>',
      'JSON array of { exampleName, comment?, fields?: [{ path, comment }] }'
    )
    .option('--status <draft|open|paused>', 'Initial lifecycle status (default: draft)')
    .addHelpText(
      'after',
      `
Examples:
  $ eigenpal workflow dataset review-request create wf_abc123 \\
      --title "Q1 invoice GT review" \\
      --example-name invoice-foo --example-name invoice-bar \\
      --instructions "Check IBAN checksums and totals." \\
      --focus vendor.iban --focus-reason 'vendor.iban=OCR often mangles IBANs' \\
      --ignore currency \\
      --field-note 'invoice-foo.total=off by 0.01 last run' \\
      --status open --json

  $ eigenpal workflow dataset review-request list wf_abc123 --status open --json
  $ eigenpal workflow dataset review-request get wf_abc123 dsr_... --json

Agent loop: create with focus/ignore and per-example notes → poll \`get --json\`
until \`.progress.complete\` → record per-field decisions and per-example
approve/remove with comments → \`pull --out <dir>\` to fetch expected files
(snapshot or reviewer-corrected) → correct bytes with
\`item --action edit-file --file-path <path> --file <local>\` (or
\`--new-path\` for brand-new files) → record per-file decisions with notes
via \`item --action file-decision\` → read \`events\` → \`dataset pull\` and
MANUAL per-example reconcile into the live dataset (no auto-apply exists by
design; reviewers can err) → \`update --status closed\`.

\`remove\` is a recommendation only — nothing is deleted by any review endpoint.
Use \`--json\` from agents; API errors exit non-zero.
`
    )
    .action(
      action(
        async (
          automationRef: string,
          opts: ReviewRequestOpts & {
            title: string;
            exampleName: string[];
            instructions?: string;
            focus?: string[];
            focusReason?: string[];
            ignore?: string[];
            itemNote?: string[];
            fieldNote?: string[];
            focusJson?: string;
            notesJson?: string;
            status?: 'draft' | 'open' | 'paused';
            json?: boolean;
          }
        ) => {
          if (opts.exampleName.length === 0) {
            throw new Error('pass at least one --example-name');
          }
          const { client, automationId } = await resolveAutomation(automationRef, opts);
          const focusFromFlags = mergeFocusFields(
            opts.focus ?? [],
            (opts.focusReason ?? []).map(parseFocusReasonFlag)
          );
          const focusFromJson = opts.focusJson
            ? (parseJsonObjectFlag(
                opts.focusJson,
                '--focus-json'
              ) as DatasetReviewFocusFieldInput[])
            : [];
          if (opts.focusJson && !Array.isArray(focusFromJson)) {
            throw new Error('--focus-json must be a JSON array');
          }
          const notesFromFlags = mergeItemNotes([
            ...(opts.itemNote ?? []).map(parseItemNoteFlag),
            ...(opts.fieldNote ?? []).map(parseFieldNoteFlag),
          ]);
          const notesFromJson = opts.notesJson
            ? (parseJsonObjectFlag(opts.notesJson, '--notes-json') as DatasetReviewItemNoteInput[])
            : [];
          if (opts.notesJson && !Array.isArray(notesFromJson)) {
            throw new Error('--notes-json must be a JSON array');
          }
          const body: Record<string, unknown> = {
            title: opts.title,
            exampleNames: opts.exampleName,
          };
          if (opts.instructions !== undefined) body.instructions = opts.instructions;
          if (opts.status !== undefined) body.status = opts.status;
          const focusFields = [...focusFromFlags, ...focusFromJson];
          if (focusFields.length > 0) body.focusFields = focusFields;
          const ignoredFields = [
            ...new Set((opts.ignore ?? []).map((path) => path.trim()).filter(Boolean)),
          ];
          if (ignoredFields.length > 0) body.ignoredFields = ignoredFields;
          const itemNotes = mergeItemNotes([...notesFromFlags, ...notesFromJson]);
          if (itemNotes.length > 0) body.itemNotes = itemNotes;
          const payload = await client.post(datasetReviewRequestsPath(automationId), body);
          if (opts.json) return printJson(payload);
          const created = payload as { id?: string; status?: string };
          success(
            `Created review request ${ui.bold(created.id ?? '(unknown id)')}` +
              (created.status ? ` ${ui.dim(`(${created.status})`)}` : '')
          );
        }
      )
    );

  addJsonFlag(withBaseUrl(reviewRequest.command('get <automation-id> <review-id>')))
    .description(
      'Fetch one dataset review request with items, progress, focus fields, ignored fields, expected files, file decisions, and events.'
    )
    .action(
      action(
        async (
          automationRef: string,
          reviewId: string,
          opts: ReviewRequestOpts & { json?: boolean }
        ) => {
          const { client, automationId } = await resolveAutomation(automationRef, opts);
          const payload = await client.get(datasetReviewRequestsPath(automationId, reviewId));
          if (opts.json) return printJson(payload);
          const detail = payload as {
            id?: string;
            title?: string;
            status?: string;
            instructions?: string | null;
            focusFields?: Array<{ path?: string; reason?: string | null }>;
            ignoredFields?: string[];
            progress?: ReviewProgress;
            items?: Array<{
              id?: string;
              exampleName?: string;
              status?: string;
              inputDrifted?: boolean;
              currentExpectedFiles?: Array<{ path?: string; origin?: string }> | null;
              snapshotManifest?: { expectedFiles?: Array<{ name?: string }> };
              fileDecisions?: Record<string, { decision?: string }>;
            }>;
            events?: Array<{
              action?: string;
              itemId?: string | null;
              diffSummary?: { comment?: string; fieldPath?: string | null } | null;
            }>;
          };
          console.log(
            table(
              [
                { field: 'id', value: detail.id },
                { field: 'title', value: detail.title },
                { field: 'status', value: detail.status },
                { field: 'progress', value: formatProgress(detail.progress) },
                { field: 'instructions', value: detail.instructions ?? '-' },
                {
                  field: 'focus',
                  value:
                    detail.focusFields
                      ?.map((field) =>
                        field.reason ? `${field.path} (${field.reason})` : field.path
                      )
                      .join(', ') || '-',
                },
                {
                  field: 'ignored',
                  value: detail.ignoredFields?.join(', ') || '-',
                },
              ],
              [
                { key: 'field', header: 'field' },
                { key: 'value', header: 'value' },
              ]
            )
          );
          if (detail.items?.length) {
            console.log(
              table(
                detail.items.map((item) => ({
                  exampleName: item.exampleName,
                  status: item.status,
                  inputDrifted: item.inputDrifted ? 'yes' : 'no',
                  files: formatReviewItemFiles(item),
                })),
                [
                  { key: 'exampleName', header: 'example' },
                  { key: 'status', header: 'status' },
                  { key: 'inputDrifted', header: 'inputDrifted' },
                  { key: 'files', header: 'files' },
                ]
              )
            );
          }
        }
      )
    );

  addJsonFlag(withBaseUrl(reviewRequest.command('update <automation-id> <review-id>')))
    .description(
      'Update review metadata or lifecycle status. Set --status closed when review is finished.'
    )
    .option('--title <title>', 'New review request title')
    .option('--instructions <text>', 'Note shown to the reviewer for the whole request')
    .option(
      '--focus <path>',
      'Replace focus paths (repeatable; use with --focus-reason / --focus-json)',
      collectRepeatable,
      [] as string[]
    )
    .option(
      '--focus-reason <spec>',
      'Reason a focus path needs review, as path=reason (repeatable)',
      collectRepeatable,
      [] as string[]
    )
    .option('--focus-json <json>', 'JSON array of { path, reason? } focus fields (replaces focus)')
    .option('--ignore <path>', 'Replace ignored paths (repeatable)', collectRepeatable)
    .option('--status <draft|open|paused|closed>', 'Lifecycle status')
    .addHelpText(
      'after',
      `
Examples:
  $ eigenpal workflow dataset review-request update wf_abc123 dsr_... \\
      --status closed --json
  $ eigenpal workflow dataset review-request update wf_abc123 dsr_... \\
      --title "Q1 GT review (round 2)" --instructions "Re-check totals." --json

At least one of --title, --instructions, --focus/--focus-json, --ignore, or
--status is required. Closing a request does not write expected outputs back
to the dataset — reconcile manually after \`dataset pull\`. A closed request
accepts only \`--status open\` to reopen it.
`
    )
    .action(
      action(
        async (
          automationRef: string,
          reviewId: string,
          opts: ReviewRequestOpts & {
            title?: string;
            instructions?: string;
            focus?: string[];
            focusReason?: string[];
            focusJson?: string;
            ignore?: string[];
            status?: 'draft' | 'open' | 'paused' | 'closed';
            json?: boolean;
          }
        ) => {
          const body: Record<string, unknown> = {};
          if (opts.title !== undefined) body.title = opts.title;
          if (opts.instructions !== undefined) body.instructions = opts.instructions;
          if (opts.status !== undefined) body.status = opts.status;

          const focusFlagCount = (opts.focus ?? []).length + (opts.focusReason ?? []).length;
          const hasFocusInput = focusFlagCount > 0 || opts.focusJson !== undefined;
          if (hasFocusInput) {
            const focusFromFlags = mergeFocusFields(
              opts.focus ?? [],
              (opts.focusReason ?? []).map(parseFocusReasonFlag)
            );
            const focusFromJson = opts.focusJson
              ? (parseJsonObjectFlag(
                  opts.focusJson,
                  '--focus-json'
                ) as DatasetReviewFocusFieldInput[])
              : [];
            if (opts.focusJson && !Array.isArray(focusFromJson)) {
              throw new Error('--focus-json must be a JSON array');
            }
            body.focusFields = [...focusFromFlags, ...focusFromJson];
          }

          if (opts.ignore !== undefined) {
            body.ignoredFields = [
              ...new Set(opts.ignore.map((path) => path.trim()).filter(Boolean)),
            ];
          }

          if (Object.keys(body).length === 0) {
            throw new Error(
              'pass at least one of --title, --instructions, --focus/--focus-json, --ignore, or --status'
            );
          }

          const { client, automationId } = await resolveAutomation(automationRef, opts);
          const payload = await client.patch(
            datasetReviewRequestsPath(automationId, reviewId),
            body
          );
          if (opts.json) return printJson(payload);
          const updated = payload as { id?: string; status?: string; title?: string };
          success(
            `Updated review request ${ui.bold(updated.id ?? reviewId)}` +
              (updated.status ? ` ${ui.dim(`(${updated.status})`)}` : '')
          );
        }
      )
    );

  addJsonFlag(withBaseUrl(reviewRequest.command('items <automation-id> <review-id>')))
    .description('List snapshotted review items and their statuses.')
    .option('--status <csv>', 'Filter by item status (pending,approved,edited,removed)')
    .action(
      action(
        async (
          automationRef: string,
          reviewId: string,
          opts: ReviewRequestOpts & { status?: string; json?: boolean }
        ) => {
          const { client, automationId } = await resolveAutomation(automationRef, opts);
          const params: Record<string, string> = {};
          if (opts.status) params.status = opts.status;
          const payload = await client.get(
            datasetReviewRequestItemsPath(automationId, reviewId),
            params
          );
          if (opts.json) return printJson(payload);
          const items =
            (
              payload as {
                items?: Array<{
                  exampleName?: string;
                  status?: string;
                  inputDrifted?: boolean;
                  currentExpectedFiles?: Array<{ path?: string; origin?: string }> | null;
                  snapshotManifest?: { expectedFiles?: Array<{ name?: string }> };
                  fileDecisions?: Record<string, { decision?: string }>;
                }>;
              }
            ).items ?? [];
          console.log(
            table(
              items.map((item) => ({
                exampleName: item.exampleName,
                status: item.status,
                inputDrifted: item.inputDrifted ? 'yes' : 'no',
                files: formatReviewItemFiles(item),
              })),
              [
                { key: 'exampleName', header: 'example' },
                { key: 'status', header: 'status' },
                { key: 'inputDrifted', header: 'inputDrifted' },
                { key: 'files', header: 'files' },
              ]
            )
          );
        }
      )
    );

  addJsonFlag(withBaseUrl(reviewRequest.command('events <automation-id> <review-id>')))
    .description('List review activity, including example and field notes.')
    .action(
      action(
        async (
          automationRef: string,
          reviewId: string,
          opts: ReviewRequestOpts & { json?: boolean }
        ) => {
          const { client, automationId } = await resolveAutomation(automationRef, opts);
          const payload = await client.get(datasetReviewRequestEventsPath(automationId, reviewId));
          if (opts.json) return printJson(payload);
          const events =
            (
              payload as {
                events?: Array<{
                  action?: string;
                  itemId?: string | null;
                  createdAt?: string;
                  diffSummary?: { comment?: string; fieldPath?: string | null } | null;
                }>;
              }
            ).events ?? [];
          console.log(
            table(
              events.map((event) => ({
                action: event.action,
                itemId: event.itemId ?? '-',
                field: event.diffSummary?.fieldPath ?? '-',
                comment: event.diffSummary?.comment ?? '-',
                createdAt: event.createdAt ? formatTimestamp(event.createdAt) : '-',
              })),
              [
                { key: 'action', header: 'action' },
                { key: 'itemId', header: 'item' },
                { key: 'field', header: 'field' },
                { key: 'comment', header: 'comment' },
                { key: 'createdAt', header: 'createdAt' },
              ]
            )
          );
        }
      )
    );

  addJsonFlag(withBaseUrl(reviewRequest.command('item <automation-id> <review-id> <item-id>')))
    .description(
      'Approve, remove, reopen, comment, edit, or record a field- or file-decision on one review item. Upload corrected expected-file bytes with edit-file.'
    )
    .requiredOption(
      '--action <approve|remove|reopen|comment|edit|field-decision|file-decision|edit-file>',
      'Item action'
    )
    .requiredOption(
      '--expected-updated-at <iso>',
      'Item updatedAt the client last observed (optimistic concurrency)'
    )
    .option('--comment <text>', 'Note stored on the item, field, or file')
    .option('--field-path <path>', 'Dotted expected-output path for comment or field-decision')
    .option('--file-path <path>', 'Expected-file path for file-decision or edit-file (correct)')
    .option(
      '--new-path <path>',
      'Expected-file path for edit-file uploads of brand-new reviewer files'
    )
    .option('--file <local path>', 'Local file bytes to upload when --action edit-file')
    .option(
      '--decision <approved|removed|null>',
      'Field or file decision for --action field-decision or file-decision (null/clear removes it)'
    )
    .option('--clear', 'Clear a field or file decision (sends decision: null)', false)
    .option('--expected-json <json>', 'Replacement expected JSON when --action edit')
    .addHelpText(
      'after',
      `
Examples:
  $ eigenpal workflow dataset review-request item wf_abc123 dsr_... dsri_... \\
      --action field-decision --field-path vendor.iban --decision approved \\
      --expected-updated-at 2026-01-01T00:00:00.000Z --json
  $ eigenpal workflow dataset review-request item wf_abc123 dsr_... dsri_... \\
      --action field-decision --field-path vendor.iban --clear \\
      --expected-updated-at 2026-01-01T00:00:00.000Z --json
  $ eigenpal workflow dataset review-request item wf_abc123 dsr_... dsri_... \\
      --action file-decision --file-path expected/report.pdf --decision approved \\
      --comment "totals match" --expected-updated-at 2026-01-01T00:00:00.000Z --json
  $ eigenpal workflow dataset review-request item wf_abc123 dsr_... dsri_... \\
      --action edit-file --file-path expected/report.pdf --file ./report-fixed.pdf \\
      --comment "fixed total" --expected-updated-at 2026-01-01T00:00:00.000Z --json
  $ eigenpal workflow dataset review-request item wf_abc123 dsr_... dsri_... \\
      --action edit-file --new-path expected/appendix.pdf --file ./appendix.pdf \\
      --expected-updated-at 2026-01-01T00:00:00.000Z --json
  $ eigenpal workflow dataset review-request item wf_abc123 dsr_... dsri_... \\
      --action remove --comment "wrong vendor" \\
      --expected-updated-at 2026-01-01T00:00:00.000Z --json

\`remove\` marks the example as not recommended for the dataset; it does not
delete anything. \`--clear\` / \`--decision null\` removes a prior field or
file decision (API: decision: null). A file-decision \`--comment\` without a
decision is a note and needs an existing decision server-side. \`edit-file\`
takes exactly one of \`--file-path\` (correct an existing expected file) or
\`--new-path\` (upload a brand-new expected file) plus \`--file\` bytes
(50MB cap); it replaces the item overlay entry, never the live dataset.
Always pass \`--expected-updated-at\` from the item payload you last observed.
`
    )
    .action(
      action(
        async (
          automationRef: string,
          reviewId: string,
          itemId: string,
          opts: ReviewRequestOpts & {
            action: ItemAction;
            expectedUpdatedAt: string;
            comment?: string;
            fieldPath?: string;
            filePath?: string;
            newPath?: string;
            file?: string;
            decision?: string;
            clear?: boolean;
            expectedJson?: string;
            json?: boolean;
          }
        ) => {
          const { client, automationId } = await resolveAutomation(automationRef, opts);
          const itemPath = datasetReviewRequestItemsPath(automationId, reviewId, itemId);
          if (opts.action === 'edit-file') {
            const fields = buildReviewItemFileFields({
              expectedUpdatedAt: opts.expectedUpdatedAt,
              filePath: opts.filePath,
              newPath: opts.newPath,
              file: opts.file,
              comment: opts.comment,
            });
            const localPath = resolve(opts.file!.trim());
            const fileStat = await stat(localPath);
            if (!fileStat.isFile()) {
              throw new Error(`--file is not a file: ${localPath}`);
            }
            if (fileStat.size > REVIEW_EDIT_FILE_MAX_BYTES) {
              throw new Error(
                `--file ${localPath} is ${(fileStat.size / 1024 / 1024).toFixed(1)}MB; the edit-file cap is 50MB`
              );
            }
            const bytes = await readFile(localPath);
            const form = new FormData();
            form.set('action', 'edit-file');
            form.set(
              'file',
              new Blob([bytes], { type: 'application/octet-stream' }),
              basename(localPath)
            );
            if (fields.filePath !== undefined) form.set('filePath', fields.filePath);
            if (fields.newPath !== undefined) form.set('newPath', fields.newPath);
            if (fields.comment !== undefined) form.set('comment', fields.comment);
            form.set('expectedUpdatedAt', fields.expectedUpdatedAt);
            const payload = await client.patchFormData(itemPath, form);
            if (opts.json) return printJson(payload);
            const item = (payload as { item?: { exampleName?: string; status?: string } }).item;
            success(
              `Updated ${ui.bold(item?.exampleName ?? itemId)}` +
                (item?.status ? ` ${ui.dim(`(${item.status})`)}` : '')
            );
            return;
          }
          const body = buildReviewItemPatchBody(opts.action, {
            expectedUpdatedAt: opts.expectedUpdatedAt,
            comment: opts.comment,
            fieldPath: opts.fieldPath,
            filePath: opts.filePath,
            newPath: opts.newPath,
            file: opts.file,
            decision: opts.decision,
            clear: opts.clear,
            expectedJson: opts.expectedJson,
          });
          const payload = await client.patch(itemPath, body);
          if (opts.json) return printJson(payload);
          const item = (payload as { item?: { exampleName?: string; status?: string } }).item;
          success(
            `Updated ${ui.bold(item?.exampleName ?? itemId)}` +
              (item?.status ? ` ${ui.dim(`(${item.status})`)}` : '')
          );
        }
      )
    );

  addJsonFlag(withBaseUrl(reviewRequest.command('pull <automation-id> <review-id>')))
    .description(
      'Download review snapshots: per-example expected files (snapshot or reviewer-corrected) plus item JSON.'
    )
    .requiredOption('--out <dir>', 'Local directory to materialize the review into')
    .addHelpText(
      'after',
      `
Examples:
  $ eigenpal workflow dataset review-request pull wf_abc123 dsr_... --out ./review-dsr
  $ eigenpal workflow dataset review-request pull wf_abc123 dsr_... --out ./review-dsr --json

Layout (mirrors the dataset archive so reconcile is a copy):
  <out>/<example>/expected/<path>   file bytes; reviewer-corrected when the
                                    item has an overlay entry, else the snapshot
  <out>/<example>/item.json         full item payload (status, expected JSON,
                                    currentExpectedFiles, fileDecisions)

There is no write-back: copy approved/edited files and expected JSON into the
live dataset example-by-example by hand (reviewers can err), then
\`dataset push\`. \`remove\` is a recommendation only — nothing is deleted.
`
    )
    .action(
      action(
        async (
          automationRef: string,
          reviewId: string,
          opts: ReviewRequestOpts & { out: string; json?: boolean }
        ) => {
          const { client, automationId } = await resolveAutomation(automationRef, opts);
          const detail = (await client.get(datasetReviewRequestsPath(automationId, reviewId))) as {
            items?: Array<{
              id?: string;
              exampleName?: string;
              status?: string;
              currentExpectedFiles?: Array<{ path?: string }> | null;
              snapshotManifest?: { expectedFiles?: Array<{ name?: string }> };
            }>;
          };
          const items = detail.items ?? [];
          const outDir = resolve(opts.out);
          const summary: Array<{
            exampleName: string;
            itemId: string;
            status?: string;
            files: string[];
          }> = [];
          let fileCount = 0;
          for (const item of items) {
            if (!item.id || !item.exampleName) continue;
            const exampleDir = join(outDir, assertSafeReviewExampleName(item.exampleName));
            const expectedDir = join(exampleDir, 'expected');
            await mkdir(expectedDir, { recursive: true });
            await writeFile(join(exampleDir, 'item.json'), JSON.stringify(item, null, 2));
            const paths = (
              item.currentExpectedFiles?.map((entry) => entry.path) ??
              item.snapshotManifest?.expectedFiles?.map((entry) => entry.name) ??
              []
            ).filter((path): path is string => !!path);
            const downloaded: string[] = [];
            for (const filePath of paths) {
              const encoded = encodeReviewFilePath(filePath);
              const res = await client.getStream(
                `${datasetReviewRequestItemsPath(automationId, reviewId, item.id)}/files/${encoded}?kind=expected`
              );
              const bytes = new Uint8Array(await res.arrayBuffer());
              const dest = resolve(expectedDir, ...filePath.split('/'));
              const rel = relative(expectedDir, dest);
              if (rel.startsWith('..') || isAbsolute(rel)) {
                throw new Error(`refusing to write outside ${expectedDir}: ${filePath}`);
              }
              await mkdir(dirname(dest), { recursive: true });
              await writeFile(dest, bytes);
              downloaded.push(filePath);
              fileCount += 1;
            }
            summary.push({
              exampleName: item.exampleName,
              itemId: item.id,
              status: item.status,
              files: downloaded,
            });
          }
          if (opts.json) {
            return printJson({ out: outDir, examples: summary, fileCount });
          }
          success(
            `Pulled ${fileCount} expected file${fileCount === 1 ? '' : 's'} ` +
              `across ${summary.length} example${summary.length === 1 ? '' : 's'} ` +
              `to ${ui.bold(outDir)}`
          );
        }
      )
    );
}
