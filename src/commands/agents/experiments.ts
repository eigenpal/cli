import { type Command } from 'commander';
import { promises as fs } from 'node:fs';
import { action } from '../../lib/format-error';
import { selectJsonValue } from '../../lib/json-select';
import { requireYesInNonInteractive } from '../../lib/non-interactive';
import {
  addJsonFlag,
  intArg,
  success,
  table,
  withBaseUrl,
  withPagination,
  type PaginationOpts,
} from '../../lib/ui';
import {
  buildBatchDiff,
  buildExperimentOutputDiff,
  fetchEvalResults,
  fetchExperimentOutputs,
  normalizeCompareSort,
  renderBatchDiffHuman,
  renderExperimentOutputDiffHuman,
} from '../workflow/experiment-compare';
import {
  analyzeExperimentResults,
  experimentRowsFromDetail,
  renderExperimentResultsSummary,
  type ExperimentDetailPayload,
} from '../workflow/experiment-results';
import {
  BaseOpts,
  agentAutomationId,
  buildClient,
  compactParams,
  parseResultsFormat,
  pollExperiment,
  printJson,
  renderGeneric,
  toCsv,
} from './shared';

export function registerExperimentCommands(agent: Command): void {
  const experiment = agent
    .command('experiment')
    .description('Run and inspect batches of agent executions.')
    .action(() => {
      process.stderr.write(
        '`eigenpal agents experiment` requires a subcommand. Run `eigenpal agents experiment --help`.\n'
      );
      process.exit(2);
    });

  addJsonFlag(withBaseUrl(experiment.command('run <agent-id-or-slug>')))
    .description('Start an experiment over dataset examples.')
    .option('--example-id <id>', 'Run one dataset example')
    .option('--wait', 'Poll until the experiment reaches a terminal status')
    .option('--interval <seconds>', 'Polling interval in seconds', intArg, 2)
    .option('--max-wait <seconds>', 'Maximum wait before exit code 2', intArg, 1800)
    .action(action(runExperiment));

  addJsonFlag(withBaseUrl(experiment.command('status <agent-id-or-slug> <batch-id>')))
    .description('Get experiment status.')
    .option('--watch', 'Poll until complete')
    .option('--interval <seconds>', 'Polling interval in seconds', intArg, 2)
    .option('--max-wait <seconds>', 'Maximum wait before exit code 2', intArg, 1800)
    .action(action(experimentStatus));

  addJsonFlag(withBaseUrl(experiment.command('results <agent-id-or-slug> [batch-id]')))
    .description('Print experiment results as JSON or CSV.')
    .option('--format <csv|json>', 'Output format (default json)', parseResultsFormat, 'json')
    .option('--out <path>', 'Write output to file')
    .option('--summary', 'Show total/pass/fail/error counts, average score, and evaluator rollups')
    .option('--failed-only', 'Keep only failed or errored evaluator results')
    .option('--evaluator <name>', 'Keep only results from this evaluator')
    .option(
      '--select <path>',
      'Print only a nested JSON value (for example summary.byEvaluator or discrepancies[].path)'
    )
    .action(action(experimentResults));

  addJsonFlag(withPagination(withBaseUrl(experiment.command('list <agent-id-or-slug>')), 50))
    .description('List experiments.')
    .option('--batch-id <id>', 'Filter to one batch id')
    .action(action(listExperiments));

  addJsonFlag(withBaseUrl(experiment.command('compare <batch-id-a> <batch-id-b>')))
    .description('Compare evaluator scores or actual outputs between two experiment batches.')
    .option('--outputs', 'Compare actual run outputs instead of evaluator scores')
    .option(
      '--sort <abs-delta-desc|delta-asc|delta-desc|name>',
      'Row sort order (default: biggest movers first)',
      'abs-delta-desc'
    )
    .option(
      '--regression-threshold <n>',
      'Δ below this is flagged as a regression (default 0.05)',
      Number.parseFloat,
      0.05
    )
    .action(action(compareExperiments));

  addJsonFlag(withBaseUrl(experiment.command('cancel <agent-id-or-slug> <batch-id>')))
    .description('Cancel every active execution in an experiment.')
    .option('--yes', 'Skip confirmation (required in CI / agent terminals without a TTY)')
    .action(action(cancelExperiment));
}

