/**
 * Grouped + colored help output for the top-level `eigenpal` command.
 *
 * Commander.js's default formatter dumps every command into a single
 * alphabetical list. With ~15 top-level commands that scrolls past the
 * first thing a new user wants — "what do I do first?" Grouping by
 * intent (auth, workflow ops, dataset ops, etc.) keeps that visible.
 *
 * Implementation: override `configureHelp({ formatHelp })` on the root
 * program. Subcommand `--help` (e.g. `eigenpal workflow --help`)
 * continues to use commander's default rendering — those surfaces are
 * already focused enough.
 */

import type { Command, Help } from 'commander';
import { getBanner } from './logo';
import { pc } from './ui';

export interface CommandGroup {
  title: string;
  description?: string;
  commands: string[];
}

/**
 * Order matters — sections render top-to-bottom in this order. This list should
 * cover every top-level command a user reaches for. Anything not listed falls
 * into a final "Other" bucket (so a new command never disappears silently),
 * which should hold only plumbing like `completion` and `git-credential-helper`.
 */
const HELP_GROUPS: CommandGroup[] = [
  {
    title: 'Get started',
    commands: ['init'],
  },
  {
    title: 'Authenticate',
    description: 'Profiles in ~/.config/eigenpal/credentials.json',
    commands: ['auth', 'status', 'models'],
  },
  {
    title: 'Workflows',
    description: 'Definition, evaluators, dataset, experiments, and versions',
    commands: ['workflow'],
  },
  {
    title: 'Agents',
    description:
      'Git-backed source (clone, save, release, sync), datasets, sessions. `git` passthrough adds org remote auth.',
    commands: ['agents', 'git'],
  },
  {
    title: 'Run',
    description: 'Start runs, then watch them, read their output, and download artifacts.',
    commands: ['run', 'rerun', 'runs'],
  },
  {
    title: 'Tooling',
    description: 'Install the Eigenpal skill into your agent tools (Claude Code, Cursor, …)',
    commands: ['skill'],
  },
];

function commandLine(cmd: Command, padTo: number): string {
  const usage = cmd.name() + (cmd.usage() ? ' ' + cmd.usage() : '');
  const description = cmd.description();
  const padded = pc.cyan(usage.padEnd(padTo));
  if (!description) return `  ${padded}`;
  // Wrap the description into the column to the right of the padded term
  // so long sentences read on multiple aligned lines instead of getting
  // truncated to 80 chars (`gh`, `cargo`, `kubectl` all do this).
  const indent = `  ${' '.repeat(padTo)}  `;
  const firstLineIndent = `  ${' '.repeat(padTo)}  `;
  const wrapped = wrap(description, indent.length);
  return `  ${padded}  ${pc.dim(wrapped[0] ?? '')}${wrapped
    .slice(1)
    .map((line) => `\n${firstLineIndent}${pc.dim(line)}`)
    .join('')}`;
}

function termWidth(): number {
  const cols = process.stdout.columns;
  return typeof cols === 'number' && cols > 40 ? cols : 100;
}

/**
 * Word-wrap `text` to fit within (terminal_width - leftIndent). Returns
 * an array of lines (no trailing newline). Single-token words longer
 * than the available width are kept whole — never break mid-word.
 */
