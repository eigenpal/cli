import {
  SOURCE_SECRETS_FILENAME,
  SourcePackageManifestSchema,
  SourcePackagePathSchema,
  SourceSecretsFileSchema,
  eigenpalAjv,
  parseAutomationTarget,
  validateWorkspaceSchema,
  type EncryptedSecretValue,
} from '@eigenpal/types';
import { InvalidArgumentError, type Command } from 'commander';
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
import { registerAgentSourceCommands, validateSourcePackage } from './git';

type BaseOpts = { baseUrl?: string; json?: boolean };
type AgentFile = { path: string; contentBase64: string; contentType?: string };
type FileDiffStatus = 'match' | 'different' | 'remote-missing';
type SourceLockPackage = {
  packagePath: string;
  resolvedRef: string;
  resolvedTag?: string;
  commit: string;
  dependencies: SourceLockPackage[];
};

const PACKAGE_MANIFEST = 'eigenpal.yaml';
const DATASET_DIR = 'dataset';
const SCHEMA_FILENAMES = ['input-schema.json', 'output-schema.json'] as const;
const AGENT_EXAMPLE_INPUT_JSON = 'input.json';
const AGENT_EXAMPLE_EXPECTED_JSON = 'expected.json';
const LEGACY_LAYOUTS = [
  ['workflow', 'agent'],
  ['eval', 'dataset'],
] as const;

export function registerAgentCommands(program: Command): void {
  const agent = program
    .command('agents')
    .alias('agent')
    .description(
      'Manage Eigenpal agents: Git source, datasets, runs, experiments, sessions, and releases.'
    )
    .action(() => {
      process.stderr.write(
        '`eigenpal agents` requires a subcommand. Run `eigenpal agents --help`.\n'
      );
      process.exit(2);
    });

  addJsonFlag(withBaseUrl(agent.command('run <target>')))
    .description('Run an agent target, e.g. agents.invoice-agent@latest.')
    .option('--input-json <json>', 'JSON input object')
    .option('--input-file <path>', 'Input file to upload as multipart form-data')
    .option('--example <name>', 'Run a persisted dataset example by name')
    .option('--wait', 'Poll until the run reaches a terminal status')
    .option('--interval <seconds>', 'Polling interval in seconds', intArg, 2)
    .option('--max-wait <seconds>', 'Maximum wait before exiting 2', intArg, 1800)
    .action(action(runTarget));

  addJsonFlag(withPagination(withBaseUrl(agent.command('list')), 50))
    .description('List agents.')
    .option('--search <q>', 'Search by slug, name, or description')
    .action(action(listAgents));

  registerAgentFileCommands(agent);

  addJsonFlag(agent.command('validate [dir]'))
    .description(
      'Validate a local agent package (layout, manifest, schemas, and Git source rules).'
    )
    .action(action(validateAgentCommand));

  registerAgentSourceCommands(agent);
  registerDatasetCommands(agent);
  registerRunCommands(agent);
  registerExperimentCommands(agent);
  registerSessionCommands(agent);
  registerEnvCommands(agent);
  registerSecretsExportCommands(agent);
}

function registerEnvCommands(agent: Command): void {
  const env = agent
    .command('env')
    .description('Export encrypted source secrets for a local installed agent package.')
    .action(() => {
      process.stderr.write(
        '`eigenpal agents env` requires a subcommand. Run `eigenpal agents env --help`.\n'
      );
      process.exit(2);
    });

  withBaseUrl(env.command('pull [target]'))
    .description('Decrypt source secrets and print shell exports.')
    .option('--dir <dir>', 'Installed agent package directory', '.')
    .option('--format <format>', 'Output format: shell or dotenv', 'shell')
    .action(action(pullAgentEnv));
}

function registerSecretsExportCommands(agent: Command): void {
  const secrets = agent
    .command('secrets')
    .description('Export encrypted source secrets for a local installed agent package.')
    .action(() => {
      process.stderr.write(
        '`eigenpal agents secrets` requires a subcommand. Run `eigenpal agents secrets --help`.\n'
      );
      process.exit(2);
    });

  withBaseUrl(secrets.command('export [target]'))
    .description('Decrypt source secrets and print shell exports.')
    .option('--dir <dir>', 'Installed agent package directory', '.')
    .option('--format <format>', 'Output format: shell or dotenv', 'shell')
    .action(action(pullAgentEnv));
}

export function parseAgentTarget(target: string): {
  packageName: string;
  slug: string;
  sourceRef?: string;
} {
  const [rawTarget, rawRef, extra] = target.split('@');
  if (extra !== undefined) throw new Error('Agent target must be <slug>[@ref].');
  const normalizedTarget = rawTarget.includes('.')
    ? target
    : `agents.${rawTarget}${rawRef !== undefined ? `@${rawRef}` : ''}`;
  const parsed = parseAutomationTarget(normalizedTarget);
  if (parsed.type !== 'agents') {
    throw new Error('Only agent targets are supported in this release. Use agents.<slug>[@ref].');
  }
  return {
    packageName: parsed.packageName,
    slug: parsed.slug,
    sourceRef: rawRef !== undefined ? parsed.ref : undefined,
  };
}

async function runTarget(
  target: string,
  opts: BaseOpts & {
    inputJson?: string;
    inputFile?: string;
    example?: string;
    wait?: boolean;
    interval: number;
    maxWait: number;
  }
) {
  const parsed = parseAgentTarget(target);
  if (opts.example) {
    if (opts.inputJson || opts.inputFile) {
      throw new Error('--example cannot be combined with --input-json or --input-file');
    }
    return runExample(parsed.slug, {
      ...opts,
      sourceRef: parsed.sourceRef,
      example: opts.example,
    });
  }
  return runExecution(parsed.slug, { ...opts, sourceRef: parsed.sourceRef });
}

async function listRunsTarget(target: string, opts: Parameters<typeof listRuns>[1]) {
  const parsed = parseAgentTarget(target);
  return listRuns(parsed.slug, { ...opts, sourceRef: parsed.sourceRef });
}

