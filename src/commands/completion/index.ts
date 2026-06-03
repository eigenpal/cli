/**
 * `eigenpal completion <bash|zsh|fish>` — emit a shell completion script
 * to stdout. Hand-rolled (zero deps) because the npm shell-completion
 * packages all add ~50KB and we have a small, stable command tree.
 *
 * Usage (after `npm install -g @eigenpal/cli`):
 *
 *   # bash
 *   eigenpal completion bash > /usr/local/etc/bash_completion.d/eigenpal
 *
 *   # zsh
 *   eigenpal completion zsh > "${fpath[1]}/_eigenpal"
 *   compinit
 *
 *   # fish
 *   eigenpal completion fish > ~/.config/fish/completions/eigenpal.fish
 *
 * The script is regenerated from the live `Command` tree at print time,
 * so adding a new subcommand or flag in the source automatically shows
 * up after the user re-runs `eigenpal completion <shell>`. Reference
 * shape: `gh completion`, `vercel completions`.
 */

import type { Command } from 'commander';

type Shell = 'bash' | 'zsh' | 'fish';

export function isShell(value: string): value is Shell {
  return value === 'bash' || value === 'zsh' || value === 'fish';
}

interface NodeInfo {
  /** Path of subcommand names from the root, e.g. `['workflow', 'execution']`. */
  path: string[];
  /** Subcommand names directly under this node (excludes `help`). */
  subcommands: string[];
  /** Long flags (`--foo`) declared on this node, including inherited globals. */
  flags: string[];
}

/**
 * Walk the Commander tree and flatten it into one entry per `Command`. Each
 * entry knows its full path, its direct child commands, and its long flags.
 * Used by the per-shell renderers below.
 */
function walk(root: Command): NodeInfo[] {
  const out: NodeInfo[] = [];
  // Commander v13's `Command.hidden` is a public field at runtime but not in
  // its public typings (until a future major bump fixes it). The docs
  // generator uses the same access pattern; mirror its cast.
  const isHidden = (cmd: Command): boolean =>
    Boolean((cmd as unknown as { hidden?: boolean }).hidden);
  const visit = (cmd: Command, path: string[]): void => {
    const subcommands = cmd.commands
      .filter((c) => c.name() !== 'help' && !isHidden(c))
      .map((c) => c.name())
      .sort();
    const flags = cmd.options
      .map((o) => o.long)
      .filter((flag): flag is string => Boolean(flag))
      .sort();
    // Always include `--help`; commander adds it implicitly.
    if (!flags.includes('--help')) flags.push('--help');
    out.push({ path, subcommands, flags });
    for (const child of cmd.commands) {
      if (child.name() === 'help' || isHidden(child)) continue;
      visit(child, [...path, child.name()]);
    }
  };
  visit(root, []);
  return out;
}

export function generateCompletionScript(program: Command, shell: Shell): string {
  const tree = walk(program);
  switch (shell) {
    case 'bash':
      return renderBash(program.name(), tree);
    case 'zsh':
      return renderZsh(program.name(), tree);
    case 'fish':
      return renderFish(program.name(), tree);
  }
}

// ---------------------------------------------------------------------------
// bash
// ---------------------------------------------------------------------------

function renderBash(programName: string, tree: NodeInfo[]): string {
  // Flatten the tree into a lookup keyed by the command path joined with " "
  // (matching how the bash function reads `${COMP_WORDS[@]}`). For each path
  // we emit the subcommands and flags as a single space-separated string.
  const cases = tree
    .map((node) => {
      const key = node.path.join(' ');
      const completions = [...node.subcommands, ...node.flags].join(' ');
      const pattern = key === '' ? '""' : `"${key}"`;
      return `    ${pattern})\n      COMPREPLY=( $(compgen -W "${completions}" -- "$cur") )\n      ;;`;
    })
    .join('\n');

  return `# bash completion for ${programName}
#
# Install:
#   ${programName} completion bash > /usr/local/etc/bash_completion.d/${programName}
#   # or, for the current shell:
#   source <(${programName} completion bash)

_${programName}_completions() {
  local cur prev words cword
  _init_completion -s 2>/dev/null || {
    cur="\${COMP_WORDS[COMP_CWORD]}"
    cword=$COMP_CWORD
    words=("\${COMP_WORDS[@]}")
  }

  # Build the path of subcommand tokens seen so far (skip flags and the
  # current word being typed).
  local path=""
  local i
  for ((i = 1; i < cword; i++)); do
    local w="\${words[i]}"
    [[ "$w" == -* ]] && continue
    if [[ -z "$path" ]]; then
      path="$w"
    else
      path="$path $w"
    fi
  done

  case "$path" in
${cases}
    *)
      COMPREPLY=()
      ;;
  esac
  return 0
}

complete -F _${programName}_completions ${programName}
`;
}

