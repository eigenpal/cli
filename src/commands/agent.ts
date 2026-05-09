import { InvalidArgumentError, Option, type Command } from 'commander';
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import YAML from 'yaml';
import { ApiClient } from '../lib/client';
import { requireApiKey, resolveConfig } from '../lib/config';
import { action } from '../lib/format-error';
import {
  addJsonFlag,
  dim,
  error,
  formatTimestamp,
  intArg,
  success,
  table,
  ui,
  withBaseUrl,
  withPagination,
  type PaginationOpts,
} from '../lib/ui';

type BaseOpts = { baseUrl?: string; json?: boolean };
type AgentFile = { path: string; contentBase64: string; contentType?: string };

interface AgentYaml {
  slug?: string;
  name?: string;
  description?: string;
  config?: Record<string, unknown>;
}

const AGENT_YAML = 'agent.yaml';
const AGENT_DIR = 'agent';
const DATASET_DIR = 'dataset';
const OLD_LAYOUTS = [
  ['workflow', 'agent'],
  ['eval', 'dataset'],
  ['runs', 'executions'],
] as const;

export function registerAgentCommands(program: Command): void {
  const agent = program
    .command('agent')
    .description(
      'Manage Eigenpal agents, triggers, datasets, executions, experiments, and sessions.'
    )
    .action(() => {
      process.stderr.write(
        '`eigenpal agent` requires a subcommand. Run `eigenpal agent --help`.\n'
      );
      process.exit(2);
    });

  addJsonFlag(withPagination(withBaseUrl(agent.command('list')), 50))
    .description('List agents.')
    .option('--search <q>', 'Search by slug, name, or description')
    .action(action(listAgents));

  addJsonFlag(withBaseUrl(agent.command('push')))
    .description('Create or update an agent from agent.yaml, agent/, and dataset/.')
    .option('--dir <dir>', 'Agent project directory', '.')
    .option('--agent-id <id-or-slug>', 'Update an existing agent instead of creating one')
    .addOption(new Option('--bump <level>').hideHelp())
    .addOption(new Option('--set-version <version>').hideHelp())
    .allowUnknownOption(false)
    .addHelpText(
      'after',
      '\nExamples:\n  $ eigenpal agent push --dir ./invoice-agent\n  $ eigenpal agent push --dir . --agent-id invoice-agent --json\n\nVersion flags are intentionally unsupported for agents in this release.\n'
    )
    .action(action(pushAgent));

  withBaseUrl(agent.command('pull <agent-id-or-slug>'))
    .description('Download an agent project as agent.yaml, agent/, and dataset/.')
    .option('--out <dir>', 'Output directory')
    .action(action(pullAgent));

  addJsonFlag(agent.command('validate [dir]'))
    .description('Validate a local agent project layout.')
    .action(action(validateAgentCommand));

  registerDatasetCommands(agent);
  registerExecutionCommands(agent);
  registerExperimentCommands(agent);
  registerSessionCommands(agent);
  registerTriggerCommands(agent);
  registerComingSoon(
    agent,
    'evaluators',
    'Agent evaluators are reserved for future workflow-style evaluators.'
  );
  registerComingSoon(agent, 'versions', 'Agent versions are coming soon.');
}

function registerDatasetCommands(agent: Command): void {
  const dataset = agent
    .command('dataset')
    .description('Manage an agent dataset.')
    .action(() => {
      process.stderr.write(
        '`eigenpal agent dataset` requires a subcommand. Run `eigenpal agent dataset --help`.\n'
      );
      process.exit(2);
    });

  addJsonFlag(withPagination(withBaseUrl(dataset.command('list <agent-id-or-slug>')), 50))
    .description('List dataset examples for an agent.')
    .action(action(listDataset));

  addJsonFlag(withBaseUrl(dataset.command('push <agent-id-or-slug>')))
    .description('Upload dataset examples from a local dataset directory.')
    .requiredOption('--file <path>', 'Dataset directory')
    .option('--mode <append|replace>', 'Upload mode', parseDatasetMode, 'append')
    .option('--yes', 'Confirm replace mode in non-interactive environments')
    .action(action(pushDataset));

  withBaseUrl(dataset.command('pull <agent-id-or-slug>'))
    .description('Download an agent dataset directory.')
    .option('--out <dir>', 'Output directory', DATASET_DIR)
    .action(action(pullDataset));

  addJsonFlag(dataset.command('validate [path]'))
    .description('Validate a local dataset directory.')
    .action(action(validateDatasetCommand));
}

