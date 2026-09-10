import { type Command } from 'commander';
import { action } from '../../lib/format-error';
import {
  isInteractiveStderr,
  requireTypedConfirmation,
  requireYesInNonInteractive,
} from '../../lib/non-interactive';
import { addJsonFlag, dim, success, table, ui, warn, withBaseUrl } from '../../lib/ui';
import {
  buildFolderTree,
  ensureFolderPath,
  fetchWorkflowFolders,
  folderIdToPath,
  folderPathSegments,
  normalizeFolderPathInput,
  renderFolderTreeLines,
  resolveWorkflowFolderRef,
} from '../../lib/workflow-folders';
import { buildClient, printJson, type WorkflowCommandConfig } from './lifecycle-shared';

export function registerWorkflowFolderCommands(parent: Command): void {
  const folders = parent
    .command('folders')
    .description('Manage workflow folders (organize workflows in Studio).')
    .action(() => {
      process.stderr.write(
        '`eigenpal workflow folders` requires a subcommand. Run `eigenpal workflow folders --help`.\n'
      );
      process.exit(2);
    });

  addJsonFlag(withBaseUrl(folders.command('list')))
    .description('List workflow folders.')
    .option('--tree', 'Render folders as an indented tree')
    .action(action(listWorkflowFolders));

  addJsonFlag(withBaseUrl(folders.command('create <path>')))
    .description('Create a folder path, creating any missing parent segments.')
    .action(action(createWorkflowFolder));

  addJsonFlag(withBaseUrl(folders.command('rename <path-or-id>')))
    .description('Rename a workflow folder.')
    .requiredOption('--name <name>', 'New folder name')
    .action(action(renameWorkflowFolder));

  addJsonFlag(withBaseUrl(folders.command('delete <path-or-id>')))
    .description('Delete a workflow folder.')
    .option('--yes', 'Skip typed-id confirmation (required in CI / agent terminals without a TTY)')
    .addHelpText(
      'after',
      `
Deleting a folder removes its subfolders. Workflows inside are moved to the
root ("All workflows"), not deleted. This matches Studio folder deletion.
`
    )
    .action(action(deleteWorkflowFolder));
}

async function listWorkflowFolders(
  opts: WorkflowCommandConfig & { tree?: boolean; json?: boolean }
): Promise<void> {
  const client = buildClient(opts);
  const rows = await fetchWorkflowFolders(client, { tree: true });
  if (opts.json) {
    printJson({ data: rows, total: rows.length });
    return;
  }
  if (opts.tree) {
    const tree = buildFolderTree(rows);
    const lines = renderFolderTreeLines(tree);
    if (lines.length === 0) {
      dim('No workflow folders yet.');
      return;
    }
    console.log(lines.join('\n'));
    dim(`${rows.length} folder${rows.length === 1 ? '' : 's'} · use --json for the raw payload`);
    return;
  }
  console.log(
    table(rows, [
      { key: 'id', header: 'ID' },
      {
        key: 'name',
        header: 'NAME',
        format: (_v, row) => folderIdToPath(rows, row.id as string),
      },
      { key: 'workflowCount', header: 'WORKFLOWS', format: (v) => String(v ?? 0) },
      { key: 'childCount', header: 'SUBFOLDERS', format: (v) => String(v ?? 0) },
    ])
  );
  dim(`${rows.length} folder${rows.length === 1 ? '' : 's'} · use --tree for hierarchy`);
}

async function createWorkflowFolder(
  path: string,
  opts: WorkflowCommandConfig & { json?: boolean }
): Promise<void> {
  const client = buildClient(opts);
  const normalized = normalizeFolderPathInput(path);
  if (normalized === '/') {
    throw new Error('Cannot create the root folder. Omit the path or choose a name.');
  }
  const segments = folderPathSegments(path);
  if (segments.length === 0) {
    throw new Error('Folder path is required (for example billing/invoices).');
  }
  const folderId = await ensureFolderPath(client, path);
  const folders = await fetchWorkflowFolders(client, { tree: true });
  const folder = folders.find((f) => f.id === folderId);
  if (opts.json) {
    printJson(folder ?? { id: folderId, path: normalized });
    return;
  }
  success(`Created folder ${ui.bold(normalized)} ${ui.dim(`(${folderId})`)}`);
}

async function renameWorkflowFolder(
  pathOrId: string,
  opts: WorkflowCommandConfig & { name: string; json?: boolean }
): Promise<void> {
  const client = buildClient(opts);
  const folder = await resolveWorkflowFolderRef(client, pathOrId);
  const result = (await client.patch(`/v1/folders/${encodeURIComponent(folder.id)}`, {
    name: opts.name.trim(),
  })) as { id?: string; name?: string };
  if (opts.json) {
    printJson(result);
    return;
  }
  success(`Renamed folder ${ui.bold(folder.name)} → ${ui.bold(result.name ?? opts.name)}`);
}

async function deleteWorkflowFolder(
  pathOrId: string,
  opts: WorkflowCommandConfig & { yes?: boolean; json?: boolean }
): Promise<void> {
  requireYesInNonInteractive(opts.yes, 'delete workflow folder');
  const client = buildClient(opts);
  const folder = await resolveWorkflowFolderRef(client, pathOrId);
  const folders = await fetchWorkflowFolders(client, { tree: true });
  const pathLabel = folderIdToPath(folders, folder.id);
  warn(
    'Deleting this folder removes its subfolders. Workflows inside move to the root; they are not deleted.'
  );
  if (!opts.yes && isInteractiveStderr()) {
    await requireTypedConfirmation({
      id: folder.id,
      actionName: `delete folder "${pathLabel}"`,
      cancelledMessage: 'Folder delete aborted',
    });
  }
  await client.delete(`/v1/folders/${encodeURIComponent(folder.id)}`);
  if (opts.json) {
    printJson({ deleted: true, id: folder.id, path: pathLabel });
    return;
  }
  success(`Deleted folder ${ui.bold(pathLabel)}`);
}
