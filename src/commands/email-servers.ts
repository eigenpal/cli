/**
 * `eigenpal email-servers` — manage tenant outbound email servers (ems_…).
 */

import type { EmailServer, TestEmailServerResponse } from '@eigenpal/types';
import type { Command } from 'commander';
import { apiPath } from '../lib/api-paths';
import { ApiClient } from '../lib/client';
import { requireApiKey, resolveConfig } from '../lib/config';
import {
  buildCreateRequest,
  buildUpdateRequest,
  formatEmailServerHuman,
  redactEmailServerPayload,
  type CreateFlagOpts,
  type UpdateFlagOpts,
} from '../lib/email-servers-cli';
import { action } from '../lib/format-error';
import {
  addJsonFlag,
  formatTimestamp,
  intArg,
  renderListResult,
  success,
  ui,
  withBaseUrl,
  withPagination,
  type PaginationOpts,
  type TableColumn,
} from '../lib/ui';

interface EmailServersCommandConfig {
  baseUrl?: string;
}

type EmailServerRow = EmailServer & Record<string, unknown>;

const LIST_COLUMNS: TableColumn<EmailServerRow>[] = [
  { key: 'id', header: 'id' },
  { key: 'name', header: 'name' },
  { key: 'transport', header: 'transport' },
  {
    key: 'enabled',
    header: 'enabled',
    format: (value) => (value ? 'yes' : 'no'),
  },
  { key: 'fromEmail', header: 'from' },
  {
    key: 'host',
    header: 'host',
    format: (_value, row) => (row.transport === 'smtp' ? String(row.host) : '-'),
  },
  {
    key: 'updatedAt',
    header: 'updated',
    format: (value) => formatTimestamp(value),
  },
];

