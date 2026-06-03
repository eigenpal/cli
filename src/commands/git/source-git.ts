import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { getProcessEnv } from '../../env';
import { ApiClient } from '../../lib/client';
import { requireApiKey, resolveSource, type CliConfig } from '../../lib/config';
import { readActiveCredentials } from '../../lib/credentials';

export type SourceRepository = { gitRepositoryPath: string; remoteUrl: string };
export type GitAuthorEnv = Pick<
  NodeJS.ProcessEnv,
  'GIT_AUTHOR_NAME' | 'GIT_AUTHOR_EMAIL' | 'GIT_COMMITTER_NAME' | 'GIT_COMMITTER_EMAIL'
>;
export type GitAuthorIdentity = { name: string; email: string };

const SourceRepositorySchema = z.object({
  gitRepositoryPath: z.string(),
  remoteUrl: z.string().url(),
});

const AuthCheckSchema = z.object({
  ok: z.literal(true),
  email: z.string().email().nullable().optional(),
  name: z.string().nullable().optional(),
  keyId: z.string(),
});

function gitOutput(args: string[], cwd?: string): string | null {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
  });
  if (result.status !== 0) return null;
  return result.stdout.trim();
}

function gitSucceeds(args: string[], cwd?: string): boolean {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
  });
  return result.status === 0;
}

