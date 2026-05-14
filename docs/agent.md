# eigenpal agent

Manage Eigenpal agents, triggers, datasets, executions, experiments, and sessions.

## Contents

- [Surface](#surface)
- [Commands](#commands)
  - [Core](#core)
  - [File](#file)
  - [Dataset](#dataset)
  - [Execution](#execution)
  - [Experiment](#experiment)
  - [Session](#session)
  - [Trigger](#trigger)
  - [Evaluators](#evaluators)
  - [Versions](#versions)
- [Details](#details)
  - [`eigenpal agent list|ls [options]`](#eigenpal-agent-listls-options)
  - [`eigenpal agent push [options]`](#eigenpal-agent-push-options)
  - [`eigenpal agent pull [options] <agent-id-or-slug>`](#eigenpal-agent-pull-options-agent-id-or-slug)
  - [`eigenpal agent validate [options] [dir]`](#eigenpal-agent-validate-options-dir)
  - [`eigenpal agent file list|ls [options] <agent-id-or-slug>`](#eigenpal-agent-file-listls-options-agent-id-or-slug)
  - [`eigenpal agent file get [options] <agent-id-or-slug> <remote-path>`](#eigenpal-agent-file-get-options-agent-id-or-slug-remote-path)
  - [`eigenpal agent file put [options] <agent-id-or-slug> <remote-path> <local-path>`](#eigenpal-agent-file-put-options-agent-id-or-slug-remote-path-local-path)
  - [`eigenpal agent file diff [options] <agent-id-or-slug> <remote-path> <local-path>`](#eigenpal-agent-file-diff-options-agent-id-or-slug-remote-path-local-path)
  - [`eigenpal agent dataset list|ls [options] <agent-id-or-slug>`](#eigenpal-agent-dataset-listls-options-agent-id-or-slug)
  - [`eigenpal agent dataset push [options] <agent-id-or-slug>`](#eigenpal-agent-dataset-push-options-agent-id-or-slug)
  - [`eigenpal agent dataset pull [options] <agent-id-or-slug>`](#eigenpal-agent-dataset-pull-options-agent-id-or-slug)
  - [`eigenpal agent dataset validate [options] [path]`](#eigenpal-agent-dataset-validate-options-path)
  - [`eigenpal agent execution|exec run [options] <agent-id-or-slug>`](#eigenpal-agent-executionexec-run-options-agent-id-or-slug)
  - [`eigenpal agent execution|exec get [options] <execution-id>`](#eigenpal-agent-executionexec-get-options-execution-id)
  - [`eigenpal agent execution|exec rerun [options] <execution-id>`](#eigenpal-agent-executionexec-rerun-options-execution-id)
  - [`eigenpal agent execution|exec list|ls [options] <agent-id-or-slug>`](#eigenpal-agent-executionexec-listls-options-agent-id-or-slug)
  - [`eigenpal agent execution|exec pull [options] <execution-id>`](#eigenpal-agent-executionexec-pull-options-execution-id)
  - [`eigenpal agent execution|exec compare|diff [options] <reference-execution-id> <execution-id>`](#eigenpal-agent-executionexec-comparediff-options-reference-execution-id-execution-id)
  - [`eigenpal agent execution|exec artifacts|artifact list|ls [options] <execution-id>`](#eigenpal-agent-executionexec-artifactsartifact-listls-options-execution-id)
  - [`eigenpal agent execution|exec trace [options] <execution-id>`](#eigenpal-agent-executionexec-trace-options-execution-id)
  - [`eigenpal agent execution|exec feedback|fb update [options] <execution-id>`](#eigenpal-agent-executionexec-feedbackfb-update-options-execution-id)
  - [`eigenpal agent execution|exec feedback|fb resolve [options] <execution-id>`](#eigenpal-agent-executionexec-feedbackfb-resolve-options-execution-id)
  - [`eigenpal agent execution|exec feedback|fb clear [options] <execution-id>`](#eigenpal-agent-executionexec-feedbackfb-clear-options-execution-id)
  - [`eigenpal agent execution|exec expected list|ls [options] <execution-id>`](#eigenpal-agent-executionexec-expected-listls-options-execution-id)
  - [`eigenpal agent execution|exec expected pull [options] <execution-id>`](#eigenpal-agent-executionexec-expected-pull-options-execution-id)
  - [`eigenpal agent execution|exec expected upload [options] <execution-id> <file>`](#eigenpal-agent-executionexec-expected-upload-options-execution-id-file)
  - [`eigenpal agent execution|exec expected copy-output [options] <execution-id> <output-file>`](#eigenpal-agent-executionexec-expected-copy-output-options-execution-id-output-file)
  - [`eigenpal agent execution|exec expected rename [options] <execution-id> <old-name> <new-name>`](#eigenpal-agent-executionexec-expected-rename-options-execution-id-old-name-new-name)
  - [`eigenpal agent execution|exec expected delete [options] <execution-id> <name>`](#eigenpal-agent-executionexec-expected-delete-options-execution-id-name)
  - [`eigenpal agent execution|exec watch [options] <execution-id>`](#eigenpal-agent-executionexec-watch-options-execution-id)
  - [`eigenpal agent execution|exec cancel [options] <execution-id>`](#eigenpal-agent-executionexec-cancel-options-execution-id)
  - [`eigenpal agent experiment|exp run [options] <agent-id-or-slug>`](#eigenpal-agent-experimentexp-run-options-agent-id-or-slug)
  - [`eigenpal agent experiment|exp status [options] <agent-id-or-slug> <batch-id>`](#eigenpal-agent-experimentexp-status-options-agent-id-or-slug-batch-id)
  - [`eigenpal agent experiment|exp results [options] <agent-id-or-slug> [batch-id]`](#eigenpal-agent-experimentexp-results-options-agent-id-or-slug-batch-id)
  - [`eigenpal agent experiment|exp list|ls [options] <agent-id-or-slug>`](#eigenpal-agent-experimentexp-listls-options-agent-id-or-slug)
  - [`eigenpal agent experiment|exp compare|diff [options] <batch-id-a> <batch-id-b>`](#eigenpal-agent-experimentexp-comparediff-options-batch-id-a-batch-id-b)
  - [`eigenpal agent experiment|exp cancel [options] <agent-id-or-slug> <batch-id>`](#eigenpal-agent-experimentexp-cancel-options-agent-id-or-slug-batch-id)
  - [`eigenpal agent session list|ls [options] <agent-id-or-slug>`](#eigenpal-agent-session-listls-options-agent-id-or-slug)
  - [`eigenpal agent session get [options] <session-id>`](#eigenpal-agent-session-get-options-session-id)
  - [`eigenpal agent session start [options] <agent-id-or-slug>`](#eigenpal-agent-session-start-options-agent-id-or-slug)
  - [`eigenpal agent session message [options] <session-id>`](#eigenpal-agent-session-message-options-session-id)
  - [`eigenpal agent session stop [options] <session-id>`](#eigenpal-agent-session-stop-options-session-id)
  - [`eigenpal agent trigger list|ls [options] <agent-id-or-slug>`](#eigenpal-agent-trigger-listls-options-agent-id-or-slug)
  - [`eigenpal agent trigger api enable [options] <agent-id-or-slug>`](#eigenpal-agent-trigger-api-enable-options-agent-id-or-slug)
  - [`eigenpal agent trigger api disable [options] <agent-id-or-slug>`](#eigenpal-agent-trigger-api-disable-options-agent-id-or-slug)
  - [`eigenpal agent trigger email enable [options] <agent-id-or-slug>`](#eigenpal-agent-trigger-email-enable-options-agent-id-or-slug)
  - [`eigenpal agent trigger email disable [options] <agent-id-or-slug>`](#eigenpal-agent-trigger-email-disable-options-agent-id-or-slug)
  - [`eigenpal agent trigger email list|ls [options] [agent-id-or-slug]`](#eigenpal-agent-trigger-email-listls-options-agent-id-or-slug)
  - [`eigenpal agent trigger email add [options] <agent-id-or-slug>`](#eigenpal-agent-trigger-email-add-options-agent-id-or-slug)
  - [`eigenpal agent trigger email update [options] <agent-id-or-slug> <email-id>`](#eigenpal-agent-trigger-email-update-options-agent-id-or-slug-email-id)
  - [`eigenpal agent trigger email remove [options] <agent-id-or-slug> <email-id>`](#eigenpal-agent-trigger-email-remove-options-agent-id-or-slug-email-id)
  - [`eigenpal agent evaluators list|ls [options] [agent-id-or-slug]`](#eigenpal-agent-evaluators-listls-options-agent-id-or-slug)
  - [`eigenpal agent versions list|ls [options] [agent-id-or-slug]`](#eigenpal-agent-versions-listls-options-agent-id-or-slug)

## Surface

```
agent
├── list|ls
├── push
├── pull <agent-id-or-slug>
├── file
│   ├── list|ls <agent-id-or-slug>
│   ├── get <agent-id-or-slug> <remote-path>
│   ├── put <agent-id-or-slug> <remote-path> <local-path>
│   └── diff <agent-id-or-slug> <remote-path> <local-path>
├── validate [dir]
├── dataset
│   ├── list|ls <agent-id-or-slug>
│   ├── push <agent-id-or-slug>
│   ├── pull <agent-id-or-slug>
│   └── validate [path]
├── execution|exec
│   ├── run <agent-id-or-slug>
│   ├── get <execution-id>
│   ├── rerun <execution-id>
│   ├── list|ls <agent-id-or-slug>
│   ├── pull <execution-id>
│   ├── compare|diff <reference-execution-id> <execution-id>
│   ├── artifacts|artifact
│   │   └── list|ls <execution-id>
│   ├── trace <execution-id>
│   ├── feedback|fb
│   │   ├── update <execution-id>
│   │   ├── resolve <execution-id>
│   │   └── clear <execution-id>
│   ├── expected
│   │   ├── list|ls <execution-id>
│   │   ├── pull <execution-id>
│   │   ├── upload <execution-id> <file>
│   │   ├── copy-output <execution-id> <output-file>
│   │   ├── rename <execution-id> <old-name> <new-name>
│   │   └── delete <execution-id> <name>
│   ├── watch <execution-id>
│   └── cancel <execution-id>
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
├── trigger
│   ├── list|ls <agent-id-or-slug>
│   ├── api
│   │   ├── enable <agent-id-or-slug>
│   │   └── disable <agent-id-or-slug>
│   └── email
│       ├── enable <agent-id-or-slug>
│       ├── disable <agent-id-or-slug>
│       ├── list|ls [agent-id-or-slug]
│       ├── add <agent-id-or-slug>
│       ├── update <agent-id-or-slug> <email-id>
│       └── remove <agent-id-or-slug> <email-id>
├── evaluators
│   └── list|ls [agent-id-or-slug]
└── versions
    └── list|ls [agent-id-or-slug]
```

## Commands

### Core

| Command                                            | Description                                                      |
| -------------------------------------------------- | ---------------------------------------------------------------- | ------------ |
| `eigenpal agent list                               | ls [options]`                                                    | List agents. |
| `eigenpal agent push [options]`                    | Create or update an agent from agent.yaml, agent/, and dataset/. |
| `eigenpal agent pull [options] <agent-id-or-slug>` | Download an agent project as agent.yaml, agent/, and dataset/.   |
| `eigenpal agent validate [options] [dir]`          | Validate a local agent project layout.                           |

### File

| Command                                                                            | Description                                          |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------- |
| `eigenpal agent file list                                                          | ls [options] <agent-id-or-slug>`                     | List live files for an agent. |
| `eigenpal agent file get [options] <agent-id-or-slug> <remote-path>`               | Download one live agent file.                        |
| `eigenpal agent file put [options] <agent-id-or-slug> <remote-path> <local-path>`  | Upload one local file into the live agent namespace. |
| `eigenpal agent file diff [options] <agent-id-or-slug> <remote-path> <local-path>` | Compare one live agent file against a local file.    |

### Dataset

| Command                                                    | Description                                             |
| ---------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------- |
| `eigenpal agent dataset list                               | ls [options] <agent-id-or-slug>`                        | List dataset examples for an agent. |
| `eigenpal agent dataset push [options] <agent-id-or-slug>` | Upload dataset examples from a local dataset directory. |
| `eigenpal agent dataset pull [options] <agent-id-or-slug>` | Download an agent dataset directory.                    |
| `eigenpal agent dataset validate [options] [path]`         | Validate a local dataset directory.                     |

### Execution

| Command                   | Description                                                          |
| ------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `eigenpal agent execution | exec run [options] <agent-id-or-slug>`                               | Start one agent execution.                                                |
| `eigenpal agent execution | exec get [options] <execution-id>`                                   | Get one agent execution.                                                  |
| `eigenpal agent execution | exec rerun [options] <execution-id>`                                 | Create a new execution from a previous execution's stored input snapshot. |
| `eigenpal agent execution | exec list                                                            | ls [options] <agent-id-or-slug>`                                          | List agent executions.                                                                                                       |
| `eigenpal agent execution | exec pull [options] <execution-id>`                                  | Download execution feedback, expected artifacts, files, and metadata.     |
| `eigenpal agent execution | exec compare                                                         | diff [options] <reference-execution-id> <execution-id>`                   | Compare one execution against another execution. PDF/DOCX text comparison uses pdftotext/python3 and reports byte fallbacks. |
| `eigenpal agent execution | exec artifacts                                                       | artifact list                                                             | ls [options] <execution-id>`                                                                                                 | List available execution artifacts without downloading them. |
| `eigenpal agent execution | exec trace [options] <execution-id>`                                 | Print raw trace.jsonl for an execution, or write it with --out.           |
| `eigenpal agent execution | exec feedback                                                        | fb update [options] <execution-id>`                                       | Edit feedback state, rating, message, or expected JSON for an execution.                                                     |
| `eigenpal agent execution | exec feedback                                                        | fb resolve [options] <execution-id>`                                      | Mark execution feedback as resolved.                                                                                         |
| `eigenpal agent execution | exec feedback                                                        | fb clear [options] <execution-id>`                                        | Delete feedback, expected.json, and expected files for an execution.                                                         |
| `eigenpal agent execution | exec expected list                                                   | ls [options] <execution-id>`                                              | List expected JSON and files attached to an execution.                                                                       |
| `eigenpal agent execution | exec expected pull [options] <execution-id>`                         | Download expected JSON and files attached to an execution.                |
| `eigenpal agent execution | exec expected upload [options] <execution-id> <file>`                | Upload a local file as an expected artifact.                              |
| `eigenpal agent execution | exec expected copy-output [options] <execution-id> <output-file>`    | Copy a generated output file into expected artifacts.                     |
| `eigenpal agent execution | exec expected rename [options] <execution-id> <old-name> <new-name>` | Rename an expected artifact.                                              |
| `eigenpal agent execution | exec expected delete [options] <execution-id> <name>`                | Delete an expected artifact.                                              |
| `eigenpal agent execution | exec watch [options] <execution-id>`                                 | Watch an execution until it reaches a terminal status.                    |
| `eigenpal agent execution | exec cancel [options] <execution-id>`                                | Cancel an agent execution.                                                |

### Experiment

| Command                    | Description                                          |
| -------------------------- | ---------------------------------------------------- | ----------------------------------------------- | ------------------------------- |
| `eigenpal agent experiment | exp run [options] <agent-id-or-slug>`                | Start an experiment over dataset examples.      |
| `eigenpal agent experiment | exp status [options] <agent-id-or-slug> <batch-id>`  | Get experiment status.                          |
| `eigenpal agent experiment | exp results [options] <agent-id-or-slug> [batch-id]` | Print experiment results as JSON or CSV.        |
| `eigenpal agent experiment | exp list                                             | ls [options] <agent-id-or-slug>`                | List experiments.               |
| `eigenpal agent experiment | exp compare                                          | diff [options] <batch-id-a> <batch-id-b>`       | Compare two experiment batches. |
| `eigenpal agent experiment | exp cancel [options] <agent-id-or-slug> <batch-id>`  | Cancel every active execution in an experiment. |

### Session

| Command                                                     | Description                            |
| ----------------------------------------------------------- | -------------------------------------- | ----------------------------------- |
| `eigenpal agent session list                                | ls [options] <agent-id-or-slug>`       | List builder sessions for an agent. |
| `eigenpal agent session get [options] <session-id>`         | Get a builder session and messages.    |
| `eigenpal agent session start [options] <agent-id-or-slug>` | Start a builder session.               |
| `eigenpal agent session message [options] <session-id>`     | Append a message to a builder session. |
| `eigenpal agent session stop [options] <session-id>`        | Stop a builder session.                |

### Trigger

| Command                                                                       | Description                             |
| ----------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------ |
| `eigenpal agent trigger list                                                  | ls [options] <agent-id-or-slug>`        | List enabled agent triggers.                           |
| `eigenpal agent trigger api enable [options] <agent-id-or-slug>`              | Enable the API trigger for an agent.    |
| `eigenpal agent trigger api disable [options] <agent-id-or-slug>`             | Disable the API trigger for an agent.   |
| `eigenpal agent trigger email enable [options] <agent-id-or-slug>`            | Enable the email trigger for an agent.  |
| `eigenpal agent trigger email disable [options] <agent-id-or-slug>`           | Disable the email trigger for an agent. |
| `eigenpal agent trigger email list                                            | ls [options] [agent-id-or-slug]`        | List email triggers, optionally filtered to one agent. |
| `eigenpal agent trigger email add [options] <agent-id-or-slug>`               | Add an email trigger to an agent.       |
| `eigenpal agent trigger email update [options] <agent-id-or-slug> <email-id>` | Update an email trigger.                |
| `eigenpal agent trigger email remove [options] <agent-id-or-slug> <email-id>` | Remove an email trigger.                |

### Evaluators

| Command                         | Description                      |
| ------------------------------- | -------------------------------- | -------------------------------------------------------------------------------- |
| `eigenpal agent evaluators list | ls [options] [agent-id-or-slug]` | Agent evaluators are reserved for future workflow-style evaluators. Coming soon. |

### Versions

| Command                       | Description                      |
| ----------------------------- | -------------------------------- | -------------------------------------------- |
| `eigenpal agent versions list | ls [options] [agent-id-or-slug]` | Agent versions are coming soon. Coming soon. |

## Details

### `eigenpal agent list|ls [options]`

List agents.

### Options

| Flag               | Required | Default | Description                            |
| ------------------ | -------- | ------- | -------------------------------------- |
| `--base-url <url>` | no       |         | Server base URL                        |
| `--limit <n>`      | no       | `50`    | Page size                              |
| `--offset <n>`     | no       | `0`     | Page offset                            |
| `--json`           | no       |         | Output the raw server response as JSON |
| `--search <q>`     | no       |         | Search by slug, name, or description   |

### `eigenpal agent push [options]`

Create or update an agent from agent.yaml, agent/, and dataset/.

### Options

| Flag                      | Required | Default | Description                                      |
| ------------------------- | -------- | ------- | ------------------------------------------------ |
| `--base-url <url>`        | no       |         | Server base URL                                  |
| `--json`                  | no       |         | Output the raw server response as JSON           |
| `--dir <dir>`             | no       | `"."`   | Agent project directory                          |
| `--agent-id <id-or-slug>` | no       |         | Update an existing agent instead of creating one |

### `eigenpal agent pull [options] <agent-id-or-slug>`

Download an agent project as agent.yaml, agent/, and dataset/.

### Arguments

| Name               | Required | Variadic | Description |
| ------------------ | -------- | -------- | ----------- |
| `agent-id-or-slug` | yes      | no       |             |

### Options

| Flag               | Required | Default | Description      |
| ------------------ | -------- | ------- | ---------------- |
| `--base-url <url>` | no       |         | Server base URL  |
| `--out <dir>`      | no       |         | Output directory |

### `eigenpal agent validate [options] [dir]`

Validate a local agent project layout.

### Arguments

| Name  | Required | Variadic | Description |
| ----- | -------- | -------- | ----------- |
| `dir` | no       | no       |             |

### Options

| Flag     | Required | Default | Description                            |
| -------- | -------- | ------- | -------------------------------------- |
| `--json` | no       |         | Output the raw server response as JSON |

### `eigenpal agent file list|ls [options] <agent-id-or-slug>`

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

### `eigenpal agent file get [options] <agent-id-or-slug> <remote-path>`

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

### `eigenpal agent file put [options] <agent-id-or-slug> <remote-path> <local-path>`

Upload one local file into the live agent namespace.

### Arguments

| Name               | Required | Variadic | Description |
| ------------------ | -------- | -------- | ----------- |
| `agent-id-or-slug` | yes      | no       |             |
| `remote-path`      | yes      | no       |             |
| `local-path`       | yes      | no       |             |

### Options

| Flag               | Required | Default | Description                                           |
| ------------------ | -------- | ------- | ----------------------------------------------------- |
| `--base-url <url>` | no       |         | Server base URL                                       |
| `--json`           | no       |         | Output the raw server response as JSON                |
| `--dry-run`        | no       |         | Validate local file and remote path without uploading |
| `--preview`        | no       |         | Compare remote and local file without uploading       |

### `eigenpal agent file diff [options] <agent-id-or-slug> <remote-path> <local-path>`

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

### `eigenpal agent dataset list|ls [options] <agent-id-or-slug>`

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

### `eigenpal agent dataset push [options] <agent-id-or-slug>`

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

### `eigenpal agent dataset pull [options] <agent-id-or-slug>`

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

### `eigenpal agent dataset validate [options] [path]`

Validate a local dataset directory.

### Arguments

| Name   | Required | Variadic | Description |
| ------ | -------- | -------- | ----------- |
| `path` | no       | no       |             |

### Options

| Flag     | Required | Default | Description                            |
| -------- | -------- | ------- | -------------------------------------- |
| `--json` | no       |         | Output the raw server response as JSON |

### `eigenpal agent execution|exec run [options] <agent-id-or-slug>`

Start one agent execution.

### Arguments

| Name               | Required | Variadic | Description |
| ------------------ | -------- | -------- | ----------- |
| `agent-id-or-slug` | yes      | no       |             |

### Options

| Flag                  | Required | Default | Description                                        |
| --------------------- | -------- | ------- | -------------------------------------------------- |
| `--base-url <url>`    | no       |         | Server base URL                                    |
| `--json`              | no       |         | Output the raw server response as JSON             |
| `--input-json <json>` | no       |         | JSON input object                                  |
| `--input-file <path>` | no       |         | Input file to upload as multipart form-data        |
| `--wait`              | no       |         | Poll until the execution reaches a terminal status |

### `eigenpal agent execution|exec get [options] <execution-id>`

Get one agent execution.

### Arguments

| Name           | Required | Variadic | Description |
| -------------- | -------- | -------- | ----------- |
| `execution-id` | yes      | no       |             |

### Options

| Flag                | Required | Default      | Description                                                       |
| ------------------- | -------- | ------------ | ----------------------------------------------------------------- |
| `--base-url <url>`  | no       |              | Server base URL                                                   |
| `--json`            | no       |              | Output the raw server response as JSON                            |
| `--include <parts>` | no       | `"feedback"` | Comma-separated extra parts: feedback,expected,files,trace,issues |

### `eigenpal agent execution|exec rerun [options] <execution-id>`

Create a new execution from a previous execution's stored input snapshot.

### Arguments

| Name           | Required | Variadic | Description |
| -------------- | -------- | -------- | ----------- |
| `execution-id` | yes      | no       |             |

### Options

| Flag                   | Required | Default | Description                                    |
| ---------------------- | -------- | ------- | ---------------------------------------------- |
| `--base-url <url>`     | no       |         | Server base URL                                |
| `--json`               | no       |         | Output the raw server response as JSON         |
| `--wait`               | no       |         | Poll until the rerun reaches a terminal status |
| `--interval <seconds>` | no       | `2`     | Polling interval in seconds                    |
| `--max-wait <seconds>` | no       | `1800`  | Maximum wait before exiting 2                  |

### `eigenpal agent execution|exec list|ls [options] <agent-id-or-slug>`

List agent executions.

### Arguments

| Name               | Required | Variadic | Description |
| ------------------ | -------- | -------- | ----------- |
| `agent-id-or-slug` | yes      | no       |             |

### Options

| Flag                                            | Required | Default | Description                                                   |
| ----------------------------------------------- | -------- | ------- | ------------------------------------------------------------- |
| `--base-url <url>`                              | no       |         | Server base URL                                               |
| `--limit <n>`                                   | no       | `50`    | Page size                                                     |
| `--offset <n>`                                  | no       | `0`     | Page offset                                                   |
| `--json`                                        | no       |         | Output the raw server response as JSON                        |
| `--status <status>`                             | no       |         | Filter by status                                              |
| `--batch-id <id>`                               | no       |         | Filter by experiment batch id                                 |
| `--example-name <name>`                         | no       |         | Filter by exact dataset example name                          |
| `--example-name-contains <q>`                   | no       |         | Filter by substring in example name                           |
| `--created-after <time>`                        | no       |         | Filter by created-at lower bound                              |
| `--created-before <time>`                       | no       |         | Filter by created-at upper bound                              |
| `--completed-after <time>`                      | no       |         | Filter by completed-at lower bound                            |
| `--completed-before <time>`                     | no       |         | Filter by completed-at upper bound                            |
| `--feedback-status <open\|resolved\|ignored>`   | no       |         | Filter by feedback status                                     |
| `--feedback-rating <pass\|fail\|partial\|none>` | no       |         | Filter by feedback rating                                     |
| `--feedback-body-contains <q>`                  | no       |         | Filter by feedback body substring                             |
| `--feedback-created-after <time>`               | no       |         | Filter by feedback created-at lower bound                     |
| `--feedback-created-before <time>`              | no       |         | Filter by feedback created-at upper bound                     |
| `--feedback-updated-after <time>`               | no       |         | Filter by feedback updated-at lower bound                     |
| `--feedback-updated-before <time>`              | no       |         | Filter by feedback updated-at upper bound                     |
| `--feedback-resolved-after <time>`              | no       |         | Filter by feedback resolved-at lower bound                    |
| `--feedback-resolved-before <time>`             | no       |         | Filter by feedback resolved-at upper bound                    |
| `--has-feedback`                                | no       |         | Only executions with feedback                                 |
| `--no-feedback`                                 | no       |         | Only executions without feedback                              |
| `--has-expected`                                | no       |         | Only executions with expected JSON or files                   |
| `--has-expected-json`                           | no       |         | Only executions with expected.json                            |
| `--has-expected-files`                          | no       |         | Only executions with expected files                           |
| `--promoted-to-example`                         | no       |         | Only executions promoted to dataset examples                  |
| `--promoted-example-name <name>`                | no       |         | Filter by promoted dataset example name                       |
| `--since-last-resolved`                         | no       |         | Only executions created after the latest resolved feedback    |
| `--include <parts>`                             | no       |         | Comma-separated extra parts: feedback,expected,files          |
| `--compact`                                     | no       |         | Return/print compact triage rows without full output payloads |
| `--sort <field>`                                | no       |         | Sort by createdAt, completedAt, status, or exampleName        |
| `--order <asc\|desc>`                           | no       |         | Sort direction                                                |
| `--scan-limit <n>`                              | no       |         | Feedback scan window for feedback filters                     |

### `eigenpal agent execution|exec pull [options] <execution-id>`

Download execution feedback, expected artifacts, files, and metadata.

### Arguments

| Name           | Required | Variadic | Description |
| -------------- | -------- | -------- | ----------- |
| `execution-id` | yes      | no       |             |

### Options

| Flag                | Required | Default               | Description                                                                           |
| ------------------- | -------- | --------------------- | ------------------------------------------------------------------------------------- |
| `--base-url <url>`  | no       |                       | Server base URL                                                                       |
| `--out <dir>`       | no       |                       | Output directory                                                                      |
| `--include <parts>` | no       | `"feedback,expected"` | Comma-separated parts: feedback,expected,files,output,input,metadata,issues,trace,all |
| `--json`            | no       |                       | Output a JSON summary of written artifacts                                            |

### `eigenpal agent execution|exec compare|diff [options] <reference-execution-id> <execution-id>`

Compare one execution against another execution. PDF/DOCX text comparison uses pdftotext/python3 and reports byte fallbacks.

### Arguments

| Name                     | Required | Variadic | Description |
| ------------------------ | -------- | -------- | ----------- |
| `reference-execution-id` | yes      | no       |             |
| `execution-id`           | yes      | no       |             |

### Options

| Flag                | Required | Default | Description                                                               |
| ------------------- | -------- | ------- | ------------------------------------------------------------------------- |
| `--base-url <url>`  | no       |         | Server base URL                                                           |
| `--json`            | no       |         | Output the raw server response as JSON                                    |
| `--baseline`        | no       |         | Compare actual outputs from both executions instead of expected artifacts |
| `--out <dir>`       | no       |         | Write comparison artifacts to this directory                              |
| `--normalize-dates` | no       |         | Normalize YYYYMMDD and YYYY-MM-DD tokens in filenames/text                |
| `--fail-on-diff`    | no       |         | Exit 1 when comparison status is fail                                     |

### `eigenpal agent execution|exec artifacts|artifact list|ls [options] <execution-id>`

List available execution artifacts without downloading them.

### Arguments

| Name           | Required | Variadic | Description |
| -------------- | -------- | -------- | ----------- |
| `execution-id` | yes      | no       |             |

### Options

| Flag               | Required | Default | Description                            |
| ------------------ | -------- | ------- | -------------------------------------- |
| `--base-url <url>` | no       |         | Server base URL                        |
| `--json`           | no       |         | Output the raw server response as JSON |

### `eigenpal agent execution|exec trace [options] <execution-id>`

Print raw trace.jsonl for an execution, or write it with --out.

### Arguments

| Name           | Required | Variadic | Description |
| -------------- | -------- | -------- | ----------- |
| `execution-id` | yes      | no       |             |

### Options

| Flag               | Required | Default | Description      |
| ------------------ | -------- | ------- | ---------------- |
| `--base-url <url>` | no       |         | Server base URL  |
| `--out <file>`     | no       |         | Output file path |

### `eigenpal agent execution|exec feedback|fb update [options] <execution-id>`

Edit feedback state, rating, message, or expected JSON for an execution.

### Arguments

| Name           | Required | Variadic | Description |
| -------------- | -------- | -------- | ----------- |
| `execution-id` | yes      | no       |             |

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

### `eigenpal agent execution|exec feedback|fb resolve [options] <execution-id>`

Mark execution feedback as resolved.

### Arguments

| Name           | Required | Variadic | Description |
| -------------- | -------- | -------- | ----------- |
| `execution-id` | yes      | no       |             |

### Options

| Flag                    | Required | Default | Description                            |
| ----------------------- | -------- | ------- | -------------------------------------- |
| `--base-url <url>`      | no       |         | Server base URL                        |
| `--json`                | no       |         | Output the raw server response as JSON |
| `--message <text>`      | no       |         | Set feedback message body              |
| `--message-file <path>` | no       |         | Read feedback message body from a file |

### `eigenpal agent execution|exec feedback|fb clear [options] <execution-id>`

Delete feedback, expected.json, and expected files for an execution.

### Arguments

| Name           | Required | Variadic | Description |
| -------------- | -------- | -------- | ----------- |
| `execution-id` | yes      | no       |             |

### Options

| Flag               | Required | Default | Description                              |
| ------------------ | -------- | ------- | ---------------------------------------- |
| `--base-url <url>` | no       |         | Server base URL                          |
| `--json`           | no       |         | Output the raw server response as JSON   |
| `--yes`            | no       |         | Required in non-interactive environments |

### `eigenpal agent execution|exec expected list|ls [options] <execution-id>`

List expected JSON and files attached to an execution.

### Arguments

| Name           | Required | Variadic | Description |
| -------------- | -------- | -------- | ----------- |
| `execution-id` | yes      | no       |             |

### Options

| Flag               | Required | Default | Description                            |
| ------------------ | -------- | ------- | -------------------------------------- |
| `--base-url <url>` | no       |         | Server base URL                        |
| `--json`           | no       |         | Output the raw server response as JSON |

### `eigenpal agent execution|exec expected pull [options] <execution-id>`

Download expected JSON and files attached to an execution.

### Arguments

| Name           | Required | Variadic | Description |
| -------------- | -------- | -------- | ----------- |
| `execution-id` | yes      | no       |             |

### Options

| Flag               | Required | Default | Description      |
| ------------------ | -------- | ------- | ---------------- |
| `--base-url <url>` | no       |         | Server base URL  |
| `--out <dir>`      | no       |         | Output directory |

### `eigenpal agent execution|exec expected upload [options] <execution-id> <file>`

Upload a local file as an expected artifact.

### Arguments

| Name           | Required | Variadic | Description |
| -------------- | -------- | -------- | ----------- |
| `execution-id` | yes      | no       |             |
| `file`         | yes      | no       |             |

### Options

| Flag               | Required | Default | Description                            |
| ------------------ | -------- | ------- | -------------------------------------- |
| `--base-url <url>` | no       |         | Server base URL                        |
| `--json`           | no       |         | Output the raw server response as JSON |
| `--name <name>`    | no       |         | Expected artifact name                 |

### `eigenpal agent execution|exec expected copy-output [options] <execution-id> <output-file>`

Copy a generated output file into expected artifacts.

### Arguments

| Name           | Required | Variadic | Description |
| -------------- | -------- | -------- | ----------- |
| `execution-id` | yes      | no       |             |
| `output-file`  | yes      | no       |             |

### Options

| Flag               | Required | Default | Description                            |
| ------------------ | -------- | ------- | -------------------------------------- |
| `--base-url <url>` | no       |         | Server base URL                        |
| `--json`           | no       |         | Output the raw server response as JSON |
| `--name <name>`    | no       |         | Expected artifact name                 |

### `eigenpal agent execution|exec expected rename [options] <execution-id> <old-name> <new-name>`

Rename an expected artifact.

### Arguments

| Name           | Required | Variadic | Description |
| -------------- | -------- | -------- | ----------- |
| `execution-id` | yes      | no       |             |
| `old-name`     | yes      | no       |             |
| `new-name`     | yes      | no       |             |

### Options

| Flag               | Required | Default | Description                            |
| ------------------ | -------- | ------- | -------------------------------------- |
| `--base-url <url>` | no       |         | Server base URL                        |
| `--json`           | no       |         | Output the raw server response as JSON |

### `eigenpal agent execution|exec expected delete [options] <execution-id> <name>`

Delete an expected artifact.

### Arguments

| Name           | Required | Variadic | Description |
| -------------- | -------- | -------- | ----------- |
| `execution-id` | yes      | no       |             |
| `name`         | yes      | no       |             |

### Options

| Flag               | Required | Default | Description                              |
| ------------------ | -------- | ------- | ---------------------------------------- |
| `--base-url <url>` | no       |         | Server base URL                          |
| `--json`           | no       |         | Output the raw server response as JSON   |
| `--yes`            | no       |         | Required in non-interactive environments |

### `eigenpal agent execution|exec watch [options] <execution-id>`

Watch an execution until it reaches a terminal status.

### Arguments

| Name           | Required | Variadic | Description |
| -------------- | -------- | -------- | ----------- |
| `execution-id` | yes      | no       |             |

### Options

| Flag                   | Required | Default | Description                            |
| ---------------------- | -------- | ------- | -------------------------------------- |
| `--base-url <url>`     | no       |         | Server base URL                        |
| `--json`               | no       |         | Output the raw server response as JSON |
| `--interval <seconds>` | no       | `2`     | Polling interval in seconds            |
| `--max-wait <seconds>` | no       | `1800`  | Maximum wait before exiting 2          |

### `eigenpal agent execution|exec cancel [options] <execution-id>`

Cancel an agent execution.

### Arguments

| Name           | Required | Variadic | Description |
| -------------- | -------- | -------- | ----------- |
| `execution-id` | yes      | no       |             |

### Options

| Flag               | Required | Default | Description                              |
| ------------------ | -------- | ------- | ---------------------------------------- |
| `--base-url <url>` | no       |         | Server base URL                          |
| `--json`           | no       |         | Output the raw server response as JSON   |
| `--yes`            | no       |         | Required in non-interactive environments |

### `eigenpal agent experiment|exp run [options] <agent-id-or-slug>`

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

### `eigenpal agent experiment|exp status [options] <agent-id-or-slug> <batch-id>`

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

### `eigenpal agent experiment|exp results [options] <agent-id-or-slug> [batch-id]`

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

### `eigenpal agent experiment|exp list|ls [options] <agent-id-or-slug>`

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

### `eigenpal agent experiment|exp compare|diff [options] <batch-id-a> <batch-id-b>`

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

### `eigenpal agent experiment|exp cancel [options] <agent-id-or-slug> <batch-id>`

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

### `eigenpal agent session list|ls [options] <agent-id-or-slug>`

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

### `eigenpal agent session get [options] <session-id>`

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

### `eigenpal agent session start [options] <agent-id-or-slug>`

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

### `eigenpal agent session message [options] <session-id>`

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

### `eigenpal agent session stop [options] <session-id>`

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

### `eigenpal agent trigger list|ls [options] <agent-id-or-slug>`

List enabled agent triggers.

### Arguments

| Name               | Required | Variadic | Description |
| ------------------ | -------- | -------- | ----------- |
| `agent-id-or-slug` | yes      | no       |             |

### Options

| Flag               | Required | Default | Description                            |
| ------------------ | -------- | ------- | -------------------------------------- |
| `--base-url <url>` | no       |         | Server base URL                        |
| `--json`           | no       |         | Output the raw server response as JSON |

### `eigenpal agent trigger api enable [options] <agent-id-or-slug>`

Enable the API trigger for an agent.

### Arguments

| Name               | Required | Variadic | Description |
| ------------------ | -------- | -------- | ----------- |
| `agent-id-or-slug` | yes      | no       |             |

### Options

| Flag               | Required | Default | Description                            |
| ------------------ | -------- | ------- | -------------------------------------- |
| `--base-url <url>` | no       |         | Server base URL                        |
| `--json`           | no       |         | Output the raw server response as JSON |

### `eigenpal agent trigger api disable [options] <agent-id-or-slug>`

Disable the API trigger for an agent.

### Arguments

| Name               | Required | Variadic | Description |
| ------------------ | -------- | -------- | ----------- |
| `agent-id-or-slug` | yes      | no       |             |

### Options

| Flag               | Required | Default | Description                            |
| ------------------ | -------- | ------- | -------------------------------------- |
| `--base-url <url>` | no       |         | Server base URL                        |
| `--json`           | no       |         | Output the raw server response as JSON |

### `eigenpal agent trigger email enable [options] <agent-id-or-slug>`

Enable the email trigger for an agent.

### Arguments

| Name               | Required | Variadic | Description |
| ------------------ | -------- | -------- | ----------- |
| `agent-id-or-slug` | yes      | no       |             |

### Options

| Flag               | Required | Default | Description                            |
| ------------------ | -------- | ------- | -------------------------------------- |
| `--base-url <url>` | no       |         | Server base URL                        |
| `--json`           | no       |         | Output the raw server response as JSON |

### `eigenpal agent trigger email disable [options] <agent-id-or-slug>`

Disable the email trigger for an agent.

### Arguments

| Name               | Required | Variadic | Description |
| ------------------ | -------- | -------- | ----------- |
| `agent-id-or-slug` | yes      | no       |             |

### Options

| Flag               | Required | Default | Description                            |
| ------------------ | -------- | ------- | -------------------------------------- |
| `--base-url <url>` | no       |         | Server base URL                        |
| `--json`           | no       |         | Output the raw server response as JSON |

### `eigenpal agent trigger email list|ls [options] [agent-id-or-slug]`

List email triggers, optionally filtered to one agent.

### Arguments

| Name               | Required | Variadic | Description |
| ------------------ | -------- | -------- | ----------- |
| `agent-id-or-slug` | no       | no       |             |

### Options

| Flag               | Required | Default | Description                            |
| ------------------ | -------- | ------- | -------------------------------------- |
| `--base-url <url>` | no       |         | Server base URL                        |
| `--json`           | no       |         | Output the raw server response as JSON |

### `eigenpal agent trigger email add [options] <agent-id-or-slug>`

Add an email trigger to an agent.

### Arguments

| Name               | Required | Variadic | Description |
| ------------------ | -------- | -------- | ----------- |
| `agent-id-or-slug` | yes      | no       |             |

### Options

| Flag                         | Required | Default | Description                            |
| ---------------------------- | -------- | ------- | -------------------------------------- |
| `--base-url <url>`           | no       |         | Server base URL                        |
| `--json`                     | no       |         | Output the raw server response as JSON |
| `--email <local-part>`       | yes      |         | Email local-part, e.g. invoice-intake  |
| `--label <label>`            | no       |         | Human label                            |
| `--allow <sender>`           | no       | `[]`    | Allowed sender pattern; repeatable     |
| `--reply <never\|always>`    | no       |         | Reply behavior                         |
| `--reply-mode <sender\|all>` | no       |         | Reply recipients                       |

### `eigenpal agent trigger email update [options] <agent-id-or-slug> <email-id>`

Update an email trigger.

### Arguments

| Name               | Required | Variadic | Description |
| ------------------ | -------- | -------- | ----------- |
| `agent-id-or-slug` | yes      | no       |             |
| `email-id`         | yes      | no       |             |

### Options

| Flag                          | Required | Default | Description                            |
| ----------------------------- | -------- | ------- | -------------------------------------- |
| `--base-url <url>`            | no       |         | Server base URL                        |
| `--json`                      | no       |         | Output the raw server response as JSON |
| `--label <label>`             | no       |         | Human label                            |
| `--allow <sender>`            | no       | `[]`    | Allowed sender pattern; repeatable     |
| `--status <active\|disabled>` | no       |         | Email trigger status                   |
| `--reply <never\|always>`     | no       |         | Reply behavior                         |
| `--reply-mode <sender\|all>`  | no       |         | Reply recipients                       |

### `eigenpal agent trigger email remove [options] <agent-id-or-slug> <email-id>`

Remove an email trigger.

### Arguments

| Name               | Required | Variadic | Description |
| ------------------ | -------- | -------- | ----------- |
| `agent-id-or-slug` | yes      | no       |             |
| `email-id`         | yes      | no       |             |

### Options

| Flag               | Required | Default | Description                              |
| ------------------ | -------- | ------- | ---------------------------------------- |
| `--base-url <url>` | no       |         | Server base URL                          |
| `--json`           | no       |         | Output the raw server response as JSON   |
| `--yes`            | no       |         | Required in non-interactive environments |

### `eigenpal agent evaluators list|ls [options] [agent-id-or-slug]`

Agent evaluators are reserved for future workflow-style evaluators. Coming soon.

### Arguments

| Name               | Required | Variadic | Description |
| ------------------ | -------- | -------- | ----------- |
| `agent-id-or-slug` | no       | no       |             |

### `eigenpal agent versions list|ls [options] [agent-id-or-slug]`

Agent versions are coming soon. Coming soon.

### Arguments

| Name               | Required | Variadic | Description |
| ------------------ | -------- | -------- | ----------- |
| `agent-id-or-slug` | no       | no       |             |