async function runExperiment(
  agentId: string,
  opts: BaseOpts & { exampleId?: string; wait?: boolean; interval: number; maxWait: number }
) {
  const client = buildClient(opts);
  const automationId = agentAutomationId(agentId);
  let payload = (await client.post(
    `/v1/automations/${encodeURIComponent(automationId)}/experiments`,
    {
      ...(opts.exampleId ? { examples: [opts.exampleId] } : {}),
    }
  )) as Record<string, unknown> & { id?: string; batchId?: string };
  const experimentId = payload.id ?? payload.batchId;
  if (opts.wait && !experimentId) {
    throw new Error('Experiment start response did not include a batch id; cannot honor --wait');
  }
  if (opts.wait && experimentId) {
    payload = await pollExperiment(
      client,
      automationId,
      experimentId,
      opts.interval,
      opts.maxWait,
      opts.json
    );
  }
  const stablePayload = {
    ...payload,
    batchId: experimentId,
    total:
      (payload as { runCount?: unknown; total?: unknown }).runCount ??
      (payload as { total?: unknown }).total,
  };
  renderGeneric(
    stablePayload,
    opts,
    `${opts.wait ? 'Completed' : 'Started'} experiment ${experimentId ?? ''}`
  );
  const failedCount = (payload as { failedCount?: unknown }).failedCount;
  if (opts.wait && typeof failedCount === 'number' && failedCount > 0) {
    process.exitCode = 1;
  }
}

async function experimentStatus(
  agentId: string,
  batchId: string,
  opts: BaseOpts & { watch?: boolean; interval: number; maxWait: number }
) {
  const client = buildClient(opts);
  const automationId = agentAutomationId(agentId);
  const payload = opts.watch
    ? await pollExperiment(client, automationId, batchId, opts.interval, opts.maxWait, opts.json)
    : await client.get(
        `/v1/automations/${encodeURIComponent(automationId)}/experiments/${encodeURIComponent(batchId)}`
      );
  renderGeneric(payload, opts, `Experiment ${batchId}`);
  if (opts.watch) {
    const counts = payload as {
      failedCount?: unknown;
      cancelledCount?: unknown;
      rejectedCount?: unknown;
    };
    if (
      [counts.failedCount, counts.cancelledCount, counts.rejectedCount].some(
        (count) => typeof count === 'number' && count > 0
      )
    ) {
      process.exitCode = 1;
    }
  }
}

async function experimentResults(
  agentId: string,
  batchId: string | undefined,
  opts: BaseOpts & {
    format: 'csv' | 'json';
    out?: string;
    summary?: boolean;
    failedOnly?: boolean;
    evaluator?: string;
    select?: string;
  }
) {
  const client = buildClient(opts);
  const automationId = agentAutomationId(agentId);
  if (opts.json && opts.format !== 'json') {
    throw new Error('--json cannot be combined with --format csv');
  }
  const selected =
    batchId ??
    String(
      (
        (await client.get(`/v1/automations/${encodeURIComponent(automationId)}/experiments`, {
          limit: '1',
          offset: '0',
        })) as { data?: Array<{ id?: string }> }
      ).data?.[0]?.id ?? ''
    );
  if (!selected) throw new Error('No experiment batch found');
  const analyze =
    opts.summary || opts.failedOnly || opts.evaluator !== undefined || opts.select !== undefined;
  if (analyze) {
    if (opts.format !== 'json')
      throw new Error('Experiment analysis options require --format json');
    const detail = (await client.get(
      `/v1/automations/${encodeURIComponent(automationId)}/experiments/${encodeURIComponent(selected)}`
    )) as ExperimentDetailPayload;
    const analysis = analyzeExperimentResults({
      rows: experimentRowsFromDetail(detail),
      runs: detail.runs ?? [],
      evaluator: opts.evaluator,
      failedOnly: opts.failedOnly,
    });
    const output = opts.select ? selectJsonValue(analysis, opts.select) : analysis;
    if (opts.summary && !opts.json && !opts.out && !opts.select) {
      renderExperimentResultsSummary(analysis);
      return;
    }
    const content = `${JSON.stringify(output, null, 2)}\n`;
    if (opts.out) {
      await fs.writeFile(opts.out, content);
      success(`Wrote ${opts.out}`);
    } else {
      process.stdout.write(content);
    }
    return;
  }
  const payload = (await client.get(
    `/v1/automations/${encodeURIComponent(automationId)}/experiments/${encodeURIComponent(selected)}`
  )) as { runs: Record<string, unknown>[] };
  const content =
    opts.format === 'json'
      ? JSON.stringify(payload, null, 2)
      : toCsv(payload.runs, ['id', 'status', 'exampleId']);
  if (opts.out) {
    await fs.writeFile(opts.out, content);
    success(`Wrote ${opts.out}`);
  } else {
    process.stdout.write(`${content}\n`);
  }
}

