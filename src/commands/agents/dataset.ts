import { type Command } from 'commander';
import { zipSync } from 'fflate';
import { existsSync, promises as fs } from 'node:fs';
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
  BaseOpts,
  DATASET_DIR,
  agentAutomationId,
  buildClient,
  compactParams,
  confirmTyped,
  parseDatasetMode,
  printJson,
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
    .description('Upload dataset examples from a local dataset directory or zip archive.')
    .requiredOption('--file <path>', 'Dataset directory or .zip archive')
    .option('--mode <append|replace>', 'Upload mode', parseDatasetMode, 'append')
    .option('--yes', 'Confirm replace mode in non-interactive environments')
    .action(action(pushDataset));

  withBaseUrl(dataset.command('pull <agent-id-or-slug>'))
    .description('Download an agent dataset as a .zip archive.')
    .option('--out <path>', 'Output .zip path (default: dataset.zip)', DATASET_DIR)
    .action(action(pullDataset));

  addJsonFlag(dataset.command('validate [path]'))
    .description('Validate a local dataset directory against the agent input/output schemas.')
    .option('--agent-dir <dir>', 'Agent package directory containing input/output schemas', '.')
    .action(action(validateDatasetCommand));
}

async function listDataset(agentId: string, opts: BaseOpts & PaginationOpts) {
  const client = buildClient(opts);
  const payload = (await client.get(
    `/api/v1/automations/${encodeURIComponent(agentAutomationId(agentId))}/examples`,
    compactParams(opts)
  )) as { data?: Array<{ id?: string; name?: string }>; total: number };
  const examples = payload.data ?? [];
  if (opts.json) return printJson(payload);
  console.log(
    table(
      examples.map((row) => ({ id: row.id, name: row.name })),
      [
        { key: 'id', header: 'ID' },
        { key: 'name', header: 'NAME' },
      ]
    )
  );
  dim(
    `${examples.length}${payload.total > examples.length ? ` of ${payload.total}` : ''} examples · use --json for the raw payload`
  );
}

async function pushDataset(
  agentId: string,
  opts: BaseOpts & { file: string; mode: 'append' | 'replace'; yes?: boolean }
) {
  if (opts.mode === 'replace' && !(opts.yes || (await confirmTyped(agentId, 'replace dataset')))) {
    throw new Error('Dataset replace aborted');
  }
  const resolved = path.resolve(opts.file);
  const stat = await fs.stat(resolved);
  const archive: Uint8Array = stat.isDirectory()
    ? await readDirAsZip(resolved)
    : new Uint8Array(await fs.readFile(resolved));
  const form = new FormData();
  // DOM typings reject Uint8Array<ArrayBufferLike> under strict mode; the runtime
  // accepts it and the workflow dataset command uses the same cast.

  form.set(
    'file',
    new Blob([archive as unknown as BlobPart], { type: 'application/zip' }),
    stat.isDirectory() ? 'dataset.zip' : path.basename(resolved)
  );
  form.set('mode', opts.mode);
  const client = buildClient(opts);
  const payload = await client.postFormData(
    `/api/v1/automations/${encodeURIComponent(agentAutomationId(agentId))}/dataset/import`,
    form
  );
  if (opts.json) return printJson(payload);
  success(`${opts.mode === 'replace' ? 'Replaced' : 'Uploaded'} dataset archive`);
}

async function pullDataset(agentId: string, opts: BaseOpts & { out?: string }) {
  const client = buildClient(opts);
  const res = await client.getStream(
    `/api/v1/automations/${encodeURIComponent(agentAutomationId(agentId))}/dataset/export`
  );
  const archive = Buffer.from(await res.arrayBuffer());
  const out = path.resolve(opts.out ?? DATASET_DIR);
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out.endsWith('.zip') ? out : `${out}.zip`, archive);
  success(`Pulled dataset to ${ui.bold(out.endsWith('.zip') ? out : `${out}.zip`)}`);
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

async function readDirAsZip(dir: string): Promise<Uint8Array> {
  if (!existsSync(dir)) throw new Error(`directory does not exist: ${dir}`);
  const files: Record<string, Uint8Array> = {};
  async function walk(current: string, relPrefix: string): Promise<void> {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const absolute = path.join(current, entry.name);
      const relative = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(absolute, relative);
      else if (entry.isFile()) files[relative] = new Uint8Array(await fs.readFile(absolute));
    }
  }
  await walk(dir, '');
  if (Object.keys(files).length === 0) throw new Error(`directory is empty: ${dir}`);
  return zipSync(files);
}
