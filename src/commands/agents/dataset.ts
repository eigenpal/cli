import { type Command } from 'commander';
import path from 'node:path';
import { action } from '../../lib/format-error';
import {
  addJsonFlag,
  dim,
  error,
  success,
  table,
  ui,
  withBaseUrl,
  withPagination,
  type PaginationOpts,
} from '../../lib/ui';
import {
  AgentFile,
  BaseOpts,
  DATASET_DIR,
  buildClient,
  compactParams,
  confirmTyped,
  parseDatasetMode,
  printJson,
  readFilesUnder,
  writeBase64File,
} from './shared';
import { validateDatasetDir } from './validation';

export function registerDatasetCommands(agent: Command): void {
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
