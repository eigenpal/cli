# eigenpal agents

Manage Eigenpal agents: Git source, datasets, runs, experiments, sessions, and releases.

## Contents

- [Surface](#surface)
- [Commands](#commands)
  - [Core](#core)
  - [File](#file)
  - [Secret](#secret)
  - [Dataset](#dataset)
  - [Runs](#runs)
  - [Experiment](#experiment)
  - [Session](#session)
  - [Env](#env)
  - [Secrets](#secrets)
- [Details](#details)
  - [`eigenpal agents|agent run [options] <target>`](#eigenpal-agentsagent-run-options-target)
  - [`eigenpal agents|agent list|ls [options]`](#eigenpal-agentsagent-listls-options)
  - [`eigenpal agents|agent validate [options] [dir]`](#eigenpal-agentsagent-validate-options-dir)
  - [`eigenpal agents|agent clone [options]`](#eigenpal-agentsagent-clone-options)
  - [`eigenpal agents|agent install [options] [packageRef]`](#eigenpal-agentsagent-install-options-packageref)
  - [`eigenpal agents|agent init [options] <name>`](#eigenpal-agentsagent-init-options-name)
  - [`eigenpal agents|agent pull [options]`](#eigenpal-agentsagent-pull-options)
  - [`eigenpal agents|agent commit [options]`](#eigenpal-agentsagent-commit-options)
  - [`eigenpal agents|agent save [options]`](#eigenpal-agentsagent-save-options)
  - [`eigenpal agents|agent push [options]`](#eigenpal-agentsagent-push-options)
  - [`eigenpal agents|agent upgrade [options]`](#eigenpal-agentsagent-upgrade-options)
  - [`eigenpal agents|agent doctor [options]`](#eigenpal-agentsagent-doctor-options)
  - [`eigenpal agents|agent status [options]`](#eigenpal-agentsagent-status-options)
  - [`eigenpal agents|agent deps [options]`](#eigenpal-agentsagent-deps-options)
  - [`eigenpal agents|agent clean [options]`](#eigenpal-agentsagent-clean-options)
  - [`eigenpal agents|agent show [options] <automation>`](#eigenpal-agentsagent-show-options-automation)
  - [`eigenpal agents|agent versions [options] <package>`](#eigenpal-agentsagent-versions-options-package)
  - [`eigenpal agents|agent release [options] <version> [dir]`](#eigenpal-agentsagent-release-options-version-dir)
  - [`eigenpal agents|agent sync [options] [automation]`](#eigenpal-agentsagent-sync-options-automation)
  - [`eigenpal agents|agent file list|ls [options] <agent-id-or-slug>`](#eigenpal-agentsagent-file-listls-options-agent-id-or-slug)
  - [`eigenpal agents|agent file get [options] <agent-id-or-slug> <remote-path>`](#eigenpal-agentsagent-file-get-options-agent-id-or-slug-remote-path)
  - [`eigenpal agents|agent file put [options] <agent-id-or-slug> <remote-path> <local-path>`](#eigenpal-agentsagent-file-put-options-agent-id-or-slug-remote-path-local-path)
  - [`eigenpal agents|agent file diff [options] <agent-id-or-slug> <remote-path> <local-path>`](#eigenpal-agentsagent-file-diff-options-agent-id-or-slug-remote-path-local-path)
  - [`eigenpal agents|agent secret set [options] <name>`](#eigenpal-agentsagent-secret-set-options-name)
  - [`eigenpal agents|agent secret unset [options] <name>`](#eigenpal-agentsagent-secret-unset-options-name)
  - [`eigenpal agents|agent secret import [options] <env-file>`](#eigenpal-agentsagent-secret-import-options-env-file)
  - [`eigenpal agents|agent dataset list|ls [options] <agent-id-or-slug>`](#eigenpal-agentsagent-dataset-listls-options-agent-id-or-slug)
  - [`eigenpal agents|agent dataset push [options] <agent-id-or-slug>`](#eigenpal-agentsagent-dataset-push-options-agent-id-or-slug)
  - [`eigenpal agents|agent dataset pull [options] <agent-id-or-slug>`](#eigenpal-agentsagent-dataset-pull-options-agent-id-or-slug)
  - [`eigenpal agents|agent dataset validate [options] [path]`](#eigenpal-agentsagent-dataset-validate-options-path)
  - [`eigenpal agents|agent runs list|ls [options] <target>`](#eigenpal-agentsagent-runs-listls-options-target)
  - [`eigenpal agents|agent runs get [options] <run-id>`](#eigenpal-agentsagent-runs-get-options-run-id)
  - [`eigenpal agents|agent runs rerun [options] <run-id>`](#eigenpal-agentsagent-runs-rerun-options-run-id)
  - [`eigenpal agents|agent runs pull [options] <run-id>`](#eigenpal-agentsagent-runs-pull-options-run-id)
  - [`eigenpal agents|agent runs compare|diff [options] <reference-run-id> <run-id>`](#eigenpal-agentsagent-runs-comparediff-options-reference-run-id-run-id)
  - [`eigenpal agents|agent runs artifacts|artifact list|ls [options] <run-id>`](#eigenpal-agentsagent-runs-artifactsartifact-listls-options-run-id)
  - [`eigenpal agents|agent runs trace [options] <run-id>`](#eigenpal-agentsagent-runs-trace-options-run-id)
  - [`eigenpal agents|agent runs feedback|fb update [options] <run-id>`](#eigenpal-agentsagent-runs-feedbackfb-update-options-run-id)
  - [`eigenpal agents|agent runs feedback|fb resolve [options] <run-id>`](#eigenpal-agentsagent-runs-feedbackfb-resolve-options-run-id)
  - [`eigenpal agents|agent runs feedback|fb clear [options] <run-id>`](#eigenpal-agentsagent-runs-feedbackfb-clear-options-run-id)
  - [`eigenpal agents|agent runs expected list|ls [options] <run-id>`](#eigenpal-agentsagent-runs-expected-listls-options-run-id)
  - [`eigenpal agents|agent runs expected pull [options] <run-id>`](#eigenpal-agentsagent-runs-expected-pull-options-run-id)
  - [`eigenpal agents|agent runs expected upload [options] <run-id> <file>`](#eigenpal-agentsagent-runs-expected-upload-options-run-id-file)
  - [`eigenpal agents|agent runs expected copy-output [options] <run-id> <output-file>`](#eigenpal-agentsagent-runs-expected-copy-output-options-run-id-output-file)
  - [`eigenpal agents|agent runs expected rename [options] <run-id> <old-name> <new-name>`](#eigenpal-agentsagent-runs-expected-rename-options-run-id-old-name-new-name)
  - [`eigenpal agents|agent runs expected delete [options] <run-id> <name>`](#eigenpal-agentsagent-runs-expected-delete-options-run-id-name)
  - [`eigenpal agents|agent runs watch [options] <run-id>`](#eigenpal-agentsagent-runs-watch-options-run-id)
  - [`eigenpal agents|agent runs cancel [options] <run-id>`](#eigenpal-agentsagent-runs-cancel-options-run-id)
  - [`eigenpal agents|agent experiment|exp run [options] <agent-id-or-slug>`](#eigenpal-agentsagent-experimentexp-run-options-agent-id-or-slug)
  - [`eigenpal agents|agent experiment|exp status [options] <agent-id-or-slug> <batch-id>`](#eigenpal-agentsagent-experimentexp-status-options-agent-id-or-slug-batch-id)
  - [`eigenpal agents|agent experiment|exp results [options] <agent-id-or-slug> [batch-id]`](#eigenpal-agentsagent-experimentexp-results-options-agent-id-or-slug-batch-id)
  - [`eigenpal agents|agent experiment|exp list|ls [options] <agent-id-or-slug>`](#eigenpal-agentsagent-experimentexp-listls-options-agent-id-or-slug)
  - [`eigenpal agents|agent experiment|exp compare|diff [options] <batch-id-a> <batch-id-b>`](#eigenpal-agentsagent-experimentexp-comparediff-options-batch-id-a-batch-id-b)
  - [`eigenpal agents|agent experiment|exp cancel [options] <agent-id-or-slug> <batch-id>`](#eigenpal-agentsagent-experimentexp-cancel-options-agent-id-or-slug-batch-id)
  - [`eigenpal agents|agent session list|ls [options] <agent-id-or-slug>`](#eigenpal-agentsagent-session-listls-options-agent-id-or-slug)
  - [`eigenpal agents|agent session get [options] <session-id>`](#eigenpal-agentsagent-session-get-options-session-id)
  - [`eigenpal agents|agent session start [options] <agent-id-or-slug>`](#eigenpal-agentsagent-session-start-options-agent-id-or-slug)
  - [`eigenpal agents|agent session message [options] <session-id>`](#eigenpal-agentsagent-session-message-options-session-id)
  - [`eigenpal agents|agent session stop [options] <session-id>`](#eigenpal-agentsagent-session-stop-options-session-id)
  - [`eigenpal agents|agent env pull [options] [target]`](#eigenpal-agentsagent-env-pull-options-target)
  - [`eigenpal agents|agent secrets export [options] [target]`](#eigenpal-agentsagent-secrets-export-options-target)

## Surface

```
agents
├── run <target>
├── list|ls
├── file
│   ├── list|ls <agent-id-or-slug>
│   ├── get <agent-id-or-slug> <remote-path>
│   ├── put <agent-id-or-slug> <remote-path> <local-path>
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
├── runs
│   ├── list|ls <target>
│   ├── get <run-id>
│   ├── rerun <run-id>
│   ├── pull <run-id>
│   ├── compare|diff <reference-run-id> <run-id>
│   ├── artifacts|artifact
│   │   └── list|ls <run-id>
│   ├── trace <run-id>
│   ├── feedback|fb
│   │   ├── update <run-id>
│   │   ├── resolve <run-id>
│   │   └── clear <run-id>
│   ├── expected
│   │   ├── list|ls <run-id>
│   │   ├── pull <run-id>
│   │   ├── upload <run-id> <file>
│   │   ├── copy-output <run-id> <output-file>
│   │   ├── rename <run-id> <old-name> <new-name>
│   │   └── delete <run-id> <name>
│   ├── watch <run-id>
│   └── cancel <run-id>
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

| Command                                                    | Description                                                                                                                             |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `eigenpal agents\|agent run [options] <target>`            | Run an agent target, e.g. agents.invoice-agent@latest.                                                                                  |
| `eigenpal agents\|agent list\|ls [options]`                | List agents.                                                                                                                            |
| `eigenpal agents\|agent validate [options] [dir]`          | Validate a local agent package (layout, manifest, schemas, and Git source rules).                                                       |
| `eigenpal agents\|agent clone [options]`                   | Clone the organization source repository.                                                                                               |
| `eigenpal agents\|agent install [options] [packageRef]`    | Materialize a source package and its workspace dependencies.                                                                            |
| `eigenpal agents\|agent init [options] <name>`             | Create a new source package scaffold.                                                                                                   |
| `eigenpal agents\|agent pull [options]`                    | Pull organization source from origin/main with --ff-only. For datasets use agents dataset pull; for run artifacts use agents runs pull. |
| `eigenpal agents\|agent commit [options]`                  | Validate changed source packages and commit them.                                                                                       |
| `eigenpal agents\|agent save [options]`                    | Validate, commit if dirty, and push the current source branch.                                                                          |
| `eigenpal agents\|agent push [options]`                    | Push the current organization source branch and tags.                                                                                   |
| `eigenpal agents\|agent upgrade [options]`                 | Upgrade the source repository schema in place.                                                                                          |
| `eigenpal agents\|agent doctor [options]`                  | Check organization source repository health.                                                                                            |
| `eigenpal agents\|agent status [options]`                  | Show source repo and package status.                                                                                                    |
| `eigenpal agents\|agent deps [options]`                    | List package workspace dependencies.                                                                                                    |
| `eigenpal agents\|agent clean [options]`                   | Require a clean source working tree.                                                                                                    |
| `eigenpal agents\|agent show [options] <automation>`       | Show Git-backed automation details.                                                                                                     |
| `eigenpal agents\|agent versions [options] <package>`      | List package release versions.                                                                                                          |
| `eigenpal agents\|agent release [options] <version> [dir]` | Create and push an immutable package release tag. Never move or overwrite an existing tag; release a new patch instead.                 |
| `eigenpal agents\|agent sync [options] [automation]`       | Sync an automation from the latest Git source release.                                                                                  |

### File

| Command                                                                                    | Description                                                                      |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `eigenpal agents\|agent file list\|ls [options] <agent-id-or-slug>`                        | List live files for an agent.                                                    |
| `eigenpal agents\|agent file get [options] <agent-id-or-slug> <remote-path>`               | Download one live agent file.                                                    |
| `eigenpal agents\|agent file put [options] <agent-id-or-slug> <remote-path> <local-path>`  | [removed] Git-backed agents — edit source in Git and run `eigenpal agents save`. |
| `eigenpal agents\|agent file diff [options] <agent-id-or-slug> <remote-path> <local-path>` | Compare one live agent file against a local file.                                |

### Secret

| Command                                                     | Description                                                      |
| ----------------------------------------------------------- | ---------------------------------------------------------------- |
| `eigenpal agents\|agent secret set [options] <name>`        | Encrypt and set a secret value in secrets.enc.yaml.              |
| `eigenpal agents\|agent secret unset [options] <name>`      | Remove a secret from secrets.enc.yaml.                           |
| `eigenpal agents\|agent secret import [options] <env-file>` | Import KEY=value entries from an env file into secrets.enc.yaml. |

### Dataset

| Command                                                                | Description                                                                |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `eigenpal agents\|agent dataset list\|ls [options] <agent-id-or-slug>` | List dataset examples for an agent.                                        |
| `eigenpal agents\|agent dataset push [options] <agent-id-or-slug>`     | Upload dataset examples from a local dataset directory.                    |
| `eigenpal agents\|agent dataset pull [options] <agent-id-or-slug>`     | Download an agent dataset directory.                                       |
| `eigenpal agents\|agent dataset validate [options] [path]`             | Validate a local dataset directory against the agent input/output schemas. |

### Runs

| Command                                                                                | Description                                                                                                      |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `eigenpal agents\|agent runs list\|ls [options] <target>`                              | List runs for an agent target, e.g. agents.invoice-agent.                                                        |
| `eigenpal agents\|agent runs get [options] <run-id>`                                   | Get one agent run.                                                                                               |
| `eigenpal agents\|agent runs rerun [options] <run-id>`                                 | Create a new run from a previous run's stored input snapshot.                                                    |
| `eigenpal agents\|agent runs pull [options] <run-id>`                                  | Download run feedback, expected artifacts, files, and metadata.                                                  |
| `eigenpal agents\|agent runs compare\|diff [options] <reference-run-id> <run-id>`      | Compare one run against another run. PDF/DOCX text comparison uses pdftotext/python3 and reports byte fallbacks. |
| `eigenpal agents\|agent runs artifacts\|artifact list\|ls [options] <run-id>`          | List available run artifacts without downloading them.                                                           |
| `eigenpal agents\|agent runs trace [options] <run-id>`                                 | Print raw trace.jsonl for a run, or write it with --out.                                                         |
| `eigenpal agents\|agent runs feedback\|fb update [options] <run-id>`                   | Edit feedback state, rating, message, or expected JSON for a run.                                                |
| `eigenpal agents\|agent runs feedback\|fb resolve [options] <run-id>`                  | Mark run feedback as resolved.                                                                                   |
| `eigenpal agents\|agent runs feedback\|fb clear [options] <run-id>`                    | Delete feedback, expected.json, and expected files for a run.                                                    |
| `eigenpal agents\|agent runs expected list\|ls [options] <run-id>`                     | List expected JSON and files attached to a run.                                                                  |
| `eigenpal agents\|agent runs expected pull [options] <run-id>`                         | Download expected JSON and files attached to a run.                                                              |
| `eigenpal agents\|agent runs expected upload [options] <run-id> <file>`                | Upload a local file as an expected artifact.                                                                     |
| `eigenpal agents\|agent runs expected copy-output [options] <run-id> <output-file>`    | Copy a generated output file into expected artifacts.                                                            |
| `eigenpal agents\|agent runs expected rename [options] <run-id> <old-name> <new-name>` | Rename an expected artifact.                                                                                     |
| `eigenpal agents\|agent runs expected delete [options] <run-id> <name>`                | Delete an expected artifact.                                                                                     |
| `eigenpal agents\|agent runs watch [options] <run-id>`                                 | Watch a run until it reaches a terminal status.                                                                  |
| `eigenpal agents\|agent runs cancel [options] <run-id>`                                | Cancel an agent run.                                                                                             |

### Experiment

| Command                                                                                    | Description                                     |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| `eigenpal agents\|agent experiment\|exp run [options] <agent-id-or-slug>`                  | Start an experiment over dataset examples.      |
| `eigenpal agents\|agent experiment\|exp status [options] <agent-id-or-slug> <batch-id>`    | Get experiment status.                          |
| `eigenpal agents\|agent experiment\|exp results [options] <agent-id-or-slug> [batch-id]`   | Print experiment results as JSON or CSV.        |
| `eigenpal agents\|agent experiment\|exp list\|ls [options] <agent-id-or-slug>`             | List experiments.                               |
| `eigenpal agents\|agent experiment\|exp compare\|diff [options] <batch-id-a> <batch-id-b>` | Compare two experiment batches.                 |
| `eigenpal agents\|agent experiment\|exp cancel [options] <agent-id-or-slug> <batch-id>`    | Cancel every active execution in an experiment. |

### Session

| Command                                                                | Description                            |
| ---------------------------------------------------------------------- | -------------------------------------- |
| `eigenpal agents\|agent session list\|ls [options] <agent-id-or-slug>` | List builder sessions for an agent.    |
| `eigenpal agents\|agent session get [options] <session-id>`            | Get a builder session and messages.    |
| `eigenpal agents\|agent session start [options] <agent-id-or-slug>`    | Start a builder session.               |
| `eigenpal agents\|agent session message [options] <session-id>`        | Append a message to a builder session. |
| `eigenpal agents\|agent session stop [options] <session-id>`           | Stop a builder session.                |

### Env

| Command                                              | Description                                     |
| ---------------------------------------------------- | ----------------------------------------------- |
| `eigenpal agents\|agent env pull [options] [target]` | Decrypt source secrets and print shell exports. |

### Secrets

| Command                                                    | Description                                     |
| ---------------------------------------------------------- | ----------------------------------------------- |
| `eigenpal agents\|agent secrets export [options] [target]` | Decrypt source secrets and print shell exports. |

## Details

### `eigenpal agents|agent run [options] <target>`

Run an agent target, e.g. agents.invoice-agent@latest.

### Arguments

| Name     | Required | Variadic | Description |
| -------- | -------- | -------- | ----------- |
| `target` | yes      | no       |             |

### Options

| Flag                   | Required | Default | Description                                  |
| ---------------------- | -------- | ------- | -------------------------------------------- |
| `--base-url <url>`     | no       |         | Server base URL                              |
| `--json`               | no       |         | Output the raw server response as JSON       |
| `--input-json <json>`  | no       |         | JSON input object                            |
| `--input-file <path>`  | no       |         | Input file to upload as multipart form-data  |
| `--example <name>`     | no       |         | Run a persisted dataset example by name      |
| `--wait`               | no       |         | Poll until the run reaches a terminal status |
| `--interval <seconds>` | no       | `2`     | Polling interval in seconds                  |
| `--max-wait <seconds>` | no       | `1800`  | Maximum wait before exiting 2                |

### `eigenpal agents|agent list|ls [options]`

List agents.

### Options

| Flag               | Required | Default | Description                            |
| ------------------ | -------- | ------- | -------------------------------------- |
| `--base-url <url>` | no       |         | Server base URL                        |
| `--limit <n>`      | no       | `50`    | Page size                              |
| `--offset <n>`     | no       | `0`     | Page offset                            |
| `--json`           | no       |         | Output the raw server response as JSON |
| `--search <q>`     | no       |         | Search by slug, name, or description   |

### `eigenpal agents|agent validate [options] [dir]`

Validate a local agent package (layout, manifest, schemas, and Git source rules).

### Arguments

| Name  | Required | Variadic | Description |
| ----- | -------- | -------- | ----------- |
| `dir` | no       | no       |             |

### Options

| Flag     | Required | Default | Description                            |
| -------- | -------- | ------- | -------------------------------------- |
| `--json` | no       |         | Output the raw server response as JSON |

### `eigenpal agents|agent clone [options]`

Clone the organization source repository.

### Options

| Flag               | Required | Default | Description      |
| ------------------ | -------- | ------- | ---------------- |
| `--base-url <url>` | no       |         | Server base URL  |
| `--out <dir>`      | no       |         | Output directory |

### `eigenpal agents|agent install [options] [packageRef]`

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

### `eigenpal agents|agent init [options] <name>`

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

### `eigenpal agents|agent pull [options]`

Pull organization source from origin/main with --ff-only. For datasets use agents dataset pull; for run artifacts use agents runs pull.

### Options

| Flag               | Required | Default | Description          |
| ------------------ | -------- | ------- | -------------------- |
| `--base-url <url>` | no       |         | Server base URL      |
| `--dir <dir>`      | no       |         | Repository directory |

### `eigenpal agents|agent commit [options]`

Validate changed source packages and commit them.

### Options

| Flag                      | Required | Default | Description          |
| ------------------------- | -------- | ------- | -------------------- |
| `--base-url <url>`        | no       |         | Server base URL      |
| `-m, --message <message>` | yes      |         | Commit message       |
| `--dir <dir>`             | no       |         | Repository directory |

### `eigenpal agents|agent save [options]`

Validate, commit if dirty, and push the current source branch.

### Options

| Flag                      | Required | Default | Description                                  |
| ------------------------- | -------- | ------- | -------------------------------------------- |
| `--base-url <url>`        | no       |         | Server base URL                              |
| `-m, --message <message>` | no       |         | Commit message when source changes are dirty |
| `--dir <dir>`             | no       |         | Repository directory                         |

### `eigenpal agents|agent push [options]`

Push the current organization source branch and tags.

### Options

| Flag               | Required | Default | Description          |
| ------------------ | -------- | ------- | -------------------- |
| `--base-url <url>` | no       |         | Server base URL      |
| `--dir <dir>`      | no       |         | Repository directory |

### `eigenpal agents|agent upgrade [options]`

Upgrade the source repository schema in place.

### Options

| Flag          | Required | Default | Description                                  |
| ------------- | -------- | ------- | -------------------------------------------- |
| `--dir <dir>` | no       |         | Repository directory                         |
| `--dry-run`   | no       |         | Print upgrade actions without changing files |

### `eigenpal agents|agent doctor [options]`

Check organization source repository health.

### Options

| Flag          | Required | Default | Description                            |
| ------------- | -------- | ------- | -------------------------------------- |
| `--json`      | no       |         | Output the raw server response as JSON |
| `--dir <dir>` | no       |         | Directory to inspect                   |

### `eigenpal agents|agent status [options]`

Show source repo and package status.

### Options

| Flag          | Required | Default | Description                            |
| ------------- | -------- | ------- | -------------------------------------- |
| `--json`      | no       |         | Output the raw server response as JSON |
| `--dir <dir>` | no       |         | Directory to inspect                   |

### `eigenpal agents|agent deps [options]`

List package workspace dependencies.

### Options

| Flag          | Required | Default | Description                            |
| ------------- | -------- | ------- | -------------------------------------- |
| `--json`      | no       |         | Output the raw server response as JSON |
| `--dir <dir>` | no       |         | Directory to inspect                   |

### `eigenpal agents|agent clean [options]`

Require a clean source working tree.

### Options

| Flag          | Required | Default | Description          |
| ------------- | -------- | ------- | -------------------- |
| `--dir <dir>` | no       |         | Directory to inspect |

### `eigenpal agents|agent show [options] <automation>`

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

### `eigenpal agents|agent versions [options] <package>`

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

### `eigenpal agents|agent release [options] <version> [dir]`

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

### `eigenpal agents|agent sync [options] [automation]`

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

### `eigenpal agents|agent file list|ls [options] <agent-id-or-slug>`

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

### `eigenpal agents|agent file get [options] <agent-id-or-slug> <remote-path>`

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

### `eigenpal agents|agent file put [options] <agent-id-or-slug> <remote-path> <local-path>`

[removed] Git-backed agents — edit source in Git and run `eigenpal agents save`.

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

### `eigenpal agents|agent file diff [options] <agent-id-or-slug> <remote-path> <local-path>`

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

### `eigenpal agents|agent secret set [options] <name>`

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

### `eigenpal agents|agent secret unset [options] <name>`

Remove a secret from secrets.enc.yaml.

### Arguments

| Name   | Required | Variadic | Description |
| ------ | -------- | -------- | ----------- |
| `name` | yes      | no       |             |

### Options

| Flag          | Required | Default | Description          |
| ------------- | -------- | ------- | -------------------- |
| `--dir <dir>` | no       |         | Directory to inspect |

### `eigenpal agents|agent secret import [options] <env-file>`

Import KEY=value entries from an env file into secrets.enc.yaml.

### Arguments

| Name       | Required | Variadic | Description |
| ---------- | -------- | -------- | ----------- |
| `env-file` | yes      | no       |             |

### Options

| Flag          | Required | Default | Description          |
| ------------- | -------- | ------- | -------------------- |
| `--dir <dir>` | no       |         | Directory to inspect |

### `eigenpal agents|agent dataset list|ls [options] <agent-id-or-slug>`

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

### `eigenpal agents|agent dataset push [options] <agent-id-or-slug>`

Upload dataset examples from a local dataset directory.

### Arguments

| Name               | Required | Variadic | Description |
| ------------------ | -------- | -------- | ----------- |
| `agent-id-or-slug` | yes      | no       |             |

### Options

| Flag                       | Required | Default    | Description                                          |
| -------------------------- | -------- | ---------- | ---------------------------------------------------- |
| `--base-url <url>`         | no       |            | Server base URL                                      |
| `--json`                   | no       |            | Output the raw server response as JSON               |
| `--file <path>`            | yes      |            | Dataset directory                                    |
| `--mode <append\|replace>` | no       | `"append"` | Upload mode                                          |
| `--yes`                    | no       |            | Confirm replace mode in non-interactive environments |

### `eigenpal agents|agent dataset pull [options] <agent-id-or-slug>`

Download an agent dataset directory.

### Arguments

| Name               | Required | Variadic | Description |
| ------------------ | -------- | -------- | ----------- |
| `agent-id-or-slug` | yes      | no       |             |

### Options

| Flag               | Required | Default     | Description      |
| ------------------ | -------- | ----------- | ---------------- |
| `--base-url <url>` | no       |             | Server base URL  |
| `--out <dir>`      | no       | `"dataset"` | Output directory |

### `eigenpal agents|agent dataset validate [options] [path]`

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

### `eigenpal agents|agent runs list|ls [options] <target>`

List runs for an agent target, e.g. agents.invoice-agent.

### Arguments

| Name     | Required | Variadic | Description |
| -------- | -------- | -------- | ----------- |
| `target` | yes      | no       |             |

### Options

| Flag                  | Required | Default | Description                            |
| --------------------- | -------- | ------- | -------------------------------------- |
| `--base-url <url>`    | no       |         | Server base URL                        |
| `--limit <n>`         | no       | `50`    | Page size                              |
| `--offset <n>`        | no       | `0`     | Page offset                            |
| `--json`              | no       |         | Output the raw server response as JSON |
| `--status <status>`   | no       |         | Filter by run status                   |
| `--include <items>`   | no       |         | Comma-separated include list           |
| `--compact`           | no       |         | Render compact run rows                |
| `--sort <field>`      | no       |         | Sort field                             |
| `--order <asc\|desc>` | no       |         | Sort order                             |

### `eigenpal agents|agent runs get [options] <run-id>`

Get one agent run.

### Arguments

| Name     | Required | Variadic | Description |
| -------- | -------- | -------- | ----------- |
| `run-id` | yes      | no       |             |

### Options

| Flag                | Required | Default      | Description                                                       |
| ------------------- | -------- | ------------ | ----------------------------------------------------------------- |
| `--base-url <url>`  | no       |              | Server base URL                                                   |
| `--json`            | no       |              | Output the raw server response as JSON                            |
| `--include <parts>` | no       | `"feedback"` | Comma-separated extra parts: feedback,expected,files,trace,issues |

### `eigenpal agents|agent runs rerun [options] <run-id>`

Create a new run from a previous run's stored input snapshot.

### Arguments

| Name     | Required | Variadic | Description |
| -------- | -------- | -------- | ----------- |
| `run-id` | yes      | no       |             |

### Options

| Flag                   | Required | Default | Description                                    |
| ---------------------- | -------- | ------- | ---------------------------------------------- |
| `--base-url <url>`     | no       |         | Server base URL                                |
| `--json`               | no       |         | Output the raw server response as JSON         |
| `--wait`               | no       |         | Poll until the rerun reaches a terminal status |
| `--interval <seconds>` | no       | `2`     | Polling interval in seconds                    |
| `--max-wait <seconds>` | no       | `1800`  | Maximum wait before exiting 2                  |

### `eigenpal agents|agent runs pull [options] <run-id>`

Download run feedback, expected artifacts, files, and metadata.

### Arguments

| Name     | Required | Variadic | Description |
| -------- | -------- | -------- | ----------- |
| `run-id` | yes      | no       |             |

### Options

| Flag                | Required | Default               | Description                                                                           |
| ------------------- | -------- | --------------------- | ------------------------------------------------------------------------------------- |
| `--base-url <url>`  | no       |                       | Server base URL                                                                       |
| `--out <dir>`       | no       |                       | Output directory                                                                      |
| `--include <parts>` | no       | `"feedback,expected"` | Comma-separated parts: feedback,expected,files,output,input,metadata,issues,trace,all |
| `--json`            | no       |                       | Output a JSON summary of written artifacts                                            |

### `eigenpal agents|agent runs compare|diff [options] <reference-run-id> <run-id>`

Compare one run against another run. PDF/DOCX text comparison uses pdftotext/python3 and reports byte fallbacks.

### Arguments

| Name               | Required | Variadic | Description |
| ------------------ | -------- | -------- | ----------- |
| `reference-run-id` | yes      | no       |             |
| `run-id`           | yes      | no       |             |

### Options

| Flag                | Required | Default | Description                                                         |
| ------------------- | -------- | ------- | ------------------------------------------------------------------- |
| `--base-url <url>`  | no       |         | Server base URL                                                     |
| `--json`            | no       |         | Output the raw server response as JSON                              |
| `--baseline`        | no       |         | Compare actual outputs from both runs instead of expected artifacts |
| `--out <dir>`       | no       |         | Write comparison artifacts to this directory                        |
| `--normalize-dates` | no       |         | Normalize YYYYMMDD and YYYY-MM-DD tokens in filenames/text          |
| `--fail-on-diff`    | no       |         | Exit 1 when comparison status is fail                               |

### `eigenpal agents|agent runs artifacts|artifact list|ls [options] <run-id>`

List available run artifacts without downloading them.

### Arguments

| Name     | Required | Variadic | Description |
| -------- | -------- | -------- | ----------- |
| `run-id` | yes      | no       |             |

### Options

| Flag               | Required | Default | Description                            |
| ------------------ | -------- | ------- | -------------------------------------- |
| `--base-url <url>` | no       |         | Server base URL                        |
| `--json`           | no       |         | Output the raw server response as JSON |

### `eigenpal agents|agent runs trace [options] <run-id>`

Print raw trace.jsonl for a run, or write it with --out.

### Arguments

| Name     | Required | Variadic | Description |
| -------- | -------- | -------- | ----------- |
| `run-id` | yes      | no       |             |

### Options

| Flag               | Required | Default | Description      |
| ------------------ | -------- | ------- | ---------------- |
| `--base-url <url>` | no       |         | Server base URL  |
| `--out <file>`     | no       |         | Output file path |

### `eigenpal agents|agent runs feedback|fb update [options] <run-id>`

Edit feedback state, rating, message, or expected JSON for a run.

### Arguments

| Name     | Required | Variadic | Description |
| -------- | -------- | -------- | ----------- |
| `run-id` | yes      | no       |             |

### Options

| Flag                                   | Required | Default | Description                               |
| -------------------------------------- | -------- | ------- | ----------------------------------------- |
| `--base-url <url>`                     | no       |         | Server base URL                           |
| `--json`                               | no       |         | Output the raw server response as JSON    |
| `--status <open\|resolved\|ignored>`   | no       |         | Set feedback status                       |
| `--rating <pass\|fail\|partial\|none>` | no       |         | Set feedback rating                       |
| `--message <text>`                     | no       |         | Set feedback message body                 |
| `--message-file <path>`                | no       |         | Read feedback message body from a file    |
| `--expected-json <json>`               | no       |         | Set structured expected JSON              |
| `--expected-json-file <path>`          | no       |         | Read structured expected JSON from a file |
| `--clear-message`                      | no       |         | Clear the feedback message body           |
| `--clear-rating`                       | no       |         | Clear feedback rating                     |
| `--clear-expected-json`                | no       |         | Delete structured expected JSON           |

### `eigenpal agents|agent runs feedback|fb resolve [options] <run-id>`

Mark run feedback as resolved.

### Arguments

| Name     | Required | Variadic | Description |
| -------- | -------- | -------- | ----------- |
| `run-id` | yes      | no       |             |

### Options

| Flag                    | Required | Default | Description                            |
| ----------------------- | -------- | ------- | -------------------------------------- |
| `--base-url <url>`      | no       |         | Server base URL                        |
| `--json`                | no       |         | Output the raw server response as JSON |
| `--message <text>`      | no       |         | Set feedback message body              |
| `--message-file <path>` | no       |         | Read feedback message body from a file |

### `eigenpal agents|agent runs feedback|fb clear [options] <run-id>`

Delete feedback, expected.json, and expected files for a run.

### Arguments

| Name     | Required | Variadic | Description |
| -------- | -------- | -------- | ----------- |
| `run-id` | yes      | no       |             |

### Options

| Flag               | Required | Default | Description                              |
| ------------------ | -------- | ------- | ---------------------------------------- |
| `--base-url <url>` | no       |         | Server base URL                          |
| `--json`           | no       |         | Output the raw server response as JSON   |
| `--yes`            | no       |         | Required in non-interactive environments |

### `eigenpal agents|agent runs expected list|ls [options] <run-id>`

List expected JSON and files attached to a run.

### Arguments

| Name     | Required | Variadic | Description |
| -------- | -------- | -------- | ----------- |
| `run-id` | yes      | no       |             |

### Options

| Flag               | Required | Default | Description                            |
| ------------------ | -------- | ------- | -------------------------------------- |
| `--base-url <url>` | no       |         | Server base URL                        |
| `--json`           | no       |         | Output the raw server response as JSON |

### `eigenpal agents|agent runs expected pull [options] <run-id>`

Download expected JSON and files attached to a run.

### Arguments

| Name     | Required | Variadic | Description |
| -------- | -------- | -------- | ----------- |
| `run-id` | yes      | no       |             |

### Options

| Flag               | Required | Default | Description      |
| ------------------ | -------- | ------- | ---------------- |
| `--base-url <url>` | no       |         | Server base URL  |
| `--out <dir>`      | no       |         | Output directory |

### `eigenpal agents|agent runs expected upload [options] <run-id> <file>`

Upload a local file as an expected artifact.

### Arguments

| Name     | Required | Variadic | Description |
| -------- | -------- | -------- | ----------- |
| `run-id` | yes      | no       |             |
| `file`   | yes      | no       |             |

### Options

| Flag               | Required | Default | Description                            |
| ------------------ | -------- | ------- | -------------------------------------- |
| `--base-url <url>` | no       |         | Server base URL                        |
| `--json`           | no       |         | Output the raw server response as JSON |
| `--name <name>`    | no       |         | Expected artifact name                 |

### `eigenpal agents|agent runs expected copy-output [options] <run-id> <output-file>`

Copy a generated output file into expected artifacts.

### Arguments

| Name          | Required | Variadic | Description |
| ------------- | -------- | -------- | ----------- |
| `run-id`      | yes      | no       |             |
| `output-file` | yes      | no       |             |

### Options

| Flag               | Required | Default | Description                            |
| ------------------ | -------- | ------- | -------------------------------------- |
| `--base-url <url>` | no       |         | Server base URL                        |
| `--json`           | no       |         | Output the raw server response as JSON |
| `--name <name>`    | no       |         | Expected artifact name                 |

### `eigenpal agents|agent runs expected rename [options] <run-id> <old-name> <new-name>`

Rename an expected artifact.

### Arguments

| Name       | Required | Variadic | Description |
| ---------- | -------- | -------- | ----------- |
| `run-id`   | yes      | no       |             |
| `old-name` | yes      | no       |             |
| `new-name` | yes      | no       |             |

### Options

| Flag               | Required | Default | Description                            |
| ------------------ | -------- | ------- | -------------------------------------- |
| `--base-url <url>` | no       |         | Server base URL                        |
| `--json`           | no       |         | Output the raw server response as JSON |

### `eigenpal agents|agent runs expected delete [options] <run-id> <name>`

Delete an expected artifact.

### Arguments

| Name     | Required | Variadic | Description |
| -------- | -------- | -------- | ----------- |
| `run-id` | yes      | no       |             |
| `name`   | yes      | no       |             |

### Options

| Flag               | Required | Default | Description                              |
| ------------------ | -------- | ------- | ---------------------------------------- |
| `--base-url <url>` | no       |         | Server base URL                          |
| `--json`           | no       |         | Output the raw server response as JSON   |
| `--yes`            | no       |         | Required in non-interactive environments |

### `eigenpal agents|agent runs watch [options] <run-id>`

Watch a run until it reaches a terminal status.

### Arguments

| Name     | Required | Variadic | Description |
| -------- | -------- | -------- | ----------- |
| `run-id` | yes      | no       |             |

### Options

| Flag                   | Required | Default | Description                            |
| ---------------------- | -------- | ------- | -------------------------------------- |
| `--base-url <url>`     | no       |         | Server base URL                        |
| `--json`               | no       |         | Output the raw server response as JSON |
| `--interval <seconds>` | no       | `2`     | Polling interval in seconds            |
| `--max-wait <seconds>` | no       | `1800`  | Maximum wait before exiting 2          |

### `eigenpal agents|agent runs cancel [options] <run-id>`

Cancel an agent run.

### Arguments

| Name     | Required | Variadic | Description |
| -------- | -------- | -------- | ----------- |
| `run-id` | yes      | no       |             |

### Options

| Flag               | Required | Default | Description                              |
| ------------------ | -------- | ------- | ---------------------------------------- |
| `--base-url <url>` | no       |         | Server base URL                          |
| `--json`           | no       |         | Output the raw server response as JSON   |
| `--yes`            | no       |         | Required in non-interactive environments |

### `eigenpal agents|agent experiment|exp run [options] <agent-id-or-slug>`

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

### `eigenpal agents|agent experiment|exp status [options] <agent-id-or-slug> <batch-id>`

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
| `--max-wait <seconds>` | no       | `1800`  | Maximum wait before exiting 2          |
| `--include <parts>`    | no       |         | Reserved for future detailed parts     |

### `eigenpal agents|agent experiment|exp results [options] <agent-id-or-slug> [batch-id]`

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

### `eigenpal agents|agent experiment|exp list|ls [options] <agent-id-or-slug>`

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

### `eigenpal agents|agent experiment|exp compare|diff [options] <batch-id-a> <batch-id-b>`

Compare two experiment batches.

### Arguments

| Name         | Required | Variadic | Description |
| ------------ | -------- | -------- | ----------- |
| `batch-id-a` | yes      | no       |             |
| `batch-id-b` | yes      | no       |             |

### Options

| Flag                         | Required | Default | Description                                                   |
| ---------------------------- | -------- | ------- | ------------------------------------------------------------- |
| `--base-url <url>`           | no       |         | Server base URL                                               |
| `--json`                     | no       |         | Output the raw server response as JSON                        |
| `--sort <mode>`              | no       |         | Accepted for compatibility; sorting happens client-side later |
| `--regression-threshold <n>` | no       |         | Accepted for compatibility                                    |

### `eigenpal agents|agent experiment|exp cancel [options] <agent-id-or-slug> <batch-id>`

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

### `eigenpal agents|agent session list|ls [options] <agent-id-or-slug>`

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

### `eigenpal agents|agent session get [options] <session-id>`

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

### `eigenpal agents|agent session start [options] <agent-id-or-slug>`

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

### `eigenpal agents|agent session message [options] <session-id>`

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

### `eigenpal agents|agent session stop [options] <session-id>`

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

### `eigenpal agents|agent env pull [options] [target]`

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

### `eigenpal agents|agent secrets export [options] [target]`

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