function registerAgentFileCommands(agent: Command): void {
  const file = agent
    .command('file')
    .description('List, download, and upload individual live agent files.')
    .action(() => {
      process.stderr.write(
        '`eigenpal agents file` requires a subcommand. Run `eigenpal agents file --help`.\n'
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
    .description('[removed] Git-backed agents — edit source in Git and run `eigenpal agents save`.')
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
        '`eigenpal agents dataset` requires a subcommand. Run `eigenpal agents dataset --help`.\n'
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
    .description('Validate a local dataset directory against the agent input/output schemas.')
    .option('--agent-dir <dir>', 'Agent package directory containing input/output schemas', '.')
    .action(action(validateDatasetCommand));
}

function registerRunCommands(agent: Command): void {
  const runs = agent
    .command('runs')
    .description('Inspect, watch, and manage agent runs.')
    .action(() => {
      process.stderr.write(
        '`eigenpal agents runs` requires a subcommand. Run `eigenpal agents runs --help`.\n'
      );
      process.exit(2);
    });

  const listRunsCmd = addJsonFlag(withPagination(withBaseUrl(runs.command('list <target>')), 50))
    .description('List runs for an agent target; unqualified targets include all source refs.')
    .option('--status <status>', 'Filter by run status')
    .option('--include <items>', 'Comma-separated include list')
    .option('--compact', 'Render compact run rows')
    .option('--sort <field>', 'Sort field')
    .option('--order <asc|desc>', 'Sort order');
  listRunsCmd.action(action(listRunsTarget));

  addJsonFlag(withBaseUrl(runs.command('get <run-id>')))
    .description('Get one agent run.')
    .option(
      '--include <parts>',
      'Comma-separated extra parts: feedback,expected,files,trace,issues',
      'feedback'
    )
    .action(action(getRun));

  addJsonFlag(withBaseUrl(runs.command('rerun <run-id>')))
    .description("Create a new run from a previous run's stored input snapshot.")
    .option('--wait', 'Poll until the rerun reaches a terminal status')
    .option('--interval <seconds>', 'Polling interval in seconds', intArg, 2)
    .option('--max-wait <seconds>', 'Maximum wait before exiting 2', intArg, 1800)
    .action(action(rerunRun));

  withBaseUrl(runs.command('pull <run-id>'))
    .description('Download run feedback, expected artifacts, files, and metadata.')
    .option('--out <dir>', 'Output directory')
    .option(
      '--include <parts>',
      'Comma-separated parts: feedback,expected,files,output,input,metadata,issues,trace,all',
      'feedback,expected'
    )
    .option('--json', 'Output a JSON summary of written artifacts')
    .action(action(pullRun));

  addJsonFlag(withBaseUrl(runs.command('compare <reference-run-id> <run-id>')))
    .description(
      'Compare one run against another run. PDF/DOCX text comparison uses pdftotext/python3 and reports byte fallbacks.'
    )
    .option('--baseline', 'Compare actual outputs from both runs instead of expected artifacts')
    .option('--out <dir>', 'Write comparison artifacts to this directory')
    .option('--normalize-dates', 'Normalize YYYYMMDD and YYYY-MM-DD tokens in filenames/text')
    .option('--fail-on-diff', 'Exit 1 when comparison status is fail')
    .action(action(compareRun));

  const artifacts = runs
    .command('artifacts')
    .description('Inspect run artifact inventory.')
    .action(() => {
      process.stderr.write(
        '`eigenpal agents runs artifacts` requires a subcommand. Run `eigenpal agents runs artifacts --help`.\n'
      );
      process.exit(2);
    });

  addJsonFlag(withBaseUrl(artifacts.command('list <run-id>')))
    .description('List available run artifacts without downloading them.')
    .action(action(listRunArtifacts));

  withBaseUrl(runs.command('trace <run-id>'))
    .description('Print raw trace.jsonl for a run, or write it with --out.')
    .option('--out <file>', 'Output file path')
    .action(action(traceRun));

  registerRunFeedbackCommands(runs);
  registerRunExpectedCommands(runs);

  addJsonFlag(withBaseUrl(runs.command('watch <run-id>')))
    .description('Watch a run until it reaches a terminal status.')
    .option('--interval <seconds>', 'Polling interval in seconds', intArg, 2)
    .option('--max-wait <seconds>', 'Maximum wait before exiting 2', intArg, 1800)
    .action(action(watchRunCommand));

  addJsonFlag(withBaseUrl(runs.command('cancel <run-id>')))
    .description('Cancel an agent run.')
    .option('--yes', 'Required in non-interactive environments')
    .action(action(cancelRun));
}

function registerExperimentCommands(agent: Command): void {
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

function registerRunFeedbackCommands(runs: Command): void {
  const feedback = runs
    .command('feedback')
    .description('Update or clear feedback attached to an agent run.')
    .action(() => {
      process.stderr.write(
        '`eigenpal agents runs feedback` requires a subcommand. Run `eigenpal agents runs feedback --help`.\n'
      );
      process.exit(2);
    });

  addJsonFlag(withBaseUrl(feedback.command('update <run-id>')))
    .description('Edit feedback state, rating, message, or expected JSON for a run.')
    .option('--status <open|resolved|ignored>', 'Set feedback status')
    .option('--rating <pass|fail|partial|none>', 'Set feedback rating')
    .option('--message <text>', 'Set feedback message body')
    .option('--message-file <path>', 'Read feedback message body from a file')
    .option('--expected-json <json>', 'Set structured expected JSON')
    .option('--expected-json-file <path>', 'Read structured expected JSON from a file')
    .option('--clear-message', 'Clear the feedback message body')
    .option('--clear-rating', 'Clear feedback rating')
    .option('--clear-expected-json', 'Delete structured expected JSON')
    .action(action(updateRunFeedback));

  addJsonFlag(withBaseUrl(feedback.command('resolve <run-id>')))
    .description('Mark run feedback as resolved.')
    .option('--message <text>', 'Set feedback message body')
    .option('--message-file <path>', 'Read feedback message body from a file')
    .action(
      action((runId: string, opts: BaseOpts & { message?: string; messageFile?: string }) =>
        updateRunFeedback(runId, { ...opts, status: 'resolved' })
      )
    );

  addJsonFlag(withBaseUrl(feedback.command('clear <run-id>')))
    .description('Delete feedback, expected.json, and expected files for a run.')
    .option('--yes', 'Required in non-interactive environments')
    .action(action(clearRunFeedback));
}

function registerRunExpectedCommands(runs: Command): void {
  const expected = runs
    .command('expected')
    .description('Manage expected artifacts attached to an agent run.')
    .action(() => {
      process.stderr.write(
        '`eigenpal agents runs expected` requires a subcommand. Run `eigenpal agents runs expected --help`.\n'
      );
      process.exit(2);
    });

  addJsonFlag(withBaseUrl(expected.command('list <run-id>')))
    .description('List expected JSON and files attached to a run.')
    .action(action(listRunExpected));

  withBaseUrl(expected.command('pull <run-id>'))
    .description('Download expected JSON and files attached to a run.')
    .option('--out <dir>', 'Output directory')
    .action(action(pullRunExpected));

  addJsonFlag(withBaseUrl(expected.command('upload <run-id> <file>')))
    .description('Upload a local file as an expected artifact.')
    .option('--name <name>', 'Expected artifact name')
    .action(action(uploadRunExpected));

  addJsonFlag(withBaseUrl(expected.command('copy-output <run-id> <output-file>')))
    .description('Copy a generated output file into expected artifacts.')
    .option('--name <name>', 'Expected artifact name')
    .action(action(copyOutputToExpected));

  addJsonFlag(withBaseUrl(expected.command('rename <run-id> <old-name> <new-name>')))
    .description('Rename an expected artifact.')
    .action(action(renameRunExpected));

  addJsonFlag(withBaseUrl(expected.command('delete <run-id> <name>')))
    .description('Delete an expected artifact.')
    .option('--yes', 'Required in non-interactive environments')
    .action(action(deleteRunExpected));
}

function registerSessionCommands(agent: Command): void {
  const session = agent
    .command('session')
    .description('Manage agent builder sessions.')
    .action(() => {
      process.stderr.write(
        '`eigenpal agents session` requires a subcommand. Run `eigenpal agents session --help`.\n'
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

function buildClient(opts: { baseUrl?: string }): ApiClient {
  const config = resolveConfig(opts);
  requireApiKey(config);
  return new ApiClient(config);
}

async function pullAgentEnv(
  target: string | undefined,
  opts: BaseOpts & { dir?: string; format?: string }
) {
  const format = opts.format ?? 'shell';
  if (format !== 'shell' && format !== 'dotenv') {
    throw new Error('--format must be shell or dotenv');
  }
  const client = buildClient(opts);
  const requests = target
    ? await collectEncryptedSecretsForTarget(client, target)
    : await collectEncryptedSecrets(path.resolve(opts.dir ?? '.'));
  if (requests.length === 0) return;
  const payload = (await client.post('/api/v1/source/secrets/decrypt', {
    secrets: requests.map(({ sourcePath, secretName, encrypted }) => ({
      sourcePath,
      secretName,
      encrypted,
    })),
  })) as { secrets?: Record<string, string> };
  const secrets = payload.secrets ?? {};
  for (const [name, value] of Object.entries(secrets).sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    if (format === 'shell') {
      process.stdout.write(`export ${name}=${shellQuote(value)}\n`);
    } else {
      process.stdout.write(`${name}=${dotenvQuote(value)}\n`);
    }
  }
}

async function collectEncryptedSecretsForTarget(
  client: ApiClient,
  target: string
): Promise<
  Array<{
    sourcePath: string;
    secretName: string;
    encrypted: EncryptedSecretValue;
  }>
> {
  const parsed = parseAgentTarget(target);
  const packageRef = `${parsed.packageName}@${parsed.sourceRef ?? 'latest'}`;
  const lockfile = (await client.get('/api/v1/source/lockfile', { packageRef })) as {
    root: SourceLockPackage;
  };
  const requests: Awaited<ReturnType<typeof collectEncryptedSecretsForTarget>> = [];
  const seen = new Set<string>();

  for (const packageNode of flattenLockPackages(lockfile.root)) {
    const sourcePath = `${packageNode.packagePath}/${SOURCE_SECRETS_FILENAME}`;
    const content = await readOptionalSourceFile(client, {
      ref: packageNode.resolvedTag ?? packageNode.commit ?? packageNode.resolvedRef,
      path: sourcePath,
    });
    if (!content) continue;
    const parsedSecrets = SourceSecretsFileSchema.parse(YAML.parse(content));
    for (const [secretName, entry] of Object.entries(parsedSecrets.secrets)) {
      if (!entry.encrypted) continue;
      if (seen.has(secretName)) {
        warn(`Skipping dependency secret ${secretName}; root package value wins.`);
        continue;
      }
      seen.add(secretName);
      requests.push({ sourcePath, secretName, encrypted: entry.encrypted });
    }
  }

  return requests;
}

function flattenLockPackages(root: SourceLockPackage): SourceLockPackage[] {
  return [root, ...root.dependencies.flatMap((dependency) => flattenLockPackages(dependency))];
}

async function readOptionalSourceFile(
  client: ApiClient,
  query: { ref: string; path: string }
): Promise<string | null> {
  try {
    const payload = (await client.get('/api/v1/source/raw', query)) as { content?: string };
    return typeof payload.content === 'string' ? payload.content : null;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

async function collectEncryptedSecrets(root: string): Promise<
  Array<{
    sourcePath: string;
    secretName: string;
    encrypted: EncryptedSecretValue;
  }>
> {
  const roots = [root, ...(await listModulePackageRoots(path.join(root, 'eigenpal_modules')))];
  const seen = new Set<string>();
  const requests: Awaited<ReturnType<typeof collectEncryptedSecrets>> = [];
  for (const packageRoot of roots) {
    const secretsPath = path.join(packageRoot, SOURCE_SECRETS_FILENAME);
    if (!existsSync(secretsPath)) continue;
    const parsed = SourceSecretsFileSchema.parse(
      YAML.parse(await fs.readFile(secretsPath, 'utf8'))
    );
    const sourcePath = sourcePathForInstalledPackage(root, packageRoot);
    for (const [secretName, entry] of Object.entries(parsed.secrets)) {
      if (!entry.encrypted) continue;
      if (seen.has(secretName)) {
        warn(`Skipping dependency secret ${secretName}; root package value wins.`);
        continue;
      }
      seen.add(secretName);
      requests.push({
        sourcePath: `${sourcePath}/${SOURCE_SECRETS_FILENAME}`,
        secretName,
        encrypted: entry.encrypted,
      });
    }
  }
  return requests;
}

async function listModulePackageRoots(modulesRoot: string): Promise<string[]> {
  if (!existsSync(modulesRoot)) return [];
  const result: string[] = [];
  for (const type of await fs.readdir(modulesRoot)) {
    const typeRoot = path.join(modulesRoot, type);
    const typeStat = await fs.stat(typeRoot).catch(() => null);
    if (!typeStat?.isDirectory()) continue;
    for (const slug of await fs.readdir(typeRoot)) {
      const packageRoot = path.join(typeRoot, slug);
      const packageStat = await fs.stat(packageRoot).catch(() => null);
      if (packageStat?.isDirectory()) result.push(packageRoot);
    }
  }
  return result;
}

export function sourcePathForInstalledPackage(root: string, packageRoot: string): string {
  const sourceRelative = path.relative(root, packageRoot).replace(/\\/g, '/');
  if (
    !sourceRelative.startsWith('..') &&
    SourcePackagePathSchema.safeParse(sourceRelative).success
  ) {
    return sourceRelative;
  }
  const relative = path
    .relative(path.join(root, 'eigenpal_modules'), packageRoot)
    .replace(/\\/g, '/');
  if (!relative.startsWith('..')) return relative;
  const lockfilePath = path.join(root, '.eigenpal', 'eigenpal.lock');
  if (packageRoot === root && existsSync(lockfilePath)) {
    const lockfile = JSON.parse(readFileSync(lockfilePath, 'utf8')) as {
      root?: { packagePath?: unknown };
    };
    if (typeof lockfile.root?.packagePath === 'string') return lockfile.root.packagePath;
  }
  throw new Error(
    `Cannot determine canonical source path for ${packageRoot}. Run from an installed package with .eigenpal/eigenpal.lock or from an organization source repository.`
  );
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function dotenvQuote(value: string): string {
  return JSON.stringify(value);
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
  _agentId: string,
  _remotePath: string,
  _localPath: string,
  _opts: BaseOpts
): Promise<void> {
  warn(
    'eigenpal agents file put removed. Edit source in Git and run eigenpal agents save (use agents file diff to compare).'
  );
  process.exit(2);
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
  const root = path.resolve(dir);
  const legacy = await validateAgentProject(root);
  const result: {
    valid: boolean;
    errors: string[];
    warnings: string[];
    packagePath?: string;
  } = { ...legacy };

  if (existsSync(path.join(root, PACKAGE_MANIFEST))) {
    const source = validateSourcePackage(root);
    result.valid = legacy.valid && source.valid;
    result.packagePath = source.packagePath;
    for (const issue of source.errors) {
      if (!result.errors.includes(issue)) result.errors.push(issue);
    }
  }
  if (opts.json) {
    printJson(result);
    if (!result.valid) process.exit(1);
    return;
  }
  if (result.valid) {
    success('Agent project is valid');
    for (const warning of result.warnings) warn(warning);
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

async function validateDatasetCommand(
  dir = DATASET_DIR,
  opts: { json?: boolean; agentDir?: string }
) {
  const result = await validateDatasetDir(path.resolve(dir), {
    agentDir: path.resolve(opts.agentDir ?? '.'),
  });
  if (opts.json) return printJson(result);
  if (result.valid) return success('Dataset is valid');
  for (const issue of result.errors) error(issue);
  process.exit(1);
}

async function runExecution(
  agentId: string,
  opts: BaseOpts & {
    inputJson?: string;
    inputFile?: string;
    wait?: boolean;
    sourceRef?: string;
    interval?: number;
    maxWait?: number;
  }
) {
  const client = buildClient(opts);
  const runPath = `/api/v1/agents/${encodeURIComponent(agentId)}/run${
    opts.sourceRef ? `?sourceRef=${encodeURIComponent(opts.sourceRef)}` : ''
  }`;
  let payload: unknown;
  if (opts.inputFile) {
    const form = await buildAgentExecutionRunFormData(opts.inputFile, opts.inputJson);
    payload = await client.postFormData(runPath, form);
  } else {
    payload = await client.post(runPath, {
      input: opts.inputJson ? JSON.parse(opts.inputJson) : {},
      ...(opts.sourceRef ? { sourceRef: opts.sourceRef } : {}),
    });
  }
  const runId = String((payload as { runId?: string }).runId ?? '');
  if (opts.wait && runId) {
    payload = await pollRun(client, runId, opts.interval ?? 2, opts.maxWait ?? 1800);
  }
  renderRunPayload(payload, opts);
}

async function runExample(
  agentId: string,
  opts: BaseOpts & {
    example: string;
    sourceRef?: string;
    wait?: boolean;
    interval: number;
    maxWait: number;
  }
) {
  const client = buildClient(opts);
  const started = (await client.post(`/api/v1/agents/${encodeURIComponent(agentId)}/experiments`, {
    exampleId: opts.example,
    ...(opts.sourceRef ? { sourceRef: opts.sourceRef } : {}),
  })) as { batchId?: string; runs?: Array<{ runId?: string; exampleId?: string }> };
  const runId = started.runs?.[0]?.runId;
  if (opts.wait && runId) {
    const payload = await pollRun(client, runId, opts.interval, opts.maxWait);
    return renderRunPayload(payload, opts);
  }
  const payload = {
    runId,
    exampleId: opts.example,
    batchId: started.batchId,
    status: 'pending',
  };
  if (opts.json) return printJson(payload);
  success(`Run ${runId ?? ''} queued for example ${opts.example}`);
}

async function getRun(executionId: string, opts: BaseOpts & { include?: string }) {
  const client = buildClient(opts);
  const payload = await client.get(`/api/v1/agents/runs/${encodeURIComponent(executionId)}`, {
    ...(opts.include ? { include: opts.include } : {}),
  });
  renderRunPayload(payload, opts);
}

async function rerunRun(
  executionId: string,
  opts: BaseOpts & { wait?: boolean; interval: number; maxWait: number }
) {
  const client = buildClient(opts);
  let payload: unknown = await client.post(
    `/api/v1/agents/runs/${encodeURIComponent(executionId)}/rerun`,
    {}
  );
  const rerunId = String((payload as { runId?: string }).runId ?? '');
  if (opts.wait && rerunId) {
    payload = await pollRun(client, rerunId, opts.interval, opts.maxWait);
    return renderRunPayload(payload, opts);
  }
  if (opts.json) return printJson(payload);
  success(`Started rerun ${ui.bold(rerunId)} from ${executionId}`);
}

async function pullRun(executionId: string, opts: BaseOpts & { include: string; out?: string }) {
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
  const payload = (await client.get(`/api/v1/agents/runs/${encodeURIComponent(executionId)}`, {
    include: [...include].join(','),
  })) as { run?: Record<string, unknown> };
  const run = payload.run;
  if (!run) throw new Error(`Run ${executionId} not found`);
  const out = path.resolve(opts.out ?? path.join('.eigenpal', 'artifacts', 'runs', executionId));
  await fs.mkdir(out, { recursive: true });
  const written: string[] = [];
  const skipped: string[] = [];
  const writeJsonArtifact = async (name: string, value: unknown) => {
    await fs.writeFile(path.join(out, name), JSON.stringify(value, null, 2));
    written.push(name);
  };
  await writeJsonArtifact('run.json', run);

  const feedback = run.feedback as Record<string, unknown> | null | undefined;
  if (include.has('feedback') && feedback) {
    await fs.writeFile(path.join(out, 'feedback.md'), serializeCliFeedback(feedback));
    written.push('feedback.md');
  } else if (include.has('feedback')) {
    skipped.push('feedback');
  }
  if (include.has('expected')) {
    written.push(...(await writeExpectedArtifacts(client, executionId, out, run)));
  }
  if (include.has('files') || include.has('output')) {
    written.push(...(await writeListedFiles(client, executionId, out, 'output', run.resultFiles)));
  }
  if (include.has('files') || include.has('input')) {
    written.push(...(await writeListedFiles(client, executionId, out, 'input', run.inputFiles)));
    if (run.inputJson) {
      await writeJsonArtifact('input.json', run.inputJson);
    } else {
      skipped.push('input.json');
    }
  }
  if (include.has('files') || include.has('metadata')) {
    if (run.metadata) {
      await writeJsonArtifact('metadata.json', run.metadata);
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
      run.issueFiles
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
      run.traceFiles
    );
    if (file) written.push(file);
    else skipped.push('trace.jsonl');
  }
  const summary = {
    runId: executionId,
    out,
    written,
    skipped,
    counts: {
      written: written.length,
      skipped: skipped.length,
    },
  };
  if (opts.json) return printJson(summary);
  success(`Pulled run ${executionId} to ${out}`);
  dim(
    `Wrote ${written.length} artifact${written.length === 1 ? '' : 's'}${
      skipped.length ? `; skipped missing ${skipped.join(', ')}` : ''
    }`
  );
}

async function listRunArtifacts(executionId: string, opts: BaseOpts) {
  const client = buildClient(opts);
  const payload = (await client.get(`/api/v1/agents/runs/${encodeURIComponent(executionId)}`, {
    include: 'expected,files,input,output,issues,trace,metadata',
  })) as { run?: Record<string, unknown> };
  const run = payload.run;
  if (!run) throw new Error(`Run ${executionId} not found`);
  const artifacts = runArtifactInventory(run);
  if (opts.json) return printJson({ runId: executionId, artifacts });
  console.log(
    table(artifacts, [
      { key: 'kind', header: 'KIND' },
      { key: 'name', header: 'NAME' },
      { key: 'present', header: 'PRESENT' },
    ])
  );
}

async function traceRun(executionId: string, opts: BaseOpts & { out?: string }) {
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

async function compareRun(
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
    `/api/v1/agents/runs/${encodeURIComponent(executionId)}`,
    { include: 'files,output' }
  )) as { run?: Record<string, unknown> };
  const target = targetPayload.run;
  if (!target) throw new Error(`Run ${executionId} not found`);

  const mode = opts.baseline ? 'baseline' : 'expected';
  const reference = (
    (await client.get(`/api/v1/agents/runs/${encodeURIComponent(referenceId)}`, {
      include: mode === 'baseline' ? 'files,output' : 'expected',
    })) as { run?: Record<string, unknown> }
  ).run;
  if (!reference) throw new Error(`Reference run ${referenceId} not found`);

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
      `Reference run ${referenceId} has no expected JSON or expected files; comparison has no baseline artifacts. Use --baseline to compare actual outputs.`
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
    { runId: referenceId, kind: mode === 'baseline' ? 'output' : 'expected' },
    { runId: executionId, kind: 'output' },
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
    runId: executionId,
    comparedWithRunId: referenceId,
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

async function listRuns(
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
      sourceRef?: string;
    }
) {
  const client = buildClient(opts);
  const params = buildRunListParams(opts);
  const payload = (await client.get(
    `/api/v1/agents/${encodeURIComponent(agentId)}/runs`,
    params
  )) as {
    runs: Record<string, unknown>[];
    total: number;
    scanLimited?: boolean;
    noResolvedAnchor?: boolean;
  };
  const rows = opts.compact ? payload.runs.map(compactRunRow) : payload.runs;
  if (opts.json) return printJson({ ...payload, runs: rows });
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

export function buildRunListParams<T extends object>(
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

async function updateRunFeedback(
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
    `/api/v1/agents/runs/${encodeURIComponent(executionId)}/feedback`,
    body
  );
  renderGeneric(payload, opts, `Updated feedback for ${executionId}`);
}

function compactRunRow(run: Record<string, unknown>) {
  const feedback =
    run.feedback && typeof run.feedback === 'object'
      ? (run.feedback as Record<string, unknown>)
      : null;
  return {
    id: run.id,
    status: run.status,
    exampleId: run.exampleId,
    feedback: feedback
      ? {
          rating: feedback.rating ?? null,
          status: feedback.status ?? null,
          updatedAt: feedback.updatedAt ?? null,
        }
      : null,
    hasExpectedJson: run.expected != null,
    expectedFileCount: Array.isArray(run.expectedFiles) ? run.expectedFiles.length : undefined,
    createdAt: run.createdAt,
    completedAt: run.completedAt,
  };
}

async function clearRunFeedback(executionId: string, opts: BaseOpts & { yes?: boolean }) {
  if (!(opts.yes || (await confirmTyped(executionId, 'clear feedback artifacts')))) {
    throw new Error('Clear cancelled');
  }
  const client = buildClient(opts);
  const payload = await client.delete(
    `/api/v1/agents/runs/${encodeURIComponent(executionId)}/feedback`
  );
  renderGeneric(payload, opts, `Cleared feedback for ${executionId}`);
}

async function listRunExpected(executionId: string, opts: BaseOpts) {
  const client = buildClient(opts);
  const payload = (await client.get(
    `/api/v1/agents/runs/${encodeURIComponent(executionId)}/expected`
  )) as { expected?: unknown; files?: Record<string, unknown>[] };
  if (opts.json) return printJson(payload);
  console.log(table(payload.files ?? [], [{ key: 'name', header: 'NAME' }]));
  if (payload.expected != null) dim('expected.json present');
}

async function pullRunExpected(executionId: string, opts: BaseOpts & { out?: string }) {
  const client = buildClient(opts);
  const payload = (await client.get(
    `/api/v1/agents/runs/${encodeURIComponent(executionId)}/expected`
  )) as { expected?: unknown; files?: Record<string, unknown>[] };
  const out = path.resolve(opts.out ?? path.join(executionId, 'expected'));
  await fs.mkdir(out, { recursive: true });
  if (payload.expected != null) {
    await fs.writeFile(path.join(out, 'expected.json'), JSON.stringify(payload.expected, null, 2));
  }
  await downloadExpectedFiles(client, executionId, out, payload.files);
  success(`Pulled expected artifacts for ${executionId} to ${out}`);
}

async function uploadRunExpected(
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
    `/api/v1/agents/runs/${encodeURIComponent(executionId)}/expected`,
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
    `/api/v1/agents/runs/${encodeURIComponent(executionId)}/expected`,
    { outputFileName: outputFile, ...(opts.name ? { expectedName: opts.name } : {}) }
  );
  renderGeneric(payload, opts, `Copied output file to expected for ${executionId}`);
}

async function renameRunExpected(
  executionId: string,
  oldName: string,
  newName: string,
  opts: BaseOpts
) {
  const client = buildClient(opts);
  const payload = await client.patch(
    `/api/v1/agents/runs/${encodeURIComponent(executionId)}/expected/${encodeURIComponent(oldName)}`,
    { name: newName }
  );
  renderGeneric(payload, opts, `Renamed expected file for ${executionId}`);
}

async function deleteRunExpected(
  executionId: string,
  name: string,
  opts: BaseOpts & { yes?: boolean }
) {
  if (!(opts.yes || (await confirmTyped(name, 'delete expected file')))) {
    throw new Error('Delete cancelled');
  }
  const client = buildClient(opts);
  await client.delete(
    `/api/v1/agents/runs/${encodeURIComponent(executionId)}/expected/${encodeURIComponent(name)}`
  );
  renderGeneric({ ok: true }, opts, `Deleted expected file ${name}`);
}

async function watchRunCommand(
  executionId: string,
  opts: BaseOpts & { interval: number; maxWait: number; json?: boolean }
) {
  const client = buildClient(opts);
  const payload = await pollRun(client, executionId, opts.interval, opts.maxWait);
  renderRunPayload(payload, opts);
}

async function cancelRun(executionId: string, opts: BaseOpts & { yes?: boolean }) {
  if (!(opts.yes || process.stdin.isTTY))
    throw new Error('Pass --yes to cancel in non-interactive mode');
  const client = buildClient(opts);
  const payload = await client.post(
    `/api/v1/agents/runs/${encodeURIComponent(executionId)}/cancel`,
    {}
  );
  renderRunPayload(payload, opts);
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

export async function validateAgentProject(
  root: string
): Promise<{ valid: boolean; errors: string[]; warnings: string[] }> {
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const [oldName] of LEGACY_LAYOUTS) {
    if (existsSync(path.join(root, oldName))) {
      errors.push(`Legacy layout ${oldName}/ is removed; use Git source under agents/<slug>/`);
    }
  }
  if (existsSync(path.join(root, 'agent.yaml'))) {
    errors.push('Legacy agent.yaml layout is removed; use eigenpal.yaml in a Git-backed package');
  }
  if (existsSync(path.join(root, 'agent'))) {
    errors.push('Legacy agent/ directory is removed; use Git source (eigenpal agents clone)');
  }
  const manifestPath = path.join(root, PACKAGE_MANIFEST);
  if (!existsSync(manifestPath)) {
    errors.push(`Missing ${PACKAGE_MANIFEST}`);
  } else {
    try {
      SourcePackageManifestSchema.parse(YAML.parse(await fs.readFile(manifestPath, 'utf8')));
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  if (!existsSync(path.join(root, 'AGENT.md'))) warnings.push('Missing AGENT.md');
  if (!existsSync(path.join(root, DATASET_DIR))) warnings.push(`Missing ${DATASET_DIR}/`);
  for (const filename of SCHEMA_FILENAMES) {
    const schemaPath = path.join(root, filename);
    if (!existsSync(schemaPath)) continue;
    const validation = validateWorkspaceSchema(await fs.readFile(schemaPath, 'utf8'), filename);
    for (const issue of validation.errors) {
      errors.push(`${filename}: ${issue}`);
    }
  }
  return { valid: errors.length === 0, errors, warnings };
}

export async function validateDatasetDir(
  dir: string,
  opts: { agentDir?: string } = {}
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];
  if (!existsSync(dir)) errors.push(`Missing dataset directory: ${dir}`);
  for (const [oldName, newName] of LEGACY_LAYOUTS) {
    if (path.basename(dir) === oldName) {
      errors.push(`Use ${newName}/ instead of legacy ${oldName}/`);
    }
  }
  if (errors.length > 0) return { valid: false, errors };

  const agentDir = opts.agentDir ?? process.cwd();
  const inputSchema = await loadOptionalWorkspaceSchema(agentDir, 'input-schema.json', errors);
  const outputSchema = await loadOptionalWorkspaceSchema(agentDir, 'output-schema.json', errors);
  if (errors.length > 0) return { valid: false, errors };

  const entries = await fs.readdir(dir, { withFileTypes: true });
  const examples = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const example of examples) {
    const exampleRoot = path.join(dir, example);
    if (inputSchema) {
      errors.push(...(await validateAgentDatasetInputExample(example, exampleRoot, inputSchema)));
    } else {
      await validateJsonObjectIfPresent(
        path.join(exampleRoot, AGENT_EXAMPLE_INPUT_JSON),
        `${example}/${AGENT_EXAMPLE_INPUT_JSON}`,
        errors
      );
    }
    if (outputSchema) {
      errors.push(
        ...(await validateAgentDatasetExpectedExample(example, exampleRoot, outputSchema))
      );
    } else {
      await validateJsonObjectIfPresent(
        path.join(exampleRoot, AGENT_EXAMPLE_EXPECTED_JSON),
        `${example}/${AGENT_EXAMPLE_EXPECTED_JSON}`,
        errors
      );
    }
  }
  return { valid: errors.length === 0, errors };
}

async function loadOptionalWorkspaceSchema(
  agentDir: string,
  filename: (typeof SCHEMA_FILENAMES)[number],
  errors: string[]
): Promise<Record<string, unknown> | null> {
  const schemaPath = path.join(agentDir, filename);
  if (!existsSync(schemaPath)) return null;
  const raw = await fs.readFile(schemaPath, 'utf8');
  const validation = validateWorkspaceSchema(raw, filename);
  for (const issue of validation.errors) errors.push(`${filename}: ${issue}`);
  if (!validation.valid) return null;
  return JSON.parse(raw) as Record<string, unknown>;
}

function schemaProperties(
  schema: Record<string, unknown>
): Record<string, Record<string, unknown>> {
  const props = schema.properties;
  if (!props || typeof props !== 'object' || Array.isArray(props)) return {};
  return props as Record<string, Record<string, unknown>>;
}

function schemaRequired(schema: Record<string, unknown>): Set<string> {
  return new Set(Array.isArray(schema.required) ? schema.required.filter(isString) : []);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isFileField(propSchema: unknown): boolean {
  if (!propSchema || typeof propSchema !== 'object' || Array.isArray(propSchema)) return false;
  const prop = propSchema as Record<string, unknown>;
  if (prop['x-eigenpal-type'] === 'file') return true;
  if (prop.type === 'array' && prop.items && typeof prop.items === 'object') {
    return (prop.items as Record<string, unknown>)['x-eigenpal-type'] === 'file';
  }
  return false;
}

async function validateAgentDatasetInputExample(
  example: string,
  exampleRoot: string,
  inputSchema: Record<string, unknown>
): Promise<string[]> {
  const errors: string[] = [];
  const props = schemaProperties(inputSchema);
  const required = schemaRequired(inputSchema);
  const inputDir = path.join(exampleRoot, 'input');
  const inputFiles = existsSync(inputDir)
    ? (await fs.readdir(inputDir, { withFileTypes: true }))
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
    : [];
  const matchedFiles = new Set<string>();

  for (const [fieldName, propSchema] of Object.entries(props)) {
    if (!isFileField(propSchema)) continue;
    const match = inputFiles.find((file) => file === fieldName || file.startsWith(`${fieldName}.`));
    if (match) {
      matchedFiles.add(match);
    } else if (required.has(fieldName)) {
      errors.push(
        `${example}/input: missing file for "${fieldName}" (expected ${fieldName} or ${fieldName}.*)`
      );
    }
  }

  const dataFields = Object.entries(props)
    .filter(([, propSchema]) => !isFileField(propSchema))
    .map(([fieldName]) => fieldName);
  const inputJsonPath = path.join(exampleRoot, AGENT_EXAMPLE_INPUT_JSON);
  let inputData: Record<string, unknown> | null = null;
  if (existsSync(inputJsonPath)) {
    inputData = await readJsonObject(
      inputJsonPath,
      `${example}/${AGENT_EXAMPLE_INPUT_JSON}`,
      errors
    );
  } else {
    const missingRequired = dataFields.filter((fieldName) => required.has(fieldName));
    if (missingRequired.length > 0) {
      errors.push(
        `${example}/${AGENT_EXAMPLE_INPUT_JSON}: missing file (needed for ${missingRequired.join(', ')})`
      );
    }
  }

  if (inputData) {
    for (const fieldName of dataFields) {
      if (required.has(fieldName) && !(fieldName in inputData)) {
        errors.push(`${example}/${AGENT_EXAMPLE_INPUT_JSON}: missing field "${fieldName}"`);
      }
    }
    for (const key of Object.keys(inputData)) {
      const propSchema = props[key];
      if (!propSchema) {
        errors.push(
          `${example}/${AGENT_EXAMPLE_INPUT_JSON}: extra field "${key}" not in input schema`
        );
      } else if (isFileField(propSchema)) {
        errors.push(
          `${example}/${AGENT_EXAMPLE_INPUT_JSON}: "${key}" is a file field; put it under input/`
        );
      } else {
        errors.push(
          ...validateValueAgainstSchema(
            inputData[key],
            propSchema,
            `${example}/${AGENT_EXAMPLE_INPUT_JSON}/${key}`
          )
        );
      }
    }
  }

  for (const file of inputFiles) {
    if (matchedFiles.has(file)) continue;
    const stem = file.includes('.') ? file.slice(0, file.indexOf('.')) : file;
    if (!props[stem] || !isFileField(props[stem])) {
      errors.push(`${example}/input: extra file "${file}" does not match a file input field`);
    }
  }

  return errors;
}

async function validateAgentDatasetExpectedExample(
  example: string,
  exampleRoot: string,
  outputSchema: Record<string, unknown>
): Promise<string[]> {
  const errors: string[] = [];
  const props = schemaProperties(outputSchema);
  const expectedPath = path.join(exampleRoot, AGENT_EXAMPLE_EXPECTED_JSON);
  const expectedDir = path.join(exampleRoot, 'expected');
  const goldenFiles = existsSync(expectedDir)
    ? (await fs.readdir(expectedDir, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
        .map((entry) => entry.name)
    : [];

  let expected: Record<string, unknown> | null = null;
  if (existsSync(expectedPath)) {
    expected = await readJsonObject(
      expectedPath,
      `${example}/${AGENT_EXAMPLE_EXPECTED_JSON}`,
      errors
    );
  } else if (goldenFiles.length === 0) {
    errors.push(
      `${example}: missing ${AGENT_EXAMPLE_EXPECTED_JSON} and no golden files under expected/`
    );
  }

  if (expected) {
    for (const [key, value] of Object.entries(expected)) {
      const propSchema = props[key];
      if (!propSchema) {
        errors.push(
          `${example}/${AGENT_EXAMPLE_EXPECTED_JSON}: extra field "${key}" not in output schema`
        );
        continue;
      }
      if (isFileField(propSchema) && filePlaceholderValue(value)) continue;
      errors.push(
        ...validateValueAgainstSchema(
          value,
          propSchema,
          `${example}/${AGENT_EXAMPLE_EXPECTED_JSON}/${key}`
        )
      );
    }
  }

  for (const file of goldenFiles) {
    const matched = Object.entries(props).some(
      ([fieldName, propSchema]) =>
        isFileField(propSchema) && goldenNameMatchesFileField(file, fieldName)
    );
    if (!matched) {
      errors.push(
        `${example}/expected: extra golden file "${file}" does not match a file output field`
      );
    }
  }

  return errors;
}

function filePlaceholderValue(value: unknown): boolean {
  if (value === '__any__') return true;
  return Array.isArray(value) && value.every((item) => item === '__any__');
}

function goldenNameMatchesFileField(goldenName: string, fieldName: string): boolean {
  if (goldenName === fieldName) return true;
  if (goldenName.startsWith(`${fieldName}.`)) return true;
  const dot = goldenName.indexOf('.');
  const stem = dot === -1 ? goldenName : goldenName.slice(0, dot);
  return stem === fieldName;
}

async function validateJsonObjectIfPresent(
  filePath: string,
  label: string,
  errors: string[]
): Promise<void> {
  if (!existsSync(filePath)) return;
  await readJsonObject(filePath, label, errors);
}

async function readJsonObject(
  filePath: string,
  label: string,
  errors: string[]
): Promise<Record<string, unknown> | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      errors.push(`${label}: must be a JSON object`);
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    errors.push(`${label}: invalid JSON — ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

function validateValueAgainstSchema(
  value: unknown,
  schema: Record<string, unknown>,
  label: string
): string[] {
  try {
    const validate = eigenpalAjv.compile(tightenObjectSchemas(schema) as Record<string, unknown>);
    if (validate(value)) return [];
    return (validate.errors ?? []).map((err) => {
      if (err.keyword === 'additionalProperties' && err.params?.additionalProperty) {
        return `${label}${err.instancePath}/${err.params.additionalProperty}: extra field not in schema`;
      }
      return `${label}${err.instancePath}: ${err.message ?? 'invalid'}`;
    });
  } catch (err) {
    return [`${label}: schema compile error — ${err instanceof Error ? err.message : String(err)}`];
  }
}

function tightenObjectSchemas(node: unknown): unknown {
  if (node === null || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map(tightenObjectSchemas);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) out[key] = tightenObjectSchemas(value);
  const type = out.type;
  const isObjectType = type === 'object' || (Array.isArray(type) && type.includes('object'));
  if (isObjectType && out.additionalProperties === undefined) out.additionalProperties = false;
  return out;
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
        `/api/v1/agents/runs/${encodeURIComponent(executionId)}/expected/${encodeURIComponent(name)}`
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
        `/api/v1/agents/runs/${encodeURIComponent(executionId)}/files/${kind}/${encodeURIComponent(name)}`
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
    `/api/v1/agents/runs/${encodeURIComponent(executionId)}/files/${kind}/${filename}`
  );
  await fs.writeFile(path.join(out, filename), Buffer.from(await response.arrayBuffer()));
  return filename;
}

async function downloadTraceText(client: ApiClient, executionId: string): Promise<string> {
  const response = await client.getStream(
    `/api/v1/agents/runs/${encodeURIComponent(executionId)}/files/trace/trace.jsonl`
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

function runArtifactInventory(run: Record<string, unknown>) {
  const rows: Array<{ kind: string; name: string; present: string }> = [
    { kind: 'metadata', name: 'run.json', present: 'yes' },
  ];
  if (run.inputJson != null) rows.push({ kind: 'input', name: 'input.json', present: 'yes' });
  if (run.metadata != null) rows.push({ kind: 'metadata', name: 'metadata.json', present: 'yes' });
  if (run.expected != null) rows.push({ kind: 'expected', name: 'expected.json', present: 'yes' });
  for (const name of fileNames(run.inputFiles)) rows.push({ kind: 'input', name, present: 'yes' });
  for (const name of fileNames(run.resultFiles).filter(
    (name) => name !== 'issues.md' && name !== 'trace.jsonl'
  )) {
    rows.push({ kind: 'output', name, present: 'yes' });
  }
  for (const name of fileNames(run.expectedFiles)) {
    rows.push({ kind: 'expected', name, present: 'yes' });
  }
  for (const name of fileNames(run.issueFiles)) rows.push({ kind: 'issues', name, present: 'yes' });
  for (const name of fileNames(run.traceFiles)) rows.push({ kind: 'trace', name, present: 'yes' });
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
  left: { runId: string; kind: 'expected' | 'output' },
  right: { runId: string; kind: 'output' },
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
    await downloadStreamToFile(client, runFileUrl(left, pair.expected), expectedPath);
    await downloadStreamToFile(client, runFileUrl(right, pair.output), outputPath);
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

function runFileUrl(side: { runId: string; kind: 'expected' | 'output' }, name: string): string {
  const runId = encodeURIComponent(side.runId);
  const filename = encodeURIComponent(name);
  return side.kind === 'expected'
    ? `/api/v1/agents/runs/${runId}/expected/${filename}`
    : `/api/v1/agents/runs/${runId}/files/output/${filename}`;
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

async function pollRun(client: ApiClient, executionId: string, interval: number, maxWait: number) {
  const started = Date.now();
  for (;;) {
    const payload = (await client.get(
      `/api/v1/agents/runs/${encodeURIComponent(executionId)}`
    )) as {
      run?: { status?: string };
    };
    if (isTerminal(payload.run?.status)) return payload;
    if (Date.now() - started > maxWait * 1000) {
      process.stderr.write(`Timed out waiting for run ${executionId}\n`);
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

function renderRunPayload(payload: unknown, opts: BaseOpts) {
  if (opts.json) return printJson(payload);
  const run = (payload as { run?: Record<string, unknown> }).run;
  if (!run) return printJson(payload);
  success(`Run ${run.id} is ${run.status}`);
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
