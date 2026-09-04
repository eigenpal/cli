import { isTerminalExecutionStatus } from '@eigenpal/types';
import { InvalidArgumentError } from 'commander';
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { ApiClient, ApiError } from '../../lib/client';
import { requireApiKey, resolveConfig } from '../../lib/config';
import { success } from '../../lib/ui';

export type BaseOpts = { baseUrl?: string; json?: boolean };
export type AgentFile = { path: string; contentBase64: string; contentType?: string };
export type AgentInputFileSpec = { fieldName: string; filePath: string };
export type ArtifactInventoryRow = { kind: string; name: string; path: string; present: string };

export const PACKAGE_MANIFEST = 'eigenpal.yaml';
export const DATASET_DIR = 'dataset';
export const SCHEMA_FILENAMES = ['input-schema.json', 'output-schema.json'] as const;
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

export function buildClient(opts: { baseUrl?: string }): ApiClient {
  const config = resolveConfig(opts);
  requireApiKey(config);
  return new ApiClient(config);
}

export async function readFilesUnder(dir: string): Promise<AgentFile[]> {
  if (!existsSync(dir)) return [];
  const out: AgentFile[] = [];
  async function walk(current: string) {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
      } else if (entry.isFile()) {
        const relative = path.relative(dir, absolute).split(path.sep).join('/');
        out.push({
          path: relative,
          contentBase64: (await fs.readFile(absolute)).toString('base64'),
        });
      }
    }
  }
  await walk(dir);
  return out;
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
  const started = Date.now();
  const base = `/v1/runs/${encodeURIComponent(executionId)}`;
  for (;;) {
    // Request a lightweight primary-DB expansion so a just-created run cannot
    // disappear briefly behind read-replica lag.
    const payload = (await client.get(`${base}?expand=execution`)) as {
      finished?: boolean;
      execution?: { status?: string };
    };
    const status = payload.execution?.status;
    if (payload.finished || isTerminalExecutionStatus(status)) {
      return (await client.get(`${base}?expand=usage,execution`)) as {
        finished?: boolean;
        execution?: { status?: string };
        error?: string | null;
      };
    }
    if (Date.now() - started > maxWait * 1000) {
      if (json) printJson(payload);
      process.stderr.write(`Timed out waiting for run ${executionId}\n`);
      process.exit(2);
    }
    await new Promise((resolve) => setTimeout(resolve, interval * 1000));
  }
}

export async function pollExperiment(
  client: ApiClient,
  automationId: string,
  batchId: string,
  interval: number,
  maxWait: number,
  json = false
) {
  const started = Date.now();
  let notFoundRetries = 0;
  let lastPayload: { status?: string } | undefined;
  for (;;) {
    let payload: { status?: string };
    try {
      payload = (await client.get(
        `/v1/automations/${encodeURIComponent(automationId)}/experiments/${encodeURIComponent(batchId)}`
      )) as { status?: string };
      lastPayload = payload;
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 404 || notFoundRetries >= 2) throw error;
      notFoundRetries++;
      await new Promise((resolve) => setTimeout(resolve, interval * 1000));
      continue;
    }
    if (payload.status === 'completed') return payload;
    if (Date.now() - started > maxWait * 1000) {
      if (json) printJson(lastPayload ?? { batchId, status: 'pending' });
      process.stderr.write(`Timed out waiting for experiment ${batchId}\n`);
      process.exit(2);
    }
    await new Promise((resolve) => setTimeout(resolve, interval * 1000));
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

export function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
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