function registerExecutionCommands(agent: Command): void {
  const execution = agent
    .command('execution')
    .description('Run, inspect, watch, and cancel agent executions.')
    .action(() => {
      process.stderr.write(
        '`eigenpal agent execution` requires a subcommand. Run `eigenpal agent execution --help`.\n'
      );
      process.exit(2);
    });

  addJsonFlag(withBaseUrl(execution.command('run <agent-id-or-slug>')))
    .description('Start one agent execution.')
    .option('--input-json <json>', 'JSON input object')
    .option('--input-file <path>', 'Input file to upload as multipart form-data')
    .option('--wait', 'Poll until the execution reaches a terminal status')
    .action(action(runExecution));

  addJsonFlag(withBaseUrl(execution.command('get <execution-id>')))
    .description('Get one agent execution.')
    .option('--include <parts>', 'Comma-separated extra parts, e.g. files')
    .action(action(getExecution));

  addJsonFlag(withPagination(withBaseUrl(execution.command('list <agent-id-or-slug>')), 50))
    .description('List agent executions.')
    .option('--status <status>', 'Filter by status')
    .action(action(listExecutions));

  addJsonFlag(withBaseUrl(execution.command('watch <execution-id>')))
    .description('Watch an execution until it reaches a terminal status.')
    .option('--interval <seconds>', 'Polling interval in seconds', intArg, 2)
    .option('--max-wait <seconds>', 'Maximum wait before exiting 2', intArg, 1800)
    .action(action(watchExecutionCommand));

  addJsonFlag(withBaseUrl(execution.command('cancel <execution-id>')))
    .description('Cancel an agent execution.')
    .option('--yes', 'Required in non-interactive environments')
    .action(action(cancelExecution));
}

