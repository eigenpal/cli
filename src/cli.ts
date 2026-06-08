#!/usr/bin/env node
import { Command } from 'commander';
import { realpathSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pkg from '../package.json' with { type: 'json' };
import { registerAgentCommands } from './commands/agents';
import { authList, authLogin, authLogout, authUse } from './commands/auth';
import { completion } from './commands/completion';
import {
  hasGitPassthroughSeparator,
  registerGitCommands,
  runGitPassthroughFromArgv,
} from './commands/git';
import { init } from './commands/init';
import { registerRunsCommands } from './commands/runs';
import { installSkillTools, listSkillTools, uninstallSkillTools } from './commands/skill';
import { status } from './commands/status';
import { registerWorkflowCommands } from './commands/workflow';
import { applyCommandAliasConventions } from './lib/command-aliases';
import { action } from './lib/format-error';
import { configureGroupedHelp } from './lib/help';
import { setQuiet } from './lib/ui';

const __filename = path.resolve(fileURLToPath(import.meta.url));

export const program = new Command();

// `0.0.0-placeholder` is the value in source — release.yml rewrites it to the
// real semver before publishing. If that ever leaks (someone runs the local
// dev build, or CI skips the pin step), render it as `dev` so it's obvious
// the binary on PATH isn't the npm-published one.
const cliVersion = pkg.version === '0.0.0-placeholder' ? 'dev' : pkg.version;

program
  .name('eigenpal')
  .description('Eigenpal CLI — AI workflows, evals, and experiments')
  .version(cliVersion, '-v, --version', 'Print the CLI version and exit')
  .option(
    '-q, --quiet',
    'Suppress informational status output (success/info/dim). Errors and warnings still print; --json output is unaffected.'
  )
  // To disable ANSI colors set the universal `NO_COLOR=1` env var (or
  // `FORCE_COLOR=0`) — picocolors honors both at module-load. We don't ship
  // a `--no-color` CLI flag because it would just be a verbose alias for the
  // env var that every modern terminal/CI already understands.
  // Commander hooks fire BEFORE every subcommand action, so this is the
  // right place to flip the quiet flag — `program.opts()` is populated by
  // the time we get here.
  .hook('preAction', () => {
    if (program.opts().quiet) setQuiet(true);
  });

program
  .command('status')
  .description(
    'One-shot dashboard: server, active tenant, user, key id, workflow count. Pair with `--json` for scripting.'
  )
  .option('--base-url <url>', 'Server base URL')
  .option('--json', 'Emit machine-readable JSON instead of human-readable text')
  // `action()` routes errors through `formatCliError` so HtmlResponseError,
  // ApiError 401, and connection failures all surface friendly hints
  // (instead of dumping a raw exception or an HTML response body).
  .action(action(async (opts: { baseUrl?: string; json?: boolean }) => status(opts)));

const initCmd = program
  .command('init [name]')
  .description(
    'Scaffold a new workflow project. Without `[name]`, scaffolds into the current directory using the cwd basename as the workflow name. With `[name]`, creates `./<name>/` and uses that as the slug. The flat layout matches what `workflow run <slug>` already discovers — no manual file moves.'
  )
  .option('--template <name>', 'Skip the picker; use this template')
  .option('--dir <dir>', 'Target directory (default: cwd if `[name]` omitted, else ./<name>)')
  .option('--yes', 'Non-interactive: pick the default template (blank)')
  .action(
    async (name: string | undefined, opts: { template?: string; dir?: string; yes?: boolean }) => {
      try {
        if (name) {
          await init(name, opts);
        } else {
          // Bare `eigenpal init` — scaffold into the cwd with the workflow
          // slug derived from the basename. Pair with `workflow run <basename>`
          // so a freshly-scaffolded folder runs without moves. If the cwd
          // basename isn't a valid slug, fall back to "my-workflow" so the
          // command still succeeds (rename later).
          const path = await import('node:path');
          const raw = path.basename(process.cwd());
          const slug = /^[a-z0-9][a-z0-9-_]*$/.test(raw) && raw.length <= 60 ? raw : 'my-workflow';
          await init(slug, { ...opts, dir: opts.dir ?? '.' });
        }
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    }
  );

// `init workflow <name>` — explicit workflow alias for the kind→noun command-tree shape.
// Agent packages are scaffolded through `agents init`, because they live in Git source.
initCmd
  .command('workflow <name>')
  .description(
    'Alias of `eigenpal init <name>`. Kept so the `init {workflow,agent}` namespace stays visible — once the agent surface lights up, both kinds will live as siblings here.'
  )
  .option('--template <name>', 'Skip the picker; use this template')
  .option('--dir <dir>', 'Target directory (default: ./<name>)')
  .option('--yes', 'Non-interactive: pick the default template (blank)')
  .action(async (name: string, opts: { template?: string; dir?: string; yes?: boolean }) => {
    try {
      await init(name, opts);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

const authCmd = program
  .command('auth')
  .description(
    'Manage authentication. Credentials live in ~/.config/eigenpal/credentials.json as named profiles. Switch tenants with `auth use <name>` or set `EIGENPAL_PROFILE=<name>` for one shell.'
  );

authCmd
  .command('login')
  .description(
    'Authenticate with Eigenpal. Opens a browser to create an API key, stores it under a profile named after the tenant, and makes that profile active. Re-running `login` against the same tenant updates the existing profile in place.'
  )
  .option('--base-url <url>', 'Server base URL', undefined)
  .addHelpText(
    'after',
    `
Examples:
  $ eigenpal auth login                                         # default: https://studio.eigenpal.com
  $ EIGENPAL_API_KEY=eig_live_… eigenpal status                 # CI: skip login entirely

Refuses to run inside CI (\`CI=true\` + non-TTY); set \`EIGENPAL_API_KEY\` (and
optionally \`EIGENPAL_BASE_URL\`) directly instead. Credentials persist to
\`~/.config/eigenpal/credentials.json\` as named profiles — switch with
\`eigenpal auth use <name>\` or set \`EIGENPAL_PROFILE=<name>\` per shell.
`
  )
  .action(async (opts: { baseUrl?: string }) => {
    await authLogin(opts.baseUrl);
  });

authCmd
  .command('logout [profile]')
  .description(
    'Remove a profile from the credentials file. Defaults to the active profile if no name is given. After removal the next available profile becomes active.'
  )
  .action(async (profile: string | undefined) => {
    await authLogout(profile);
  });

authCmd
  .command('list')
  .description('List configured profiles. The active one is marked ● — switch with `auth use`.')
  .action(async () => {
    await authList();
  });

authCmd
  .command('use [profile]')
  .description(
    'Switch the active profile (persistent across shells). Omit `[profile]` to pick from a list. For one-shot per-shell switching, set `EIGENPAL_PROFILE=<name>` instead.'
  )
  .action(async (profile: string | undefined) => {
    await authUse(profile);
  });

registerWorkflowCommands(program);
registerAgentCommands(program);
registerRunsCommands(program);
registerGitCommands(program);

program
  .command('completion <shell>')
  .description(
    'Print a shell completion script to stdout (supported shells: bash, zsh, fish). Pipe into the appropriate completion file for your shell — see the script header for install instructions.'
  )
  .action(async (shell: string) => {
    try {
      await completion(shell, program);
    } catch (err) {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    }
  });

// `skill` is a noun; install / uninstall / list are the verbs. Bare
// `eigenpal skill` is a usage error — exit 2 (POSIX "command exists but
// isn't usable as invoked") so misrouting CI scripts fail loud.
const skillCmd = program
  .command('skill')
  .description(
    'Install / uninstall / list the Eigenpal agent skill in your project (Claude Code, Cursor, Codex, Gemini CLI, Antigravity, OpenCode, Pi, Windsurf, GitHub Copilot).'
  )
  .action(() => {
    process.stderr.write(
      '`eigenpal skill` requires a subcommand: `install`, `uninstall`, or `list`.\nRun `eigenpal skill --help` to see options.\n'
    );
    process.exit(2);
  });

const SUPPORTED_TOOLS_BLOCK = `
Supported tools
  claude          Claude Code         → .claude/skills/eigenpal
  cursor          Cursor              → .cursor/skills/eigenpal
  codex           Codex               → .codex/skills/eigenpal
  gemini          Gemini CLI          → .gemini/skills/eigenpal
  antigravity     Antigravity         → .agent/skills/eigenpal
  opencode        OpenCode            → .opencode/skills/eigenpal
  pi              Pi                  → .pi/skills/eigenpal
  windsurf        Windsurf            → .windsurf/skills/eigenpal
  github-copilot  GitHub Copilot      → .github/skills/eigenpal
`;

skillCmd
  .command('install')
  .description(
    'Install the skill into one or more tools. Opens an interactive multiselect picker (toggle on to install, toggle off to uninstall) — pass `--tools` for non-interactive use.'
  )
  .option(
    '--tools <ids>',
    'Comma-separated tool ids. Skips the picker; tools not listed are uninstalled.'
  )
  .option(
    '--target <path>',
    'Power-user override: install into a single custom directory and skip the picker.'
  )
  .option('--force', 'Overwrite user-edited files without prompting')
  .option('--yes', 'Non-interactive mode (keep currently installed tools, keep user edits)')
  .addHelpText(
    'after',
    `${SUPPORTED_TOOLS_BLOCK}
Examples
  eigenpal skill install                              # interactive picker
  eigenpal skill install --tools claude,cursor --yes  # scripted install
  eigenpal skill install --tools "" --yes             # uninstall everything via install picker
`
  )
  .action(async (opts: { tools?: string; target?: string; force?: boolean; yes?: boolean }) => {
    try {
      await installSkillTools(opts);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

skillCmd
  .command('uninstall [toolIds...]')
  .description(
    'Remove the skill from named tools (e.g. `skill uninstall claude cursor`), pass `--all` to wipe every install, or run with no args in a TTY for an interactive picker showing only installed tools.'
  )
  .option('--all', 'Uninstall every tool that has an Eigenpal skill installed')
  .option(
    '--target <path>',
    'Power-user override: uninstall a single custom directory (skips tool detection)'
  )
  .option('--yes', 'Required for non-TTY shells; skips confirmation in TTY')
  .addHelpText(
    'after',
    `${SUPPORTED_TOOLS_BLOCK}
Examples
  eigenpal skill uninstall claude              # remove one
  eigenpal skill uninstall claude cursor       # remove several
  eigenpal skill uninstall --all --yes         # remove every install (CI / scripts)
  eigenpal skill uninstall                     # interactive picker (only installed tools shown)
`
  )
  .action(async (toolIds: string[], opts: { all?: boolean; target?: string; yes?: boolean }) => {
    try {
      await uninstallSkillTools({ toolIds, ...opts });
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

skillCmd
  .command('list')
  .description(
    'Show every tool that has an Eigenpal skill installed in the current directory, with the CLI version that wrote it.'
  )
  .option('--json', 'Emit machine-readable JSON instead of a table')
  .action((opts: { json?: boolean }) => {
    try {
      listSkillTools(opts);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

applyCommandAliasConventions(program);

// Only parse when this file is the entry point (e.g. `bun cli.ts` or via the
// installed `eigenpal` bin), not when imported for getCliHelpStructure.
// Resolve both sides through realpath because npm/bun install the bin as a
// symlink — without realpath, the published CLI silently exits with no output.
function isEntryPoint(): boolean {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === realpathSync(__filename);
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  configureGroupedHelp(program);
  if (hasGitPassthroughSeparator(process.argv)) {
    await runGitPassthroughFromArgv(process.argv);
    process.exit(0);
  }
  program.parse();
}
