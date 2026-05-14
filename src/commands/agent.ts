import { InvalidArgumentError, Option, type Command } from 'commander';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, promises as fs, readFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import YAML from 'yaml';
import { ApiClient, ApiError } from '../lib/client';
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
  warn,
  withBaseUrl,
  withPagination,
  type PaginationOpts,
} from '../lib/ui';

type BaseOpts = { baseUrl?: string; json?: boolean };
type AgentFile = { path: string; contentBase64: string; contentType?: string };
type FileDiffStatus = 'match' | 'different' | 'remote-missing';

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

  registerAgentFileCommands(agent);

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

function registerAgentFileCommands(agent: Command): void {
  const file = agent
    .command('file')
    .description('List, download, and upload individual live agent files.')
    .action(() => {
      process.stderr.write(
        '`eigenpal agent file` requires a subcommand. Run `eigenpal agent file --help`.\n'
      );
      process.exit(2);
    });

  addJsonFlag(withBaseUrl(file.command('list <agent-id-or-slug>')))
    .description('List live files for an agent.')
    .option('--path <prefix>', 'Only list files beneath this relative path')
    .action(action(listAgentFiles));

  addJsonFlag(withBaseUrl(file.command('get <agent-id-or-slug> <remote-path>')))
    .description('Download one live agent file.')
    .option('--out <file>', 'Output file path')
    .action(action(getAgentFile));

  addJsonFlag(withBaseUrl(file.command('put <agent-id-or-slug> <remote-path> <local-path>')))
    .description('Upload one local file into the live agent namespace.')
    .option('--dry-run', 'Validate local file and remote path without uploading')
    .option('--preview', 'Compare remote and local file without uploading')
    .action(action(putAgentFile));

  addJsonFlag(withBaseUrl(file.command('diff <agent-id-or-slug> <remote-path> <local-path>')))
    .description('Compare one live agent file against a local file.')
    .action(action(diffAgentFile));
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
    .option(
      '--include <parts>',
      'Comma-separated extra parts: feedback,expected,files,trace,issues',
      'feedback'
    )
    .action(action(getExecution));

  addJsonFlag(withBaseUrl(execution.command('rerun <execution-id>')))
    .description("Create a new execution from a previous execution's stored input snapshot.")
    .option('--wait', 'Poll until the rerun reaches a terminal status')
    .option('--interval <seconds>', 'Polling interval in seconds', intArg, 2)
    .option('--max-wait <seconds>', 'Maximum wait before exiting 2', intArg, 1800)
    .action(action(rerunExecution));

  const list = addJsonFlag(
    withPagination(withBaseUrl(execution.command('list <agent-id-or-slug>')), 50)
  )
    .description('List agent executions.')
    .option('--status <status>', 'Filter by status')
    .option('--batch-id <id>', 'Filter by experiment batch id')
    .option('--example-name <name>', 'Filter by exact dataset example name')
    .option('--example-name-contains <q>', 'Filter by substring in example name')
    .option('--created-after <time>', 'Filter by created-at lower bound')
    .option('--created-before <time>', 'Filter by created-at upper bound')
    .option('--completed-after <time>', 'Filter by completed-at lower bound')
    .option('--completed-before <time>', 'Filter by completed-at upper bound')
    .option('--feedback-status <open|resolved|ignored>', 'Filter by feedback status')
    .option('--feedback-rating <pass|fail|partial|none>', 'Filter by feedback rating')
    .option('--feedback-body-contains <q>', 'Filter by feedback body substring')
    .option('--feedback-created-after <time>', 'Filter by feedback created-at lower bound')
    .option('--feedback-created-before <time>', 'Filter by feedback created-at upper bound')
    .option('--feedback-updated-after <time>', 'Filter by feedback updated-at lower bound')
    .option('--feedback-updated-before <time>', 'Filter by feedback updated-at upper bound')
    .option('--feedback-resolved-after <time>', 'Filter by feedback resolved-at lower bound')
    .option('--feedback-resolved-before <time>', 'Filter by feedback resolved-at upper bound')
    .option('--has-feedback', 'Only executions with feedback')
    .option('--no-feedback', 'Only executions without feedback')
    .option('--has-expected', 'Only executions with expected JSON or files')
    .option('--has-expected-json', 'Only executions with expected.json')
    .option('--has-expected-files', 'Only executions with expected files')
    .option('--promoted-to-example', 'Only executions promoted to dataset examples')
    .option('--promoted-example-name <name>', 'Filter by promoted dataset example name')
    .option('--since-last-resolved', 'Only executions created after the latest resolved feedback')
    .option('--include <parts>', 'Comma-separated extra parts: feedback,expected,files')
    .option('--compact', 'Return/print compact triage rows without full output payloads')
    .option('--sort <field>', 'Sort by createdAt, completedAt, status, or exampleName')
    .option('--order <asc|desc>', 'Sort direction')
    .option('--scan-limit <n>', 'Feedback scan window for feedback filters', intArg)
    .action(action(listExecutions));
  list.addHelpText(
    'after',
    '\nExamples:\n  $ eigenpal agent execution list incorporator --feedback-rating fail --since-last-resolved --include feedback,expected\n  $ eigenpal agent execution list activities --has-expected-files --created-after 2026-05-01\n'
  );

  withBaseUrl(execution.command('pull <execution-id>'))
    .description('Download execution feedback, expected artifacts, files, and metadata.')
    .option('--out <dir>', 'Output directory')
    .option(
      '--include <parts>',
      'Comma-separated parts: feedback,expected,files,output,input,metadata,issues,trace,all',
      'feedback,expected'
    )
    .option('--json', 'Output a JSON summary of written artifacts')
    .action(action(pullExecution));

  addJsonFlag(withBaseUrl(execution.command('compare <reference-execution-id> <execution-id>')))
    .description(
      'Compare one execution against another execution. PDF/DOCX text comparison uses pdftotext/python3 and reports byte fallbacks.'
    )
    .option(
      '--baseline',
      'Compare actual outputs from both executions instead of expected artifacts'
    )
    .option('--out <dir>', 'Write comparison artifacts to this directory')
    .option('--normalize-dates', 'Normalize YYYYMMDD and YYYY-MM-DD tokens in filenames/text')
    .option('--fail-on-diff', 'Exit 1 when comparison status is fail')
    .action(action(compareExecution));

  const artifacts = execution
    .command('artifacts')
    .description('Inspect execution artifact inventory.')
    .action(() => {
      process.stderr.write(
        '`eigenpal agent execution artifacts` requires a subcommand. Run `eigenpal agent execution artifacts --help`.\n'
      );
      process.exit(2);
    });

  addJsonFlag(withBaseUrl(artifacts.command('list <execution-id>')))
    .description('List available execution artifacts without downloading them.')
    .action(action(listExecutionArtifacts));

  withBaseUrl(execution.command('trace <execution-id>'))
    .description('Print raw trace.jsonl for an execution, or write it with --out.')
    .option('--out <file>', 'Output file path')
    .action(action(traceExecution));

  registerExecutionFeedbackCommands(execution);
  registerExecutionExpectedCommands(execution);

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

function registerExecutionFeedbackCommands(execution: Command): void {
  const feedback = execution
    .command('feedback')
    .description('Update or clear feedback attached to an agent execution.')
    .action(() => {
      process.stderr.write(
        '`eigenpal agent execution feedback` requires a subcommand. Run `eigenpal agent execution feedback --help`.\n'
      );
      process.exit(2);
    });

  addJsonFlag(withBaseUrl(feedback.command('update <execution-id>')))
    .description('Edit feedback state, rating, message, or expected JSON for an execution.')
    .option('--status <open|resolved|ignored>', 'Set feedback status')
    .option('--rating <pass|fail|partial|none>', 'Set feedback rating')
    .option('--message <text>', 'Set feedback message body')
    .option('--message-file <path>', 'Read feedback message body from a file')
    .option('--expected-json <json>', 'Set structured expected JSON')
    .option('--expected-json-file <path>', 'Read structured expected JSON from a file')
    .option('--clear-message', 'Clear the feedback message body')
    .option('--clear-rating', 'Clear feedback rating')
    .option('--clear-expected-json', 'Delete structured expected JSON')
    .action(action(updateExecutionFeedback));

  addJsonFlag(withBaseUrl(feedback.command('resolve <execution-id>')))
    .description('Mark execution feedback as resolved.')
    .option('--message <text>', 'Set feedback message body')
    .option('--message-file <path>', 'Read feedback message body from a file')
    .action(
      action((executionId: string, opts: BaseOpts & { message?: string; messageFile?: string }) =>
        updateExecutionFeedback(executionId, { ...opts, status: 'resolved' })
      )
    );

  addJsonFlag(withBaseUrl(feedback.command('clear <execution-id>')))
    .description('Delete feedback, expected.json, and expected files for an execution.')
    .option('--yes', 'Required in non-interactive environments')
    .action(action(clearExecutionFeedback));
}

function registerExecutionExpectedCommands(execution: Command): void {
  const expected = execution
    .command('expected')
    .description('Manage expected artifacts attached to an agent execution.')
    .action(() => {
      process.stderr.write(
        '`eigenpal agent execution expected` requires a subcommand. Run `eigenpal agent execution expected --help`.\n'
      );
      process.exit(2);
    });

  addJsonFlag(withBaseUrl(expected.command('list <execution-id>')))
    .description('List expected JSON and files attached to an execution.')
    .action(action(listExecutionExpected));

  withBaseUrl(expected.command('pull <execution-id>'))
    .description('Download expected JSON and files attached to an execution.')
    .option('--out <dir>', 'Output directory')
    .action(action(pullExecutionExpected));

  addJsonFlag(withBaseUrl(expected.command('upload <execution-id> <file>')))
    .description('Upload a local file as an expected artifact.')
    .option('--name <name>', 'Expected artifact name')
    .action(action(uploadExecutionExpected));

  addJsonFlag(withBaseUrl(expected.command('copy-output <execution-id> <output-file>')))
    .description('Copy a generated output file into expected artifacts.')
    .option('--name <name>', 'Expected artifact name')
    .action(action(copyOutputToExpected));

  addJsonFlag(withBaseUrl(expected.command('rename <execution-id> <old-name> <new-name>')))
    .description('Rename an expected artifact.')
    .action(action(renameExecutionExpected));

  addJsonFlag(withBaseUrl(expected.command('delete <execution-id> <name>')))
    .description('Delete an expected artifact.')
    .option('--yes', 'Required in non-interactive environments')
    .action(action(deleteExecutionExpected));
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

async function listAgentFiles(agentId: string, opts: BaseOpts & { path?: string }): Promise<void> {
  const client = buildClient(opts);
  const payload = (await client.get(`/api/v1/agents/${encodeURIComponent(agentId)}/files`, {
    ...(opts.path ? { prefix: opts.path } : {}),
  })) as { files?: string[] };
  if (opts.json) return printJson(payload);
  console.log(
    table(
      (payload.files ?? []).map((name) => ({ name })),
      [{ key: 'name', header: 'PATH' }]
    )
  );
}

async function getAgentFile(
  agentId: string,
  remotePath: string,
  opts: BaseOpts & { out?: string }
): Promise<void> {
  const client = buildClient(opts);
  const payload = (await client.get(`/api/v1/agents/${encodeURIComponent(agentId)}/files`, {
    path: remotePath,
  })) as { path: string; contentBase64: string };
  if (opts.json) return printJson(payload);
  const out = path.resolve(opts.out ?? payload.path);
  await writeBase64File(out, payload.contentBase64);
  success(`Downloaded ${payload.path} to ${ui.bold(out)}`);
}

async function putAgentFile(
  agentId: string,
  remotePath: string,
  localPath: string,
  opts: BaseOpts & { dryRun?: boolean; preview?: boolean }
): Promise<void> {
  const absolute = path.resolve(localPath);
  const data = await fs.readFile(absolute);
  if (opts.dryRun) {
    const payload = { ok: true, dryRun: true, path: remotePath, bytes: data.length };
    if (opts.json) return printJson(payload);
    success(`Validated ${remotePath} from ${ui.bold(absolute)} (${data.length} bytes)`);
    return;
  }
  if (opts.preview) {
    const report = await buildAgentFileDiff(agentId, remotePath, absolute, opts);
    if (opts.json) return printJson(report);
    renderAgentFileDiff(report);
    return;
  }

  const client = buildClient(opts);
  const payload = await client.put(
    `/api/v1/agents/${encodeURIComponent(agentId)}/files?path=${encodeURIComponent(remotePath)}`,
    { contentBase64: data.toString('base64') }
  );
  if (opts.json) return printJson(payload);
  success(`Uploaded ${remotePath} from ${ui.bold(absolute)}`);
}

async function diffAgentFile(
  agentId: string,
  remotePath: string,
  localPath: string,
  opts: BaseOpts
): Promise<void> {
  const report = await buildAgentFileDiff(agentId, remotePath, path.resolve(localPath), opts);
  if (opts.json) return printJson(report);
  renderAgentFileDiff(report);
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

async function rerunExecution(
  executionId: string,
  opts: BaseOpts & { wait?: boolean; interval: number; maxWait: number }
) {
  const client = buildClient(opts);
  let payload: unknown = await client.post(
    `/api/v1/agents/executions/${encodeURIComponent(executionId)}/rerun`,
    {}
  );
  const rerunId = String((payload as { executionId?: string }).executionId ?? '');
  if (opts.wait && rerunId) {
    payload = await pollExecution(client, rerunId, opts.interval, opts.maxWait);
    return renderExecutionPayload(payload, opts);
  }
  if (opts.json) return printJson(payload);
  success(`Started rerun ${ui.bold(rerunId)} from ${executionId}`);
}

async function pullExecution(
  executionId: string,
  opts: BaseOpts & { include: string; out?: string }
) {
  const client = buildClient(opts);
  const include = new Set(
    opts.include
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
  );
  if (include.has('all')) {
    include.add('feedback');
    include.add('expected');
    include.add('files');
    include.add('input');
    include.add('output');
    include.add('metadata');
    include.add('issues');
    include.add('trace');
  }
  const payload = (await client.get(
    `/api/v1/agents/executions/${encodeURIComponent(executionId)}`,
    { include: [...include].join(',') }
  )) as { execution?: Record<string, unknown> };
  const execution = payload.execution;
  if (!execution) throw new Error(`Execution ${executionId} not found`);
  const out = path.resolve(
    opts.out ?? path.join('.eigenpal', 'artifacts', 'executions', executionId)
  );
  await fs.mkdir(out, { recursive: true });
  const written: string[] = [];
  const skipped: string[] = [];
  const writeJsonArtifact = async (name: string, value: unknown) => {
    await fs.writeFile(path.join(out, name), JSON.stringify(value, null, 2));
    written.push(name);
  };
  await writeJsonArtifact('execution.json', execution);

  const feedback = execution.feedback as Record<string, unknown> | null | undefined;
  if (include.has('feedback') && feedback) {
    await fs.writeFile(path.join(out, 'feedback.md'), serializeCliFeedback(feedback));
    written.push('feedback.md');
  } else if (include.has('feedback')) {
    skipped.push('feedback');
  }
  if (include.has('expected')) {
    written.push(...(await writeExpectedArtifacts(client, executionId, out, execution)));
  }
  if (include.has('files') || include.has('output')) {
    written.push(
      ...(await writeListedFiles(client, executionId, out, 'output', execution.resultFiles))
    );
  }
  if (include.has('files') || include.has('input')) {
    written.push(
      ...(await writeListedFiles(client, executionId, out, 'input', execution.inputFiles))
    );
    if (execution.inputJson) {
      await writeJsonArtifact('input.json', execution.inputJson);
    } else {
      skipped.push('input.json');
    }
  }
  if (include.has('files') || include.has('metadata')) {
    if (execution.metadata) {
      await writeJsonArtifact('metadata.json', execution.metadata);
    } else {
      skipped.push('metadata.json');
    }
  }
  if (include.has('files') || include.has('issues')) {
    const file = await writeDiagnosticFile(
      client,
      executionId,
      out,
      'issues',
      'issues.md',
      execution.issueFiles
    );
    if (file) written.push(file);
    else skipped.push('issues.md');
  }
  if (include.has('files') || include.has('trace')) {
    const file = await writeDiagnosticFile(
      client,
      executionId,
      out,
      'trace',
      'trace.jsonl',
      execution.traceFiles
    );
    if (file) written.push(file);
    else skipped.push('trace.jsonl');
  }
  const summary = {
    executionId,
    out,
    written,
    skipped,
    counts: {
      written: written.length,
      skipped: skipped.length,
    },
  };
  if (opts.json) return printJson(summary);
  success(`Pulled execution ${executionId} to ${out}`);
  dim(
    `Wrote ${written.length} artifact${written.length === 1 ? '' : 's'}${
      skipped.length ? `; skipped missing ${skipped.join(', ')}` : ''
    }`
  );
}

async function listExecutionArtifacts(executionId: string, opts: BaseOpts) {
  const client = buildClient(opts);
  const payload = (await client.get(
    `/api/v1/agents/executions/${encodeURIComponent(executionId)}`,
    { include: 'expected,files,input,output,issues,trace,metadata' }
  )) as { execution?: Record<string, unknown> };
  const execution = payload.execution;
  if (!execution) throw new Error(`Execution ${executionId} not found`);
  const artifacts = executionArtifactInventory(execution);
  if (opts.json) return printJson({ executionId, artifacts });
  console.log(
    table(artifacts, [
      { key: 'kind', header: 'KIND' },
      { key: 'name', header: 'NAME' },
      { key: 'present', header: 'PRESENT' },
    ])
  );
}

async function traceExecution(executionId: string, opts: BaseOpts & { out?: string }) {
  const client = buildClient(opts);
  const text = await downloadTraceText(client, executionId);
  if (!opts.out) {
    process.stdout.write(text);
    return;
  }
  const out = path.resolve(opts.out);
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, text);
  success(`Downloaded trace for ${executionId} to ${ui.bold(out)}`);
}

async function compareExecution(
  referenceId: string,
  executionId: string,
  opts: BaseOpts & {
    baseline?: boolean;
    out?: string;
    normalizeDates?: boolean;
    failOnDiff?: boolean;
  }
) {
  const client = buildClient(opts);
  const targetPayload = (await client.get(
    `/api/v1/agents/executions/${encodeURIComponent(executionId)}`,
    { include: 'files,output' }
  )) as { execution?: Record<string, unknown> };
  const target = targetPayload.execution;
  if (!target) throw new Error(`Execution ${executionId} not found`);

  const mode = opts.baseline ? 'baseline' : 'expected';
  const reference = (
    (await client.get(`/api/v1/agents/executions/${encodeURIComponent(referenceId)}`, {
      include: mode === 'baseline' ? 'files,output' : 'expected',
    })) as { execution?: Record<string, unknown> }
  ).execution;
  if (!reference) throw new Error(`Reference execution ${referenceId} not found`);

  const out = path.resolve(
    opts.out ?? path.join('.eigenpal', 'artifacts', 'comparisons', `${referenceId}..${executionId}`)
  );
  await fs.mkdir(out, { recursive: true });

  const warnings: string[] = [];
  if (
    mode === 'expected' &&
    reference.expected == null &&
    fileNames(reference.expectedFiles).length === 0
  ) {
    warnings.push(
      `Reference execution ${referenceId} has no expected JSON or expected files; comparison has no baseline artifacts. Use --baseline to compare actual outputs.`
    );
  }
  const jsonDiffs = diffJson(
    mode === 'baseline' ? reference.output : reference.expected,
    target.output
  );
  const expectedFiles =
    mode === 'baseline'
      ? fileNames(reference.resultFiles).filter(
          (name) => name !== 'issues.md' && name !== 'trace.jsonl'
        )
      : fileNames(reference.expectedFiles);
  const outputFiles = fileNames(target.resultFiles).filter(
    (name) => name !== 'issues.md' && name !== 'trace.jsonl'
  );
  const inventory = compareFileInventory(expectedFiles, outputFiles, Boolean(opts.normalizeDates));
  const textDifferences = await compareMatchedFileText(
    client,
    { executionId: referenceId, kind: mode === 'baseline' ? 'output' : 'expected' },
    { executionId, kind: 'output' },
    out,
    inventory.matched,
    Boolean(opts.normalizeDates)
  );
  const report = {
    status:
      jsonDiffs.length === 0 &&
      inventory.missing.length === 0 &&
      inventory.extra.length === 0 &&
      textDifferences.every((diff) => diff.status === 'match' || diff.status === 'binary-match')
        ? 'pass'
        : 'fail',
    executionId,
    comparedWith: referenceId,
    mode,
    warnings,
    jsonDifferences: jsonDiffs,
    matchedFiles: inventory.matched,
    missingFiles: inventory.missing,
    extraFiles: inventory.extra,
    textDifferences,
  };
  await fs.writeFile(path.join(out, 'comparison.json'), JSON.stringify(report, null, 2));
  if (opts.json) {
    printJson(report);
  } else {
    renderComparisonReport(report);
  }
  dim(`Comparison artifacts written to ${ui.bold(out)}`);
  if (opts.failOnDiff && report.status === 'fail') process.exit(1);
}

async function listExecutions(
  agentId: string,
  opts: BaseOpts &
    PaginationOpts & {
      status?: string;
      batchId?: string;
      exampleName?: string;
      exampleNameContains?: string;
      createdAfter?: string;
      createdBefore?: string;
      completedAfter?: string;
      completedBefore?: string;
      feedbackStatus?: string;
      feedbackRating?: string;
      feedbackBodyContains?: string;
      feedbackCreatedAfter?: string;
      feedbackCreatedBefore?: string;
      feedbackUpdatedAfter?: string;
      feedbackUpdatedBefore?: string;
      feedbackResolvedAfter?: string;
      feedbackResolvedBefore?: string;
      hasFeedback?: boolean;
      noFeedback?: boolean;
      feedback?: boolean;
      hasExpected?: boolean;
      hasExpectedJson?: boolean;
      hasExpectedFiles?: boolean;
      promotedToExample?: boolean;
      promotedExampleName?: string;
      sinceLastResolved?: boolean;
      include?: string;
      compact?: boolean;
      sort?: string;
      order?: string;
      scanLimit?: number;
    }
) {
  const client = buildClient(opts);
  const params = buildExecutionListParams(opts);
  const payload = (await client.get(
    `/api/v1/agents/${encodeURIComponent(agentId)}/executions`,
    params
  )) as {
    executions: Record<string, unknown>[];
    total: number;
    scanLimited?: boolean;
    noResolvedAnchor?: boolean;
  };
  const rows = opts.compact ? payload.executions.map(compactExecutionRow) : payload.executions;
  if (opts.json) return printJson({ ...payload, executions: rows });
  if (payload.scanLimited) {
    warn(
      'Feedback/expected filters scanned only the first matching window. Increase --scan-limit or narrow DB filters for a fuller result.'
    );
  }
  if (payload.noResolvedAnchor) {
    warn(
      'No resolved feedback anchor was found in the scan window; --since-last-resolved returned no rows.'
    );
  }
  console.log(
    table(rows, [
      { key: 'id', header: 'ID' },
      { key: 'status', header: 'STATUS' },
      { key: 'exampleId', header: 'EXAMPLE' },
      {
        key: 'feedback',
        header: 'FEEDBACK',
        format: (value) =>
          value && typeof value === 'object'
            ? `${String((value as { rating?: unknown }).rating ?? '')}/${String((value as { status?: unknown }).status ?? '')}`
            : '',
      },
      { key: 'createdAt', header: 'CREATED', format: formatTimestamp },
    ])
  );
}

export function buildExecutionListParams<T extends object>(
  opts: T & {
    noFeedback?: boolean;
    feedback?: boolean;
    json?: boolean;
    baseUrl?: string;
    yes?: boolean;
  }
): Record<string, string> {
  return compactParams({
    ...opts,
    feedback: undefined,
    noFeedback: opts.noFeedback ?? (opts.feedback === false ? true : undefined),
  });
}

async function updateExecutionFeedback(
  executionId: string,
  opts: BaseOpts & {
    status?: string;
    rating?: string;
    message?: string;
    messageFile?: string;
    expectedJson?: string;
    expectedJsonFile?: string;
    clearMessage?: boolean;
    clearRating?: boolean;
    clearExpectedJson?: boolean;
  }
) {
  const client = buildClient(opts);
  const body: Record<string, unknown> = {};
  if (opts.status) body.status = opts.status;
  if (opts.rating) body.rating = opts.rating === 'none' ? null : opts.rating;
  if (opts.clearRating) body.rating = null;
  if (opts.messageFile) body.body = await fs.readFile(opts.messageFile, 'utf-8');
  if (opts.message !== undefined) body.body = opts.message;
  if (opts.clearMessage) body.body = '';
  if (opts.expectedJsonFile)
    body.expected = JSON.parse(await fs.readFile(opts.expectedJsonFile, 'utf-8'));
  if (opts.expectedJson !== undefined) body.expected = JSON.parse(opts.expectedJson);
  if (opts.clearExpectedJson) body.expected = null;
  const payload = await client.patch(
    `/api/v1/agents/executions/${encodeURIComponent(executionId)}/feedback`,
    body
  );
  renderGeneric(payload, opts, `Updated feedback for ${executionId}`);
}

function compactExecutionRow(execution: Record<string, unknown>) {
  const feedback =
    execution.feedback && typeof execution.feedback === 'object'
      ? (execution.feedback as Record<string, unknown>)
      : null;
  return {
    id: execution.id,
    status: execution.status,
    exampleId: execution.exampleId,
    feedback: feedback
      ? {
          rating: feedback.rating ?? null,
          status: feedback.status ?? null,
          updatedAt: feedback.updatedAt ?? null,
        }
      : null,
    hasExpectedJson: execution.expected != null,
    expectedFileCount: Array.isArray(execution.expectedFiles)
      ? execution.expectedFiles.length
      : undefined,
    createdAt: execution.createdAt,
    completedAt: execution.completedAt,
  };
}

async function clearExecutionFeedback(executionId: string, opts: BaseOpts & { yes?: boolean }) {
  if (!(opts.yes || (await confirmTyped(executionId, 'clear feedback artifacts')))) {
    throw new Error('Clear cancelled');
  }
  const client = buildClient(opts);
  const payload = await client.delete(
    `/api/v1/agents/executions/${encodeURIComponent(executionId)}/feedback`
  );
  renderGeneric(payload, opts, `Cleared feedback for ${executionId}`);
}

async function listExecutionExpected(executionId: string, opts: BaseOpts) {
  const client = buildClient(opts);
  const payload = (await client.get(
    `/api/v1/agents/executions/${encodeURIComponent(executionId)}/expected`
  )) as { expected?: unknown; files?: Record<string, unknown>[] };
  if (opts.json) return printJson(payload);
  console.log(table(payload.files ?? [], [{ key: 'name', header: 'NAME' }]));
  if (payload.expected != null) dim('expected.json present');
}

async function pullExecutionExpected(executionId: string, opts: BaseOpts & { out?: string }) {
  const client = buildClient(opts);
  const payload = (await client.get(
    `/api/v1/agents/executions/${encodeURIComponent(executionId)}/expected`
  )) as { expected?: unknown; files?: Record<string, unknown>[] };
  const out = path.resolve(opts.out ?? path.join(executionId, 'expected'));
  await fs.mkdir(out, { recursive: true });
  if (payload.expected != null) {
    await fs.writeFile(path.join(out, 'expected.json'), JSON.stringify(payload.expected, null, 2));
  }
  await downloadExpectedFiles(client, executionId, out, payload.files);
  success(`Pulled expected artifacts for ${executionId} to ${out}`);
}

async function uploadExecutionExpected(
  executionId: string,
  file: string,
  opts: BaseOpts & { name?: string }
) {
  const client = buildClient(opts);
  const form = new FormData();
  const data = await fs.readFile(file);
  form.append('file', new Blob([data]), path.basename(file));
  if (opts.name) form.append('name', opts.name);
  const payload = await client.postFormData(
    `/api/v1/agents/executions/${encodeURIComponent(executionId)}/expected`,
    form
  );
  renderGeneric(payload, opts, `Uploaded expected file for ${executionId}`);
}

async function copyOutputToExpected(
  executionId: string,
  outputFile: string,
  opts: BaseOpts & { name?: string }
) {
  const client = buildClient(opts);
  const payload = await client.post(
    `/api/v1/agents/executions/${encodeURIComponent(executionId)}/expected`,
    { outputFileName: outputFile, ...(opts.name ? { expectedName: opts.name } : {}) }
  );
  renderGeneric(payload, opts, `Copied output file to expected for ${executionId}`);
}

async function renameExecutionExpected(
  executionId: string,
  oldName: string,
  newName: string,
  opts: BaseOpts
) {
  const client = buildClient(opts);
  const payload = await client.patch(
    `/api/v1/agents/executions/${encodeURIComponent(executionId)}/expected/${encodeURIComponent(oldName)}`,
    { name: newName }
  );
  renderGeneric(payload, opts, `Renamed expected file for ${executionId}`);
}

async function deleteExecutionExpected(
  executionId: string,
  name: string,
  opts: BaseOpts & { yes?: boolean }
) {
  if (!(opts.yes || (await confirmTyped(name, 'delete expected file')))) {
    throw new Error('Delete cancelled');
  }
  const client = buildClient(opts);
  await client.delete(
    `/api/v1/agents/executions/${encodeURIComponent(executionId)}/expected/${encodeURIComponent(name)}`
  );
  renderGeneric({ ok: true }, opts, `Deleted expected file ${name}`);
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

function serializeCliFeedback(feedback: Record<string, unknown>): string {
  const keys = [
    'rating',
    'status',
    'createdAt',
    'createdBy',
    'createdByEmail',
    'updatedAt',
    'resolvedAt',
    'resolvedBy',
    'resolvedByEmail',
    'resolvedBySessionId',
    'promotedExampleName',
  ];
  const frontmatter = keys.map((key) => `${key}: ${feedback[key] ?? ''}`).join('\n');
  return `---\n${frontmatter}\n---\n\n${String(feedback.body ?? '').trim()}\n`;
}

async function writeExpectedArtifacts(
  client: ApiClient,
  executionId: string,
  out: string,
  execution: Record<string, unknown>
): Promise<string[]> {
  const written: string[] = [];
  const expectedDir = path.join(out, 'expected');
  await fs.mkdir(expectedDir, { recursive: true });
  if (execution.expected != null) {
    await fs.writeFile(
      path.join(out, 'expected.json'),
      JSON.stringify(execution.expected, null, 2)
    );
    written.push('expected.json');
  }
  written.push(
    ...(await downloadExpectedFiles(client, executionId, expectedDir, execution.expectedFiles)).map(
      (name) => `expected/${name}`
    )
  );
  return written;
}

async function downloadExpectedFiles(
  client: ApiClient,
  executionId: string,
  out: string,
  files: unknown
): Promise<string[]> {
  const rows = Array.isArray(files) ? files : [];
  const written = await Promise.all(
    rows.map(async (file) => {
      const name = String((file as { name?: unknown }).name ?? '');
      if (!name || name.includes('/') || name.includes('..')) return null;
      const response = await client.getStream(
        `/api/v1/agents/executions/${encodeURIComponent(executionId)}/expected/${encodeURIComponent(name)}`
      );
      await fs.mkdir(out, { recursive: true });
      await fs.writeFile(path.join(out, name), Buffer.from(await response.arrayBuffer()));
      return name;
    })
  );
  return written.filter((name): name is string => Boolean(name));
}

async function writeListedFiles(
  client: ApiClient,
  executionId: string,
  out: string,
  kind: 'input' | 'output',
  files: unknown
): Promise<string[]> {
  const rows = Array.isArray(files) ? files : [];
  const targetDir = path.join(out, kind);
  await fs.mkdir(targetDir, { recursive: true });
  const written = await Promise.all(
    rows.map(async (file) => {
      const name = String((file as { name?: unknown }).name ?? '');
      if (!name || name.includes('/') || name.includes('..')) return null;
      const response = await client.getStream(
        `/api/v1/agents/executions/${encodeURIComponent(executionId)}/files/${kind}/${encodeURIComponent(name)}`
      );
      await fs.writeFile(path.join(targetDir, name), Buffer.from(await response.arrayBuffer()));
      return `${kind}/${name}`;
    })
  );
  return written.filter((name): name is string => Boolean(name));
}

async function writeDiagnosticFile(
  client: ApiClient,
  executionId: string,
  out: string,
  kind: 'issues' | 'trace',
  filename: string,
  files: unknown
): Promise<string | null> {
  const rows = Array.isArray(files) ? files : [];
  const exists = rows.some((file) => String((file as { name?: unknown }).name ?? '') === filename);
  if (!exists) return null;
  const response = await client.getStream(
    `/api/v1/agents/executions/${encodeURIComponent(executionId)}/files/${kind}/${filename}`
  );
  await fs.writeFile(path.join(out, filename), Buffer.from(await response.arrayBuffer()));
  return filename;
}

async function downloadTraceText(client: ApiClient, executionId: string): Promise<string> {
  const response = await client.getStream(
    `/api/v1/agents/executions/${encodeURIComponent(executionId)}/files/trace/trace.jsonl`
  );
  return Buffer.from(await response.arrayBuffer()).toString('utf-8');
}

export function diffJson(
  expected: unknown,
  actual: unknown,
  basePath = '$'
): Array<Record<string, string>> {
  if (expected === undefined || expected === null) return [];
  if (Object.is(expected, actual)) return [];
  if (
    expected &&
    actual &&
    typeof expected === 'object' &&
    typeof actual === 'object' &&
    !Array.isArray(expected) &&
    !Array.isArray(actual)
  ) {
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    return [...keys].flatMap((key) => {
      const next = `${basePath}.${key}`;
      if (!(key in (actual as Record<string, unknown>))) return [{ path: next, type: 'missing' }];
      if (!(key in (expected as Record<string, unknown>))) return [{ path: next, type: 'extra' }];
      return diffJson(
        (expected as Record<string, unknown>)[key],
        (actual as Record<string, unknown>)[key],
        next
      );
    });
  }
  if (Array.isArray(expected) && Array.isArray(actual)) {
    const diffs: Array<Record<string, string>> = [];
    const max = Math.max(expected.length, actual.length);
    for (let index = 0; index < max; index += 1) {
      const next = `${basePath}[${index}]`;
      if (index >= actual.length) diffs.push({ path: next, type: 'missing' });
      else if (index >= expected.length) diffs.push({ path: next, type: 'extra' });
      else diffs.push(...diffJson(expected[index], actual[index], next));
    }
    return diffs;
  }
  return [
    {
      path: basePath,
      type: 'changed',
      expected: JSON.stringify(expected),
      actual: JSON.stringify(actual),
    },
  ];
}

function fileNames(files: unknown): string[] {
  return (Array.isArray(files) ? files : [])
    .map((file) => String((file as { name?: unknown }).name ?? ''))
    .filter(Boolean)
    .sort();
}

function executionArtifactInventory(execution: Record<string, unknown>) {
  const rows: Array<{ kind: string; name: string; present: string }> = [
    { kind: 'metadata', name: 'execution.json', present: 'yes' },
  ];
  if (execution.inputJson != null) rows.push({ kind: 'input', name: 'input.json', present: 'yes' });
  if (execution.metadata != null)
    rows.push({ kind: 'metadata', name: 'metadata.json', present: 'yes' });
  if (execution.expected != null)
    rows.push({ kind: 'expected', name: 'expected.json', present: 'yes' });
  for (const name of fileNames(execution.inputFiles))
    rows.push({ kind: 'input', name, present: 'yes' });
  for (const name of fileNames(execution.resultFiles).filter(
    (name) => name !== 'issues.md' && name !== 'trace.jsonl'
  )) {
    rows.push({ kind: 'output', name, present: 'yes' });
  }
  for (const name of fileNames(execution.expectedFiles)) {
    rows.push({ kind: 'expected', name, present: 'yes' });
  }
  for (const name of fileNames(execution.issueFiles))
    rows.push({ kind: 'issues', name, present: 'yes' });
  for (const name of fileNames(execution.traceFiles))
    rows.push({ kind: 'trace', name, present: 'yes' });
  return rows.sort((a, b) => `${a.kind}/${a.name}`.localeCompare(`${b.kind}/${b.name}`));
}

async function buildAgentFileDiff(
  agentId: string,
  remotePath: string,
  localPath: string,
  opts: BaseOpts
) {
  const client = buildClient(opts);
  const local = await fs.readFile(localPath);
  let remote: Buffer | null = null;
  let serverPath = remotePath;
  try {
    const payload = (await client.get(`/api/v1/agents/${encodeURIComponent(agentId)}/files`, {
      path: remotePath,
    })) as { path?: string; contentBase64?: string };
    serverPath = String(payload.path ?? remotePath);
    remote = Buffer.from(String(payload.contentBase64 ?? ''), 'base64');
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 404) throw err;
  }
  const localHash = createHash('sha256').update(local).digest('hex');
  const remoteHash = remote ? createHash('sha256').update(remote).digest('hex') : null;
  const status: FileDiffStatus = !remote
    ? 'remote-missing'
    : localHash === remoteHash
      ? 'match'
      : 'different';
  return {
    agentId,
    path: serverPath,
    localPath,
    status,
    localBytes: local.length,
    remoteBytes: remote?.length ?? null,
    localSha256: localHash,
    remoteSha256: remoteHash,
    textPreview:
      remote && isLikelyText(local) && isLikelyText(remote)
        ? buildTextDiffPreview(remote.toString('utf-8'), local.toString('utf-8'))
        : null,
  };
}

function renderAgentFileDiff(report: Awaited<ReturnType<typeof buildAgentFileDiff>>) {
  const label = `File ${report.status}`;
  if (report.status === 'match') success(label);
  else error(label);
  console.log(
    table(
      [
        { item: 'Remote path', value: report.path },
        { item: 'Local bytes', value: String(report.localBytes) },
        { item: 'Remote bytes', value: String(report.remoteBytes ?? 'missing') },
        { item: 'Local sha256', value: report.localSha256.slice(0, 12) },
        { item: 'Remote sha256', value: report.remoteSha256?.slice(0, 12) ?? 'missing' },
      ],
      [
        { key: 'item', header: 'ITEM' },
        { key: 'value', header: 'VALUE' },
      ]
    )
  );
  if (report.textPreview?.length) {
    console.log(report.textPreview.join('\n'));
  }
}

function isLikelyText(buffer: Buffer): boolean {
  return !buffer.includes(0);
}

function buildTextDiffPreview(remoteText: string, localText: string): string[] {
  if (remoteText === localText) return [];
  const remoteLines = remoteText.split(/\r?\n/);
  const localLines = localText.split(/\r?\n/);
  const max = Math.max(remoteLines.length, localLines.length);
  const preview: string[] = [];
  for (let index = 0; index < max && preview.length < 12; index += 1) {
    if (remoteLines[index] === localLines[index]) continue;
    preview.push(`-${remoteLines[index] ?? ''}`);
    preview.push(`+${localLines[index] ?? ''}`);
  }
  return preview;
}

function normalizeGeneratedTokens(value: string): string {
  return value.replace(/\d{4}-\d{2}-\d{2}/g, '<date>').replace(/\d{8}/g, '<date>');
}

export function compareFileInventory(
  expected: string[],
  output: string[],
  normalizeDates: boolean
) {
  const normalize = (value: string) => (normalizeDates ? normalizeGeneratedTokens(value) : value);
  const outputByNormalized = new Map(output.map((name) => [normalize(name), name]));
  const expectedByNormalized = new Map(expected.map((name) => [normalize(name), name]));
  const matched = expected
    .map((expectedName) => {
      const outputName = outputByNormalized.get(normalize(expectedName));
      return outputName ? { expected: expectedName, output: outputName } : null;
    })
    .filter((match): match is { expected: string; output: string } => Boolean(match));
  return {
    matched,
    missing: expected.filter((name) => !outputByNormalized.has(normalize(name))),
    extra: output.filter((name) => !expectedByNormalized.has(normalize(name))),
  };
}

async function compareMatchedFileText(
  client: ApiClient,
  left: { executionId: string; kind: 'expected' | 'output' },
  right: { executionId: string; kind: 'output' },
  out: string,
  matched: Array<{ expected: string; output: string }>,
  normalizeDates: boolean
): Promise<Array<Record<string, unknown>>> {
  const expectedDir = path.join(out, 'expected');
  const outputDir = path.join(out, 'output');
  await fs.mkdir(expectedDir, { recursive: true });
  await fs.mkdir(outputDir, { recursive: true });
  const diffs: Array<Record<string, unknown>> = [];
  for (const pair of matched) {
    const expectedPath = path.join(expectedDir, pair.expected);
    const outputPath = path.join(outputDir, pair.output);
    await downloadStreamToFile(client, executionFileUrl(left, pair.expected), expectedPath);
    await downloadStreamToFile(client, executionFileUrl(right, pair.output), outputPath);
    const expectedText = extractComparableText(expectedPath);
    const outputText = extractComparableText(outputPath);
    if (expectedText.text == null || outputText.text == null) {
      const [expectedBuffer, outputBuffer] = await Promise.all([
        fs.readFile(expectedPath),
        fs.readFile(outputPath),
      ]);
      const expectedHash = createHash('sha256').update(expectedBuffer).digest('hex');
      const outputHash = createHash('sha256').update(outputBuffer).digest('hex');
      diffs.push({
        ...pair,
        status:
          expectedBuffer.length === outputBuffer.length && expectedHash === outputHash
            ? 'binary-match'
            : 'binary-different',
        expectedBytes: expectedBuffer.length,
        outputBytes: outputBuffer.length,
        expectedSha256: expectedHash,
        outputSha256: outputHash,
        textExtraction: {
          expected: expectedText.reason ?? null,
          output: outputText.reason ?? null,
        },
      });
      continue;
    }
    const normalize = (value: string) =>
      normalizeDates ? normalizeGeneratedTokens(value).trim() : value.trim();
    diffs.push({
      ...pair,
      status:
        normalize(expectedText.text) === normalize(outputText.text) ? 'match' : 'text-different',
    });
  }
  return diffs;
}

function executionFileUrl(
  side: { executionId: string; kind: 'expected' | 'output' },
  name: string
): string {
  const executionId = encodeURIComponent(side.executionId);
  const filename = encodeURIComponent(name);
  return side.kind === 'expected'
    ? `/api/v1/agents/executions/${executionId}/expected/${filename}`
    : `/api/v1/agents/executions/${executionId}/files/output/${filename}`;
}

async function downloadStreamToFile(client: ApiClient, url: string, target: string): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const response = await client.getStream(url);
  await fs.writeFile(target, Buffer.from(await response.arrayBuffer()));
}

function extractComparableText(file: string): { text: string | null; reason?: string } {
  const ext = path.extname(file).toLowerCase();
  if (['.txt', '.md', '.json', '.csv', '.xml'].includes(ext)) {
    return { text: readFileSync(file, 'utf8') };
  }
  if (ext === '.pdf') {
    const result = spawnSync('pdftotext', [file, '-'], { encoding: 'utf8' });
    return result.status === 0
      ? { text: result.stdout }
      : { text: null, reason: textExtractionFallbackReason('pdftotext', result) };
  }
  if (ext === '.docx') {
    const script =
      "import re,sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); x=z.read('word/document.xml').decode('utf-8','ignore'); print(re.sub('<[^>]+>',' ',x))";
    const result = spawnSync('python3', ['-c', script, file], { encoding: 'utf8' });
    return result.status === 0
      ? { text: result.stdout }
      : { text: null, reason: textExtractionFallbackReason('python3', result) };
  }
  return { text: null, reason: `No text extractor for ${ext || 'extensionless'} files` };
}

function textExtractionFallbackReason(tool: string, result: ReturnType<typeof spawnSync>): string {
  if (result.error) return `${tool} unavailable; compared bytes instead`;
  return `${tool} could not extract text; compared bytes instead`;
}

function renderComparisonReport(report: {
  status: string;
  warnings?: string[];
  jsonDifferences: unknown[];
  missingFiles: string[];
  extraFiles: string[];
  matchedFiles: unknown[];
  textDifferences: Array<Record<string, unknown>>;
}) {
  const header = `Comparison ${report.status}`;
  if (report.status === 'pass') {
    success(header);
  } else {
    error(header);
  }
  for (const warning of report.warnings ?? []) {
    dim(`warning: ${warning}`);
  }
  console.log(
    table(
      [
        { item: 'JSON differences', count: report.jsonDifferences.length },
        { item: 'Matched files', count: report.matchedFiles.length },
        { item: 'Missing files', count: report.missingFiles.length },
        { item: 'Extra files', count: report.extraFiles.length },
        {
          item: 'Text differences',
          count: report.textDifferences.filter((diff) => diff.status === 'text-different').length,
        },
      ],
      [
        { key: 'item', header: 'ITEM' },
        { key: 'count', header: 'COUNT' },
      ]
    )
  );
  for (const diff of report.textDifferences) {
    const textExtraction = diff.textExtraction as
      | { expected?: unknown; output?: unknown }
      | undefined;
    const reasons = [textExtraction?.expected, textExtraction?.output]
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .filter((value, index, values) => values.indexOf(value) === index);
    for (const reason of reasons) {
      dim(`warning: ${String(diff.expected)} vs ${String(diff.output)}: ${reason}`);
    }
  }
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
      key === 'yes' ||
      key === 'compact'
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
