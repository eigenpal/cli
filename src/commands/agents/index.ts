import { type Command } from 'commander';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { action } from '../../lib/format-error';
import {
  addJsonFlag,
  dim,
  error,
  formatTimestamp,
  success,
  table,
  warn,
  withBaseUrl,
  withPagination,
  type PaginationOpts,
} from '../../lib/ui';
import { registerAgentSourceCommands, validateSourcePackage } from '../git';
import { registerDatasetCommands } from './dataset';
import { registerEnvCommands, registerSecretsExportCommands } from './env';
import { registerExperimentCommands } from './experiments';
import { registerAgentFileCommands } from './files';
import { registerSessionCommands } from './sessions';
import { BaseOpts, PACKAGE_MANIFEST, buildClient, compactParams, printJson } from './shared';
import { validateAgentProject } from './validation';

export { buildRunListParams, compareFileInventory, diffJson, runArtifactInventory } from '../runs';
export { sourcePathForInstalledPackage } from './env';
export { parseAgentTarget } from './target';
export { validateAgentProject, validateDatasetDir } from './validation';

export function registerAgentCommands(program: Command): void {
  const agent = program
    .command('agents')
    .description(
      'Manage Eigenpal agents: Git source, datasets, runs, experiments, sessions, and releases.'
    )
    .action(() => {
      process.stderr.write(
        '`eigenpal agents` requires a subcommand. Run `eigenpal agents --help`.\n'
      );
      process.exit(2);
    });

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
  registerExperimentCommands(agent);
  registerSessionCommands(agent);
  registerEnvCommands(agent);
  registerSecretsExportCommands(agent);
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