function buildClient(opts: EmailServersCommandConfig): ApiClient {
  const config = resolveConfig(opts);
  requireApiKey(config);
  return new ApiClient(config);
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function sharedCreateOptions(cmd: Command): Command {
  return cmd
    .option(
      '--config-json <json>',
      'JSON object (non-secret fields only; use secret *-stdin/*-file flags)'
    )
    .option('--config-file <path>', 'JSON file path (`-` reads stdin; non-secret fields only)')
    .option('--name <name>', 'Display name')
    .option('--transport <kind>', 'Transport: resend or smtp')
    .option('--from-email <email>', 'From address')
    .option('--from-name <name>', 'From display name (no control characters or <>)')
    .option('--enabled', 'Enable the server (default on create)')
    .option('--disabled', 'Disable the server')
    .option('--host <host>', 'SMTP host (required on update when --transport smtp)')
    .option(
      '--port <n>',
      'SMTP port. Required on update when --transport smtp; create defaults from --security',
      intArg
    )
    .option(
      '--security <mode>',
      'SMTP security: starttls, tls, or none (unauthenticated trusted relays; credentials are rejected). Required on update when --transport smtp; create defaults to starttls'
    )
    .option('--username <user>', 'SMTP username (non-secret)')
    .option('--api-key-stdin', 'Read the Resend API key from stdin')
    .option('--api-key-file <path>', 'Read the Resend API key from a file (`-` for stdin)')
    .option('--password-stdin', 'Read the SMTP password from stdin')
    .option('--password-file <path>', 'Read the SMTP password from a file (`-` for stdin)')
    .option('--ca-pem-stdin', 'Read a custom SMTP CA PEM from stdin')
    .option('--ca-pem-file <path>', 'Read a custom SMTP CA PEM from a file (`-` for stdin)');
}

function sharedUpdateOptions(cmd: Command): Command {
  return sharedCreateOptions(cmd)
    .option('--clear-ca-pem', 'Remove a stored custom SMTP CA certificate')
    .option('--clear-username', 'Clear stored SMTP username/password pair');
}

const EMAIL_SERVERS_EXAMPLES = `
Examples:
  $ eigenpal email-servers list --json
  $ eigenpal email-servers get ems_... --json
  $ eigenpal email-servers create --transport resend --name Alerts \\
      --from-email alerts@example.com --from-name Alerts --api-key-stdin
  $ eigenpal email-servers create --transport smtp --name "Corp SMTP" --host smtp.example.com \\
      --from-email noreply@example.com --from-name Eigenpal
  $ eigenpal email-servers create --config-file ./resend.json --api-key-file ./re.key
  $ eigenpal email-servers update ems_... --name "Ops alerts"
  $ eigenpal email-servers update ems_... --transport smtp --host smtp.example.com \\
      --port 587 --security starttls --from-email noreply@example.com \\
      --from-name Eigenpal --password-stdin
  $ eigenpal email-servers delete ems_... --yes
  $ eigenpal email-servers test ems_... --to you@example.com

Secrets never belong on the command line. Provide Resend API keys, SMTP passwords,
and CA PEM material via --*-stdin, --*-file, or the secure TTY prompt.
`;

export function registerEmailServersCommands(program: Command): void {
  const emailServers = program
    .command('email-servers')
    .alias('email-server')
    .description(
      'Manage outbound email servers (ems_…): list, inspect, create, update, delete, and send a real test message.'
    )
    .addHelpText('after', EMAIL_SERVERS_EXAMPLES);

  const listCmd = emailServers
    .command('list')
    .description('List outbound email servers for the current workspace.');
  addJsonFlag(withBaseUrl(withPagination(listCmd))).action(
    action(async (opts: EmailServersCommandConfig & PaginationOpts & { json?: boolean }) => {
      const client = buildClient(opts);
      const raw = await client.get(apiPath('/email-servers'), {
        limit: String(opts.limit),
        offset: String(opts.offset),
      });
      renderListResult<EmailServerRow>(raw, LIST_COLUMNS, {
        json: opts.json,
        entityLabel: 'email server',
      });
    })
  );

  const getCmd = emailServers
    .command('get <id>')
    .description('Inspect one email server. Human output is redacted even if the API regresses.');
  addJsonFlag(withBaseUrl(getCmd)).action(
    action(async (id: string, opts: EmailServersCommandConfig & { json?: boolean }) => {
      const client = buildClient(opts);
      const raw = (await client.get(
        apiPath(`/email-servers/${encodeURIComponent(id)}`)
      )) as EmailServer;
      const redacted = redactEmailServerPayload(raw);
      if (opts.json) {
        printJson(redacted);
        return;
      }
      console.log(formatEmailServerHuman(redacted));
    })
  );

  const createCmd = emailServers
    .command('create')
    .description(
      'Create an outbound email server. Resend requires an API key; SMTP accepts optional username/password except with --security none, plus optional CA PEM, and defaults to starttls on port 587.'
    );
  addJsonFlag(withBaseUrl(sharedCreateOptions(createCmd))).action(
    action(async (opts: EmailServersCommandConfig & CreateFlagOpts & { json?: boolean }) => {
      const body = await buildCreateRequest(opts);
      const client = buildClient(opts);
      const created = (await client.post(apiPath('/email-servers'), body)) as EmailServer;
      const redacted = redactEmailServerPayload(created);
      if (opts.json) {
        printJson(redacted);
        return;
      }
      success(`Created ${ui.bold(redacted.id)} (${redacted.transport})`);
      console.log(formatEmailServerHuman(redacted));
    })
  );

  const updateCmd = emailServers
    .command('update <id>')
    .description(
      'Update metadata or replace transport configuration. Omitted secrets are retained. Passing --transport smtp requires --host, --port, --security, --from-email, and --from-name (no security/port defaults). Metadata-only updates omit --transport.'
    );
  addJsonFlag(withBaseUrl(sharedUpdateOptions(updateCmd))).action(
    action(
      async (id: string, opts: EmailServersCommandConfig & UpdateFlagOpts & { json?: boolean }) => {
        const client = buildClient(opts);
        const existing = (await client.get(
          apiPath(`/email-servers/${encodeURIComponent(id)}`)
        )) as EmailServer;
        const body = await buildUpdateRequest({ existing, opts });
        const updated = (await client.patch(
          apiPath(`/email-servers/${encodeURIComponent(id)}`),
          body
        )) as EmailServer;
        const redacted = redactEmailServerPayload(updated);
        if (opts.json) {
          printJson(redacted);
          return;
        }
        success(`Updated ${ui.bold(redacted.id)}`);
        console.log(formatEmailServerHuman(redacted));
      }
    )
  );

  const deleteCmd = emailServers
    .command('delete <id>')
    .description('Soft-delete an outbound email server.')
    .option('--yes', 'Required for non-TTY shells', false);
  addJsonFlag(withBaseUrl(deleteCmd)).action(
    action(
      async (id: string, opts: EmailServersCommandConfig & { yes: boolean; json?: boolean }) => {
        if (!opts.yes && !process.stdout.isTTY) {
          throw new Error(
            'email-servers delete is destructive and requires --yes when run non-interactively'
          );
        }
        const client = buildClient(opts);
        const result = await client.delete(apiPath(`/email-servers/${encodeURIComponent(id)}`));
        if (opts.json) {
          printJson(result);
          return;
        }
        success(`Deleted ${ui.bold(id)}`);
      }
    )
  );

  const testCmd = emailServers
    .command('test <id>')
    .description(
      'Send a real connectivity test email through the stored server to --to. Disabled servers fail with a conflict.'
    )
    .requiredOption('--to <email>', 'Recipient for the live test message');
  addJsonFlag(withBaseUrl(testCmd)).action(
    action(async (id: string, opts: EmailServersCommandConfig & { to: string; json?: boolean }) => {
      const client = buildClient(opts);
      const result = (await client.post(apiPath(`/email-servers/${encodeURIComponent(id)}/test`), {
        to: opts.to,
      })) as TestEmailServerResponse;
      if (opts.json) {
        printJson(result);
        if (!result.ok) process.exit(1);
        return;
      }
      if (result.ok) {
        success(`Test email sent via ${ui.bold(result.transport)} (${ui.dim(result.messageId)})`);
        return;
      }
      throw new Error(result.error);
    })
  );
}