function registerExperimentCommands(agent: Command): void {
  const experiment = agent
    .command('experiment')
    .description('Run and inspect batches of agent executions.')
    .action(() => {
      process.stderr.write(
        '`eigenpal agent experiment` requires a subcommand. Run `eigenpal agent experiment --help`.\n'
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

function registerSessionCommands(agent: Command): void {
  const session = agent
    .command('session')
    .description('Manage agent builder sessions.')
    .action(() => {
      process.stderr.write(
        '`eigenpal agent session` requires a subcommand. Run `eigenpal agent session --help`.\n'
      );
      process.exit(2);
    });

  addJsonFlag(withPagination(withBaseUrl(session.command('list <agent-id-or-slug>')), 50))
    .description('List builder sessions for an agent.')
    .action(action(listSessions));

  addJsonFlag(withBaseUrl(session.command('get <session-id>')))
    .description('Get a builder session and messages.')
    .action(action(getSession));

  addJsonFlag(withBaseUrl(session.command('start <agent-id-or-slug>')))
    .description('Start a builder session.')
    .option('--title <title>', 'Session title')
    .action(action(startSession));

  addJsonFlag(withBaseUrl(session.command('message <session-id>')))
    .description('Append a message to a builder session.')
    .requiredOption('--text <message>', 'Message text')
    .option('--wait', 'Reserved; server acknowledges after enqueueing the message')
    .action(action(messageSession));

  addJsonFlag(withBaseUrl(session.command('stop <session-id>')))
    .description('Stop a builder session.')
    .option('--yes', 'Required in non-interactive environments')
    .action(action(stopSession));
}

function registerTriggerCommands(agent: Command): void {
  const trigger = agent
    .command('trigger')
    .description('Manage agent triggers.')
    .action(() => {
      process.stderr.write(
        '`eigenpal agent trigger` requires a subcommand. Run `eigenpal agent trigger --help`.\n'
      );
      process.exit(2);
    });

  addJsonFlag(withBaseUrl(trigger.command('list <agent-id-or-slug>')))
    .description('List enabled agent triggers.')
    .action(action(listTriggers));

  const api = trigger
    .command('api')
    .description('Enable or disable the API trigger.')
    .action(() => {
      process.stderr.write(
        '`eigenpal agent trigger api` requires a subcommand. Run `eigenpal agent trigger api --help`.\n'
      );
      process.exit(2);
    });

  addJsonFlag(withBaseUrl(api.command('enable <agent-id-or-slug>')))
    .description('Enable the API trigger for an agent.')
    .action(action((agentId: string, opts: BaseOpts) => setTrigger(agentId, 'api', true, opts)));

  addJsonFlag(withBaseUrl(api.command('disable <agent-id-or-slug>')))
    .description('Disable the API trigger for an agent.')
    .action(action((agentId: string, opts: BaseOpts) => setTrigger(agentId, 'api', false, opts)));

  const email = trigger
    .command('email')
    .description('Manage email triggers for agents.')
    .action(() => {
      process.stderr.write(
        '`eigenpal agent trigger email` requires a subcommand. Run `eigenpal agent trigger email --help`.\n'
      );
      process.exit(2);
    });

  addJsonFlag(withBaseUrl(email.command('enable <agent-id-or-slug>')))
    .description('Enable the email trigger for an agent.')
    .action(action((agentId: string, opts: BaseOpts) => setTrigger(agentId, 'email', true, opts)));

  addJsonFlag(withBaseUrl(email.command('disable <agent-id-or-slug>')))
    .description('Disable the email trigger for an agent.')
    .action(action((agentId: string, opts: BaseOpts) => setTrigger(agentId, 'email', false, opts)));

  addJsonFlag(withBaseUrl(email.command('list [agent-id-or-slug]')))
    .description('List email triggers, optionally filtered to one agent.')
    .action(action(listEmails));

  addJsonFlag(withBaseUrl(email.command('add <agent-id-or-slug>')))
    .description('Add an email trigger to an agent.')
    .requiredOption('--email <local-part>', 'Email local-part, e.g. invoice-intake')
    .option('--label <label>', 'Human label')
    .option('--allow <sender>', 'Allowed sender pattern; repeatable', collect, [])
    .option('--reply <never|always>', 'Reply behavior')
    .option('--reply-mode <sender|all>', 'Reply recipients')
    .action(action(addEmail));

  addJsonFlag(withBaseUrl(email.command('update <agent-id-or-slug> <email-id>')))
    .description('Update an email trigger.')
    .option('--label <label>', 'Human label')
    .option('--allow <sender>', 'Allowed sender pattern; repeatable', collect, [])
    .option('--status <active|disabled>', 'Email trigger status')
    .option('--reply <never|always>', 'Reply behavior')
    .option('--reply-mode <sender|all>', 'Reply recipients')
    .action(action(updateEmail));

  addJsonFlag(withBaseUrl(email.command('remove <agent-id-or-slug> <email-id>')))
    .description('Remove an email trigger.')
    .option('--yes', 'Required in non-interactive environments')
    .action(action(removeEmail));
}

function registerComingSoon(agent: Command, name: string, message: string): void {
  const cmd = agent.command(name).description(`${message} Coming soon.`);
  cmd.action(() => {
    process.stderr.write(`${message}\n`);
    process.exit(2);
  });
  cmd
    .command('list [agent-id-or-slug]')
    .description(`${message} Coming soon.`)
    .action(() => {
      process.stderr.write(`${message}\n`);
      process.exit(2);
    });
}

function buildClient(opts: { baseUrl?: string }): ApiClient {
  const config = resolveConfig(opts);
  requireApiKey(config);
  return new ApiClient(config);
}

async function listAgents(opts: BaseOpts & PaginationOpts & { search?: string }) {
  const client = buildClient(opts);
  const payload = (await client.get('/api/v1/agents', compactParams(opts))) as {
    data: Record<string, unknown>[];
    total: number;
  };
  if (opts.json) return printJson(payload);
  console.log(
    table(payload.data, [
      { key: 'slug', header: 'SLUG' },
      { key: 'name', header: 'NAME' },
      { key: 'updatedAt', header: 'UPDATED', format: formatTimestamp },
    ])
  );
  dim(
    `${payload.data.length}${payload.total > payload.data.length ? ` of ${payload.total}` : ''} agents · use --json for the raw payload`
  );
}

async function pushAgent(opts: BaseOpts & { dir: string; agentId?: string }) {
  rejectVersionFlags(process.argv);
  const root = path.resolve(opts.dir);
  const validation = await validateAgentProject(root);
  if (!validation.valid) throw new Error(validation.errors.join('\n'));
  const manifest = await readAgentYaml(root);
  const client = buildClient(opts);
  const agentBody = {
    slug: manifest.slug ?? path.basename(root),
    name: manifest.name ?? manifest.slug ?? path.basename(root),
    description: manifest.description,
    config: manifest.config ?? {},
  };
  const agentResult = opts.agentId
    ? await client.patch(`/api/v1/agents/${encodeURIComponent(opts.agentId)}`, agentBody)
    : await client.post('/api/v1/agents', agentBody);
  const agentId = String(((agentResult as { agent?: { id?: string } }).agent?.id ?? opts.agentId)!);
  const agentFiles = await readFilesUnder(path.join(root, AGENT_DIR));
  await client.post(`/api/v1/agents/${encodeURIComponent(agentId)}/files`, { files: agentFiles });
  const datasetPath = path.join(root, DATASET_DIR);
  if (existsSync(datasetPath)) {
    const datasetFiles = await readFilesUnder(datasetPath);
    if (datasetFiles.length > 0) {
      await client.post(`/api/v1/agents/${encodeURIComponent(agentId)}/dataset?mode=append`, {
        files: datasetFiles,
      });
    }
  }
  if (opts.json) return printJson(agentResult);
  success(`Pushed agent ${ui.bold(agentBody.slug)}`);
}

async function pullAgent(agentId: string, opts: BaseOpts & { out?: string }) {
  const client = buildClient(opts);
  const payload = (await client.get(`/api/v1/agents/${encodeURIComponent(agentId)}`)) as {
    agent: { slug?: string; name?: string; description?: string | null; config?: unknown };
  };
  const out = path.resolve(opts.out ?? String(payload.agent.slug ?? agentId));
  await fs.mkdir(path.join(out, AGENT_DIR), { recursive: true });
  await fs.mkdir(path.join(out, DATASET_DIR), { recursive: true });
  await fs.writeFile(
    path.join(out, AGENT_YAML),
    YAML.stringify({
      slug: payload.agent.slug,
      name: payload.agent.name,
      description: payload.agent.description,
      config: payload.agent.config ?? {},
    })
  );
  const files = (await client.get(`/api/v1/agents/${encodeURIComponent(agentId)}/files`)) as {
    files: string[];
  };
  for (const file of files.files) {
    const one = (await client.get(`/api/v1/agents/${encodeURIComponent(agentId)}/files`, {
      path: file,
    })) as { contentBase64: string };
    await writeBase64File(path.join(out, AGENT_DIR, file), one.contentBase64);
  }
  await pullDataset(agentId, { ...opts, out: path.join(out, DATASET_DIR) });
  success(`Pulled agent to ${ui.bold(out)}`);
}

async function validateAgentCommand(dir = '.', opts: { json?: boolean }) {
  const result = await validateAgentProject(path.resolve(dir));
  if (opts.json) return printJson(result);
  if (result.valid) {
    success('Agent project is valid');
    return;
  }
  for (const issue of result.errors) error(issue);
  process.exit(1);
}

async function listDataset(agentId: string, opts: BaseOpts & PaginationOpts) {
  const client = buildClient(opts);
  const payload = (await client.get(
    `/api/v1/agents/${encodeURIComponent(agentId)}/dataset`,
    compactParams(opts)
  )) as { examples: string[]; total: number };
  if (opts.json) return printJson(payload);
  console.log(
    table(
      payload.examples.map((id) => ({ id })),
      [{ key: 'id', header: 'EXAMPLE' }]
    )
  );
  dim(
    `${payload.examples.length}${payload.total > payload.examples.length ? ` of ${payload.total}` : ''} examples · use --json for the raw payload`
  );
}

async function pushDataset(
  agentId: string,
  opts: BaseOpts & { file: string; mode: 'append' | 'replace'; yes?: boolean }
) {
  if (opts.mode === 'replace' && !(opts.yes || (await confirmTyped(agentId, 'replace dataset')))) {
    throw new Error('Dataset replace aborted');
  }
  const files = await readFilesUnder(path.resolve(opts.file));
  const client = buildClient(opts);
  const payload = await client.post(
    `/api/v1/agents/${encodeURIComponent(agentId)}/dataset?mode=${opts.mode}`,
    { files }
  );
  if (opts.json) return printJson(payload);
  success(`${opts.mode === 'replace' ? 'Replaced' : 'Uploaded'} ${files.length} dataset files`);
}

async function pullDataset(agentId: string, opts: BaseOpts & { out?: string }) {
  const client = buildClient(opts);
  const payload = (await client.get(`/api/v1/agents/${encodeURIComponent(agentId)}/dataset`, {
    include: 'files',
  })) as { files: AgentFile[] };
  const out = path.resolve(opts.out ?? DATASET_DIR);
  for (const file of payload.files) {
    await writeBase64File(path.join(out, file.path), file.contentBase64);
  }
  success(`Pulled dataset to ${ui.bold(out)}`);
}

async function validateDatasetCommand(dir = DATASET_DIR, opts: { json?: boolean }) {
  const result = await validateDatasetDir(path.resolve(dir));
  if (opts.json) return printJson(result);
  if (result.valid) return success('Dataset is valid');
  for (const issue of result.errors) error(issue);
  process.exit(1);
}

async function runExecution(
  agentId: string,
  opts: BaseOpts & { inputJson?: string; inputFile?: string; wait?: boolean }
) {
  const client = buildClient(opts);
  let payload: unknown;
  if (opts.inputFile) {
    const form = await buildAgentExecutionRunFormData(opts.inputFile, opts.inputJson);
    payload = await client.postFormData(`/api/v1/agents/${encodeURIComponent(agentId)}/run`, form);
  } else {
    payload = await client.post(`/api/v1/agents/${encodeURIComponent(agentId)}/run`, {
      input: opts.inputJson ? JSON.parse(opts.inputJson) : {},
    });
  }
  const executionId = String((payload as { executionId?: string }).executionId ?? '');
  if (opts.wait && executionId) {
    payload = await pollExecution(client, executionId, 2, 1800);
  }
  renderExecutionPayload(payload, opts);
}

async function getExecution(executionId: string, opts: BaseOpts & { include?: string }) {
  const client = buildClient(opts);
  const payload = await client.get(`/api/v1/agents/executions/${encodeURIComponent(executionId)}`, {
    ...(opts.include ? { include: opts.include } : {}),
  });
  renderExecutionPayload(payload, opts);
}

async function listExecutions(
  agentId: string,
  opts: BaseOpts & PaginationOpts & { status?: string }
) {
  const client = buildClient(opts);
  const payload = (await client.get(
    `/api/v1/agents/${encodeURIComponent(agentId)}/executions`,
    compactParams(opts)
  )) as { executions: Record<string, unknown>[]; total: number };
  if (opts.json) return printJson(payload);
  console.log(
    table(payload.executions, [
      { key: 'id', header: 'ID' },
      { key: 'status', header: 'STATUS' },
      { key: 'exampleId', header: 'EXAMPLE' },
      { key: 'createdAt', header: 'CREATED', format: formatTimestamp },
    ])
  );
}

async function watchExecutionCommand(
  executionId: string,
  opts: BaseOpts & { interval: number; maxWait: number; json?: boolean }
) {
  const client = buildClient(opts);
  const payload = await pollExecution(client, executionId, opts.interval, opts.maxWait);
  renderExecutionPayload(payload, opts);
}

async function cancelExecution(executionId: string, opts: BaseOpts & { yes?: boolean }) {
  if (!(opts.yes || process.stdin.isTTY))
    throw new Error('Pass --yes to cancel in non-interactive mode');
  const client = buildClient(opts);
  const payload = await client.post(
    `/api/v1/agents/executions/${encodeURIComponent(executionId)}/cancel`,
    {}
  );
  renderExecutionPayload(payload, opts);
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
  )) as { executions: Record<string, unknown>[] };
  const content =
    opts.format === 'json'
      ? JSON.stringify(payload, null, 2)
      : toCsv(payload.executions, ['id', 'status', 'exampleId']);
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

async function listSessions(agentId: string, opts: BaseOpts & PaginationOpts) {
  const client = buildClient(opts);
  const payload = (await client.get(
    `/api/v1/agents/${encodeURIComponent(agentId)}/sessions`,
    compactParams(opts)
  )) as { sessions: Record<string, unknown>[] };
  if (opts.json) return printJson(payload);
  console.log(
    table(payload.sessions, [
      { key: 'id', header: 'ID' },
      { key: 'status', header: 'STATUS' },
      { key: 'title', header: 'TITLE' },
    ])
  );
}

async function getSession(sessionId: string, opts: BaseOpts) {
  const client = buildClient(opts);
  renderGeneric(
    await client.get(`/api/v1/agents/sessions/${encodeURIComponent(sessionId)}`),
    opts,
    `Session ${sessionId}`
  );
}

async function startSession(agentId: string, opts: BaseOpts & { title?: string }) {
  const client = buildClient(opts);
  renderGeneric(
    await client.post(`/api/v1/agents/${encodeURIComponent(agentId)}/sessions`, {
      ...(opts.title ? { title: opts.title } : {}),
    }),
    opts,
    'Started session'
  );
}

async function messageSession(sessionId: string, opts: BaseOpts & { text: string }) {
  const client = buildClient(opts);
  renderGeneric(
    await client.post(`/api/v1/agents/sessions/${encodeURIComponent(sessionId)}`, {
      text: opts.text,
    }),
    opts,
    'Sent message'
  );
}

async function stopSession(sessionId: string, opts: BaseOpts & { yes?: boolean }) {
  if (!(opts.yes || process.stdin.isTTY))
    throw new Error('Pass --yes to stop in non-interactive mode');
  const client = buildClient(opts);
  renderGeneric(
    await client.delete(`/api/v1/agents/sessions/${encodeURIComponent(sessionId)}`),
    opts,
    'Stopped session'
  );
}

async function listTriggers(agentId: string, opts: BaseOpts) {
  const client = buildClient(opts);
  const payload = (await client.get(`/api/v1/agents/${encodeURIComponent(agentId)}/triggers`)) as {
    triggers: Record<string, { enabled: boolean }>;
  };
  if (opts.json) return printJson(payload);
  console.log(
    table(
      Object.entries(payload.triggers).map(([name, config]) => ({
        name,
        enabled: config.enabled ? 'enabled' : 'disabled',
      })),
      [
        { key: 'name', header: 'TRIGGER' },
        { key: 'enabled', header: 'STATUS' },
      ]
    )
  );
}

async function setTrigger(
  agentId: string,
  trigger: 'api' | 'email',
  enabled: boolean,
  opts: BaseOpts
) {
  const client = buildClient(opts);
  const payload = await client.patch(
    `/api/v1/agents/${encodeURIComponent(agentId)}/triggers/${trigger}`,
    { enabled }
  );
  renderGeneric(payload, opts, `${enabled ? 'Enabled' : 'Disabled'} ${trigger} trigger`);
}

async function listEmails(agentId: string | undefined, opts: BaseOpts) {
  const client = buildClient(opts);
  const payload = (await client.get(
    agentId
      ? `/api/v1/agents/${encodeURIComponent(agentId)}/triggers/email`
      : '/api/v1/agents/triggers/email'
  )) as {
    emails: Record<string, unknown>[];
  };
  if (opts.json) return printJson(payload);
  console.log(
    table(payload.emails, [
      { key: 'id', header: 'ID' },
      { key: 'alias', header: 'EMAIL' },
      { key: 'status', header: 'STATUS' },
    ])
  );
}

async function addEmail(
  agentId: string,
  opts: BaseOpts & {
    email: string;
    label?: string;
    allow: string[];
    reply?: string;
    replyMode?: string;
  }
) {
  const client = buildClient(opts);
  const payload = await client.post(
    `/api/v1/agents/${encodeURIComponent(agentId)}/triggers/email`,
    {
      email: opts.email,
      label: opts.label,
      allow: opts.allow,
      replyConfig: replyConfig(opts),
    }
  );
  renderGeneric(payload, opts, `Added email trigger ${opts.email}`);
}

async function updateEmail(
  agentId: string,
  emailId: string,
  opts: BaseOpts & {
    label?: string;
    allow: string[];
    status?: string;
    reply?: string;
    replyMode?: string;
  }
) {
  const client = buildClient(opts);
  const payload = await client.patch(
    `/api/v1/agents/${encodeURIComponent(agentId)}/triggers/email/${encodeURIComponent(emailId)}`,
    {
      label: opts.label,
      allow: opts.allow.length > 0 ? opts.allow : undefined,
      status: opts.status,
      replyConfig: replyConfig(opts),
    }
  );
  renderGeneric(payload, opts, `Updated email trigger ${emailId}`);
}

async function removeEmail(agentId: string, emailId: string, opts: BaseOpts & { yes?: boolean }) {
  if (!(opts.yes || process.stdin.isTTY))
    throw new Error('Pass --yes to remove in non-interactive mode');
  const client = buildClient(opts);
  renderGeneric(
    await client.delete(
      `/api/v1/agents/${encodeURIComponent(agentId)}/triggers/email/${encodeURIComponent(emailId)}`
    ),
    opts,
    `Removed email trigger ${emailId}`
  );
}

export async function validateAgentProject(
  root: string
): Promise<{ valid: boolean; errors: string[]; warnings: string[] }> {
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const [oldName, newName] of OLD_LAYOUTS) {
    if (existsSync(path.join(root, oldName)))
      errors.push(`Use ${newName}/ instead of old ${oldName}/`);
  }
  if (!existsSync(path.join(root, AGENT_YAML))) errors.push(`Missing ${AGENT_YAML}`);
  if (!existsSync(path.join(root, AGENT_DIR))) errors.push(`Missing ${AGENT_DIR}/`);
  if (!existsSync(path.join(root, DATASET_DIR))) warnings.push(`Missing ${DATASET_DIR}/`);
  try {
    await readAgentYaml(root);
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }
  for (const schema of ['input-schema.json', 'output-schema.json']) {
    const file = path.join(root, AGENT_DIR, schema);
    if (!existsSync(file)) {
      errors.push(`Missing agent/${schema}`);
      continue;
    }
    try {
      const parsed = JSON.parse(await fs.readFile(file, 'utf-8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        errors.push(`agent/${schema} must be a JSON object`);
      }
    } catch (err) {
      errors.push(`agent/${schema}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { valid: errors.length === 0, errors, warnings };
}

export async function validateDatasetDir(
  dir: string
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];
  if (!existsSync(dir)) errors.push(`Missing dataset directory: ${dir}`);
  for (const [oldName, newName] of OLD_LAYOUTS) {
    if (path.basename(dir) === oldName) errors.push(`Use ${newName}/ instead of old ${oldName}/`);
  }
  return { valid: errors.length === 0, errors };
}

export async function buildAgentExecutionRunFormData(
  inputFile: string,
  inputJson?: string
): Promise<FormData> {
  const form = new FormData();
  const data = await fs.readFile(inputFile);
  // `input` is reserved by the server for JSON sidecar payloads.
  form.append('file', new Blob([data]), path.basename(inputFile));
  if (inputJson) form.append('_json', inputJson);
  return form;
}

async function readAgentYaml(root: string): Promise<AgentYaml> {
  const file = path.join(root, AGENT_YAML);
  const raw = await fs.readFile(file, 'utf-8');
  const parsed = YAML.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${AGENT_YAML} must contain a YAML object`);
  }
  return parsed as AgentYaml;
}

async function readFilesUnder(dir: string): Promise<AgentFile[]> {
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

async function writeBase64File(file: string, contentBase64: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, Buffer.from(contentBase64, 'base64'));
}

async function pollExecution(
  client: ApiClient,
  executionId: string,
  interval: number,
  maxWait: number
) {
  const started = Date.now();
  for (;;) {
    const payload = (await client.get(
      `/api/v1/agents/executions/${encodeURIComponent(executionId)}`
    )) as {
      execution?: { status?: string };
    };
    if (isTerminal(payload.execution?.status)) return payload;
    if (Date.now() - started > maxWait * 1000) {
      process.stderr.write(`Timed out waiting for execution ${executionId}\n`);
      process.exit(2);
    }
    await new Promise((resolve) => setTimeout(resolve, interval * 1000));
  }
}

async function pollExperiment(
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

function renderExecutionPayload(payload: unknown, opts: BaseOpts) {
  if (opts.json) return printJson(payload);
  const execution = (payload as { execution?: Record<string, unknown> }).execution;
  if (!execution) return printJson(payload);
  success(`Execution ${execution.id} is ${execution.status}`);
}

function renderGeneric(payload: unknown, opts: BaseOpts, message: string) {
  if (opts.json) return printJson(payload);
  success(message);
}

function compactParams(opts: object): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(opts)) {
    if (
      value === undefined ||
      value === null ||
      key === 'json' ||
      key === 'baseUrl' ||
      key === 'yes'
    )
      continue;
    params[key] = String(value);
  }
  return params;
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function parseDatasetMode(value: string): 'append' | 'replace' {
  if (value === 'append' || value === 'replace') return value;
  throw new InvalidArgumentError('mode must be append or replace');
}

function parseResultsFormat(value: string): 'csv' | 'json' {
  if (value === 'csv' || value === 'json') return value;
  throw new InvalidArgumentError('format must be csv or json');
}

function collect(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
}

function replyConfig(opts: { reply?: string; replyMode?: string }) {
  if (!opts.reply && !opts.replyMode) return undefined;
  return { on: opts.reply, mode: opts.replyMode };
}

function isTerminal(status: unknown): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

async function confirmTyped(id: string, actionName: string): Promise<boolean> {
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

function rejectVersionFlags(argv: string[]): void {
  const unsupported = ['--bump', '--set-version'];
  const used = unsupported.find((flag) => argv.includes(flag));
  if (used) {
    process.stderr.write(`${used} is not supported for agents yet.\n`);
    process.exit(2);
  }
}

function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const escape = (value: unknown) => {
    const text = value == null ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [
    columns.join(','),
    ...rows.map((row) => columns.map((column) => escape(row[column])).join(',')),
  ].join('\n');
}
