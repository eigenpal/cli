/**
 * `eigenpal workflow execution {run,get,list,watch,compare,cancel}` — execution
 * sub-namespace under `workflow`. `run` creates a new execution from local
 * dataset examples; `cancel` requests cancellation; the others introspect
 * existing executions.
 */

import type { Command } from 'commander';
import { ApiClient } from '../../lib/client';
import { requireApiKey, resolveConfig } from '../../lib/config';
import { formatEigenpalDirIfAvailable } from '../../lib/format-eigenpal';
import { resolveWorkflowId } from '../../lib/resolve-workflow';
import {
  addJsonFlag,
  error,
  formatDuration,
  formatTimestamp,
  info,
  intArg,
  isTTY,
  renderListResult,
  success,
  ui,
  withBaseUrl,
  withPagination,
  type PaginationOpts,
} from '../../lib/ui';
import { renderFrame, watchExecution, type ExecutionSnapshot } from '../../lib/watch';
import { runExec } from './exec';

export function registerWorkflowExecutionCommands(parent: Command): void {
  const execution = parent
    .command('execution')
    .description('Run, inspect, and compare server-side executions.');

  const runCmd = execution
    .command('run <workflow-id> [examples...]')
    .description('Run a saved workflow against local dataset examples.')
    .option('--dir <dir>', 'Local eigenpal directory', undefined)
    .option('--concurrency <n>', 'Max examples to run in parallel (default: 3)', intArg)
    .addHelpText(
      'after',
      `
Examples:
  $ eigenpal workflow execution run wf_abc123                  # all examples
  $ eigenpal workflow execution run wf_abc123 sample-1 sample-2
  $ eigenpal workflow execution run wf_abc123 --concurrency 5
  $ eigenpal workflow execution run wf_abc123 sample --json | jq '.passed'

Reads examples from ./dataset/examples/<example>/ and writes per-run
artifacts to ./dataset/examples/<example>/executions/<timestamp>/.
Exits 1 when any example fails.
`
    );
  addJsonFlag(withBaseUrl(runCmd)).action(
    async (
      workflow: string,
      examples: string[],
      opts: {
        dir?: string;
        baseUrl?: string;
        concurrency?: number;
        json?: boolean;
      }
    ) => {
      const config = resolveConfig(opts);
      try {
        requireApiKey(config);
        const client = new ApiClient(config);
        const summary = await runExec(client, config.dir, workflow, examples, {
          concurrencyOverride: opts.concurrency,
        });
        if (opts.json) {
          // Single-summary JSON for scripting. The human-mode `runExec`
          // already wrote progress lines + the "Results:" footer; under
          // --json the caller wants a parseable shape on stdout.
          console.log(JSON.stringify(summary, null, 2));
        }
        if (summary.failed > 0) process.exit(1);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(msg);
        process.exit(1);
      } finally {
        formatEigenpalDirIfAvailable(config.dir);
      }
    }
  );

  const getCmd = execution
    .command('get <executionId>')
    .description('Fetch a single execution payload. Optionally narrow to one step.')
    .option('--step <name>', 'Show only this step (or comma-separated list)')
    .option(
      '--include <kinds>',
      'Comma-separated subset of input,output,error,duration. `input` projects the resolved templated config (= what the processor actually received). `inputRef` returns the minimal predecessor-id reference instead.',
      'input,output,error,duration'
    )
    .addHelpText(
      'after',
      '\nFor field projection, pipe `--json` through real jq:\n' +
        "  $ eigenpal workflow execution get exec_… --json | jq '.status'\n" +
        '  $ eigenpal workflow execution get exec_… --json | jq \'.stepExecutions[] | select(.status=="failed")\'\n'
    );
  addJsonFlag(withBaseUrl(getCmd)).action(getExecution);

  const listCmd = execution
    .command('list <workflow-id>')
    .description('List recent executions for a workflow.')
    .option('--status <status>', 'Filter by status: pending|running|completed|failed|cancelled');
  addJsonFlag(withBaseUrl(withPagination(listCmd))).action(listExecutions);

  const watchCmd = execution
    .command('watch <executionId>')
    .description('Stream live execution status until terminal or 30-min detach.')
    .option(
      '--max-wait <seconds>',
      'Detach after N seconds (default 1800 = 30 min)',
      intArg,
      30 * 60
    );
  withBaseUrl(watchCmd).action(watchCommand);

  const compareCmd = execution
    .command('compare <executionA> <executionB>')
    .description('Diff two executions side-by-side, per step.')
    .option('--step <name>', 'Restrict comparison to one step');
  withBaseUrl(compareCmd).action(compareExecutions);

  const cancelCmd = execution
    .command('cancel <executionId>')
    .description('Cancel an execution. Idempotent on already-terminal runs.')
    .option('--yes', 'Required for non-TTY shells (CI, pipes). Acts immediately, no prompt.')
    .addHelpText(
      'after',
      `
Examples:
  $ eigenpal workflow execution cancel exec_123abc
  $ eigenpal workflow execution cancel exec_123abc --yes        # required in CI
  $ eigenpal workflow execution cancel exec_123abc --json       # raw server payload

Behavior:
  - created/pending: transitions straight to cancelled.
  - running/waiting: stamps cancelRequestedAt; the worker observes it
    between step transitions and exits cleanly.
  - already terminal (completed/failed/cancelled): no-op, exits 0 with an
    info line. Idempotent — safe to retry.
`
    );
  addJsonFlag(withBaseUrl(cancelCmd)).action(
    async (
      executionId: string,
      opts: {
        baseUrl?: string;
        yes?: boolean;
        json?: boolean;
      }
    ) => {
      const config = resolveConfig(opts);
      requireApiKey(config);
      const client = new ApiClient(config);
      try {
        await cancelExecution(client, executionId, opts);
      } catch (err) {
        error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    }
  );
}

interface CancelOpts {
  yes?: boolean;
  json?: boolean;
}

interface CancelResponse {
  executionId?: string;
  status?: string;
  wasStatus?: string;
  [k: string]: unknown;
}

/**
 * Single-row destructive op: TTY proceeds silently (matches `gh run cancel`),
 * non-TTY requires `--yes`. Idempotent — already-terminal returns exit 0 with
 * an info line, since cancelling a finished run is not an error from the
 * caller's perspective.
 */
export async function cancelExecution(
  client: Pick<ApiClient, 'post'>,
  executionId: string,
  opts: CancelOpts
): Promise<void> {
  if (!opts.yes && !isTTY()) {
    throw new Error('cancel is destructive and requires --yes when run non-interactively');
  }

  const result = (await client.post(
    `/api/v1/workflows/executions/${executionId}/cancel`
  )) as CancelResponse;

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const status = result.status;
  if (status === 'already-terminal') {
    info(`already terminal: ${result.wasStatus ?? 'unknown'}`);
    return;
  }
  if (status === 'cancelled' || status === 'cancellation-requested') {
    success('cancellation requested');
    return;
  }

  // Defensive — server returned an unexpected shape. Surface it but don't
  // throw — exit 0 since the request itself succeeded (HTTP 2xx).
  info(`server returned status: ${String(status ?? 'unknown')}`);
}

interface GetOpts {
  baseUrl?: string;
  step?: string;
  include?: string;
  json?: boolean;
}

async function getExecution(executionId: string, opts: GetOpts): Promise<void> {
  const config = resolveConfig(opts);
  requireApiKey(config);
  const client = new ApiClient(config);

  try {
    const result = (await client.get(
      `/api/v1/workflows/executions/${executionId}?includeSteps=true`
    )) as {
      executionId?: string;
      id?: string;
      status?: string;
      startedAt?: string | null;
      completedAt?: string | null;
      durationMs?: number | null;
      stepExecutions?: Array<{
        stepName: string;
        status: string;
        durationMs?: number | null;
        // Server returns these under their canonical names; CLI surfaces
        // them as input/output/config in --include (more terse).
        inputData?: unknown;
        outputData?: unknown;
        resolvedConfig?: unknown;
        error?: string | null;
        overrideMode?: string | null;
      }>;
      output?: unknown;
      error?: string | null;
      [k: string]: unknown;
    };

    if (opts.step) {
      const wanted = new Set(opts.step.split(',').map((s) => s.trim()));
      const filtered = (result.stepExecutions ?? []).filter((s) => wanted.has(s.stepName));
      console.log(
        JSON.stringify(
          { stepExecutions: filtered.map((s) => filterIncludes(s, opts.include)) },
          null,
          2
        )
      );
      return;
    }

    if (opts.json) {
      console.log(
        JSON.stringify(
          {
            ...result,
            stepExecutions: (result.stepExecutions ?? []).map((s) =>
              filterIncludes(s, opts.include)
            ),
          },
          null,
          2
        )
      );
      return;
    }

    // Pretty default — vertical step list via renderFrame, plus a truncated
    // output preview per step so agents see the useful signal without
    // reaching for --json. Failed-step error trailers and the workflow-level
    // error follow. JSON view is one flag away (`--json`) for the full payload.
    const snapshot: ExecutionSnapshot = {
      id: result.id ?? executionId,
      status: result.status ?? 'unknown',
      startedAt: result.startedAt ?? null,
      completedAt: result.completedAt ?? null,
      durationMs: result.durationMs ?? null,
      stepExecutions: (result.stepExecutions ?? []).map((s) => ({
        stepName: s.stepName,
        status: s.status,
        durationMs: s.durationMs,
        error: s.error,
        outputPreview: previewOutput(s.outputData),
      })),
      error: result.error ?? null,
    };
    console.log(renderFrame(snapshot));
    process.stderr.write(
      `${ui.dim(`use --json for the full payload, then pipe to jq for field projection`)}\n`
    );
  } catch (err) {
    error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

interface ListOpts extends PaginationOpts {
  baseUrl?: string;
  status?: string;
  json?: boolean;
}

interface ExecutionListRow {
  id: string;
  status?: string | null;
  startedAt?: string | null;
  durationMs?: number | null;
  exampleName?: string | null;
  [k: string]: unknown;
}

async function listExecutions(workflow: string, opts: ListOpts): Promise<void> {
  const config = resolveConfig(opts);
  requireApiKey(config);
  const client = new ApiClient(config);

  const workflowId = await resolveWorkflowId(client, workflow);
  const params: Record<string, string> = {
    limit: String(opts.limit),
    offset: String(opts.offset),
    workflowId,
  };
  if (opts.status) params.status = opts.status;

  try {
    const raw = await client.get(`/api/v1/workflows/${workflowId}/executions`, params);
    renderListResult<ExecutionListRow>(
      raw,
      [
        { key: 'id', header: 'id' },
        { key: 'status', header: 'status' },
        { key: 'startedAt', header: 'startedAt', format: formatTimestamp },
        {
          key: 'durationMs',
          header: 'duration',
          align: 'right',
          format: (v) => (typeof v === 'number' ? formatDuration(v) : '-'),
        },
      ],
      { json: opts.json, entityLabel: 'execution' }
    );
  } catch (err) {
    error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

interface WatchOpts {
  baseUrl?: string;
  maxWait: number;
}

async function watchCommand(executionId: string, opts: WatchOpts): Promise<void> {
  const config = resolveConfig(opts);
  requireApiKey(config);
  const client = new ApiClient(config);

  try {
    const result = await watchExecution({
      fetch: () =>
        client.get(
          `/api/v1/workflows/executions/${executionId}?includeSteps=true`
        ) as Promise<ExecutionSnapshot>,
      maxMs: opts.maxWait * 1000,
    });

    if (result.detached) {
      process.stderr.write(
        `\nDetached after ${opts.maxWait}s without reaching terminal status. Re-run \`eigenpal workflow execution watch ${executionId}\` to resume.\n`
      );
      // Detach is a timeout, not success — exit 2 so callers (CI, agents)
      // distinguish "still running" from "completed".
      process.exit(2);
    }
    if (result.final.status === 'failed' || result.final.status === 'cancelled') {
      process.exit(1);
    }
  } catch (err) {
    error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

interface CompareOpts {
  baseUrl?: string;
  step?: string;
}

interface ExecutionRow {
  id: string;
  status?: string;
  output?: unknown;
  durationMs?: number | null;
  stepExecutions?: Array<{
    stepName: string;
    status: string;
    durationMs?: number | null;
    output?: unknown;
    error?: string | null;
  }>;
}

async function compareExecutions(idA: string, idB: string, opts: CompareOpts): Promise<void> {
  const config = resolveConfig(opts);
  requireApiKey(config);
  const client = new ApiClient(config);

  try {
    const [a, b] = await Promise.all([
      client.get(`/api/v1/workflows/executions/${idA}?includeSteps=true`) as Promise<ExecutionRow>,
      client.get(`/api/v1/workflows/executions/${idB}?includeSteps=true`) as Promise<ExecutionRow>,
    ]);

    const stepNames = new Set<string>();
    for (const s of a.stepExecutions ?? []) stepNames.add(s.stepName);
    for (const s of b.stepExecutions ?? []) stepNames.add(s.stepName);
    const ordered = Array.from(stepNames).sort();
    const targetSteps = opts.step ? ordered.filter((n) => n === opts.step) : ordered;

    console.log(
      `${ui.dim('A =')} ${ui.bold(idA)}   ${ui.dim('status=')}${colorStatus(a.status)}   ${ui.dim('durationMs=')}${a.durationMs ?? '-'}`
    );
    console.log(
      `${ui.dim('B =')} ${ui.bold(idB)}   ${ui.dim('status=')}${colorStatus(b.status)}   ${ui.dim('durationMs=')}${b.durationMs ?? '-'}`
    );
    console.log('');
    console.log(ui.dim(`step                         A status    B status    Δ duration   output`));
    console.log(ui.dim(`────────────────────────     ─────────   ─────────   ──────────   ──────`));

    for (const stepName of targetSteps) {
      const aStep = (a.stepExecutions ?? []).find((s) => s.stepName === stepName);
      const bStep = (b.stepExecutions ?? []).find((s) => s.stepName === stepName);
      const aStatus = aStep?.status ?? '—';
      const bStatus = bStep?.status ?? '—';
      const aDur = aStep?.durationMs ?? null;
      const bDur = bStep?.durationMs ?? null;
      const delta =
        aDur != null && bDur != null ? `${bDur - aDur >= 0 ? '+' : ''}${bDur - aDur}ms` : '—';
      const outputState = compareOutputs(aStep?.output, bStep?.output);
      console.log(
        `${stepName.padEnd(28)} ${padColored(colorStatus(aStatus), aStatus, 11)} ${padColored(colorStatus(bStatus), bStatus, 11)} ${delta.padEnd(12)} ${colorOutputState(outputState)}`
      );
    }

    const finalState = compareOutputs(a.output, b.output);
    console.log('');
    console.log(`${ui.dim('final output:')} ${colorOutputState(finalState)}`);
  } catch (err) {
    error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

/** Pad a colorized string so visible width matches `width` (ignoring ANSI). */
function padColored(colored: string, plain: string, width: number): string {
  const pad = Math.max(0, width - plain.length);
  return colored + ' '.repeat(pad);
}

function colorStatus(status: string | undefined): string {
  if (!status) return '—';
  if (status === 'completed') return ui.ok(status);
  if (status === 'failed' || status === 'cancelled') return ui.err(status);
  if (status === 'running' || status === 'pending') return ui.info(status);
  return status;
}

function colorOutputState(state: string): string {
  if (state === 'identical') return ui.ok(state);
  if (state === '—') return ui.dim(state);
  if (state.startsWith('differs')) return ui.warn(state);
  return state;
}

function compareOutputs(a: unknown, b: unknown): string {
  if (a === undefined && b === undefined) return '—';
  if (a === undefined) return 'B only';
  if (b === undefined) return 'A only';
  const aJson = JSON.stringify(a);
  const bJson = JSON.stringify(b);
  if (aJson === bJson) return 'identical';
  return `differs (A=${aJson.length}b, B=${bJson.length}b)`;
}

/**
 * Build a single-line truncated preview of a step's output for the pretty
 * `execution get` view. Strings render verbatim (capped); structured shapes
 * stringify and truncate so agents see "is this remotely the right shape"
 * without piping to jq. Returns null for nullish/empty payloads — caller
 * skips rendering entirely so the line list stays clean.
 */
const PREVIEW_MAX = 120;
function previewOutput(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    if (value.length === 0) return null;
    return value.length > PREVIEW_MAX ? `${value.slice(0, PREVIEW_MAX - 1)}…` : value;
  }
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch {
    return null;
  }
  if (!json || json === '{}' || json === '[]' || json === 'null') return null;
  // Collapse newlines + repeated whitespace so the preview stays one line.
  const flat = json.replace(/\s+/g, ' ');
  return flat.length > PREVIEW_MAX ? `${flat.slice(0, PREVIEW_MAX - 1)}…` : flat;
}

function filterIncludes(
  step: Record<string, unknown>,
  includes: string | undefined
): Record<string, unknown> {
  if (!includes) return step;
  const wanted = new Set(includes.split(',').map((s) => s.trim()));
  const out: Record<string, unknown> = { stepName: step.stepName, status: step.status };

  // `input` projects `resolvedConfig` — the step's `with` block AFTER template
  // resolution, i.e. the actual payload sent to the processor (LLM prompt,
  // schema, input text already substituted). Was previously projecting
  // `inputData` (a minimal predecessor-id reference, storage-optimized for
  // the DB) which surfaced as `{{ steps.parse.output }}` template strings —
  // useless when you're trying to see what the LLM actually got.
  //
  // The minimal reference is still available via `--include inputRef` for
  // anyone who genuinely wants the predecessor-id shape.
  if (wanted.has('input') || wanted.has('config') || wanted.has('resolvedConfig')) {
    out.input = step.resolvedConfig;
  }
  if (wanted.has('inputRef') || wanted.has('inputData')) out.inputRef = step.inputData;
  if (wanted.has('output') || wanted.has('outputData')) out.output = step.outputData;
  if (wanted.has('error')) out.error = step.error;
  if (wanted.has('duration')) out.durationMs = step.durationMs;
  if ('overrideMode' in step) out.overrideMode = step.overrideMode;
  return out;
}
