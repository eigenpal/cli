# eigenpal skill

> **Auto-generated.** This file is regenerated from the live Commander tree in
> `packages/cli/src/cli.ts` by `bun run --cwd packages/cli generate:cli-docs`.
> Do not hand-edit — your changes will be overwritten on the next run.

Install / uninstall / list the Eigenpal agent skill in your project (Claude Code, Cursor, Codex, Gemini CLI, Antigravity, OpenCode, Pi, Windsurf, GitHub Copilot).

## Contents

- [Surface](#surface)
- [Commands](#commands)
  - [Core](#core)
- [Details](#details)
  - [`eigenpal skill install [options]`](#eigenpal-skill-install-options)
  - [`eigenpal skill uninstall [options] [toolIds...]`](#eigenpal-skill-uninstall-options-toolids)
  - [`eigenpal skill list [options]`](#eigenpal-skill-list-options)

## Surface

```
skill
├── install
├── uninstall [toolIds...]
└── list
```

## Commands

### Core

| Command                                           | Description                                                                                                                                                                                        |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `eigenpal skill install [options]`                | Install the skill into one or more tools. Opens an interactive multiselect picker (toggle on to install, toggle off to uninstall) — pass `--tools` for non-interactive use.                        |
| `eigenpal skill uninstall [options] [toolIds...]` | Remove the skill from named tools (e.g. `skill uninstall claude cursor`), pass `--all` to wipe every install, or run with no args in a TTY for an interactive picker showing only installed tools. |
| `eigenpal skill list [options]`                   | Show every tool that has an Eigenpal skill installed in the current directory, with the CLI version that wrote it.                                                                                 |

## Details

### `eigenpal skill install [options]`

Install the skill into one or more tools. Opens an interactive multiselect picker (toggle on to install, toggle off to uninstall) — pass `--tools` for non-interactive use.

### Options

| Flag              | Required | Default | Description                                                                      |
| ----------------- | -------- | ------- | -------------------------------------------------------------------------------- |
| `--tools <ids>`   | no       |         | Comma-separated tool ids. Skips the picker; tools not listed are uninstalled.    |
| `--target <path>` | no       |         | Power-user override: install into a single custom directory and skip the picker. |
| `--force`         | no       |         | Overwrite user-edited files without prompting                                    |
| `--yes`           | no       |         | Non-interactive mode (keep currently installed tools, keep user edits)           |

### `eigenpal skill uninstall [options] [toolIds...]`

Remove the skill from named tools (e.g. `skill uninstall claude cursor`), pass `--all` to wipe every install, or run with no args in a TTY for an interactive picker showing only installed tools.

### Arguments

| Name      | Required | Variadic | Description |
| --------- | -------- | -------- | ----------- |
| `toolIds` | no       | yes      |             |

### Options

| Flag              | Required | Default | Description                                                                     |
| ----------------- | -------- | ------- | ------------------------------------------------------------------------------- |
| `--all`           | no       |         | Uninstall every tool that has an Eigenpal skill installed                       |
| `--target <path>` | no       |         | Power-user override: uninstall a single custom directory (skips tool detection) |
| `--yes`           | no       |         | Required for non-TTY shells; skips confirmation in TTY                          |

### `eigenpal skill list [options]`

Show every tool that has an Eigenpal skill installed in the current directory, with the CLI version that wrote it.

### Options

| Flag     | Required | Default | Description                                   |
| -------- | -------- | ------- | --------------------------------------------- |
| `--json` | no       |         | Emit machine-readable JSON instead of a table |
