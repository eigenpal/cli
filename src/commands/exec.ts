import { join } from 'path';
import { type ApiClient } from '../lib/client';
import { type ExecutionArtifactPayload, writeExecutionArtifacts } from '../lib/execution-artifacts';
import { formatCliError } from '../lib/format-error';
import {
  buildExamplePayload,
  buildWorkflowPayload,
  getExampleNames,
  resolveEvalBaseDir,
} from '../lib/payload';
import { createProgressLines } from '../lib/progress-lines';
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
    if (['completed', 'failed', 'cancelled'].includes(res.status)) return res;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return { executionId, status: 'timeout', error: 'Execution timed out' };
}

export interface RunExecOptions {
  concurrencyOverride?: number;
}

export interface ExecRunSummary {
  workflowSlug: string;
  passed: number;
  failed: number;
  total: number;
}

/**
 * Run exec: for each example, build payload from shared utils, POST /api/v1/execute, poll, show progress.
 */
export async function runExec(
  client: ApiClient,
  dir: string,
  workflowSlug: string,
  exampleNames: string[],
  options: RunExecOptions = {}
): Promise<ExecRunSummary> {
  const workflow = buildWorkflowPayload(dir, workflowSlug);
  const names = getExampleNames(dir, workflowSlug, exampleNames.length ? exampleNames : undefined);
  if (names.length === 0) throw new Error('No matching eval examples found.');

  const requested = options.concurrencyOverride ?? DEFAULT_CONCURRENCY;
  const concurrency = Math.max(
    1,
    Math.min(
      Number.isFinite(requested) && requested > 0 ? requested : DEFAULT_CONCURRENCY,
      names.length
    )
  );
  // Layout-aware: flat templates write `dataset/examples/<name>/`; legacy
  // multi-workflow projects use `workflows/<slug>/eval/<name>/`. Resolver
  // returns whichever exists (flat preferred); `getExampleNames` already
  // narrowed `names` against the same resolver.
  const resolvedEval = resolveEvalBaseDir(dir, workflowSlug);
  if (!resolvedEval) throw new Error('No eval examples directory found.');
  const evalBaseDir = resolvedEval.baseDir;

  info(
    `Running workflow ${ui.bold(`"${workflowSlug}"`)} ${ui.dim(`(${names.length} example(s), concurrency ${concurrency})`)}`
  );
  dim('Using execute endpoint.');

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

  const runOne = async (): Promise<void> => {
    while (true) {
      const index = nextIndex++;
      if (index >= names.length) return;
      const name = names[index];
      const exampleDir = join(evalBaseDir, name);

      try {
        const example = buildExamplePayload(exampleDir);

        if (!interactive) console.log(`${ui.dim('→')} ${name}`);
        else progress.setRunning(index);

        let executionId: string;
        try {
          const res = (await client.post('/api/v1/execute', {
            yaml: workflow.yaml,
            input: example.input,
            overrides: example.overrides ?? undefined,
            templates: workflow.templates.length ? workflow.templates : undefined,
            blocks: workflow.blocks.length ? workflow.blocks : undefined,
          })) as { executionId?: string };
          if (typeof res?.executionId !== 'string') {
            throw new Error('Execute API did not return executionId');
          }
          executionId = res.executionId;
        } catch (err) {
          const msg = formatCliError(err);
          if (interactive) progress.setDone(index, `${name} ${ui.err('FAIL')} ${msg}`);
          else console.log(`${name} ${ui.err('FAIL')} ${msg}`);
          failed++;
          continue;
        }
        // Surface the id immediately — if polling or artifact-write fails
        // below, the user still has a handle to recover with
        // `eigenpal workflow execution get <id>`.
        process.stderr.write(`  ${ui.dim(`→ ${name}: ${executionId}`)}\n`);

        const result = await pollExecution(client, executionId);
        const label =
          result.status === 'completed'
            ? `${name} ${ui.ok('PASS')}`
            : `${name} ${ui.err('FAIL')} ${result.error ?? result.status}`;
        if (interactive) progress.setDone(index, label);
        else console.log(label);

        if (result.status === 'completed') passed++;
        else failed++;

        // Write artifact folder: executions/<executionId>/output.json + files
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
        const msg = formatCliError(err);
        if (interactive) progress.setDone(index, `${name} ${ui.err('FAIL')} ${msg}`);
        else console.log(`${name} ${ui.err('FAIL')} ${msg}`);
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
    workflowSlug,
    passed,
    failed,
    total: names.length,
  };
}
