#!/usr/bin/env bun
/**
 * Regenerate per-command CLI docs under packages/cli/docs/ from the live
 * Commander tree in src/cli.ts. Walks the program graph, emits one
 * markdown file per top-level command. The package-level README at
 * packages/cli/README.md is hand-written (npm-facing) and is NOT touched
 * by this script.
 *
 * Output is fully derived from the schema — no hand-written prose. Re-run
 * after adding/renaming any command, option, or argument.
 *
 * Usage:
 *   bun packages/cli/scripts/generate-cli-docs.ts          # write
 *   bun packages/cli/scripts/generate-cli-docs.ts --check  # diff-only, exit 1 on drift
 */

import type { Command, Option } from 'commander';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as prettier from 'prettier';

import { program } from '../src/cli';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DOCS_DIR = join(__dirname, '..', 'docs');
const REPO_ROOT = join(__dirname, '..', '..', '..');

function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function commandDisplayName(cmd: Command): string {
  const alias = cmd.alias();
  return alias ? `${cmd.name()}|${alias}` : cmd.name();
}

function commandPath(cmd: Command): string {
  const segments: string[] = [];
  let current: Command | null = cmd;
  while (current && current.name() !== 'eigenpal') {
    segments.unshift(commandDisplayName(current));
    current = current.parent ?? null;
  }
  return segments.join(' ');
}

function visibleCommands(cmd: Command): Command[] {
  // commander stamps a hidden `help` command on every node; skip it.
  return cmd.commands.filter((c) => !c.hidden && c.name() !== 'help');
}

function visibleOptions(cmd: Command): Option[] {
  return (cmd.options as Option[]).filter((o) => !o.hidden);
}

function commandUsage(cmd: Command): string {
  const path = commandPath(cmd);
  const usage = cmd.usage();
  return `eigenpal ${path}${usage ? ' ' + usage : ''}`.trim();
}

function renderArgumentsTable(cmd: Command): string {
  const args = cmd.registeredArguments;
  if (args.length === 0) return '';
  const lines: string[] = [];
  lines.push('### Arguments');
  lines.push('');
  lines.push('| Name | Required | Variadic | Description |');
  lines.push('| --- | --- | --- | --- |');
  for (const arg of args) {
    const name = escapeCell(`\`${arg.name()}\``);
    const required = arg.required ? 'yes' : 'no';
    const variadic = arg.variadic ? 'yes' : 'no';
    const desc = escapeCell(arg.description || '');
    lines.push(`| ${name} | ${required} | ${variadic} | ${desc} |`);
  }
  lines.push('');
  return lines.join('\n');
}

function renderOptionsTable(cmd: Command): string {
  const opts = visibleOptions(cmd);
  if (opts.length === 0) return '';
  const lines: string[] = [];
  lines.push('### Options');
  lines.push('');
  lines.push('| Flag | Required | Default | Description |');
  lines.push('| --- | --- | --- | --- |');
  for (const opt of opts) {
    const flag = escapeCell(`\`${opt.flags}\``);
    const required = opt.mandatory ? 'yes' : 'no';
    const def =
      opt.defaultValue !== undefined ? escapeCell(`\`${JSON.stringify(opt.defaultValue)}\``) : '';
    const desc = escapeCell(opt.description || '');
    lines.push(`| ${flag} | ${required} | ${def} | ${desc} |`);
  }
  lines.push('');
  return lines.join('\n');
}

/** Walk the command tree, collecting every leaf (no further subcommands). */
function collectLeafCommands(cmd: Command): Command[] {
  const children = visibleCommands(cmd);
  if (children.length === 0) return [cmd];
  return children.flatMap(collectLeafCommands);
}

interface CommandGroup {
  /** Section heading — `Core`, `Versions`, `Evaluators`, … */
  label: string;
  /** Leaf commands belonging to this group (already ordered). */
  leaves: Command[];
}

/**
 * Group a top-level command's children into one bucket per sub-namespace.
 * Direct leaves (e.g. `workflow list`, `workflow validate`) collect under
 * "Core"; each sub-namespace (`workflow versions`, `workflow evaluators`, …)
 * becomes its own bucket so its commands stay together in both the index
 * table and the ToC.
 */
