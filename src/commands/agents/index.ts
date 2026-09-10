import { type Command } from 'commander';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { action } from '../../lib/format-error';
import {
  isInteractiveStderr,
  requireTypedConfirmation,
  requireYesInNonInteractive,
} from '../../lib/non-interactive';
import {
  addJsonFlag,
  dim,
  error,
  formatTimestamp,
  success,
  table,
  ui,
  warn,
  withBaseUrl,
  withPagination,
  type PaginationOpts,
} from '../../lib/ui';
import { registerAgentSourceCommands, validateSourcePackage } from '../git';
import { fetchAutomation, parseAutomationDeleteResult } from '../workflow/lifecycle-shared';
import { registerDatasetCommands } from './dataset';
import { registerEnvCommands, registerSecretsExportCommands } from './env';
import { registerExperimentCommands } from './experiments';
import { registerAgentFileCommands } from './files';
import { registerSessionCommands } from './sessions';
import {
  BaseOpts,
  PACKAGE_MANIFEST,
  agentAutomationId,
  buildClient,
  compactParams,
  printJson,
} from './shared';
import { validateAgentProject } from './validation';

export { buildRunListParams, compareFileInventory, diffJson, runArtifactInventory } from '../runs';
export { sourcePathForInstalledPackage } from './env';
export { parseAgentTarget } from './target';
export { validateAgentProject, validateDatasetDir } from './validation';

export function registerAgentCommands(program: Command): void {
  const agent = program
    .command('agents')
    .description(
      'Manage Eigenpal agents: Git source, datasets, experiments, sessions, and releases.'
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

  addJsonFlag(withBaseUrl(agent.command('delete <agent-id-or-slug>')))
    .description('Delete an agent and its versions from the server.')
    .option('--yes', 'Skip typed-id confirmation (required in CI / agent terminals without a TTY)')
    .addHelpText(
      'after',
      `
Permanently deletes the agent implementation, versions, and builder sessions.
Unified prior runs remain in run history. This matches Studio agent deletion and
cannot be undone.

Pass \`--yes\` in scripts, CI, and agent terminals (non-TTY). In a TTY, type the
agent id (for example \`agents.invoice\`) to confirm.
`
    )
    .action(action(deleteAgent));

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

async function deleteAgent(
  agentRef: string,
  opts: BaseOpts & { yes?: boolean; json?: boolean }
): Promise<void> {
  requireYesInNonInteractive(opts.yes, 'delete agent');
  const automationId = agentAutomationId(agentRef);
  const client = buildClient(opts);
  const automation = await fetchAutomation(client, automationId);
  if (automation.type != null && automation.type !== 'agent') {
    throw new Error(
      `${automationId} is a workflow, not an agent. Use \`eigenpal workflow delete\` instead.`
    );
  }
  const confirmId = automationId;
  const label = automation.name ?? automation.slug ?? confirmId;
  warn(
    `This permanently deletes the agent "${label}", its versions, and builder sessions. Unified prior runs remain in run history. This cannot be undone.`
  );
  if (!opts.yes && isInteractiveStderr()) {
    await requireTypedConfirmation({
      id: confirmId,
      actionName: 'delete agent',
      cancelledMessage: 'Agent delete aborted',
    });
  }
  const result = await client.delete(`/v1/automations/${encodeURIComponent(automationId)}`);
  const parsed = parseAutomationDeleteResult(result);
  if (opts.json) {
    printJson({ ...parsed, id: automationId, slug: automation.slug ?? null });
    return;
  }
  success(`Deleted agent ${ui.bold(label)} ${ui.dim(`(${automationId})`)}`);
}

async function listAgents(opts: BaseOpts & PaginationOpts & { search?: string }) {
  const client = buildClient(opts);
  const payload = (await client.get('/v1/automations', {
    ...compactParams(opts),
    type: 'agent',
  })) as {
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