// ---------------------------------------------------------------------------
// zsh
// ---------------------------------------------------------------------------

function renderZsh(programName: string, tree: NodeInfo[]): string {
  // zsh's compsys is more powerful than bash's — but for consistency with
  // the bash output we use the same "current path → completions" lookup.
  const cases = tree
    .map((node) => {
      const key = node.path.join(' ');
      const completions = [...node.subcommands, ...node.flags].join(' ');
      const pattern = key === '' ? "''" : `'${key}'`;
      return `    ${pattern})\n      _values 'completion' ${completions
        .split(' ')
        .filter(Boolean)
        .map((tok) => `'${tok}'`)
        .join(' ')}\n      ;;`;
    })
    .join('\n');

  return `#compdef ${programName}
# zsh completion for ${programName}
#
# Install:
#   ${programName} completion zsh > "\${fpath[1]}/_${programName}"
#   # then restart your shell or run \`compinit\`

_${programName}() {
  local -a words
  local cword
  words=("\${(@)words}")
  cword=$CURRENT

  local path=""
  local i
  for ((i = 2; i < cword; i++)); do
    local w="\${words[i]}"
    [[ "$w" == -* ]] && continue
    if [[ -z "$path" ]]; then
      path="$w"
    else
      path="$path $w"
    fi
  done

  case "$path" in
${cases}
    *)
      ;;
  esac
}

compdef _${programName} ${programName}
`;
}

// ---------------------------------------------------------------------------
// fish
// ---------------------------------------------------------------------------

function renderFish(programName: string, tree: NodeInfo[]): string {
  // fish completions are declarative: one `complete` line per
  // (path, suggestion) pair. Use `__fish_seen_subcommand_from`-style guards
  // so suggestions only fire when the cursor is at the right depth.
  const lines: string[] = [`# fish completion for ${programName}`, '#'];
  lines.push(`# Install:`);
  lines.push(`#   ${programName} completion fish > ~/.config/fish/completions/${programName}.fish`);
  lines.push('');

  for (const node of tree) {
    // Build a condition that matches when (a) the previous tokens contain
    // the path's subcommand chain in order, and (b) the next non-flag word
    // hasn't been typed yet.
    const condition =
      node.path.length === 0
        ? `not __fish_seen_subcommand_from ${
            tree.find((n) => n.path.length === 0)?.subcommands.join(' ') ?? ''
          }`
        : `__fish_${programName}_using_path ${node.path.join(' ')}`;

    for (const sub of node.subcommands) {
      lines.push(`complete -c ${programName} -f -n '${condition}' -a '${sub}'`);
    }
    for (const flag of node.flags) {
      const long = flag.replace(/^--/, '');
      lines.push(`complete -c ${programName} -n '${condition}' -l '${long}'`);
    }
  }

  // Helper function that checks the current command-line tokens contain
  // the given subcommand chain, in order, with no other non-flag tokens
  // afterwards. Matches `__fish_seen_subcommand_from` for the leaf case.
  lines.push('');
  lines.push(`function __fish_${programName}_using_path`);
  lines.push('  set -l tokens (commandline -opc)');
  lines.push(`  set -l want $argv`);
  lines.push('  set -l ti 2');
  lines.push('  set -l wi 1');
  lines.push('  while test $wi -le (count $want)');
  lines.push('    if test $ti -gt (count $tokens)');
  lines.push('      return 1');
  lines.push('    end');
  lines.push('    set -l t $tokens[$ti]');
  lines.push('    if string match -q -- "-*" $t');
  lines.push('      set ti (math $ti + 1)');
  lines.push('      continue');
  lines.push('    end');
  lines.push('    if test $t != $want[$wi]');
  lines.push('      return 1');
  lines.push('    end');
  lines.push('    set ti (math $ti + 1)');
  lines.push('    set wi (math $wi + 1)');
  lines.push('  end');
  // After matching, no further non-flag token should be present (otherwise
  // we're past this path's depth).
  lines.push('  while test $ti -le (count $tokens)');
  lines.push('    set -l t $tokens[$ti]');
  lines.push('    if not string match -q -- "-*" $t');
  lines.push('      return 1');
  lines.push('    end');
  lines.push('    set ti (math $ti + 1)');
  lines.push('  end');
  lines.push('  return 0');
  lines.push('end');
  lines.push('');

  return lines.join('\n');
}

export async function completion(shell: string, program: Command): Promise<void> {
  if (!isShell(shell)) {
    process.stderr.write(`Unknown shell '${shell}'. Supported: bash, zsh, fish.\n`);
    process.exit(1);
  }
  const script = generateCompletionScript(program, shell);
  process.stdout.write(script);
  if (!script.endsWith('\n')) process.stdout.write('\n');
}
