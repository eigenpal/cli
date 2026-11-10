import type { RunError } from '@eigenpal/types';
import { isTerminalExecutionStatus } from '@eigenpal/types';
import { InvalidArgumentError } from 'commander';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ApiClient, ApiError } from '../../lib/client';
import { printJson, success } from '../../lib/ui';
import { pollUntil } from '../../lib/watch';

export type BaseOpts = { baseUrl?: string; json?: boolean };
export type AgentFile = { path: string; contentBase64: string; contentType?: string };
export type AgentInputFileSpec = { fieldName: string; filePath: string };
export type ArtifactInventoryRow = { kind: string; name: string; path: string; present: string };

export const DATASET_DIR = 'dataset';
export const AGENT_EXAMPLE_INPUT_JSON = 'input.json';
export const AGENT_EXAMPLE_EXPECTED_JSON = 'expected.json';
export const LEGACY_LAYOUTS = [
  ['workflow', 'agent'],
  ['eval', 'dataset'],
] as const;

export function collectRepeated(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

/**
 * Normalize a user-supplied agent reference into an automation id the public
 * `/v1/automations/...` routes accept. Bare slugs are rooted at `agents.`;
 * already-qualified aliases (`agents.`/`workflows.`) and raw ids (containing an
 * underscore, e.g. `wf_…`/`auto_…`) pass through untouched.
 */
export function agentAutomationId(value: string): string {
  if (value.startsWith('agents.') || value.startsWith('workflows.')) return value;
  if (value.includes('_')) return value;
  return `agents.${value}`;
}

export async function writeBase64File(file: string, contentBase64: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, Buffer.from(contentBase64, 'base64'));
}

export async function pollRun(
  client: ApiClient,
  executionId: string,
  interval: number,
  maxWait: number,
  json = false
) {
  const base = `/v1/runs/${encodeURIComponent(executionId)}`;
  type RunPoll = { finished?: boolean; execution?: { status?: string } };
  // Request a lightweight primary-DB expansion so a just-created run cannot
  // disappear briefly behind read-replica lag.
  const { value, timedOut } = await pollUntil<RunPoll>({
    fetch: async () => (await client.get(`${base}?expand=execution`)) as RunPoll,
    isTerminal: (run) => Boolean(run.finished) || isTerminalExecutionStatus(run.execution?.status),
    intervalMs: interval * 1000,
    maxWaitMs: maxWait * 1000,
  });
  if (timedOut) {
    if (json) printJson(value);
    process.stderr.write(`Timed out waiting for run ${executionId}\n`);
    process.exit(2);
  }
  return (await client.get(`${base}?expand=usage,execution`)) as RunPoll & {
    error?: RunError | string | null;
  };
}

/** Experiment batch statuses are queued | running | completed; failures are read from the counts. */
export async function pollExperiment(
  client: ApiClient,
  automationId: string,
  batchId: string,
  interval: number,
  maxWait: number,
  json = false
) {
  let notFoundRetries = 0;
  let lastPayload: { status?: string } | undefined;
  const url = `/v1/automations/${encodeURIComponent(automationId)}/experiments/${encodeURIComponent(batchId)}`;
  const { timedOut, value } = await pollUntil<{ status?: string }>({
    fetch: async () => {
      try {
        lastPayload = (await client.get(url)) as { status?: string };
        return lastPayload;
      } catch (error) {
        // A freshly created batch can 404 briefly; retry twice, then surface it.
        if (!(error instanceof ApiError) || error.status !== 404 || notFoundRetries >= 2)
          throw error;
        notFoundRetries++;
        return { status: 'pending' };
      }
    },
    isTerminal: (payload) => payload.status === 'completed',
    intervalMs: interval * 1000,
    maxWaitMs: maxWait * 1000,
  });
  if (timedOut) {
    if (json) printJson(lastPayload ?? { batchId, status: 'pending' });
    process.stderr.write(`Timed out waiting for experiment ${batchId}\n`);
    process.exit(2);
  }
  return value;
}

/** Exit 1 when an experiment batch reports any failed, cancelled or rejected run. */
export function setExitCodeForFailedExperiment(payload: unknown): void {
  const counts = payload as {
    failedCount?: unknown;
    cancelledCount?: unknown;
    rejectedCount?: unknown;
  } | null;
  if (
    [counts?.failedCount, counts?.cancelledCount, counts?.rejectedCount].some(
      (count) => typeof count === 'number' && count > 0
    )
  ) {
    process.exitCode = 1;
  }
}

export function renderRunPayload(payload: unknown, opts: BaseOpts) {
  if (opts.json) return printJson(payload);
  const run = payload as {
    id?: unknown;
    finished?: unknown;
    execution?: { status?: unknown };
  } | null;
  if (!run || run.id === undefined) return printJson(payload);
  const status = run.execution?.status ?? (run.finished === true ? 'completed' : 'running');
  success(`Run ${run.id} is ${status}`);
}

export function setExitCodeForFailedTerminalRun(payload: unknown): void {
  const run = payload as {
    finished?: unknown;
    execution?: { status?: unknown };
    error?: unknown;
  } | null;
  const status = run?.execution?.status;
  if (
    status === 'failed' ||
    status === 'cancelled' ||
    status === 'rejected' ||
    (run?.finished === true && run?.error)
  ) {
    process.exitCode = 1;
  }
}

export function renderGeneric(payload: unknown, opts: BaseOpts, message: string) {
  if (opts.json) return printJson(payload);
  success(message);
}

export function compactParams(opts: object): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(opts)) {
    if (
      value === undefined ||
      value === null ||
      key === 'json' ||
      key === 'baseUrl' ||
      key === 'yes' ||
      key === 'compact'
    )
      continue;
    params[key] = String(value);
  }
  return params;
}

export function parseDatasetMode(value: string): 'append' | 'replace' {
  if (value === 'append' || value === 'replace') return value;
  throw new InvalidArgumentError('mode must be append or replace');
}

export function parseResultsFormat(value: string): 'csv' | 'json' {
  if (value === 'csv' || value === 'json') return value;
  throw new InvalidArgumentError('format must be csv or json');
}

export { confirmTyped } from '../../lib/non-interactive';

export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const escape = (value: unknown) => {
    const text = value == null ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [
    columns.join(','),
    ...rows.map((row) => columns.map((column) => escape(row[column])).join(',')),
  ].join('\n');
}