async function listExperiments(
  agentId: string,
  opts: BaseOpts & PaginationOpts & { batchId?: string }
) {
  const client = buildClient(opts);
  const automationId = agentAutomationId(agentId);
  const payload = (await client.get(
    `/v1/automations/${encodeURIComponent(automationId)}/experiments`,
    compactParams(opts)
  )) as { data?: Record<string, unknown>[] };
  const experiments = payload.data ?? [];
  if (opts.batchId) {
    payload.data = experiments.filter(
      (row) => row.id === opts.batchId || row.batchId === opts.batchId
    );
  }
  if (opts.json) return printJson(payload);
  console.log(
    table(payload.data ?? experiments, [
      { key: 'id', header: 'EXPERIMENT' },
      { key: 'runCount', header: 'RUNS' },
    ])
  );
}

async function compareExperiments(
  batchIdA: string,
  batchIdB: string,
  opts: BaseOpts & { sort: string; regressionThreshold: number; outputs?: boolean }
) {
  const sort = normalizeCompareSort(opts.sort);
  const threshold = opts.regressionThreshold;
  if (!Number.isFinite(threshold) || threshold < 0) {
    throw new Error('--regression-threshold must be a non-negative number');
  }
  // The internal `/v1/agents/experiments/compare` endpoint was removed from
  // the public surface. Rebuild the side-by-side diff entirely from public
  // routes (runs?batchId + per-run eval-results) so workflow and agent compare
  // share one code path.
  const client = buildClient(opts);
  if (opts.outputs) {
    const [outputsA, outputsB] = await Promise.all([
      fetchExperimentOutputs(client, batchIdA),
      fetchExperimentOutputs(client, batchIdB),
    ]);
    if (outputsA.automationId !== outputsB.automationId) {
      throw new Error('Experiment batches must belong to the same automation');
    }
    const diff = buildExperimentOutputDiff({
      batchIdA,
      batchIdB,
      rowsA: outputsA.rows,
      rowsB: outputsB.rows,
    });
    if (opts.json) return printJson(diff);
    renderExperimentOutputDiffHuman(diff);
    return;
  }
  const [rowsA, rowsB] = await Promise.all([
    fetchEvalResults(client, batchIdA),
    fetchEvalResults(client, batchIdB),
  ]);
  const diff = buildBatchDiff({
    batchIdA,
    batchIdB,
    rowsA: rowsA.results,
    rowsB: rowsB.results,
    sort,
    regressionThreshold: threshold,
  });
  if (opts.json) return printJson(diff);
  renderBatchDiffHuman(diff);
}

async function cancelExperiment(
  agentId: string,
  batchId: string,
  opts: BaseOpts & { yes?: boolean }
) {
  requireYesInNonInteractive(opts.yes, 'Cancel experiment batch');
  const client = buildClient(opts);
  const payload = await client.post(
    `/v1/automations/${encodeURIComponent(agentAutomationId(agentId))}/experiments/${encodeURIComponent(batchId)}/cancel`
  );
  renderGeneric(payload, opts, `Cancelled experiment ${batchId}`);
}
