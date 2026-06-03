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
  BaseOpts,
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
    .description('Compare two experiment batches.')
    .option('--sort <mode>', 'Accepted for compatibility; sorting happens client-side later')
    .option('--regression-threshold <n>', 'Accepted for compatibility', intArg)
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
  let payload = (await client.post(`/api/v1/agents/${encodeURIComponent(agentId)}/experiments`, {
    ...(opts.exampleId ? { exampleId: opts.exampleId } : {}),
  })) as Record<string, unknown> & { batchId?: string };
  if (opts.wait && payload.batchId) {
    payload = await pollExperiment(client, agentId, payload.batchId, opts.interval, 1800);
  }
  renderGeneric(payload, opts, `Started experiment ${payload.batchId ?? ''}`);
}

async function experimentStatus(
  agentId: string,
  batchId: string,
  opts: BaseOpts & { watch?: boolean; interval: number; maxWait: number }
) {
  const client = buildClient(opts);
  const payload = opts.watch
    ? await pollExperiment(client, agentId, batchId, opts.interval, opts.maxWait)
    : await client.get(
        `/api/v1/agents/${encodeURIComponent(agentId)}/experiments/${encodeURIComponent(batchId)}`
      );
  renderGeneric(payload, opts, `Experiment ${batchId}`);
}

async function experimentResults(
  agentId: string,
  batchId: string | undefined,
  opts: BaseOpts & { format: 'csv' | 'json'; out?: string }
) {
  const client = buildClient(opts);
  const selected =
    batchId ??
    String(
      (
        (await client.get(`/api/v1/agents/${encodeURIComponent(agentId)}/experiments`, {
          limit: '1',
          offset: '0',
        })) as { experiments?: Array<{ batchId?: string }> }
      ).experiments?.[0]?.batchId ?? ''
    );
  if (!selected) throw new Error('No experiment batch found');
  const payload = (await client.get(
    `/api/v1/agents/${encodeURIComponent(agentId)}/experiments/${encodeURIComponent(selected)}`
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
  const payload = (await client.get(
    `/api/v1/agents/${encodeURIComponent(agentId)}/experiments`,
    compactParams(opts)
  )) as { experiments: Record<string, unknown>[] };
  if (opts.batchId) {
    payload.experiments = payload.experiments.filter((row) => row.batchId === opts.batchId);
  }
  if (opts.json) return printJson(payload);
  console.log(
    table(payload.experiments, [
      { key: 'batchId', header: 'BATCH' },
      { key: 'total', header: 'TOTAL' },
    ])
  );
}

async function compareExperiments(batchIdA: string, batchIdB: string, opts: BaseOpts) {
  const client = buildClient(opts);
  const payload = await client.get('/api/v1/agents/experiments/compare', {
    a: batchIdA,
    b: batchIdB,
  });
  renderGeneric(payload, opts, `Compared ${batchIdA} and ${batchIdB}`);
}

async function cancelExperiment(
  agentId: string,
  batchId: string,
  opts: BaseOpts & { yes?: boolean }
) {
  if (!(opts.yes || process.stdin.isTTY))
    throw new Error('Pass --yes to cancel in non-interactive mode');
  const client = buildClient(opts);
  const payload = await client.delete(
    `/api/v1/agents/${encodeURIComponent(agentId)}/experiments/${encodeURIComponent(batchId)}`
  );
  renderGeneric(payload, opts, `Cancelled experiment ${batchId}`);
}
