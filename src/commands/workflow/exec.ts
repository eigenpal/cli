import {
  isTerminalExecutionStatus,
  runStartMultipartTarget,
  runTargetApiPath,
} from '@eigenpal/types';
import { join } from 'path';
import { type ApiClient } from '../../lib/client';
import {
  type ExecutionArtifactPayload,
  writeExecutionArtifacts,
} from '../../lib/execution-artifacts';
import { formatCliError } from '../../lib/format-error';
import { buildExamplePayload, getExampleNames, resolveEvalBaseDir } from '../../lib/payload';
import { createProgressLines } from '../../lib/progress-lines';
import { resolveWorkflowId } from '../../lib/resolve-workflow';
import { dim, info, isTTY, ui } from '../../lib/ui';
import { buildRunFormData } from '../run-form-data';

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_MS = 5 * 60 * 1000;
const DEFAULT_CONCURRENCY = 3;

interface ExecutionStatus {
  executionId: string;
  status: string;
  output?: unknown;
  error?: string;
}

interface RunDetailResponse {
  id: string;
  finished?: boolean;
  status?: string;
  output?: unknown;
  error?: string | null;
  timing?: {
    createdAt?: string | null;
    completedAt?: string | null;
  };
  result?: {
    output?: unknown;
    error?: string | null;
  } | null;
  execution?: {
    status?: string;
    steps?: ExecutionArtifactPayload['stepExecutions'];
  } | null;
}

function runTerminalOutput(run: RunDetailResponse): unknown {
  return run.output !== undefined ? run.output : run.result?.output;
}

function runTerminalError(run: RunDetailResponse): string | undefined {
  const error = run.error !== undefined ? run.error : run.result?.error;
  return error ?? undefined;
}

