/**
 * `eigenpal reviews` — live human-review queue for paused workflow/agent runs.
 *
 * Distinct from `eigenpal runs reviews`, which records post-run eval corrections on
 * completed executions. Tasks here are created by workflow steps and cleared by
 * approve/reject; they are not created or deleted through this command group.
 * To stop a paused run without completing review, cancel the run (`eigenpal runs cancel`).
 */

import type { Command } from 'commander';
import { promises as fs } from 'node:fs';
import { apiPath } from '../lib/api-paths';
import { ApiClient } from '../lib/client';
import { requireApiKey, resolveConfig } from '../lib/config';
import { action } from '../lib/format-error';
import {
  buildReviewListParams,
  decisionRows,
  formatReviewTaskDetail,
  formatReviewTaskSummary,
  parseReviewJsonScalar,
  parseReviewScalarValue,
  resolveReviewIdempotencyKey,
  REVIEW_DECISION_COLUMNS,
  REVIEW_LIST_COLUMNS,
  type ReviewTaskDetail,
  type ReviewTaskRow,
} from '../lib/reviews-cli';
import { addJsonFlag, dim, intArg, success, table, ui, withBaseUrl } from '../lib/ui';

interface ReviewsCommandConfig {
  baseUrl?: string;
}

type ListOpts = ReviewsCommandConfig & {
  json?: boolean;
  automationId?: string;
  waitingBefore?: string;
  cursor?: string;
  limit: number;
};

type TaskResponse = { task: ReviewTaskDetail };
type ListResponse = { tasks: ReviewTaskRow[]; nextCursor: string | null };

