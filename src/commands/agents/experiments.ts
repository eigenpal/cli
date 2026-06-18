import { type Command } from 'commander';
import { promises as fs } from 'node:fs';
import { action } from '../../lib/format-error';
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
  fetchEvalResults,
  normalizeCompareSort,
  renderBatchDiffHuman,
} from '../workflow/experiment-compare';
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
    .action(action(runExperiment));

  addJsonFlag(withBaseUrl(experiment.command('status <agent-id-or-slug> <batch-id>')))
    .description('Get experiment status.')
    .option('--watch', 'Poll until complete')
    .option('--interval <seconds>', 'Polling interval in seconds', intArg, 2)
    .option('--max-wait <seconds>', 'Maximum wait before exiting 2', intArg, 1800)
    .option('--include <parts>', 'Reserved for future detailed parts')
    .action(action(experimentStatus));

  withBaseUrl(experiment.command('results <agent-id-or-slug> [batch-id]'))
    .description('Print experiment results as JSON or CSV.')
    .requiredOption('--format <csv|json>', 'Output format', parseResultsFormat)
    .option('--out <path>', 'Write output to file')
    .action(action(experimentResults));

  addJsonFlag(withPagination(withBaseUrl(experiment.command('list <agent-id-or-slug>')), 50))
    .description('List experiments.')
    .option('--batch-id <id>', 'Filter to one batch id')
    .action(action(listExperiments));

  addJsonFlag(withBaseUrl(experiment.command('compare <batch-id-a> <batch-id-b>')))
    .description('Diff eval scores between two experiment batches.')
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
    .option('--yes', 'Required in non-interactive environments')
    .action(action(cancelExperiment));
}

async function runExperiment(
  agentId: string,
  opts: BaseOpts & { exampleId?: string; wait?: boolean; interval: number }
) {
  const client = buildClient(opts);
  const automationId = agentAutomationId(agentId);
  let payload = (await client.post(
    `/api/v1/automations/${encodeURIComponent(automationId)}/experiments`,
    {
      ...(opts.exampleId ? { examples: [opts.exampleId] } : {}),
    }
  )) as Record<string, unknown> & { id?: string; batchId?: string };
  const experimentId = payload.id ?? payload.batchId;
  if (opts.wait && experimentId) {
    payload = await pollExperiment(client, automationId, experimentId, opts.interval, 1800);
  }
  renderGeneric(payload, opts, `Started experiment ${experimentId ?? ''}`);
}

async function experimentStatus(
  agentId: string,
  batchId: string,
  opts: BaseOpts & { watch?: boolean; interval: number; maxWait: number }
) {
  const client = buildClient(opts);
  const automationId = agentAutomationId(agentId);
  const payload = opts.watch
    ? await pollExperiment(client, automationId, batchId, opts.interval, opts.maxWait)
    : await client.get(
        `/api/v1/automations/${encodeURIComponent(automationId)}/experiments/${encodeURIComponent(batchId)}`
      );
  renderGeneric(payload, opts, `Experiment ${batchId}`);
}

async function experimentResults(
  agentId: string,
  batchId: string | undefined,
  opts: BaseOpts & { format: 'csv' | 'json'; out?: string }
) {
  const client = buildClient(opts);
  const automationId = agentAutomationId(agentId);
  const selected =
    batchId ??
    String(
      (
        (await client.get(`/api/v1/automations/${encodeURIComponent(automationId)}/experiments`, {
          limit: '1',
          offset: '0',
        })) as { data?: Array<{ id?: string }> }
      ).data?.[0]?.id ?? ''
    );
  if (!selected) throw new Error('No experiment batch found');
  const payload = (await client.get(
    `/api/v1/automations/${encodeURIComponent(automationId)}/experiments/${encodeURIComponent(selected)}`
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
    `/api/v1/automations/${encodeURIComponent(automationId)}/experiments`,
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
  opts: BaseOpts & { sort: string; regressionThreshold: number }
) {
  const sort = normalizeCompareSort(opts.sort);
  const threshold = opts.regressionThreshold;
  if (!Number.isFinite(threshold) || threshold < 0) {
    throw new Error('--regression-threshold must be a non-negative number');
  }
  // The internal `/api/v1/agents/experiments/compare` endpoint was removed from
  // the public surface. Rebuild the side-by-side diff entirely from public
  // routes (runs?batchId + per-run eval-results) so workflow and agent compare
  // share one code path.
  const client = buildClient(opts);
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
  if (!(opts.yes || process.stdin.isTTY))
    throw new Error('Pass --yes to cancel in non-interactive mode');
  const client = buildClient(opts);
  const payload = await client.post(
    `/api/v1/automations/${encodeURIComponent(agentAutomationId(agentId))}/experiments/${encodeURIComponent(batchId)}/cancel`
  );
  renderGeneric(payload, opts, `Cancelled experiment ${batchId}`);
}