function wrap(text: string, leftIndent: number): string[] {
  const width = Math.max(20, termWidth() - leftIndent);
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (current.length === 0) {
      current = word;
      continue;
    }
    if (current.length + 1 + word.length <= width) {
      current += ' ' + word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

/**
 * Apply the styled (and grouped on root) help formatter to every command
 * in the tree. Walk eagerly so all subcommands pick it up — commander
 * doesn't propagate `configureHelp` to children.
 */
export function configureGroupedHelp(program: Command): void {
  program.configureHelp({ formatHelp: rootFormatter });
  applyFlatStyledHelp(program);
}

function applyFlatStyledHelp(parent: Command): void {
  for (const child of parent.commands) {
    child.configureHelp({ formatHelp: subcommandFormatter });
    applyFlatStyledHelp(child);
  }
}

/**
 * Styled flat help for subcommands — colored sections, dim descriptions,
 * cyan command/option names. No grouping (subcommand surfaces are
 * already focused enough).
 */
function subcommandFormatter(cmd: Command, helper: Help): string {
  const lines: string[] = [];

  lines.push(pc.bold(`Usage: ${helper.commandUsage(cmd)}`));
  lines.push('');
  const description = helper.commandDescription(cmd);
  if (description) {
    lines.push(description);
    lines.push('');
  }

  const visibleArgs = helper.visibleArguments(cmd);
  if (visibleArgs.length > 0) {
    lines.push(pc.bold('Arguments'));
    const argWidth = Math.max(...visibleArgs.map((a) => helper.argumentTerm(a).length));
    for (const arg of visibleArgs) {
      const term = helper.argumentTerm(arg).padEnd(argWidth);
      const desc = helper.argumentDescription(arg);
      lines.push(`  ${pc.cyan(term)}  ${pc.dim(desc)}`);
    }
    lines.push('');
  }

  const visibleOptions = helper.visibleOptions(cmd);
  if (visibleOptions.length > 0) {
    lines.push(pc.bold('Options'));
    const optWidth = Math.max(...visibleOptions.map((o) => helper.optionTerm(o).length));
    for (const option of visibleOptions) {
      const term = helper.optionTerm(option).padEnd(optWidth);
      const desc = helper.optionDescription(option);
      lines.push(`  ${pc.cyan(term)}  ${pc.dim(desc)}`);
    }
    lines.push('');
  }

  const visibleCommands = helper.visibleCommands(cmd).filter((c) => c.name() !== 'help');
  if (visibleCommands.length > 0) {
    lines.push(pc.bold('Commands'));
    const cmdWidth = Math.max(...visibleCommands.map((c) => commandLineWidth(c)));
    for (const c of visibleCommands) {
      lines.push(commandLine(c, cmdWidth));
    }
    lines.push('');
  }

  return lines.join('\n');
}

function rootFormatter(cmd: Command, helper: Help): string {
  const lines: string[] = [];

  // Brand banner — only on TTYs to keep output piping (`eigenpal --help | grep`)
  // unaffected. Skipped automatically when stdout is redirected.
  if (process.stdout.isTTY) {
    lines.push(getBanner());
    lines.push('');
  }

  lines.push(pc.bold(`Usage: ${helper.commandUsage(cmd)}`));
  lines.push('');
  const description = helper.commandDescription(cmd);
  if (description) {
    lines.push(description);
    lines.push('');
  }

  // Options first (mostly --version, --help on root).
  const visibleOptions = helper.visibleOptions(cmd);
  if (visibleOptions.length > 0) {
    lines.push(pc.bold('Options'));
    const optWidth = Math.max(...visibleOptions.map((o) => helper.optionTerm(o).length));
    for (const option of visibleOptions) {
      const term = helper.optionTerm(option).padEnd(optWidth);
      const desc = helper.optionDescription(option);
      lines.push(`  ${pc.cyan(term)}  ${pc.dim(desc)}`);
    }
    lines.push('');
  }

  // Group commands by HELP_GROUPS; pool the rest into "Other".
  const allCommands = helper.visibleCommands(cmd);
  const byName = new Map(allCommands.map((c) => [c.name(), c] as const));
  const seen = new Set<string>();
  const padTo = Math.max(...allCommands.map((c) => commandLineWidth(c)));

  for (const group of HELP_GROUPS) {
    const groupCommands = group.commands
      .map((name) => byName.get(name))
      .filter((c): c is Command => c !== undefined);
    if (groupCommands.length === 0) continue;

    lines.push(pc.bold(group.title));
    if (group.description) lines.push(pc.dim(`  ${group.description}`));
    for (const c of groupCommands) {
      lines.push(commandLine(c, padTo));
      seen.add(c.name());
    }
    lines.push('');
  }

  const leftovers = allCommands.filter((c) => !seen.has(c.name()) && c.name() !== 'help');
  if (leftovers.length > 0) {
    lines.push(pc.bold('Other'));
    for (const c of leftovers) {
      lines.push(commandLine(c, padTo));
    }
    lines.push('');
  }

  lines.push(pc.dim('Run `eigenpal <command> --help` for more details on any command.'));
  lines.push('');
  return lines.join('\n');
}

function commandLineWidth(cmd: Command): number {
  return cmd.name().length + (cmd.usage() ? cmd.usage().length + 1 : 0);
}