function buildClient(opts: ReviewsCommandConfig): ApiClient {
  const config = resolveConfig(opts);
  requireApiKey(config);
  return new ApiClient(config);
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function taskPath(taskId: string, suffix = ''): string {
  return apiPath(`/human-reviews/${encodeURIComponent(taskId)}${suffix}`);
}

function renderTaskResult(task: ReviewTaskDetail, json?: boolean): void {
  if (json) {
    printJson({ task });
    return;
  }
  console.log(formatReviewTaskDetail(task));
  const rows = decisionRows(task);
  if (rows.length > 0) {
    console.log('');
    console.log(table(rows, REVIEW_DECISION_COLUMNS));
  }
}

const REVIEWS_EXAMPLES = `
Examples:
  $ eigenpal reviews list
  $ eigenpal reviews list --automation-id auto_... --limit 20 --json
  $ eigenpal reviews get hrt_...
  $ eigenpal reviews confirm hrt_... --path /vendor --value "Acme" --expected-version 3
  $ eigenpal reviews confirm hrt_... --path /total --value 42 --expected-version 3 --withdraw
  $ eigenpal reviews approve hrt_... --expected-version 3
  $ eigenpal reviews reject hrt_... --reason "Missing PO number" --expected-version 3
  $ eigenpal reviews download hrt_... file_... --out invoice.pdf

Notes:
  Tasks are created by workflow human-review steps and finish through approve or reject.
  Use \`eigenpal runs cancel <run-id>\` to abort a paused run without approving review.
  Post-run eval corrections live under \`eigenpal runs reviews\`, not here.
`;

export function registerReviewsCommands(program: Command): void {
  const reviews = program
    .command('reviews')
    .description(
      'Work the live human-review queue for paused runs: list pending tasks, confirm fields, approve, reject, and download attachments.'
    )
    .addHelpText('after', REVIEWS_EXAMPLES)
    .action(() => {
      process.stderr.write(
        '`eigenpal reviews` requires a subcommand. Run `eigenpal reviews --help`.\n'
      );
      process.exit(2);
    });

  addJsonFlag(
    withBaseUrl(
      reviews
        .command('list')
        .alias('ls')
        .description('List pending human-review tasks (oldest first, cursor-paginated).')
        .option('--automation-id <id>', 'Filter to one automation id')
        .option(
          '--waiting-before <iso>',
          'Only tasks created before this ISO timestamp (queue age filter)'
        )
        .option('--cursor <token>', 'Pagination cursor from a previous list response')
        .option('--limit <n>', 'Page size (1–100)', intArg, 50)
    )
  ).action(action(listReviews));

  addJsonFlag(
    withBaseUrl(
      reviews
        .command('get <task-id>')
        .description('Get one human-review task with its field decisions and attached files.')
    )
  ).action(action(getReview));

  addJsonFlag(
    withBaseUrl(
      reviews
        .command('confirm <task-id>')
        .description(
          'Confirm or edit one scalar review field. Use --withdraw to persist a draft edit without confirming.'
        )
        .requiredOption(
          '--path <json-pointer>',
          'Field JSON pointer (for example /vendor or /items/0/name)'
        )
        .option('--value <scalar>', 'Scalar value: string, number, true, false, or null')
        .option('--value-json <json>', 'Scalar JSON literal (alternative to --value)')
        .requiredOption(
          '--expected-version <n>',
          'Optimistic concurrency version from get/list',
          intArg
        )
        .option('--idempotency-key <key>', 'Durable idempotency key (auto-generated when omitted)')
        .option('--withdraw', 'Persist the edit without confirming (confirmed=false)')
    )
  ).action(action(confirmReviewField));

  addJsonFlag(
    withBaseUrl(
      reviews
        .command('approve <task-id>')
        .description('Approve a review task after all required fields are confirmed.')
        .requiredOption(
          '--expected-version <n>',
          'Optimistic concurrency version from get/list',
          intArg
        )
    )
  ).action(action(approveReview));

  addJsonFlag(
    withBaseUrl(
      reviews
        .command('reject <task-id>')
        .description('Reject a review task and fail the paused run with a reason.')
        .requiredOption('--reason <text>', 'Human-readable rejection reason')
        .requiredOption(
          '--expected-version <n>',
          'Optimistic concurrency version from get/list',
          intArg
        )
        .option('--idempotency-key <key>', 'Durable idempotency key (auto-generated when omitted)')
    )
  ).action(action(rejectReview));

  withBaseUrl(
    reviews
      .command('download <task-id> <file-id>')
      .description('Download one file attached to a review task.')
      .requiredOption('--out <path>', 'Write bytes to this file path')
  ).action(action(downloadReviewFile));
}

async function listReviews(opts: ListOpts): Promise<void> {
  const client = buildClient(opts);
  const payload = (await client.get(
    apiPath('/human-reviews'),
    buildReviewListParams(opts)
  )) as ListResponse;
  if (opts.json) {
    printJson(payload);
    writeListHint(payload);
    return;
  }
  console.log(table(payload.tasks ?? [], REVIEW_LIST_COLUMNS));
  writeListHint(payload);
}

function writeListHint(payload: ListResponse): void {
  const count = payload.tasks?.length ?? 0;
  if (count === 0) return;
  const cursorHint = payload.nextCursor ? ` · next page: --cursor ${payload.nextCursor}` : '';
  process.stderr.write(
    dim(
      `${count} pending task${count === 1 ? '' : 's'}${cursorHint} · use --json for machine-readable output`
    ) + '\n'
  );
}

async function getReview(
  taskId: string,
  opts: ReviewsCommandConfig & { json?: boolean }
): Promise<void> {
  const client = buildClient(opts);
  const payload = (await client.get(taskPath(taskId))) as TaskResponse;
  renderTaskResult(payload.task, opts.json);
}

async function confirmReviewField(
  taskId: string,
  opts: ReviewsCommandConfig & {
    json?: boolean;
    path: string;
    value?: string;
    valueJson?: string;
    expectedVersion: number;
    idempotencyKey?: string;
    withdraw?: boolean;
  }
): Promise<void> {
  if (opts.value !== undefined && opts.valueJson !== undefined) {
    throw new Error('Pass only one of --value or --value-json.');
  }
  const rawValue = opts.valueJson ?? opts.value;
  if (rawValue === undefined) {
    throw new Error('Missing field value. Pass --value <scalar> or --value-json <json>.');
  }

  const value: string | number | boolean | null =
    opts.valueJson !== undefined
      ? parseReviewJsonScalar(JSON.parse(opts.valueJson))
      : parseReviewScalarValue(rawValue);

  const client = buildClient(opts);
  const payload = (await client.put(taskPath(taskId, '/fields'), {
    path: opts.path,
    value,
    expectedVersion: opts.expectedVersion,
    idempotencyKey: resolveReviewIdempotencyKey(opts.idempotencyKey),
    confirmed: opts.withdraw ? false : true,
  })) as TaskResponse;

  if (opts.json) {
    printJson(payload);
    return;
  }
  success(
    `Updated ${ui.bold(payload.task.id)} (${payload.task.confirmedCount}/${payload.task.requiredCount} confirmed)`
  );
  console.log(formatReviewTaskSummary(payload.task));
}

async function approveReview(
  taskId: string,
  opts: ReviewsCommandConfig & { json?: boolean; expectedVersion: number }
): Promise<void> {
  const client = buildClient(opts);
  const payload = (await client.post(taskPath(taskId, '/approve'), {
    expectedVersion: opts.expectedVersion,
  })) as TaskResponse;
  if (opts.json) {
    printJson(payload);
    return;
  }
  success(`Approved ${ui.bold(payload.task.id)} · run ${payload.task.executionId} resumed`);
  console.log(formatReviewTaskSummary(payload.task));
}

async function rejectReview(
  taskId: string,
  opts: ReviewsCommandConfig & {
    json?: boolean;
    reason: string;
    expectedVersion: number;
    idempotencyKey?: string;
  }
): Promise<void> {
  const client = buildClient(opts);
  const payload = (await client.post(taskPath(taskId, '/reject'), {
    reason: opts.reason,
    expectedVersion: opts.expectedVersion,
    idempotencyKey: resolveReviewIdempotencyKey(opts.idempotencyKey),
  })) as TaskResponse;
  if (opts.json) {
    printJson(payload);
    return;
  }
  success(`Rejected ${ui.bold(payload.task.id)} · run ${payload.task.executionId} failed`);
  console.log(formatReviewTaskSummary(payload.task));
}

async function downloadReviewFile(
  taskId: string,
  fileId: string,
  opts: ReviewsCommandConfig & { out: string }
): Promise<void> {
  const client = buildClient(opts);
  const res = await client.getStream(
    taskPath(taskId, `/files/${encodeURIComponent(fileId)}/content`)
  );
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(opts.out, buf);
  success(`Wrote ${ui.bold(opts.out)} ${ui.dim(`(${buf.byteLength} bytes)`)}`);
}
