import {
  SOURCE_SECRETS_FILENAME,
  SourceSecretsFileSchema,
  type EncryptedSecretValue,
  type SourceSecretsFile,
} from '@eigenpal/types';
import type { Command } from 'commander';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { ApiClient } from '../../lib/client';
import { requireApiKey, resolveConfig } from '../../lib/config';
import { action } from '../../lib/format-error';
import { success, ui } from '../../lib/ui';
import {
  readYamlFile,
  requirePackageContext,
  writeYamlFile,
  type ContextOpts,
} from './source-state';

type SecretOpts = ContextOpts & {
  stdin?: boolean;
  valueFile?: string;
  description?: string;
  baseUrl?: string;
};

function readSecretsFile(packageRoot: string): SourceSecretsFile {
  const filePath = path.join(packageRoot, SOURCE_SECRETS_FILENAME);
  if (!existsSync(filePath)) return { schemaVersion: 1, secrets: {} };
  return SourceSecretsFileSchema.parse(readYamlFile(filePath));
}

function writeSecretsFile(packageRoot: string, value: SourceSecretsFile): void {
  const secretsFile = SourceSecretsFileSchema.parse(value);
  writeYamlFile(path.join(packageRoot, SOURCE_SECRETS_FILENAME), secretsFile);
}

async function readSecretInput(opts: { stdin?: boolean; valueFile?: string }): Promise<string> {
  const selected = [opts.stdin, opts.valueFile].filter(Boolean).length;
  if (selected > 1) throw new Error('Pass only one of --stdin or --value-file.');
  if (opts.stdin) return readFileSync(0, 'utf8').replace(/\n$/, '');
  if (opts.valueFile) return readFileSync(opts.valueFile, 'utf8').replace(/\n$/, '');
  if (process.stdin.isTTY && process.stdout.isTTY) {
    const { password, isCancel, cancel } = await import('@clack/prompts');
    const answer = await password({ message: 'Secret value' });
    if (isCancel(answer)) {
      cancel('Cancelled');
      process.exit(1);
    }
    return String(answer);
  }
  throw new Error('Secret value input is required in noninteractive mode.');
}

async function encryptSecretsViaApi(
  client: ApiClient,
  secrets: Array<{ sourcePath: string; secretName: string; plaintext: string }>
): Promise<Record<string, EncryptedSecretValue>> {
  const payload = (await client.post('/api/v1/source/secrets/encrypt', { secrets })) as {
    secrets?: Record<string, EncryptedSecretValue>;
  };
  return payload.secrets ?? {};
}

async function setSecret(name: string, opts: SecretOpts): Promise<void> {
  const context = requirePackageContext(opts);
  const config = resolveConfig(opts);
  requireApiKey(config);
  const client = new ApiClient(config);
  const sourcePath = `${context.packagePath}/${SOURCE_SECRETS_FILENAME}`;
  const encryptedByName = await encryptSecretsViaApi(client, [
    {
      sourcePath,
      secretName: name,
      plaintext: await readSecretInput(opts),
    },
  ]);
  const encrypted = encryptedByName[name];
  if (!encrypted) throw new Error('Server did not return encrypted secret.');
  const secretsFile = readSecretsFile(context.packageRoot);
  const secrets = { ...secretsFile.secrets };
  secrets[name] = {
    ...(opts.description ? { description: opts.description } : {}),
    encrypted,
  };
  writeSecretsFile(context.packageRoot, { schemaVersion: 1, secrets });
  success(`Encrypted ${ui.bold(name)} into secrets.enc.yaml.`);
}

function unsetSecret(name: string, opts: ContextOpts): void {
  const context = requirePackageContext(opts);
  const secretsFile = readSecretsFile(context.packageRoot);
  const secrets = { ...secretsFile.secrets };
  delete secrets[name];
  writeSecretsFile(context.packageRoot, { schemaVersion: 1, secrets });
  success(`Removed ${ui.bold(name)} from secrets.enc.yaml.`);
}

async function importSecrets(envFile: string, opts: SecretOpts): Promise<void> {
  const context = requirePackageContext(opts);
  const config = resolveConfig(opts);
  requireApiKey(config);
  const client = new ApiClient(config);
  const sourcePath = `${context.packagePath}/${SOURCE_SECRETS_FILENAME}`;
  const entries: Array<{ sourcePath: string; secretName: string; plaintext: string }> = [];
  const content = readFileSync(envFile, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    entries.push({
      sourcePath,
      secretName: trimmed.slice(0, idx),
      plaintext: trimmed.slice(idx + 1),
    });
  }
  if (entries.length === 0) return;
  const encryptedByName = await encryptSecretsViaApi(client, entries);
  const secretsFile = readSecretsFile(context.packageRoot);
  const secrets = { ...secretsFile.secrets };
  for (const entry of entries) {
    const encrypted = encryptedByName[entry.secretName];
    if (!encrypted) {
      throw new Error(`Server did not return encrypted secret for ${entry.secretName}.`);
    }
    secrets[entry.secretName] = { encrypted };
  }
  writeSecretsFile(context.packageRoot, { schemaVersion: 1, secrets });
  success(`Imported ${ui.bold(String(entries.length))} secret(s) into secrets.enc.yaml.`);
}

export function registerSourceSecretCommands(agent: Command): void {
  const secret = agent.command('secret').description('Edit encrypted secrets.enc.yaml.');
  secret
    .command('set <name>')
    .description('Encrypt and set a secret value in secrets.enc.yaml.')
    .option('--dir <dir>', 'Directory to inspect')
    .option('--stdin', 'Read the secret value from stdin')
    .option('--value-file <path>', 'Read the secret value from a file')
    .option('--description <text>', 'Secret description')
    .action(action(setSecret));
  secret
    .command('unset <name>')
    .description('Remove a secret from secrets.enc.yaml.')
    .option('--dir <dir>', 'Directory to inspect')
    .action(action(async (name: string, opts: ContextOpts) => unsetSecret(name, opts)));
  secret
    .command('import <env-file>')
    .description('Import KEY=value entries from an env file into secrets.enc.yaml.')
    .option('--dir <dir>', 'Directory to inspect')
    .action(action(importSecrets));
}
