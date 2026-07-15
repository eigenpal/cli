import {
  SOURCE_SECRETS_FILENAME,
  SourcePackagePathSchema,
  SourceSecretsFileSchema,
  type EncryptedSecretValue,
} from '@eigenpal/types';
import { type Command } from 'commander';
import { existsSync, promises as fs, readFileSync } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { ApiClient, ApiError } from '../../lib/client';
import { action } from '../../lib/format-error';
import { warn, withBaseUrl } from '../../lib/ui';
import { BaseOpts, buildClient } from './shared';
import { parseAgentTarget } from './target';

type SourceLockPackage = {
  packagePath: string;
  resolvedRef: string;
  resolvedTag?: string;
  commit: string;
  dependencies: SourceLockPackage[];
};

export function registerEnvCommands(agent: Command): void {
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

export function registerSecretsExportCommands(agent: Command): void {
  // The `secrets` group (list/set/unset/import) is created by
  // registerSourceSecretCommands; attach `export` to it rather than
  // registering a second command with the same name.
  const secrets = agent.commands.find((command) => command.name() === 'secrets');
  if (!secrets) {
    throw new Error('registerSecretsExportCommands must run after registerSourceSecretCommands.');
  }

  withBaseUrl(secrets.command('export [target]'))
    .description('Decrypt source secrets and print shell exports.')
    .option('--dir <dir>', 'Installed agent package directory', '.')
    .option('--format <format>', 'Output format: shell or dotenv', 'shell')
    .action(action(pullAgentEnv));
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
