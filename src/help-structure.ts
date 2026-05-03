/**
 * Walk the Commander program and return a structured help representation
 * (commands, options, subcommands as plain JSON). Exposed as a package
 * export for any tooling that wants to render the live CLI surface
 * programmatically.
 */

import type { Command, Option } from 'commander';

export interface CliOption {
  flags: string;
  description: string;
  defaultValue?: unknown;
}

export interface CliCommand {
  name: string;
  description: string;
  options: CliOption[];
  subcommands: CliCommand[];
}

function walkOptions(cmd: Command): CliOption[] {
  const options: CliOption[] = [];
  for (const opt of cmd.options) {
    const o = opt as Option;
    options.push({
      flags: o.flags ?? (o.long ? `--${o.long}` : ''),
      description: o.description ?? '',
      defaultValue: o.defaultValue,
    });
  }
  return options;
}

function walkCommand(cmd: Command): CliCommand {
  const subcommands: CliCommand[] = [];
  for (const sub of cmd.commands) {
    subcommands.push(walkCommand(sub));
  }
  return {
    name: cmd.name(),
    description: cmd.description() ?? '',
    options: walkOptions(cmd),
    subcommands,
  };
}

import { program } from './cli';

/**
 * Returns the full CLI help structure by walking the Commander program.
 * Uses the program from cli.ts so docs stay in sync with the actual CLI.
 */
export function getCliHelpStructure(): CliCommand {
  return walkCommand(program);
}
