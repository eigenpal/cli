# eigenpal agents

Manage Eigenpal agents: Git source, datasets, experiments, sessions, and releases.

## Contents

- [Surface](#surface)
- [Commands](#commands)
  - [Core](#core)
  - [File](#file)
  - [Secret](#secret)
  - [Dataset](#dataset)
  - [Experiment](#experiment)
  - [Session](#session)
  - [Env](#env)
  - [Secrets](#secrets)
- [Details](#details)
  - [`eigenpal agents list|ls [options]`](#eigenpal-agents-listls-options)
  - [`eigenpal agents validate [options] [dir]`](#eigenpal-agents-validate-options-dir)
  - [`eigenpal agents clone [options]`](#eigenpal-agents-clone-options)
  - [`eigenpal agents install [options] [packageRef]`](#eigenpal-agents-install-options-packageref)
  - [`eigenpal agents init [options] <name>`](#eigenpal-agents-init-options-name)
  - [`eigenpal agents pull [options]`](#eigenpal-agents-pull-options)
  - [`eigenpal agents commit [options]`](#eigenpal-agents-commit-options)
  - [`eigenpal agents save [options]`](#eigenpal-agents-save-options)
  - [`eigenpal agents push [options]`](#eigenpal-agents-push-options)
  - [`eigenpal agents upgrade [options]`](#eigenpal-agents-upgrade-options)
  - [`eigenpal agents doctor [options]`](#eigenpal-agents-doctor-options)
  - [`eigenpal agents status [options]`](#eigenpal-agents-status-options)
  - [`eigenpal agents deps [options]`](#eigenpal-agents-deps-options)
  - [`eigenpal agents clean [options]`](#eigenpal-agents-clean-options)
  - [`eigenpal agents show [options] <automation>`](#eigenpal-agents-show-options-automation)
  - [`eigenpal agents versions [options] <package>`](#eigenpal-agents-versions-options-package)
  - [`eigenpal agents release [options] <version> [dir]`](#eigenpal-agents-release-options-version-dir)
  - [`eigenpal agents sync [options] [automation]`](#eigenpal-agents-sync-options-automation)
  - [`eigenpal agents file list|ls [options] <agent-id-or-slug>`](#eigenpal-agents-file-listls-options-agent-id-or-slug)
  - [`eigenpal agents file get [options] <agent-id-or-slug> <remote-path>`](#eigenpal-agents-file-get-options-agent-id-or-slug-remote-path)
  - [`eigenpal agents file diff [options] <agent-id-or-slug> <remote-path> <local-path>`](#eigenpal-agents-file-diff-options-agent-id-or-slug-remote-path-local-path)
  - [`eigenpal agents secret set [options] <name>`](#eigenpal-agents-secret-set-options-name)
  - [`eigenpal agents secret unset [options] <name>`](#eigenpal-agents-secret-unset-options-name)
  - [`eigenpal agents secret import [options] <env-file>`](#eigenpal-agents-secret-import-options-env-file)
  - [`eigenpal agents dataset list|ls [options] <agent-id-or-slug>`](#eigenpal-agents-dataset-listls-options-agent-id-or-slug)
  - [`eigenpal agents dataset push [options] <agent-id-or-slug>`](#eigenpal-agents-dataset-push-options-agent-id-or-slug)
  - [`eigenpal agents dataset pull [options] <agent-id-or-slug>`](#eigenpal-agents-dataset-pull-options-agent-id-or-slug)
  - [`eigenpal agents dataset validate [options] [path]`](#eigenpal-agents-dataset-validate-options-path)
  - [`eigenpal agents experiment|exp run [options] <agent-id-or-slug>`](#eigenpal-agents-experimentexp-run-options-agent-id-or-slug)
  - [`eigenpal agents experiment|exp status [options] <agent-id-or-slug> <batch-id>`](#eigenpal-agents-experimentexp-status-options-agent-id-or-slug-batch-id)
  - [`eigenpal agents experiment|exp results [options] <agent-id-or-slug> [batch-id]`](#eigenpal-agents-experimentexp-results-options-agent-id-or-slug-batch-id)
  - [`eigenpal agents experiment|exp list|ls [options] <agent-id-or-slug>`](#eigenpal-agents-experimentexp-listls-options-agent-id-or-slug)
  - [`eigenpal agents experiment|exp compare|diff [options] <batch-id-a> <batch-id-b>`](#eigenpal-agents-experimentexp-comparediff-options-batch-id-a-batch-id-b)
  - [`eigenpal agents experiment|exp cancel [options] <agent-id-or-slug> <batch-id>`](#eigenpal-agents-experimentexp-cancel-options-agent-id-or-slug-batch-id)
  - [`eigenpal agents session list|ls [options] <agent-id-or-slug>`](#eigenpal-agents-session-listls-options-agent-id-or-slug)
  - [`eigenpal agents session get [options] <session-id>`](#eigenpal-agents-session-get-options-session-id)
  - [`eigenpal agents session start [options] <agent-id-or-slug>`](#eigenpal-agents-session-start-options-agent-id-or-slug)
  - [`eigenpal agents session message [options] <session-id>`](#eigenpal-agents-session-message-options-session-id)
  - [`eigenpal agents session stop [options] <session-id>`](#eigenpal-agents-session-stop-options-session-id)
  - [`eigenpal agents env pull [options] [target]`](#eigenpal-agents-env-pull-options-target)
  - [`eigenpal agents secrets export [options] [target]`](#eigenpal-agents-secrets-export-options-target)

## Surface

```
agents
├── list|ls
├── file
│   ├── list|ls <agent-id-or-slug>
│   ├── get <agent-id-or-slug> <remote-path>
│   └── diff <agent-id-or-slug> <remote-path> <local-path>
├── validate [dir]
├── clone
├── install [packageRef]
├── init <name>
├── pull
├── commit
├── save
├── push
├── upgrade
├── doctor
├── status
├── deps
├── clean
├── show <automation>
├── versions <package>
├── release <version> [dir]
├── sync [automation]
├── secret
│   ├── set <name>
│   ├── unset <name>
│   └── import <env-file>
├── dataset
│   ├── list|ls <agent-id-or-slug>
│   ├── push <agent-id-or-slug>
│   ├── pull <agent-id-or-slug>
│   └── validate [path]
├── experiment|exp
│   ├── run <agent-id-or-slug>
│   ├── status <agent-id-or-slug> <batch-id>
│   ├── results <agent-id-or-slug> [batch-id]
│   ├── list|ls <agent-id-or-slug>
│   ├── compare|diff <batch-id-a> <batch-id-b>
│   └── cancel <agent-id-or-slug> <batch-id>
├── session
│   ├── list|ls <agent-id-or-slug>
│   ├── get <session-id>
│   ├── start <agent-id-or-slug>
│   ├── message <session-id>
│   └── stop <session-id>
├── env
│   └── pull [target]
└── secrets
    └── export [target]
```

## Commands

### Core

| Command                                             | Description                                                                                                                                 |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `eigenpal agents list\|ls [options]`                | List agents.                                                                                                                                |
| `eigenpal agents validate [options] [dir]`          | Validate a local agent package (layout, manifest, schemas, and Git source rules).                                                           |
| `eigenpal agents clone [options]`                   | Clone the organization source repository.                                                                                                   |
| `eigenpal agents install [options] [packageRef]`    | Materialize a source package and its workspace dependencies.                                                                                |
| `eigenpal agents init [options] <name>`             | Create a new source package scaffold.                                                                                                       |
| `eigenpal agents pull [options]`                    | Pull organization source from origin/main with --ff-only. For datasets use agents dataset pull; for run artifacts use runs artifacts fetch. |
| `eigenpal agents commit [options]`                  | Validate changed source packages and commit them.                                                                                           |
| `eigenpal agents save [options]`                    | Validate, commit if dirty, and push the current source branch.                                                                              |
| `eigenpal agents push [options]`                    | Push the current organization source branch and tags.                                                                                       |
| `eigenpal agents upgrade [options]`                 | Upgrade the source repository schema in place.                                                                                              |
| `eigenpal agents doctor [options]`                  | Check organization source repository health.                                                                                                |
| `eigenpal agents status [options]`                  | Show source repo and package status.                                                                                                        |
| `eigenpal agents deps [options]`                    | List package workspace dependencies.                                                                                                        |
| `eigenpal agents clean [options]`                   | Require a clean source working tree.                                                                                                        |
| `eigenpal agents show [options] <automation>`       | Show Git-backed automation details.                                                                                                         |
| `eigenpal agents versions [options] <package>`      | List package release versions.                                                                                                              |
| `eigenpal agents release [options] <version> [dir]` | Create and push an immutable package release tag. Never move or overwrite an existing tag; release a new patch instead.                     |
| `eigenpal agents sync [options] [automation]`       | Sync an automation from the latest Git source release.                                                                                      |

### File

| Command                                                                             | Description                                       |
| ----------------------------------------------------------------------------------- | ------------------------------------------------- |
| `eigenpal agents file list\|ls [options] <agent-id-or-slug>`                        | List live files for an agent.                     |
| `eigenpal agents file get [options] <agent-id-or-slug> <remote-path>`               | Download one live agent file.                     |
| `eigenpal agents file diff [options] <agent-id-or-slug> <remote-path> <local-path>` | Compare one live agent file against a local file. |

### Secret

| Command                                              | Description                                                      |
| ---------------------------------------------------- | ---------------------------------------------------------------- |
| `eigenpal agents secret set [options] <name>`        | Encrypt and set a secret value in secrets.enc.yaml.              |
| `eigenpal agents secret unset [options] <name>`      | Remove a secret from secrets.enc.yaml.                           |
| `eigenpal agents secret import [options] <env-file>` | Import KEY=value entries from an env file into secrets.enc.yaml. |

### Dataset

| Command                                                         | Description                                                                |
| --------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `eigenpal agents dataset list\|ls [options] <agent-id-or-slug>` | List dataset examples for an agent.                                        |
| `eigenpal agents dataset push [options] <agent-id-or-slug>`     | Upload dataset examples from a local dataset directory or zip archive.     |
| `eigenpal agents dataset pull [options] <agent-id-or-slug>`     | Download an agent dataset as a .zip archive.                               |
| `eigenpal agents dataset validate [options] [path]`             | Validate a local dataset directory against the agent input/output schemas. |

### Experiment

| Command                                                                             | Description                                      |
| ----------------------------------------------------------------------------------- | ------------------------------------------------ |
| `eigenpal agents experiment\|exp run [options] <agent-id-or-slug>`                  | Start an experiment over dataset examples.       |
| `eigenpal agents experiment\|exp status [options] <agent-id-or-slug> <batch-id>`    | Get experiment status.                           |
| `eigenpal agents experiment\|exp results [options] <agent-id-or-slug> [batch-id]`   | Print experiment results as JSON or CSV.         |
| `eigenpal agents experiment\|exp list\|ls [options] <agent-id-or-slug>`             | List experiments.                                |
| `eigenpal agents experiment\|exp compare\|diff [options] <batch-id-a> <batch-id-b>` | Diff eval scores between two experiment batches. |
| `eigenpal agents experiment\|exp cancel [options] <agent-id-or-slug> <batch-id>`    | Cancel every active execution in an experiment.  |

### Session

| Command                                                         | Description                            |
| --------------------------------------------------------------- | -------------------------------------- |
| `eigenpal agents session list\|ls [options] <agent-id-or-slug>` | List builder sessions for an agent.    |
| `eigenpal agents session get [options] <session-id>`            | Get a builder session and messages.    |
| `eigenpal agents session start [options] <agent-id-or-slug>`    | Start a builder session.               |
| `eigenpal agents session message [options] <session-id>`        | Append a message to a builder session. |
| `eigenpal agents session stop [options] <session-id>`           | Stop a builder session.                |

### Env

| Command                                       | Description                                     |
| --------------------------------------------- | ----------------------------------------------- |
| `eigenpal agents env pull [options] [target]` | Decrypt source secrets and print shell exports. |

### Secrets

| Command                                             | Description                                     |
| --------------------------------------------------- | ----------------------------------------------- |
| `eigenpal agents secrets export [options] [target]` | Decrypt source secrets and print shell exports. |

## Details

### `eigenpal agents list|ls [options]`

List agents.

### Options

| Flag               | Required | Default | Description                            |
| ------------------ | -------- | ------- | -------------------------------------- |
| `--base-url <url>` | no       |         | Server base URL                        |
| `--limit <n>`      | no       | `50`    | Page size                              |
| `--offset <n>`     | no       | `0`     | Page offset                            |
| `--json`           | no       |         | Output the raw server response as JSON |
| `--search <q>`     | no       |         | Search by slug, name, or description   |

### `eigenpal agents validate [options] [dir]`

Validate a local agent package (layout, manifest, schemas, and Git source rules).

### Arguments

| Name  | Required | Variadic | Description |
| ----- | -------- | -------- | ----------- |
| `dir` | no       | no       |             |

### Options

| Flag     | Required | Default | Description                            |
| -------- | -------- | ------- | -------------------------------------- |
| `--json` | no       |         | Output the raw server response as JSON |

### `eigenpal agents clone [options]`

Clone the organization source repository.

### Options

| Flag                     | Required | Default | Description                                    |
| ------------------------ | -------- | ------- | ---------------------------------------------- |
| `--base-url <url>`       | no       |         | Server base URL                                |
| `--out <dir>`            | no       |         | Output directory                               |
| `--tenant-id <tenantId>` | no       |         | Target tenant id for admin-token source clones |

### `eigenpal agents install [options] [packageRef]`

Materialize a source package and its workspace dependencies.

### Arguments

| Name         | Required | Variadic | Description |
| ------------ | -------- | -------- | ----------- |
| `packageRef` | no       | no       |             |

### Options

| Flag                 | Required | Default | Description                                  |
| -------------------- | -------- | ------- | -------------------------------------------- |
| `--base-url <url>`   | no       |         | Server base URL                              |
| `--out <dir>`        | no       |         | Output directory for an explicit package ref |
| `--lockfile <path>`  | no       |         | Lockfile path                                |
| `--frozen-lockfile`  | no       |         | Install exactly from the existing lockfile   |
| `--remote-url <url>` | no       |         | Use an explicit organization Git remote URL  |

### `eigenpal agents init [options] <name>`

Create a new source package scaffold.

### Arguments

| Name   | Required | Variadic | Description |
| ------ | -------- | -------- | ----------- |
| `name` | yes      | no       |             |

### Options

| Flag                    | Required | Default | Description          |
| ----------------------- | -------- | ------- | -------------------- |
| `--template <template>` | yes      |         | Package template     |
| `--dir <dir>`           | no       |         | Repository directory |

### `eigenpal agents pull [options]`

Pull organization source from origin/main with --ff-only. For datasets use agents dataset pull; for run artifacts use runs artifacts fetch.

### Options

| Flag               | Required | Default | Description          |
| ------------------ | -------- | ------- | -------------------- |
| `--base-url <url>` | no       |         | Server base URL      |
| `--dir <dir>`      | no       |         | Repository directory |

### `eigenpal agents commit [options]`

Validate changed source packages and commit them.

### Options

| Flag                      | Required | Default | Description          |
| ------------------------- | -------- | ------- | -------------------- |
| `--base-url <url>`        | no       |         | Server base URL      |
| `-m, --message <message>` | yes      |         | Commit message       |
| `--dir <dir>`             | no       |         | Repository directory |

### `eigenpal agents save [options]`

Validate, commit if dirty, and push the current source branch.

### Options

| Flag                      | Required | Default | Description                                  |
| ------------------------- | -------- | ------- | -------------------------------------------- |
| `--base-url <url>`        | no       |         | Server base URL                              |
| `-m, --message <message>` | no       |         | Commit message when source changes are dirty |
| `--dir <dir>`             | no       |         | Repository directory                         |

### `eigenpal agents push [options]`

Push the current organization source branch and tags.

### Options

| Flag               | Required | Default | Description          |
| ------------------ | -------- | ------- | -------------------- |
| `--base-url <url>` | no       |         | Server base URL      |
| `--dir <dir>`      | no       |         | Repository directory |

### `eigenpal agents upgrade [options]`

Upgrade the source repository schema in place.

### Options

| Flag          | Required | Default | Description                                  |
| ------------- | -------- | ------- | -------------------------------------------- |
| `--dir <dir>` | no       |         | Repository directory                         |
| `--dry-run`   | no       |         | Print upgrade actions without changing files |

### `eigenpal agents doctor [options]`

Check organization source repository health.

### Options

| Flag          | Required | Default | Description                            |
| ------------- | -------- | ------- | -------------------------------------- |
| `--json`      | no       |         | Output the raw server response as JSON |
| `--dir <dir>` | no       |         | Directory to inspect                   |

### `eigenpal agents status [options]`

Show source repo and package status.

### Options

| Flag          | Required | Default | Description                            |
| ------------- | -------- | ------- | -------------------------------------- |
| `--json`      | no       |         | Output the raw server response as JSON |
| `--dir <dir>` | no       |         | Directory to inspect                   |

### `eigenpal agents deps [options]`

List package workspace dependencies.

### Options

| Flag          | Required | Default | Description                            |
| ------------- | -------- | ------- | -------------------------------------- |
| `--json`      | no       |         | Output the raw server response as JSON |
| `--dir <dir>` | no       |         | Directory to inspect                   |

### `eigenpal agents clean [options]`

Require a clean source working tree.

### Options

| Flag          | Required | Default | Description          |
| ------------- | -------- | ------- | -------------------- |
| `--dir <dir>` | no       |         | Directory to inspect |

### `eigenpal agents show [options] <automation>`

Show Git-backed automation details.

### Arguments

| Name         | Required | Variadic | Description |
| ------------ | -------- | -------- | ----------- |
| `automation` | yes      | no       |             |

### Options

| Flag               | Required | Default | Description                            |
| ------------------ | -------- | ------- | -------------------------------------- |
| `--base-url <url>` | no       |         | Server base URL                        |
| `--json`           | no       |         | Output the raw server response as JSON |

### `eigenpal agents versions [options] <package>`

List package release versions.

### Arguments

| Name      | Required | Variadic | Description |
| --------- | -------- | -------- | ----------- |
| `package` | yes      | no       |             |

### Options

| Flag               | Required | Default | Description                            |
| ------------------ | -------- | ------- | -------------------------------------- |
| `--base-url <url>` | no       |         | Server base URL                        |
| `--json`           | no       |         | Output the raw server response as JSON |

### `eigenpal agents release [options] <version> [dir]`

Create and push an immutable package release tag. Never move or overwrite an existing tag; release a new patch instead.

### Arguments

| Name      | Required | Variadic | Description                                         |
| --------- | -------- | -------- | --------------------------------------------------- |
| `version` | yes      | no       | Version (X.Y.Z) or bump level (patch, minor, major) |
| `dir`     | no       | no       | Package directory                                   |

### Options

| Flag                      | Required | Default | Description                                            |
| ------------------------- | -------- | ------- | ------------------------------------------------------ |
| `--base-url <url>`        | no       |         | Server base URL                                        |
| `-m, --message <message>` | no       |         | Annotated tag message (default: Release <packagePath>) |

### `eigenpal agents sync [options] [automation]`

Sync an automation from the latest Git source release.

### Arguments

| Name         | Required | Variadic | Description |
| ------------ | -------- | -------- | ----------- |
| `automation` | no       | no       |             |

### Options

| Flag               | Required | Default | Description          |
| ------------------ | -------- | ------- | -------------------- |
| `--base-url <url>` | no       |         | Server base URL      |
| `--dir <dir>`      | no       |         | Directory to inspect |

### `eigenpal agents file list|ls [options] <agent-id-or-slug>`

List live files for an agent.

### Arguments

| Name               | Required | Variadic | Description |
| ------------------ | -------- | -------- | ----------- |
| `agent-id-or-slug` | yes      | no       |             |

### Options

| Flag               | Required | Default | Description                                |
| ------------------ | -------- | ------- | ------------------------------------------ |
| `--base-url <url>` | no       |         | Server base URL                            |
| `--json`           | no       |         | Output the raw server response as JSON     |
| `--path <prefix>`  | no       |         | Only list files beneath this relative path |

### `eigenpal agents file get [options] <agent-id-or-slug> <remote-path>`

Download one live agent file.

### Arguments

| Name               | Required | Variadic | Description |
| ------------------ | -------- | -------- | ----------- |
| `agent-id-or-slug` | yes      | no       |             |
| `remote-path`      | yes      | no       |             |

### Options

| Flag               | Required | Default | Description                            |
| ------------------ | -------- | ------- | -------------------------------------- |
| `--base-url <url>` | no       |         | Server base URL                        |
| `--json`           | no       |         | Output the raw server response as JSON |
| `--out <file>`     | no       |         | Output file path                       |

### `eigenpal agents file diff [options] <agent-id-or-slug> <remote-path> <local-path>`

Compare one live agent file against a local file.

### Arguments

| Name               | Required | Variadic | Description |
| ------------------ | -------- | -------- | ----------- |
| `agent-id-or-slug` | yes      | no       |             |
| `remote-path`      | yes      | no       |             |
| `local-path`       | yes      | no       |             |

### Options

| Flag               | Required | Default | Description                            |
| ------------------ | -------- | ------- | -------------------------------------- |
| `--base-url <url>` | no       |         | Server base URL                        |
| `--json`           | no       |         | Output the raw server response as JSON |

### `eigenpal agents secret set [options] <name>`

Encrypt and set a secret value in secrets.enc.yaml.

### Arguments

| Name   | Required | Variadic | Description |
| ------ | -------- | -------- | ----------- |
| `name` | yes      | no       |             |

### Options

| Flag                   | Required | Default | Description                       |
| ---------------------- | -------- | ------- | --------------------------------- |
| `--dir <dir>`          | no       |         | Directory to inspect              |
| `--stdin`              | no       |         | Read the secret value from stdin  |
| `--value-file <path>`  | no       |         | Read the secret value from a file |
| `--description <text>` | no       |         | Secret description                |

### `eigenpal agents secret unset [options] <name>`

Remove a secret from secrets.enc.yaml.

### Arguments

| Name   | Required | Variadic | Description |
| ------ | -------- | -------- | ----------- |
| `name` | yes      | no       |             |

### Options

| Flag          | Required | Default | Description          |
| ------------- | -------- | ------- | -------------------- |
| `--dir <dir>` | no       |         | Directory to inspect |

### `eigenpal agents secret import [options] <env-file>`

Import KEY=value entries from an env file into secrets.enc.yaml.

### Arguments

| Name       | Required | Variadic | Description |
| ---------- | -------- | -------- | ----------- |
| `env-file` | yes      | no       |             |

### Options

| Flag          | Required | Default | Description          |
| ------------- | -------- | ------- | -------------------- |
| `--dir <dir>` | no       |         | Directory to inspect |

### `eigenpal agents dataset list|ls [options] <agent-id-or-slug>`

List dataset examples for an agent.

### Arguments

| Name               | Required | Variadic | Description |
| ------------------ | -------- | -------- | ----------- |
| `agent-id-or-slug` | yes      | no       |             |

### Options

| Flag               | Required | Default | Description                            |
| ------------------ | -------- | ------- | -------------------------------------- |
| `--base-url <url>` | no       |         | Server base URL                        |
| `--limit <n>`      | no       | `50`    | Page size                              |
| `--offset <n>`     | no       | `0`     | Page offset                            |
| `--json`           | no       |         | Output the raw server response as JSON |

### `eigenpal agents dataset push [options] <agent-id-or-slug>`

Upload dataset examples from a local dataset directory or zip archive.

### Arguments

| Name               | Required | Variadic | Description |
| ------------------ | -------- | -------- | ----------- |
| `agent-id-or-slug` | yes      | no       |             |

### Options

| Flag                       | Required | Default    | Description                                          |
| -------------------------- | -------- | ---------- | ---------------------------------------------------- |
| `--base-url <url>`         | no       |            | Server base URL                                      |
| `--json`                   | no       |            | Output the raw server response as JSON               |
| `--file <path>`            | yes      |            | Dataset directory or .zip archive                    |
| `--mode <append\|replace>` | no       | `"append"` | Upload mode                                          |
| `--yes`                    | no       |            | Confirm replace mode in non-interactive environments |

### `eigenpal agents dataset pull [options] <agent-id-or-slug>`

Download an agent dataset as a .zip archive.

### Arguments

| Name               | Required | Variadic | Description |
| ------------------ | -------- | -------- | ----------- |
| `agent-id-or-slug` | yes      | no       |             |

### Options

| Flag               | Required | Default     | Description                             |
| ------------------ | -------- | ----------- | --------------------------------------- |
| `--base-url <url>` | no       |             | Server base URL                         |
| `--out <path>`     | no       | `"dataset"` | Output .zip path (default: dataset.zip) |

### `eigenpal agents dataset validate [options] [path]`

Validate a local dataset directory against the agent input/output schemas.

### Arguments

| Name   | Required | Variadic | Description |
| ------ | -------- | -------- | ----------- |
| `path` | no       | no       |             |

### Options

| Flag                | Required | Default | Description                                             |
| ------------------- | -------- | ------- | ------------------------------------------------------- |
| `--json`            | no       |         | Output the raw server response as JSON                  |
| `--agent-dir <dir>` | no       | `"."`   | Agent package directory containing input/output schemas |

### `eigenpal agents experiment|exp run [options] <agent-id-or-slug>`

Start an experiment over dataset examples.

### Arguments

| Name               | Required | Variadic | Description |
| ------------------ | -------- | -------- | ----------- |
| `agent-id-or-slug` | yes      | no       |             |

### Options

| Flag                   | Required | Default | Description                                         |
| ---------------------- | -------- | ------- | --------------------------------------------------- |
| `--base-url <url>`     | no       |         | Server base URL                                     |
| `--json`               | no       |         | Output the raw server response as JSON              |
| `--example-id <id>`    | no       |         | Run one dataset example                             |
| `--wait`               | no       |         | Poll until the experiment reaches a terminal status |
| `--interval <seconds>` | no       | `2`     | Polling interval in seconds                         |

### `eigenpal agents experiment|exp status [options] <agent-id-or-slug> <batch-id>`

Get experiment status.

### Arguments

| Name               | Required | Variadic | Description |
| ------------------ | -------- | -------- | ----------- |
| `agent-id-or-slug` | yes      | no       |             |
| `batch-id`         | yes      | no       |             |

### Options

| Flag                   | Required | Default | Description                            |
| ---------------------- | -------- | ------- | -------------------------------------- |
| `--base-url <url>`     | no       |         | Server base URL                        |
| `--json`               | no       |         | Output the raw server response as JSON |
| `--watch`              | no       |         | Poll until complete                    |
| `--interval <seconds>` | no       | `2`     | Polling interval in seconds            |
| `--max-wait <seconds>` | no       | `1800`  | Maximum wait before exit code 2        |
| `--include <parts>`    | no       |         | Reserved for future detailed parts     |

### `eigenpal agents experiment|exp results [options] <agent-id-or-slug> [batch-id]`

Print experiment results as JSON or CSV.

### Arguments

| Name               | Required | Variadic | Description |
| ------------------ | -------- | -------- | ----------- |
| `agent-id-or-slug` | yes      | no       |             |
| `batch-id`         | no       | no       |             |

### Options

| Flag                   | Required | Default | Description          |
| ---------------------- | -------- | ------- | -------------------- |
| `--base-url <url>`     | no       |         | Server base URL      |
| `--format <csv\|json>` | yes      |         | Output format        |
| `--out <path>`         | no       |         | Write output to file |

### `eigenpal agents experiment|exp list|ls [options] <agent-id-or-slug>`

List experiments.

### Arguments

| Name               | Required | Variadic | Description |
| ------------------ | -------- | -------- | ----------- |
| `agent-id-or-slug` | yes      | no       |             |

### Options

| Flag               | Required | Default | Description                            |
| ------------------ | -------- | ------- | -------------------------------------- |
| `--base-url <url>` | no       |         | Server base URL                        |
| `--limit <n>`      | no       | `50`    | Page size                              |
| `--offset <n>`     | no       | `0`     | Page offset                            |
| `--json`           | no       |         | Output the raw server response as JSON |
| `--batch-id <id>`  | no       |         | Filter to one batch id                 |

### `eigenpal agents experiment|exp compare|diff [options] <batch-id-a> <batch-id-b>`

Diff eval scores between two experiment batches.

### Arguments

| Name         | Required | Variadic | Description |
| ------------ | -------- | -------- | ----------- |
| `batch-id-a` | yes      | no       |             |
| `batch-id-b` | yes      | no       |             |

### Options

| Flag                                                   | Required | Default            | Description                                            |
| ------------------------------------------------------ | -------- | ------------------ | ------------------------------------------------------ |
| `--base-url <url>`                                     | no       |                    | Server base URL                                        |
| `--json`                                               | no       |                    | Output the raw server response as JSON                 |
| `--sort <abs-delta-desc\|delta-asc\|delta-desc\|name>` | no       | `"abs-delta-desc"` | Row sort order (default: biggest movers first)         |
| `--regression-threshold <n>`                           | no       | `0.05`             | Δ below this is flagged as a regression (default 0.05) |

### `eigenpal agents experiment|exp cancel [options] <agent-id-or-slug> <batch-id>`

Cancel every active execution in an experiment.

### Arguments

| Name               | Required | Variadic | Description |
| ------------------ | -------- | -------- | ----------- |
| `agent-id-or-slug` | yes      | no       |             |
| `batch-id`         | yes      | no       |             |

### Options

| Flag               | Required | Default | Description                              |
| ------------------ | -------- | ------- | ---------------------------------------- |
| `--base-url <url>` | no       |         | Server base URL                          |
| `--json`           | no       |         | Output the raw server response as JSON   |
| `--yes`            | no       |         | Required in non-interactive environments |

### `eigenpal agents session list|ls [options] <agent-id-or-slug>`

List builder sessions for an agent.

### Arguments

| Name               | Required | Variadic | Description |
| ------------------ | -------- | -------- | ----------- |
| `agent-id-or-slug` | yes      | no       |             |

### Options

| Flag               | Required | Default | Description                            |
| ------------------ | -------- | ------- | -------------------------------------- |
| `--base-url <url>` | no       |         | Server base URL                        |
| `--limit <n>`      | no       | `50`    | Page size                              |
| `--offset <n>`     | no       | `0`     | Page offset                            |
| `--json`           | no       |         | Output the raw server response as JSON |

### `eigenpal agents session get [options] <session-id>`

Get a builder session and messages.

### Arguments

| Name         | Required | Variadic | Description |
| ------------ | -------- | -------- | ----------- |
| `session-id` | yes      | no       |             |

### Options

| Flag               | Required | Default | Description                            |
| ------------------ | -------- | ------- | -------------------------------------- |
| `--base-url <url>` | no       |         | Server base URL                        |
| `--json`           | no       |         | Output the raw server response as JSON |

### `eigenpal agents session start [options] <agent-id-or-slug>`

Start a builder session.

### Arguments

| Name               | Required | Variadic | Description |
| ------------------ | -------- | -------- | ----------- |
| `agent-id-or-slug` | yes      | no       |             |

### Options

| Flag               | Required | Default | Description                            |
| ------------------ | -------- | ------- | -------------------------------------- |
| `--base-url <url>` | no       |         | Server base URL                        |
| `--json`           | no       |         | Output the raw server response as JSON |
| `--title <title>`  | no       |         | Session title                          |

### `eigenpal agents session message [options] <session-id>`

Append a message to a builder session.

### Arguments

| Name         | Required | Variadic | Description |
| ------------ | -------- | -------- | ----------- |
| `session-id` | yes      | no       |             |

### Options

| Flag               | Required | Default | Description                                                |
| ------------------ | -------- | ------- | ---------------------------------------------------------- |
| `--base-url <url>` | no       |         | Server base URL                                            |
| `--json`           | no       |         | Output the raw server response as JSON                     |
| `--text <message>` | yes      |         | Message text                                               |
| `--wait`           | no       |         | Reserved; server acknowledges after enqueueing the message |

### `eigenpal agents session stop [options] <session-id>`

Stop a builder session.

### Arguments

| Name         | Required | Variadic | Description |
| ------------ | -------- | -------- | ----------- |
| `session-id` | yes      | no       |             |

### Options

| Flag               | Required | Default | Description                              |
| ------------------ | -------- | ------- | ---------------------------------------- |
| `--base-url <url>` | no       |         | Server base URL                          |
| `--json`           | no       |         | Output the raw server response as JSON   |
| `--yes`            | no       |         | Required in non-interactive environments |

### `eigenpal agents env pull [options] [target]`

Decrypt source secrets and print shell exports.

### Arguments

| Name     | Required | Variadic | Description |
| -------- | -------- | -------- | ----------- |
| `target` | no       | no       |             |

### Options

| Flag                | Required | Default   | Description                       |
| ------------------- | -------- | --------- | --------------------------------- |
| `--base-url <url>`  | no       |           | Server base URL                   |
| `--dir <dir>`       | no       | `"."`     | Installed agent package directory |
| `--format <format>` | no       | `"shell"` | Output format: shell or dotenv    |

### `eigenpal agents secrets export [options] [target]`

Decrypt source secrets and print shell exports.

### Arguments

| Name     | Required | Variadic | Description |
| -------- | -------- | -------- | ----------- |
| `target` | no       | no       |             |

### Options

| Flag                | Required | Default   | Description                       |
| ------------------- | -------- | --------- | --------------------------------- |
| `--base-url <url>`  | no       |           | Server base URL                   |
| `--dir <dir>`       | no       | `"."`     | Installed agent package directory |
| `--format <format>` | no       | `"shell"` | Output format: shell or dotenv    |