function runGitStrict(args: string[], cwd?: string): void {
  const result = spawnSync('git', args, {
    cwd,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status && result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed with exit code ${result.status}`);
  }
}

function resolveGitRoot(dir: string): string | null {
  return gitOutput(['rev-parse', '--show-toplevel'], dir);
}

function normalizeGitRemoteUrl(remoteUrl: string): string {
  return remoteUrl.replace(/\/+$/, '');
}

export function sourceRepositoryFromRemoteUrl(remoteUrl?: string): SourceRepository | null {
  if (!remoteUrl) return null;
  const parsed = SourceRepositorySchema.safeParse({ gitRepositoryPath: '', remoteUrl });
  if (!parsed.success) return null;
  const match = parsed.data.remoteUrl.match(/\/orgs\/([^/]+)\.git$/);
  if (!match) return null;
  return {
    gitRepositoryPath: decodeURIComponent(match[1]),
    remoteUrl: parsed.data.remoteUrl,
  };
}

export function parseSourceRepository(value: unknown): SourceRepository {
  return SourceRepositorySchema.parse(value);
}

function isEigenpalGitRemote(remoteUrl?: string | null): remoteUrl is string {
  return Boolean(sourceRepositoryFromRemoteUrl(remoteUrl ?? undefined));
}

export function gitBootstrapAuthEnv(
  config: CliConfig,
  extra: NodeJS.ProcessEnv = {},
  remoteUrl?: string | null
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...getProcessEnv(),
    ...extra,
  };
  if (!remoteUrl || !isEigenpalGitRemote(remoteUrl)) return env;

  const basicToken = Buffer.from(`eigenpal:${requireApiKey(config)}`).toString('base64');
  return {
    ...env,
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: `http.${normalizeGitRemoteUrl(remoteUrl)}.extraHeader`,
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${basicToken}`,
  };
}

export async function resolveGitAuthorIdentity(config: CliConfig): Promise<GitAuthorIdentity> {
  const env = getProcessEnv();
  if (env.GIT_AUTHOR_NAME && env.GIT_AUTHOR_EMAIL) {
    return {
      name: env.GIT_AUTHOR_NAME,
      email: env.GIT_AUTHOR_EMAIL,
    };
  }

  const auth = AuthCheckSchema.parse(await new ApiClient(config).get('/api/v1/auth/check'));
  const email = auth.email ?? `${auth.keyId}@api-keys.eigenpal.local`;
  const name = auth.name?.trim() || auth.email || `Eigenpal API Key ${auth.keyId}`;
  return { name, email };
}

export function gitAuthorEnv(identity: GitAuthorIdentity): GitAuthorEnv {
  return {
    GIT_AUTHOR_NAME: identity.name,
    GIT_AUTHOR_EMAIL: identity.email,
    GIT_COMMITTER_NAME: identity.name,
    GIT_COMMITTER_EMAIL: identity.email,
  };
}

export async function resolveGitAuthorEnv(config: CliConfig): Promise<GitAuthorEnv> {
  const env = getProcessEnv();
  if (
    env.GIT_AUTHOR_NAME &&
    env.GIT_AUTHOR_EMAIL &&
    env.GIT_COMMITTER_NAME &&
    env.GIT_COMMITTER_EMAIL
  ) {
    return {
      GIT_AUTHOR_NAME: env.GIT_AUTHOR_NAME,
      GIT_AUTHOR_EMAIL: env.GIT_AUTHOR_EMAIL,
      GIT_COMMITTER_NAME: env.GIT_COMMITTER_NAME,
      GIT_COMMITTER_EMAIL: env.GIT_COMMITTER_EMAIL,
    };
  }
  return gitAuthorEnv(await resolveGitAuthorIdentity(config));
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function credentialHelperCommand(): string {
  const override = getProcessEnv().EIGENPAL_CLI_HELPER_COMMAND;
  if (override) return `!${override}`;

  const script = process.argv[1];
  if (script?.endsWith('/packages/cli/src/cli.ts')) {
    return `!${shellQuote(process.argv[0] ?? 'bun')} ${shellQuote(script)} git-credential-helper`;
  }

  return '!eigenpal git-credential-helper';
}

function currentProfileName(): string | undefined {
  const source = resolveSource();
  return source.apiKey === 'profile' ? source.profile : undefined;
}

async function configureAuthorIdentity(gitRoot: string, config: CliConfig): Promise<void> {
  const author = await resolveGitAuthorIdentity(config);
  if (!gitOutput(['config', '--local', '--get', 'user.name'], gitRoot)) {
    runGitStrict(['config', '--local', 'user.name', author.name], gitRoot);
  }
  if (!gitOutput(['config', '--local', '--get', 'user.email'], gitRoot)) {
    runGitStrict(['config', '--local', 'user.email', author.email], gitRoot);
  }
}

export async function configureSourceGitRepo(input: {
  gitRoot: string;
  config: CliConfig;
  remoteUrl?: string | null;
}): Promise<boolean> {
  const remoteUrl =
    input.remoteUrl ?? gitOutput(['remote', 'get-url', 'origin'], input.gitRoot) ?? null;
  if (!isEigenpalGitRemote(remoteUrl)) return false;

  const helperKey = `credential.${normalizeGitRemoteUrl(remoteUrl)}.helper`;

  // Reset inherited helpers for this URL so osxkeychain/GCM do not persist API keys.
  gitSucceeds(['config', '--local', '--unset-all', helperKey], input.gitRoot);
  runGitStrict(['config', '--local', helperKey, ''], input.gitRoot);
  runGitStrict(['config', '--local', '--add', helperKey, credentialHelperCommand()], input.gitRoot);
  runGitStrict(['config', '--local', 'credential.useHttpPath', 'true'], input.gitRoot);
  runGitStrict(
    ['config', '--local', 'eigenpal.gitRemoteUrl', normalizeGitRemoteUrl(remoteUrl)],
    input.gitRoot
  );

  const profile = currentProfileName();
  if (profile) runGitStrict(['config', '--local', 'eigenpal.profile', profile], input.gitRoot);
  await configureAuthorIdentity(input.gitRoot, input.config).catch(() => {});
  return true;
}

function parseCredentialHelperInput(input: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of input.split(/\r?\n/)) {
    if (!line) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    fields[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return fields;
}

function normalizeCredentialPath(pathValue?: string): string {
  return (pathValue ?? '').replace(/^\/+/, '').replace(/\/+$/, '');
}

function credentialRequestMatchesRemote(
  fields: Record<string, string>,
  remoteUrl: string
): boolean {
  const parsed = new URL(remoteUrl);
  if (!fields.protocol || fields.protocol !== parsed.protocol.replace(/:$/, '')) return false;
  if (!fields.host || fields.host !== parsed.host) return false;
  return normalizeCredentialPath(fields.path) === normalizeCredentialPath(parsed.pathname);
}

export function runSourceGitCredentialHelper(operation: string | undefined): void {
  if (operation && operation !== 'get') return;

  const gitRoot = resolveGitRoot(process.cwd());
  if (!gitRoot) return;

  const remoteUrl =
    gitOutput(['config', '--get', 'eigenpal.gitRemoteUrl'], gitRoot) ??
    gitOutput(['remote', 'get-url', 'origin'], gitRoot);
  if (!remoteUrl || !isEigenpalGitRemote(remoteUrl)) return;

  const fields = parseCredentialHelperInput(readFileSync(0, 'utf8'));
  if (!credentialRequestMatchesRemote(fields, normalizeGitRemoteUrl(remoteUrl))) return;

  const pinnedProfile = gitOutput(['config', '--get', 'eigenpal.profile'], gitRoot);
  const envApiKey = getProcessEnv().EIGENPAL_API_KEY;
  const apiKey = pinnedProfile
    ? readActiveCredentials(pinnedProfile)?.apiKey
    : (envApiKey ?? readActiveCredentials()?.apiKey);
  if (!apiKey) return;

  process.stdout.write(`username=eigenpal\npassword=${apiKey}\n\n`);
}
