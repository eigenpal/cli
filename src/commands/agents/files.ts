import { type Command } from 'commander';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ApiError } from '../../lib/client';
import { action } from '../../lib/format-error';
import { addJsonFlag, error, success, table, ui, withBaseUrl } from '../../lib/ui';
import { BaseOpts, buildClient, printJson, writeBase64File } from './shared';

type FileDiffStatus = 'match' | 'different' | 'remote-missing';

export function registerAgentFileCommands(agent: Command): void {
  const file = agent
    .command('file')
    .description('List, download, and compare individual live agent files.')
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

  addJsonFlag(withBaseUrl(file.command('diff <agent-id-or-slug> <remote-path> <local-path>')))
    .description('Compare one live agent file against a local file.')
    .action(action(diffAgentFile));
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