async function pollExecution(client: ApiClient, executionId: string): Promise<ExecutionStatus> {
  const start = Date.now();
  while (Date.now() - start < MAX_POLL_MS) {
    const run = (await client.get(`/api/v1/runs/${executionId}`)) as RunDetailResponse;
    const status = run.execution?.status ?? run.status;
    if (run.finished || isTerminalExecutionStatus(status)) {
      return {
        executionId: run.id,
        status: status ?? (run.error ? 'failed' : 'completed'),
        output: runTerminalOutput(run),
        error: runTerminalError(run),
      };
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return { executionId, status: 'timeout', error: 'Execution timed out' };
}

function toExecutionArtifactPayload(run: RunDetailResponse): ExecutionArtifactPayload {
  const status = run.execution?.status ?? run.status ?? 'unknown';
  return {
    executionId: run.id,
    status,
    createdAt: run.timing?.createdAt ?? new Date().toISOString(),
    completedAt: run.timing?.completedAt ?? null,
    error: run.error !== undefined ? run.error : (run.result?.error ?? null),
    output: runTerminalOutput(run),
    stepExecutions: run.execution?.steps ?? [],
  };
}

export interface RunExecOptions {
  concurrencyOverride?: number;
  /** Workflow version to run (`eigenpal run workflows.x@<v> --example ...`). */
  version?: string;
}

export interface ExecRunSummary {
  workflow: string;
  passed: number;
  failed: number;
  total: number;
}

/**
 * Run exec: resolve `<workflow>` to a saved workflow id, then for each
 * example POST inputs to `/api/v1/runs` and poll. Local YAML
 * is never sent — the platform's saved version is the source of truth.
 */
export async function runExec(
  client: ApiClient,
  dir: string,
  workflowIdOrSlug: string,
  exampleNames: string[],
  options: RunExecOptions = {}
): Promise<ExecRunSummary> {
  const workflowId = await resolveWorkflowId(client, workflowIdOrSlug);
  const names = getExampleNames(dir, exampleNames.length ? exampleNames : undefined);
  if (names.length === 0) throw new Error('No matching eval examples found.');

  // Coerce the override: NaN / 0 / negative all fall back to the default.
  // Then clamp to [1, names.length] — no point spawning more workers than
  // examples. Outer Math.max guards against names.length === 1 collapsing to 0
  // when we've already short-circuited on names.length === 0 above.
  const requested = options.concurrencyOverride ?? DEFAULT_CONCURRENCY;
  const requestedValid =
    Number.isFinite(requested) && requested > 0 ? requested : DEFAULT_CONCURRENCY;
  const concurrency = Math.max(1, Math.min(requestedValid, names.length));
  const evalBaseDir = resolveEvalBaseDir(dir);
  if (!evalBaseDir) throw new Error('No dataset/examples directory found.');

  info(
    `Running workflow ${ui.bold(`"${workflowIdOrSlug}"`)} ${ui.dim(`(${workflowId}, ${names.length} example(s), concurrency ${concurrency})`)}`
  );
  dim('Using unified run endpoint.');

  const interactive = isTTY();
  const progress = createProgressLines({
    interactive,
    lineLabels: names,
    waitingLabel: 'waiting',
    runningLabel: 'running',
    dim: ui.dim,
    spinnerStyle: ui.info,
  });
  progress.start();

  let passed = 0;
  let failed = 0;
  let nextIndex = 0;

  const reportDone = (index: number, label: string): void => {
    if (interactive) progress.setDone(index, label);
    else console.log(label);
  };

  const runOne = async (): Promise<void> => {
    while (true) {
      const index = nextIndex++;
      if (index >= names.length) return;
      const name = names[index];
      const exampleDir = join(evalBaseDir, name);

      try {
        const example = buildExamplePayload(exampleDir);

        if (interactive) progress.setRunning(index);
        else console.log(`${ui.dim('→')} ${name}`);

        // Always go through the multipart path so file uploads stream
        // straight to storage — no base64 round-trip.
        const form = await buildRunFormData({
          target: runStartMultipartTarget({
            type: 'workflow',
            id: workflowId,
            version: options.version,
          }),
          input: example.scalars,
          overrides: example.overrides,
          files: example.files.map((file) => ({
            fieldName: file.argument,
            content: file.content,
            filename: file.filename,
            mimeType: file.mimeType,
          })),
        });

        const res = (await client.postFormData(
          runTargetApiPath({ type: 'workflow', id: workflowId, version: options.version }),
          form
        )) as {
          id?: string;
        };
        if (typeof res?.id !== 'string') {
          throw new Error('Run API did not return a run id');
        }
        const executionId = res.id;

        // Surface the id immediately — if polling or artifact-write fails
        // below, the user still has a handle to recover with
        // `eigenpal runs get <id>`.
        process.stderr.write(`  ${ui.dim(`→ ${name}: ${executionId}`)}\n`);

        const result = await pollExecution(client, executionId);
        reportDone(
          index,
          result.status === 'completed'
            ? `${name} ${ui.ok('PASS')}`
            : `${name} ${ui.err('FAIL')} ${result.error ?? result.status}`
        );

        if (result.status === 'completed') passed++;
        else failed++;

        // Write artifact folder: executions/<executionId>/output.json + files.
        // Failure here doesn't change pass/fail — surface a warning only.
        try {
          const run = (await client.get(
            `/api/v1/runs/${executionId}?expand=execution`
          )) as RunDetailResponse;
          const artifactDir = await writeExecutionArtifacts(
            client,
            exampleDir,
            toExecutionArtifactPayload(run)
          );
          if (!interactive) console.log(ui.dim(`  Artifacts: ${artifactDir}`));
        } catch (artErr) {
          if (!interactive)
            console.warn(ui.dim(`  Warning: could not write artifacts: ${formatCliError(artErr)}`));
        }
      } catch (err) {
        reportDone(index, `${name} ${ui.err('FAIL')} ${formatCliError(err)}`);
        failed++;
      }
    }
  };

  const workers = Array.from({ length: concurrency }, () => runOne());
  await Promise.all(workers);

  console.log(
    `\n${ui.bold('Results:')} ${ui.ok(String(passed))} passed, ${failed > 0 ? ui.err(String(failed)) : ui.ok(String(failed))} failed`
  );

  return {
    workflow: workflowIdOrSlug,
    passed,
    failed,
    total: names.length,
  };
}
