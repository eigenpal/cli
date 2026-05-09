# eigenpal agent

Manage Eigenpal agents, triggers, datasets, executions, experiments, and sessions.

## Contents

- [Surface](#surface)
- [Commands](#commands)
  - [Core](#core)
  - [Dataset](#dataset)
  - [Execution](#execution)
  - [Experiment](#experiment)
  - [Session](#session)
  - [Trigger](#trigger)
  - [Evaluators](#evaluators)
  - [Versions](#versions)
- [Details](#details)
  - [`eigenpal agent list [options]`](#eigenpal-agent-list-options)
  - [`eigenpal agent push [options]`](#eigenpal-agent-push-options)
  - [`eigenpal agent pull [options] <agent-id-or-slug>`](#eigenpal-agent-pull-options-agent-id-or-slug)
  - [`eigenpal agent validate [options] [dir]`](#eigenpal-agent-validate-options-dir)
  - [`eigenpal agent dataset list [options] <agent-id-or-slug>`](#eigenpal-agent-dataset-list-options-agent-id-or-slug)
  - [`eigenpal agent dataset push [options] <agent-id-or-slug>`](#eigenpal-agent-dataset-push-options-agent-id-or-slug)
  - [`eigenpal agent dataset pull [options] <agent-id-or-slug>`](#eigenpal-agent-dataset-pull-options-agent-id-or-slug)
  - [`eigenpal agent dataset validate [options] [path]`](#eigenpal-agent-dataset-validate-options-path)
  - [`eigenpal agent execution run [options] <agent-id-or-slug>`](#eigenpal-agent-execution-run-options-agent-id-or-slug)
  - [`eigenpal agent execution get [options] <execution-id>`](#eigenpal-agent-execution-get-options-execution-id)
  - [`eigenpal agent execution list [options] <agent-id-or-slug>`](#eigenpal-agent-execution-list-options-agent-id-or-slug)
  - [`eigenpal agent execution watch [options] <execution-id>`](#eigenpal-agent-execution-watch-options-execution-id)
  - [`eigenpal agent execution cancel [options] <execution-id>`](#eigenpal-agent-execution-cancel-options-execution-id)
  - [`eigenpal agent experiment run [options] <agent-id-or-slug>`](#eigenpal-agent-experiment-run-options-agent-id-or-slug)
  - [`eigenpal agent experiment status [options] <agent-id-or-slug> <batch-id>`](#eigenpal-agent-experiment-status-options-agent-id-or-slug-batch-id)
  - [`eigenpal agent experiment results [options] <agent-id-or-slug> [batch-id]`](#eigenpal-agent-experiment-results-options-agent-id-or-slug-batch-id)
  - [`eigenpal agent experiment list [options] <agent-id-or-slug>`](#eigenpal-agent-experiment-list-options-agent-id-or-slug)
  - [`eigenpal agent experiment compare [options] <batch-id-a> <batch-id-b>`](#eigenpal-agent-experiment-compare-options-batch-id-a-batch-id-b)
  - [`eigenpal agent experiment cancel [options] <agent-id-or-slug> <batch-id>`](#eigenpal-agent-experiment-cancel-options-agent-id-or-slug-batch-id)
  - [`eigenpal agent session list [options] <agent-id-or-slug>`](#eigenpal-agent-session-list-options-agent-id-or-slug)
  - [`eigenpal agent session get [options] <session-id>`](#eigenpal-agent-session-get-options-session-id)
  - [`eigenpal agent session start [options] <agent-id-or-slug>`](#eigenpal-agent-session-start-options-agent-id-or-slug)
  - [`eigenpal agent session message [options] <session-id>`](#eigenpal-agent-session-message-options-session-id)
  - [`eigenpal agent session stop [options] <session-id>`](#eigenpal-agent-session-stop-options-session-id)
  - [`eigenpal agent trigger list [options] <agent-id-or-slug>`](#eigenpal-agent-trigger-list-options-agent-id-or-slug)
  - [`eigenpal agent trigger api enable [options] <agent-id-or-slug>`](#eigenpal-agent-trigger-api-enable-options-agent-id-or-slug)
  - [`eigenpal agent trigger api disable [options] <agent-id-or-slug>`](#eigenpal-agent-trigger-api-disable-options-agent-id-or-slug)
  - [`eigenpal agent trigger email enable [options] <agent-id-or-slug>`](#eigenpal-agent-trigger-email-enable-options-agent-id-or-slug)
  - [`eigenpal agent trigger email disable [options] <agent-id-or-slug>`](#eigenpal-agent-trigger-email-disable-options-agent-id-or-slug)
  - [`eigenpal agent trigger email list [options] [agent-id-or-slug]`](#eigenpal-agent-trigger-email-list-options-agent-id-or-slug)
  - [`eigenpal agent trigger email add [options] <agent-id-or-slug>`](#eigenpal-agent-trigger-email-add-options-agent-id-or-slug)
  - [`eigenpal agent trigger email update [options] <agent-id-or-slug> <email-id>`](#eigenpal-agent-trigger-email-update-options-agent-id-or-slug-email-id)
  - [`eigenpal agent trigger email remove [options] <agent-id-or-slug> <email-id>`](#eigenpal-agent-trigger-email-remove-options-agent-id-or-slug-email-id)
  - [`eigenpal agent evaluators list [options] [agent-id-or-slug]`](#eigenpal-agent-evaluators-list-options-agent-id-or-slug)
  - [`eigenpal agent versions list [options] [agent-id-or-slug]`](#eigenpal-agent-versions-list-options-agent-id-or-slug)

## Surface

```
agent
├── list
├── push
├── pull <agent-id-or-slug>
├── validate [dir]
├── dataset
│   ├── list <agent-id-or-slug>
│   ├── push <agent-id-or-slug>
│   ├── pull <agent-id-or-slug>
│   └── validate [path]
├── execution
│   ├── run <agent-id-or-slug>
│   ├── get <execution-id>
│   ├── list <agent-id-or-slug>
│   ├── watch <execution-id>
│   └── cancel <execution-id>
├── experiment
│   ├── run <agent-id-or-slug>
│   ├── status <agent-id-or-slug> <batch-id>
│   ├── results <agent-id-or-slug> [batch-id]
│   ├── list <agent-id-or-slug>
│   ├── compare <batch-id-a> <batch-id-b>
│   └── cancel <agent-id-or-slug> <batch-id>
├── session
│   ├── list <agent-id-or-slug>
│   ├── get <session-id>
│   ├── start <agent-id-or-slug>
│   ├── message <session-id>
│   └── stop <session-id>
├── trigger
│   ├── list <agent-id-or-slug>
│   ├── api
│   │   ├── enable <agent-id-or-slug>
│   │   └── disable <agent-id-or-slug>
│   └── email
│       ├── enable <agent-id-or-slug>
│       ├── disable <agent-id-or-slug>
│       ├── list [agent-id-or-slug]
│       ├── add <agent-id-or-slug>
│       ├── update <agent-id-or-slug> <email-id>
│       └── remove <agent-id-or-slug> <email-id>
├── evaluators
│   └── list [agent-id-or-slug]
└── versions
    └── list [agent-id-or-slug]
```

## Commands

### Core

| Command                                            | Description                                                      |
| -------------------------------------------------- | ---------------------------------------------------------------- |
| `eigenpal agent list [options]`                    | List agents.                                                     |
| `eigenpal agent push [options]`                    | Create or update an agent from agent.yaml, agent/, and dataset/. |
| `eigenpal agent pull [options] <agent-id-or-slug>` | Download an agent project as agent.yaml, agent/, and dataset/.   |
| `eigenpal agent validate [options] [dir]`          | Validate a local agent project layout.                           |

### Dataset

| Command                                                    | Description                                             |
| ---------------------------------------------------------- | ------------------------------------------------------- |
| `eigenpal agent dataset list [options] <agent-id-or-slug>` | List dataset examples for an agent.                     |
| `eigenpal agent dataset push [options] <agent-id-or-slug>` | Upload dataset examples from a local dataset directory. |
| `eigenpal agent dataset pull [options] <agent-id-or-slug>` | Download an agent dataset directory.                    |
| `eigenpal agent dataset validate [options] [path]`         | Validate a local dataset directory.                     |

### Execution

| Command                                                      | Description                                            |
| ------------------------------------------------------------ | ------------------------------------------------------ |
| `eigenpal agent execution run [options] <agent-id-or-slug>`  | Start one agent execution.                             |
| `eigenpal agent execution get [options] <execution-id>`      | Get one agent execution.                               |
| `eigenpal agent execution list [options] <agent-id-or-slug>` | List agent executions.                                 |
| `eigenpal agent execution watch [options] <execution-id>`    | Watch an execution until it reaches a terminal status. |
| `eigenpal agent execution cancel [options] <execution-id>`   | Cancel an agent execution.                             |

### Experiment

| Command                                                                     | Description                                     |
| --------------------------------------------------------------------------- | ----------------------------------------------- |
| `eigenpal agent experiment run [options] <agent-id-or-slug>`                | Start an experiment over dataset examples.      |
| `eigenpal agent experiment status [options] <agent-id-or-slug> <batch-id>`  | Get experiment status.                          |
| `eigenpal agent experiment results [options] <agent-id-or-slug> [batch-id]` | Print experiment results as JSON or CSV.        |
| `eigenpal agent experiment list [options] <agent-id-or-slug>`               | List experiments.                               |
| `eigenpal agent experiment compare [options] <batch-id-a> <batch-id-b>`     | Compare two experiment batches.                 |
| `eigenpal agent experiment cancel [options] <agent-id-or-slug> <batch-id>`  | Cancel every active execution in an experiment. |

### Session

| Command                                                     | Description                            |
| ----------------------------------------------------------- | -------------------------------------- |
| `eigenpal agent session list [options] <agent-id-or-slug>`  | List builder sessions for an agent.    |
| `eigenpal agent session get [options] <session-id>`         | Get a builder session and messages.    |
| `eigenpal agent session start [options] <agent-id-or-slug>` | Start a builder session.               |
| `eigenpal agent session message [options] <session-id>`     | Append a message to a builder session. |
| `eigenpal agent session stop [options] <session-id>`        | Stop a builder session.                |

### Trigger

| Command                                                                       | Description                                            |
| ----------------------------------------------------------------------------- | ------------------------------------------------------ |
| `eigenpal agent trigger list [options] <agent-id-or-slug>`                    | List enabled agent triggers.                           |
| `eigenpal agent trigger api enable [options] <agent-id-or-slug>`              | Enable the API trigger for an agent.                   |
| `eigenpal agent trigger api disable [options] <agent-id-or-slug>`             | Disable the API trigger for an agent.                  |
| `eigenpal agent trigger email enable [options] <agent-id-or-slug>`            | Enable the email trigger for an agent.                 |
| `eigenpal agent trigger email disable [options] <agent-id-or-slug>`           | Disable the email trigger for an agent.                |
| `eigenpal agent trigger email list [options] [agent-id-or-slug]`              | List email triggers, optionally filtered to one agent. |
| `eigenpal agent trigger email add [options] <agent-id-or-slug>`               | Add an email trigger to an agent.                      |
| `eigenpal agent trigger email update [options] <agent-id-or-slug> <email-id>` | Update an email trigger.                               |
| `eigenpal agent trigger email remove [options] <agent-id-or-slug> <email-id>` | Remove an email trigger.                               |

### Evaluators

| Command                                                       | Description                                                                      |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `eigenpal agent evaluators list [options] [agent-id-or-slug]` | Agent evaluators are reserved for future workflow-style evaluators. Coming soon. |

### Versions

| Command                                                     | Description                                  |
| ----------------------------------------------------------- | -------------------------------------------- |
| `eigenpal agent versions list [options] [agent-id-or-slug]` | Agent versions are coming soon. Coming soon. |

## Details

### `eigenpal agent list [options]`

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

### `eigenpal agent dataset list [options] <agent-id-or-slug>`

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

### `eigenpal agent execution run [options] <agent-id-or-slug>`

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

### `eigenpal agent execution get [options] <execution-id>`

Get one agent execution.

### Arguments

| Name           | Required | Variadic | Description |
| -------------- | -------- | -------- | ----------- |
| `execution-id` | yes      | no       |             |

### Options

| Flag                | Required | Default | Description                             |
| ------------------- | -------- | ------- | --------------------------------------- |
| `--base-url <url>`  | no       |         | Server base URL                         |
| `--json`            | no       |         | Output the raw server response as JSON  |
| `--include <parts>` | no       |         | Comma-separated extra parts, e.g. files |

### `eigenpal agent execution list [options] <agent-id-or-slug>`

List agent executions.

### Arguments

| Name               | Required | Variadic | Description |
| ------------------ | -------- | -------- | ----------- |
| `agent-id-or-slug` | yes      | no       |             |

### Options

| Flag                | Required | Default | Description                            |
| ------------------- | -------- | ------- | -------------------------------------- |
| `--base-url <url>`  | no       |         | Server base URL                        |
| `--limit <n>`       | no       | `50`    | Page size                              |
| `--offset <n>`      | no       | `0`     | Page offset                            |
| `--json`            | no       |         | Output the raw server response as JSON |
| `--status <status>` | no       |         | Filter by status                       |

### `eigenpal agent execution watch [options] <execution-id>`

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

### `eigenpal agent execution cancel [options] <execution-id>`

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

### `eigenpal agent experiment run [options] <agent-id-or-slug>`

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

### `eigenpal agent experiment status [options] <agent-id-or-slug> <batch-id>`

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

### `eigenpal agent experiment results [options] <agent-id-or-slug> [batch-id]`

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

### `eigenpal agent experiment list [options] <agent-id-or-slug>`

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

### `eigenpal agent experiment compare [options] <batch-id-a> <batch-id-b>`

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

### `eigenpal agent experiment cancel [options] <agent-id-or-slug> <batch-id>`

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

### `eigenpal agent session list [options] <agent-id-or-slug>`

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

### `eigenpal agent trigger list [options] <agent-id-or-slug>`

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

### `eigenpal agent trigger email list [options] [agent-id-or-slug]`

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

### `eigenpal agent evaluators list [options] [agent-id-or-slug]`

Agent evaluators are reserved for future workflow-style evaluators. Coming soon.

### Arguments

| Name               | Required | Variadic | Description |
| ------------------ | -------- | -------- | ----------- |
| `agent-id-or-slug` | no       | no       |             |

### `eigenpal agent versions list [options] [agent-id-or-slug]`

Agent versions are coming soon. Coming soon.

### Arguments

| Name               | Required | Variadic | Description |
| ------------------ | -------- | -------- | ----------- |
| `agent-id-or-slug` | no       | no       |             |
