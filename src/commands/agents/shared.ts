import { InvalidArgumentError } from 'commander';
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { ApiClient } from '../../lib/client';
import { requireApiKey, resolveConfig } from '../../lib/config';
import { success, ui } from '../../lib/ui';

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
  maxWait: number
) {
  const started = Date.now();
  for (;;) {
    const payload = (await client.get(
      `/api/v1/agents/runs/${encodeURIComponent(executionId)}`
    )) as { run?: { status?: string } };
    if (isTerminal(payload.run?.status)) return payload;
    if (Date.now() - started > maxWait * 1000) {
      process.stderr.write(`Timed out waiting for run ${executionId}\n`);
      process.exit(2);
    }
    await new Promise((resolve) => setTimeout(resolve, interval * 1000));
  }
}

export async function pollExperiment(
  client: ApiClient,
  agentId: string,
  batchId: string,
  interval: number,
  maxWait: number
) {
  const started = Date.now();
  for (;;) {
    const payload = (await client.get(
      `/api/v1/agents/${encodeURIComponent(agentId)}/experiments/${encodeURIComponent(batchId)}`
    )) as { status?: string };
    if (payload.status === 'completed') return payload;
    if (Date.now() - started > maxWait * 1000) {
      process.stderr.write(`Timed out waiting for experiment ${batchId}\n`);
      process.exit(2);
    }
    await new Promise((resolve) => setTimeout(resolve, interval * 1000));
  }
}

export function renderRunPayload(payload: unknown, opts: BaseOpts) {
  if (opts.json) return printJson(payload);
  const run = (payload as { run?: Record<string, unknown> }).run;
  if (!run) return printJson(payload);
  success(`Run ${run.id} is ${run.status}`);
}

export function setExitCodeForFailedTerminalRun(payload: unknown): void {
  const status = (payload as { run?: { status?: unknown } }).run?.status;
  if (status === 'failed' || status === 'cancelled') {
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

function isTerminal(status: unknown): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

export async function confirmTyped(id: string, actionName: string): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stderr.isTTY) return false;
  process.stderr.write(
    `\n  ${ui.warn('!')} About to ${actionName} for ${ui.bold(id)}.\n  Type ${ui.bold(id)} to confirm: `
  );
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return (await rl.question('')).trim() === id;
  } finally {
    rl.close();
  }
}

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
