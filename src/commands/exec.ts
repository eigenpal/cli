import { join } from 'path';
import { type ApiClient } from '../lib/client';
import { type ExecutionArtifactPayload, writeExecutionArtifacts } from '../lib/execution-artifacts';
import { formatCliError } from '../lib/format-error';
import { buildExamplePayload, getExampleNames, resolveEvalBaseDir } from '../lib/payload';
import { createProgressLines } from '../lib/progress-lines';
import { resolveWorkflowId } from '../lib/resolve-workflow';
import { dim, info, isTTY, ui } from '../lib/ui';

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_MS = 5 * 60 * 1000;
const DEFAULT_CONCURRENCY = 3;

interface ExecutionStatus {
  executionId: string;
  status: string;
  result?: unknown;
  error?: string;
}

async function pollExecution(client: ApiClient, executionId: string): Promise<ExecutionStatus> {
  const start = Date.now();
  while (Date.now() - start < MAX_POLL_MS) {
    const res = (await client.get(`/api/v1/executions/${executionId}`)) as ExecutionStatus;
    if (['completed', 'failed', 'cancelled', 'rejected'].includes(res.status)) return res;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return { executionId, status: 'timeout', error: 'Execution timed out' };
}

export interface RunExecOptions {
  concurrencyOverride?: number;
}

export interface ExecRunSummary {
  workflow: string;
  passed: number;
  failed: number;
  total: number;
}

/**
 * Run exec: resolve `<workflow>` to a saved workflow id, then for each
 * example POST inputs to `/api/v1/workflows/<id>/run` and poll. Local YAML
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
  dim('Using saved-workflow run endpoint.');

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

        const res = (await client.post(`/api/v1/workflows/${workflowId}/run`, {
          input: example.input,
          overrides: example.overrides ?? undefined,
          trigger: 'cli',
        })) as { executionId?: string };
        if (typeof res?.executionId !== 'string') {
          throw new Error('Run API did not return executionId');
        }
        const executionId = res.executionId;

        // Surface the id immediately — if polling or artifact-write fails
        // below, the user still has a handle to recover with
        // `eigenpal workflow execution get <id>`.
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
          const artifact = (await client.get(
            `/api/v1/executions/${executionId}?includeSteps=true`
          )) as ExecutionArtifactPayload;
          const artifactDir = await writeExecutionArtifacts(client, exampleDir, artifact);
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
