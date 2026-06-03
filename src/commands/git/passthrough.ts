import path from 'node:path';

import { type CliConfig, resolveConfig } from '../../lib/config';
import { error } from '../../lib/ui';
import { configureSourceGitRepo, resolveGitAuthorEnv } from './source-git';
import { gitOutput, resolveGitRoot, runGit } from './source-state';

export type BaseOpts = { baseUrl?: string; json?: boolean };

function gitCommandCreatesObjects(args: string[]): boolean {
  const objectCreatingCommands = new Set([
    'cherry-pick',
    'commit',
    'merge',
    'rebase',
    'revert',
    'tag',
  ]);
  const command = gitSubcommandFromArgs(args);
  if (!command) return false;
  if (command === 'tag' && args.some((arg) => arg === '-l' || arg === '--list')) return false;
  return objectCreatingCommands.has(command);
}

function gitCwdFromArgs(args: string[]): string {
  let cwd = process.cwd();
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '-C' && args[i + 1]) {
      cwd = path.resolve(cwd, args[i + 1]);
      i += 1;
    }
  }
  return cwd;
}

function gitSubcommandFromArgs(args: string[]): string | null {
  const optionsWithValue = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace']);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--') continue;
    if (optionsWithValue.has(arg)) {
      i += 1;
      continue;
    }
    if (
      arg.startsWith('--git-dir=') ||
      arg.startsWith('--work-tree=') ||
      arg.startsWith('--namespace=')
    ) {
      continue;
    }
    if (arg.startsWith('-')) continue;
    return arg;
  }
  return null;
}

async function gitPassthrough(args: string[], config: CliConfig): Promise<void> {
  if (args.length === 0) {
    error('Pass Git arguments after `--`, for example `eigenpal git -- status`.');
    process.exit(2);
  }
  const cwd = gitCwdFromArgs(args);
  const remoteUrl = gitOutput(['remote', 'get-url', 'origin'], cwd);
  const gitRoot = resolveGitRoot(cwd);
  if (gitRoot && remoteUrl) await configureSourceGitRepo({ gitRoot, config, remoteUrl });
  runGit(args, {
    env: gitCommandCreatesObjects(args) ? await resolveGitAuthorEnv(config) : undefined,
  });
}

export async function runGitPassthroughFromArgv(argv: string[]): Promise<boolean> {
  const gitIndex = argv.indexOf('git');
  const separatorIndex = argv.indexOf('--', gitIndex + 1);
  if (gitIndex === -1 || separatorIndex === -1) return false;

  const beforeSeparator = argv.slice(gitIndex + 1, separatorIndex);
  const baseUrlIndex = beforeSeparator.indexOf('--base-url');
  const baseUrl =
    baseUrlIndex >= 0 && beforeSeparator[baseUrlIndex + 1]
      ? beforeSeparator[baseUrlIndex + 1]
      : undefined;
  await runGitPassthrough(argv.slice(separatorIndex + 1), { baseUrl });
  return true;
}

export function hasGitPassthroughSeparator(argv: string[]): boolean {
  const gitIndex = argv.indexOf('git');
  return gitIndex !== -1 && argv.indexOf('--', gitIndex + 1) !== -1;
}

export async function runGitPassthrough(args: string[], opts: BaseOpts): Promise<void> {
  await gitPassthrough(args, resolveConfig(opts));
}