function groupCommandsByNamespace(root: Command): CommandGroup[] {
  const coreLeaves: Command[] = [];
  const namespaceGroups: CommandGroup[] = [];
  for (const child of visibleCommands(root)) {
    if (visibleCommands(child).length === 0) {
      coreLeaves.push(child);
    } else {
      namespaceGroups.push({
        label: titleCase(child.name()),
        leaves: collectLeafCommands(child),
      });
    }
  }
  // Core verbs (the bare workflow-level operations) come first; sub-namespaces
  // follow in registration order.
  return coreLeaves.length > 0
    ? [{ label: 'Core', leaves: coreLeaves }, ...namespaceGroups]
    : namespaceGroups;
}

function titleCase(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * GFM-style anchor slug for a heading. Lowercases, drops everything that
 * isn't a word char / whitespace / hyphen (covers backticks, angle and
 * square brackets, dots, etc.), then collapses whitespace runs to `-`.
 * Mirrors GitHub's auto-anchor behavior so internal links resolve when the
 * doc is browsed on github.com.
 */
function slugify(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

/**
 * Render the Commands section: one table per group. Within each group every
 * leaf command gets one row (full path + description).
 */
function renderCommandTables(groups: CommandGroup[]): string {
  const lines: string[] = [];
  lines.push('## Commands');
  lines.push('');
  for (const group of groups) {
    lines.push(`### ${group.label}`);
    lines.push('');
    lines.push('| Command | Description |');
    lines.push('| --- | --- |');
    for (const cmd of group.leaves) {
      lines.push(`| \`${commandUsage(cmd)}\` | ${escapeCell(cmd.description() || '')} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * Render a per-doc Table of Contents linking to Surface, every Commands
 * sub-group, and every Details entry. Uses GFM auto-anchors so it works on
 * github.com without explicit `<a>` tags.
 */
function renderTableOfContents(groups: CommandGroup[]): string {
  const lines: string[] = [];
  lines.push('## Contents');
  lines.push('');
  lines.push('- [Surface](#surface)');
  lines.push('- [Commands](#commands)');
  for (const group of groups) {
    lines.push(`  - [${group.label}](#${slugify(group.label)})`);
  }
  lines.push('- [Details](#details)');
  for (const group of groups) {
    for (const cmd of group.leaves) {
      const heading = commandUsage(cmd);
      lines.push(`  - [\`${heading}\`](#${slugify(heading)})`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

/** Render one detailed section per leaf command (description + args + opts). */
function renderCommandDetail(cmd: Command): string {
  const lines: string[] = [];
  lines.push(`### \`${commandUsage(cmd)}\``);
  lines.push('');
  if (cmd.description()) {
    lines.push(cmd.description());
    lines.push('');
  }
  const args = renderArgumentsTable(cmd);
  if (args) lines.push(args);
  const opts = renderOptionsTable(cmd);
  if (opts) lines.push(opts);
  return lines.join('\n');
}

/**
 * Strip `[options]` / `[command]` boilerplate from a command's usage string so
 * the ASCII tree shows just the command name + its meaningful argument
 * signature (e.g. `list <workflowId>`, `restore <workflowId> <versionId>`).
 */
function argSignature(cmd: Command): string {
  return cmd
    .usage()
    .replace(/\[options\]/g, '')
    .replace(/\[command\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Render a command + its descendants as a box-drawing tree. Nested namespaces
 * are surfaced visually so the reader sees the full surface at a glance,
 * before drilling into the detailed per-command tables below.
 */
function renderASCIITree(cmd: Command, prefix = '', isRoot = true): string {
  const lines: string[] = [];
  if (isRoot) lines.push(cmd.name());
  const children = visibleCommands(cmd);
  children.forEach((child, idx) => {
    const isLast = idx === children.length - 1;
    const branch = isLast ? '└── ' : '├── ';
    const childPrefix = isLast ? '    ' : '│   ';
    const sig = argSignature(child);
    lines.push(`${prefix}${branch}${commandDisplayName(child)}${sig ? ' ' + sig : ''}`);
    if (visibleCommands(child).length > 0) {
      lines.push(renderASCIITree(child, prefix + childPrefix, false));
    }
  });
  return lines.join('\n');
}

function renderTopLevelCommandFile(cmd: Command): string {
  const name = cmd.name();
  const lines: string[] = [];
  lines.push(`# eigenpal ${name}`);
  lines.push('');

  if (cmd.description()) {
    lines.push(cmd.description());
    lines.push('');
  }

  if (name === 'git') {
    lines.push('Experimental.');
    lines.push('');
    lines.push('This command namespace is intentionally not documented in detail yet.');
    lines.push('');
    return lines.join('\n');
  }

  const hasChildren = visibleCommands(cmd).length > 0;
  if (hasChildren) {
    const groups = groupCommandsByNamespace(cmd);

    // ToC, Surface, Commands (one table per group), Details (one section per
    // leaf, naturally clustered by registration order so namespace siblings
    // stay together).
    lines.push(renderTableOfContents(groups));
    lines.push('## Surface');
    lines.push('');
    lines.push('```');
    lines.push(renderASCIITree(cmd));
    lines.push('```');
    lines.push('');
    lines.push(renderCommandTables(groups));
    lines.push('## Details');
    lines.push('');
    for (const group of groups) {
      for (const leaf of group.leaves) {
        lines.push(renderCommandDetail(leaf));
      }
    }
  } else {
    // Leaf top-level command (e.g. `eigenpal status`) — render its
    // arguments + options inline, no ToC/surface wrapper.
    const args = renderArgumentsTable(cmd);
    if (args) lines.push(args);
    const opts = renderOptionsTable(cmd);
    if (opts) lines.push(opts);
  }

  return lines.join('\n').trimEnd() + '\n';
}

interface GeneratedFile {
  path: string;
  content: string;
}

async function collectFiles(): Promise<GeneratedFile[]> {
  // Resolve prettier config from the workspace root once; reuse for every
  // file. Markdown output is formatted inline so the on-disk files match
  // what `bun format` would produce — the generator stays the source of
  // truth and prettier never has to "fix" a freshly generated file.
  const prettierConfig = await prettier.resolveConfig(DOCS_DIR);
  const format = (raw: string): Promise<string> =>
    prettier.format(raw, { ...prettierConfig, parser: 'markdown' });

  const files: GeneratedFile[] = [];
  for (const cmd of visibleCommands(program)) {
    files.push({
      path: join(DOCS_DIR, `${cmd.name()}.md`),
      content: await format(renderTopLevelCommandFile(cmd)),
    });
  }
  return files;
}

function listExistingMarkdown(): string[] {
  if (!existsSync(DOCS_DIR)) return [];
  return readdirSync(DOCS_DIR)
    .filter((name) => name.endsWith('.md'))
    .map((name) => join(DOCS_DIR, name));
}

async function main(): Promise<void> {
  const check = process.argv.includes('--check');
  if (!existsSync(DOCS_DIR)) mkdirSync(DOCS_DIR, { recursive: true });

  const files = await collectFiles();
  const wanted = new Set(files.map((f) => f.path));
  const stale = listExistingMarkdown().filter((p) => !wanted.has(p));

  let drift = false;

  for (const file of files) {
    const original = existsSync(file.path) ? readFileSync(file.path, 'utf8') : '';
    if (original === file.content) continue;
    if (check) {
      drift = true;
      console.error(`✗ ${relative(REPO_ROOT, file.path)} is out of date.`);
      continue;
    }
    writeFileSync(file.path, file.content);
    console.log(`✓ wrote ${relative(REPO_ROOT, file.path)}`);
  }

  for (const stalePath of stale) {
    if (check) {
      drift = true;
      console.error(`✗ ${relative(REPO_ROOT, stalePath)} is stale (no matching command).`);
      continue;
    }
    unlinkSync(stalePath);
    console.log(`✓ removed ${relative(REPO_ROOT, stalePath)}`);
  }

  if (check && drift) {
    console.error('');
    console.error("Run 'bun run --cwd packages/cli generate:cli-docs' and commit the result.");
    process.exit(1);
  }
  if (!check) {
    console.log(`✓ CLI docs up to date (${files.length} files).`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
