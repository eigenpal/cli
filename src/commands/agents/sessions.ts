import { type Command } from 'commander';
import { action } from '../../lib/format-error';
import { addJsonFlag, table, withBaseUrl, withPagination, type PaginationOpts } from '../../lib/ui';
import { BaseOpts, buildClient, compactParams, printJson, renderGeneric } from './shared';

export function registerSessionCommands(agent: Command): void {
  const session = agent
    .command('session')
    .description('Manage agent builder sessions.')
    .action(() => {
      process.stderr.write(
        '`eigenpal agents session` requires a subcommand. Run `eigenpal agents session --help`.\n'
      );
      process.exit(2);
    });

  addJsonFlag(withPagination(withBaseUrl(session.command('list <agent-id-or-slug>')), 50))
    .description('List builder sessions for an agent.')
    .action(action(listSessions));

  addJsonFlag(withBaseUrl(session.command('get <session-id>')))
    .description('Get a builder session and messages.')
    .action(action(getSession));

  addJsonFlag(withBaseUrl(session.command('start <agent-id-or-slug>')))
    .description('Start a builder session.')
    .option('--title <title>', 'Session title')
    .action(action(startSession));

  addJsonFlag(withBaseUrl(session.command('message <session-id>')))
    .description('Append a message to a builder session.')
    .requiredOption('--text <message>', 'Message text')
    .option('--wait', 'Reserved; server acknowledges after enqueueing the message')
    .action(action(messageSession));

  addJsonFlag(withBaseUrl(session.command('stop <session-id>')))
    .description('Stop a builder session.')
    .option('--yes', 'Required in non-interactive environments')
    .action(action(stopSession));
}

async function listSessions(agentId: string, opts: BaseOpts & PaginationOpts) {
  const client = buildClient(opts);
  const payload = (await client.get(
    `/api/v1/agents/${encodeURIComponent(agentId)}/sessions`,
    compactParams(opts)
  )) as { sessions: Record<string, unknown>[] };
  if (opts.json) return printJson(payload);
  console.log(
    table(payload.sessions, [
      { key: 'id', header: 'ID' },
      { key: 'status', header: 'STATUS' },
      { key: 'title', header: 'TITLE' },
    ])
  );
}

async function getSession(sessionId: string, opts: BaseOpts) {
  const client = buildClient(opts);
  renderGeneric(
    await client.get(`/api/v1/agents/sessions/${encodeURIComponent(sessionId)}`),
    opts,
    `Session ${sessionId}`
  );
}

async function startSession(agentId: string, opts: BaseOpts & { title?: string }) {
  const client = buildClient(opts);
  renderGeneric(
    await client.post(`/api/v1/agents/${encodeURIComponent(agentId)}/sessions`, {
      ...(opts.title ? { title: opts.title } : {}),
    }),
    opts,
    'Started session'
  );
}

async function messageSession(sessionId: string, opts: BaseOpts & { text: string }) {
  const client = buildClient(opts);
  renderGeneric(
    await client.post(`/api/v1/agents/sessions/${encodeURIComponent(sessionId)}`, {
      text: opts.text,
    }),
    opts,
    'Sent message'
  );
}

async function stopSession(sessionId: string, opts: BaseOpts & { yes?: boolean }) {
  if (!(opts.yes || process.stdin.isTTY))
    throw new Error('Pass --yes to stop in non-interactive mode');
  const client = buildClient(opts);
  renderGeneric(
    await client.delete(`/api/v1/agents/sessions/${encodeURIComponent(sessionId)}`),
    opts,
    'Stopped session'
  );
}
