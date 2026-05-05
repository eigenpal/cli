# eigenpal workflow

Manage workflows: push, pull, run, evaluate.

## Contents

- [Surface](#surface)
- [Commands](#commands)
  - [Core](#core)
  - [Evaluators](#evaluators)
  - [Dataset](#dataset)
  - [Experiment](#experiment)
  - [Execution](#execution)
  - [Versions](#versions)
  - [Step-type](#step-type)
  - [Evaluator-type](#evaluator-type)
  - [Step](#step)
- [Details](#details)
  - [`eigenpal workflow list [options]`](#eigenpal-workflow-list-options)
  - [`eigenpal workflow pull [options] <workflow-id>`](#eigenpal-workflow-pull-options-workflow-id)
  - [`eigenpal workflow push [options]`](#eigenpal-workflow-push-options)
  - [`eigenpal workflow validate [options]`](#eigenpal-workflow-validate-options)
  - [`eigenpal workflow clear-local [options] [examples...]`](#eigenpal-workflow-clear-local-options-examples)
  - [`eigenpal workflow evaluators pull [options] <workflow-id>`](#eigenpal-workflow-evaluators-pull-options-workflow-id)
  - [`eigenpal workflow evaluators push [options] <workflow-id>`](#eigenpal-workflow-evaluators-push-options-workflow-id)
  - [`eigenpal workflow evaluators validate [options] [path]`](#eigenpal-workflow-evaluators-validate-options-path)
  - [`eigenpal workflow dataset list [options] <workflow-id>`](#eigenpal-workflow-dataset-list-options-workflow-id)
  - [`eigenpal workflow dataset pull [options] <workflow-id>`](#eigenpal-workflow-dataset-pull-options-workflow-id)
  - [`eigenpal workflow dataset push [options] <workflow-id>`](#eigenpal-workflow-dataset-push-options-workflow-id)
  - [`eigenpal workflow dataset example create [options] <workflow-id>`](#eigenpal-workflow-dataset-example-create-options-workflow-id)
  - [`eigenpal workflow dataset example update [options] <workflow-id> <exampleId>`](#eigenpal-workflow-dataset-example-update-options-workflow-id-exampleid)
  - [`eigenpal workflow dataset example delete [options] <workflow-id> <exampleId>`](#eigenpal-workflow-dataset-example-delete-options-workflow-id-exampleid)
  - [`eigenpal workflow dataset example get [options] <workflow-id> <exampleId>`](#eigenpal-workflow-dataset-example-get-options-workflow-id-exampleid)
  - [`eigenpal workflow dataset validate [options] [path]`](#eigenpal-workflow-dataset-validate-options-path)
  - [`eigenpal workflow experiment list [options] <workflow-id>`](#eigenpal-workflow-experiment-list-options-workflow-id)
  - [`eigenpal workflow experiment run [options] <workflow-id>`](#eigenpal-workflow-experiment-run-options-workflow-id)
  - [`eigenpal workflow experiment status [options] <workflow-id> <batchId>`](#eigenpal-workflow-experiment-status-options-workflow-id-batchid)
  - [`eigenpal workflow experiment results [options] <workflow-id> [batchId]`](#eigenpal-workflow-experiment-results-options-workflow-id-batchid)
  - [`eigenpal workflow experiment compare [options] <batchIdA> <batchIdB>`](#eigenpal-workflow-experiment-compare-options-batchida-batchidb)
  - [`eigenpal workflow execution run [options] <workflow-id> [examples...]`](#eigenpal-workflow-execution-run-options-workflow-id-examples)
  - [`eigenpal workflow execution get [options] <executionId>`](#eigenpal-workflow-execution-get-options-executionid)
  - [`eigenpal workflow execution list [options] <workflow-id>`](#eigenpal-workflow-execution-list-options-workflow-id)
  - [`eigenpal workflow execution watch [options] <executionId>`](#eigenpal-workflow-execution-watch-options-executionid)
  - [`eigenpal workflow execution compare [options] <executionA> <executionB>`](#eigenpal-workflow-execution-compare-options-executiona-executionb)
  - [`eigenpal workflow execution cancel [options] <executionId>`](#eigenpal-workflow-execution-cancel-options-executionid)
  - [`eigenpal workflow versions list [options] <workflow-id>`](#eigenpal-workflow-versions-list-options-workflow-id)
  - [`eigenpal workflow versions restore [options] <workflow-id> <versionId>`](#eigenpal-workflow-versions-restore-options-workflow-id-versionid)
  - [`eigenpal workflow step-type list [options]`](#eigenpal-workflow-step-type-list-options)
  - [`eigenpal workflow step-type get [options] <type>`](#eigenpal-workflow-step-type-get-options-type)
  - [`eigenpal workflow evaluator-type list [options]`](#eigenpal-workflow-evaluator-type-list-options)
  - [`eigenpal workflow evaluator-type get [options] <type>`](#eigenpal-workflow-evaluator-type-get-options-type)
  - [`eigenpal workflow step exec [options] <type>`](#eigenpal-workflow-step-exec-options-type)

## Surface

```
workflow
├── list
├── pull <workflow-id>
├── push
├── evaluators
│   ├── pull <workflow-id>
│   ├── push <workflow-id>
│   └── validate [path]
├── dataset
│   ├── list <workflow-id>
│   ├── pull <workflow-id>
│   ├── push <workflow-id>
│   ├── example
│   │   ├── create <workflow-id>
│   │   ├── update <workflow-id> <exampleId>
│   │   ├── delete <workflow-id> <exampleId>
│   │   └── get <workflow-id> <exampleId>
│   └── validate [path]
├── experiment
│   ├── list <workflow-id>
│   ├── run <workflow-id>
│   ├── status <workflow-id> <batchId>
│   ├── results <workflow-id> [batchId]
│   └── compare <batchIdA> <batchIdB>
├── execution
│   ├── run <workflow-id> [examples...]
│   ├── get <executionId>
│   ├── list <workflow-id>
│   ├── watch <executionId>
│   ├── compare <executionA> <executionB>
│   └── cancel <executionId>
├── versions
│   ├── list <workflow-id>
│   └── restore <workflow-id> <versionId>
├── step-type
│   ├── list
│   └── get <type>
├── evaluator-type
│   ├── list
│   └── get <type>
├── validate
├── clear-local [examples...]
└── step
    └── exec <type>
```

## Commands

### Core

| Command                                                 | Description                                                                                                                                                                            |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `eigenpal workflow list [options]`                      | List workflows the caller can read.                                                                                                                                                    |
| `eigenpal workflow pull [options] <workflow-id>`        | Download the YAML definition of the workflow at its current version.                                                                                                                   |
| `eigenpal workflow push [options]`                      | Create or update a workflow from a YAML file.                                                                                                                                          |
| `eigenpal workflow validate [options]`                  | Local-only validation against the templated project layout: ./workflow.yaml + ./evaluators.yaml + ./dataset/. For targeted validation use `evaluators validate` or `dataset validate`. |
| `eigenpal workflow clear-local [options] [examples...]` | Delete local execution artifacts under ./dataset/examples/. Keeps the latest run per example by default.                                                                               |

### Evaluators

| Command                                                     | Description                                                                                    |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `eigenpal workflow evaluators pull [options] <workflow-id>` | Download the workflow's evaluators YAML.                                                       |
| `eigenpal workflow evaluators push [options] <workflow-id>` | Overwrite the workflow's evaluator config from a YAML file.                                    |
| `eigenpal workflow evaluators validate [options] [path]`    | Validate an evaluators YAML file against the EvalConfig schema. Defaults to ./evaluators.yaml. |

### Dataset

| Command                                                                        | Description                                                                                                     |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `eigenpal workflow dataset list [options] <workflow-id>`                       | List eval examples for the workflow.                                                                            |
| `eigenpal workflow dataset pull [options] <workflow-id>`                       | Download the workflow's dataset as a ZIP archive.                                                               |
| `eigenpal workflow dataset push [options] <workflow-id>`                       | Replace or extend the workflow's dataset from a ZIP or folder.                                                  |
| `eigenpal workflow dataset example create [options] <workflow-id>`             | Create one eval example without re-uploading the dataset.                                                       |
| `eigenpal workflow dataset example update [options] <workflow-id> <exampleId>` | Patch one eval example. Omitted flags are left alone.                                                           |
| `eigenpal workflow dataset example delete [options] <workflow-id> <exampleId>` | Delete one eval example by id. Non-TTY shells require --yes.                                                    |
| `eigenpal workflow dataset example get [options] <workflow-id> <exampleId>`    | Fetch one eval example with full triggerInput, expectedOutput, and metadata.                                    |
| `eigenpal workflow dataset validate [options] [path]`                          | Validate a dataset folder against the examples/<name>/{input,expected,meta} convention. Defaults to ./dataset/. |

### Experiment

| Command                                                                  | Description                                        |
| ------------------------------------------------------------------------ | -------------------------------------------------- |
| `eigenpal workflow experiment list [options] <workflow-id>`              | List executions for the workflow, newest first.    |
| `eigenpal workflow experiment run [options] <workflow-id>`               | Start a batch eval against the workflow's dataset. |
| `eigenpal workflow experiment status [options] <workflow-id> <batchId>`  | Aggregate progress for a batch by `batchId`.       |
| `eigenpal workflow experiment results [options] <workflow-id> [batchId]` | Download eval results in CSV or JSON.              |
| `eigenpal workflow experiment compare [options] <batchIdA> <batchIdB>`   | Diff eval scores between two experiment batches.   |

### Execution

| Command                                                                   | Description                                                      |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `eigenpal workflow execution run [options] <workflow-id> [examples...]`   | Run a saved workflow against local dataset examples.             |
| `eigenpal workflow execution get [options] <executionId>`                 | Fetch a single execution payload. Optionally narrow to one step. |
| `eigenpal workflow execution list [options] <workflow-id>`                | List recent executions for a workflow.                           |
| `eigenpal workflow execution watch [options] <executionId>`               | Stream live execution status until terminal or 30-min detach.    |
| `eigenpal workflow execution compare [options] <executionA> <executionB>` | Diff two executions side-by-side, per step.                      |
| `eigenpal workflow execution cancel [options] <executionId>`              | Cancel an execution. Idempotent on already-terminal runs.        |

### Versions

| Command                                                                  | Description                                      |
| ------------------------------------------------------------------------ | ------------------------------------------------ |
| `eigenpal workflow versions list [options] <workflow-id>`                | List historical workflow versions, newest first. |
| `eigenpal workflow versions restore [options] <workflow-id> <versionId>` | Restore the workflow to a previous version.      |

### Step-type

| Command                                            | Description                                                   |
| -------------------------------------------------- | ------------------------------------------------------------- |
| `eigenpal workflow step-type list [options]`       | List every step type the deployment supports.                 |
| `eigenpal workflow step-type get [options] <type>` | Return the full schema and behavioral docs for one step type. |

### Evaluator-type

| Command                                                 | Description                                                                                 |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `eigenpal workflow evaluator-type list [options]`       | List every evaluator type with a one-line description.                                      |
| `eigenpal workflow evaluator-type get [options] <type>` | Fetch the JSON Schema for one evaluator type. Pipe through `jq` to inspect specific fields. |

### Step

| Command                                        | Description                                                                                                                                                                                                      |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `eigenpal workflow step exec [options] <type>` | Run one step locally with sample inputs and print its output as JSON. <type> is any value from `workflow step-type list`; only types with a local runner actually execute (today: transform.script, ai.extract). |

## Details

### `eigenpal workflow list [options]`

List workflows the caller can read.

### Options

| Flag               | Required | Default | Description                            |
| ------------------ | -------- | ------- | -------------------------------------- |
| `--search <q>`     | no       |         | Filter by name                         |
| `--limit <n>`      | no       | `50`    | Page size                              |
| `--offset <n>`     | no       | `0`     | Page offset                            |
| `--base-url <url>` | no       |         | Server base URL                        |
| `--json`           | no       |         | Output the raw server response as JSON |

### `eigenpal workflow pull [options] <workflow-id>`

Download the YAML definition of the workflow at its current version.

### Arguments

| Name          | Required | Variadic | Description |
| ------------- | -------- | -------- | ----------- |
| `workflow-id` | yes      | no       |             |

### Options

| Flag               | Required | Default | Description                          |
| ------------------ | -------- | ------- | ------------------------------------ |
| `--out <path>`     | no       |         | Write YAML to file instead of stdout |
| `--base-url <url>` | no       |         | Server base URL                      |

### `eigenpal workflow push [options]`

Create or update a workflow from a YAML file.

### Options

| Flag                     | Required | Default | Description                                                                                                                                                                             |
| ------------------------ | -------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--file <yaml>`          | no       |         | Path to YAML file                                                                                                                                                                       |
| `--workflow-id <id>`     | no       |         | Update existing workflow (default: create new)                                                                                                                                          |
| `--bump <level>`         | no       |         | Auto-bump from the server's current version: patch \| minor \| major. Mutually exclusive with `--version` and with a top-level `version:` in the YAML.                                  |
| `--set-version <semver>` | no       |         | Push at this exact semver (e.g. 1.4.0). Mutually exclusive with `--bump` and with a top-level `version:` in the YAML. (Named `--set-version` to avoid the global `-v, --version` flag.) |
| `--base-url <url>`       | no       |         | Server base URL                                                                                                                                                                         |
| `--json`                 | no       |         | Output the raw server response as JSON                                                                                                                                                  |

### `eigenpal workflow validate [options]`

Local-only validation against the templated project layout: ./workflow.yaml + ./evaluators.yaml + ./dataset/. For targeted validation use `evaluators validate` or `dataset validate`.

### Options

| Flag           | Required | Default | Description                                                                |
| -------------- | -------- | ------- | -------------------------------------------------------------------------- |
| `--dir <path>` | no       |         | Project root (defaults to cwd; resolves the three default paths from here) |

### `eigenpal workflow clear-local [options] [examples...]`

Delete local execution artifacts under ./dataset/examples/. Keeps the latest run per example by default.

### Arguments

| Name       | Required | Variadic | Description |
| ---------- | -------- | -------- | ----------- |
| `examples` | no       | yes      |             |

### Options

| Flag          | Required | Default | Description                                                |
| ------------- | -------- | ------- | ---------------------------------------------------------- |
| `--dir <dir>` | no       |         | Local eigenpal directory                                   |
| `--all`       | no       | `false` | Remove all artifacts, including the latest kept by default |

### `eigenpal workflow evaluators pull [options] <workflow-id>`

Download the workflow's evaluators YAML.

### Arguments

| Name          | Required | Variadic | Description |
| ------------- | -------- | -------- | ----------- |
| `workflow-id` | yes      | no       |             |

### Options

| Flag               | Required | Default | Description                          |
| ------------------ | -------- | ------- | ------------------------------------ |
| `--out <path>`     | no       |         | Write YAML to file instead of stdout |
| `--base-url <url>` | no       |         | Server base URL                      |

### `eigenpal workflow evaluators push [options] <workflow-id>`

Overwrite the workflow's evaluator config from a YAML file.

### Arguments

| Name          | Required | Variadic | Description |
| ------------- | -------- | -------- | ----------- |
| `workflow-id` | yes      | no       |             |

### Options

| Flag               | Required | Default | Description                            |
| ------------------ | -------- | ------- | -------------------------------------- |
| `--file <yaml>`    | yes      |         | Path to evaluators YAML file           |
| `--base-url <url>` | no       |         | Server base URL                        |
| `--json`           | no       |         | Output the raw server response as JSON |

### `eigenpal workflow evaluators validate [options] [path]`

Validate an evaluators YAML file against the EvalConfig schema. Defaults to ./evaluators.yaml.

### Arguments

| Name   | Required | Variadic | Description |
| ------ | -------- | -------- | ----------- |
| `path` | no       | no       |             |

### `eigenpal workflow dataset list [options] <workflow-id>`

List eval examples for the workflow.

### Arguments

| Name          | Required | Variadic | Description |
| ------------- | -------- | -------- | ----------- |
| `workflow-id` | yes      | no       |             |

### Options

| Flag               | Required | Default | Description                            |
| ------------------ | -------- | ------- | -------------------------------------- |
| `--limit <n>`      | no       | `100`   | Page size                              |
| `--offset <n>`     | no       | `0`     | Page offset                            |
| `--base-url <url>` | no       |         | Server base URL                        |
| `--json`           | no       |         | Output the raw server response as JSON |

### `eigenpal workflow dataset pull [options] <workflow-id>`

Download the workflow's dataset as a ZIP archive.

### Arguments

| Name          | Required | Variadic | Description |
| ------------- | -------- | -------- | ----------- |
| `workflow-id` | yes      | no       |             |

### Options

| Flag               | Required | Default | Description                                                                     |
| ------------------ | -------- | ------- | ------------------------------------------------------------------------------- |
| `--out <zip>`      | no       |         | Write the dataset ZIP to this path. When omitted, the binary streams to stdout. |
| `--base-url <url>` | no       |         | Server base URL                                                                 |

### `eigenpal workflow dataset push [options] <workflow-id>`

Replace or extend the workflow's dataset from a ZIP or folder.

### Arguments

| Name          | Required | Variadic | Description |
| ------------- | -------- | -------- | ----------- |
| `workflow-id` | yes      | no       |             |

### Options

| Flag                       | Required | Default    | Description                                                                                |
| -------------------------- | -------- | ---------- | ------------------------------------------------------------------------------------------ |
| `--file <path>`            | yes      |            | Path to a dataset ZIP file or a dataset/ folder (folder is zipped in memory before upload) |
| `--mode <append\|replace>` | no       | `"append"` | Import mode (default: append)                                                              |
| `--yes`                    | no       | `false`    | Skip the destructive confirmation prompt for --mode replace (use in CI)                    |
| `--base-url <url>`         | no       |            | Server base URL                                                                            |
| `--json`                   | no       |            | Output the raw server response as JSON                                                     |

### `eigenpal workflow dataset example create [options] <workflow-id>`

Create one eval example without re-uploading the dataset.

### Arguments

| Name          | Required | Variadic | Description |
| ------------- | -------- | -------- | ----------- |
| `workflow-id` | yes      | no       |             |

### Options

| Flag                     | Required | Default | Description                                         |
| ------------------------ | -------- | ------- | --------------------------------------------------- |
| `--name <name>`          | yes      |         | Example name (1–64 chars)                           |
| `--input-json <json>`    | no       |         | Trigger input as a JSON literal                     |
| `--input-file <path>`    | no       |         | Trigger input from a JSON file (or `-` for stdin)   |
| `--expected-json <json>` | no       |         | Expected output as a JSON literal                   |
| `--expected-file <path>` | no       |         | Expected output from a JSON file (or `-` for stdin) |
| `--annotation <text>`    | no       |         | Free-form annotation                                |
| `--base-url <url>`       | no       |         | Server base URL                                     |
| `--json`                 | no       |         | Output the raw server response as JSON              |

### `eigenpal workflow dataset example update [options] <workflow-id> <exampleId>`

Patch one eval example. Omitted flags are left alone.

### Arguments

| Name          | Required | Variadic | Description |
| ------------- | -------- | -------- | ----------- |
| `workflow-id` | yes      | no       |             |
| `exampleId`   | yes      | no       |             |

### Options

| Flag                     | Required | Default | Description                                                 |
| ------------------------ | -------- | ------- | ----------------------------------------------------------- |
| `--name <name>`          | no       |         | Rename the example (1–64 chars)                             |
| `--input-json <json>`    | no       |         | Replace trigger input with this JSON literal                |
| `--input-file <path>`    | no       |         | Replace trigger input from a JSON file (or `-` for stdin)   |
| `--expected-json <json>` | no       |         | Replace expected output with this JSON literal              |
| `--expected-file <path>` | no       |         | Replace expected output from a JSON file (or `-` for stdin) |
| `--annotation <text>`    | no       |         | Replace annotation; pass empty string to clear              |
| `--row-order <n>`        | no       |         | Reorder the row (0-based)                                   |
| `--base-url <url>`       | no       |         | Server base URL                                             |
| `--json`                 | no       |         | Output the raw server response as JSON                      |

### `eigenpal workflow dataset example delete [options] <workflow-id> <exampleId>`

Delete one eval example by id. Non-TTY shells require --yes.

### Arguments

| Name          | Required | Variadic | Description |
| ------------- | -------- | -------- | ----------- |
| `workflow-id` | yes      | no       |             |
| `exampleId`   | yes      | no       |             |

### Options

| Flag               | Required | Default | Description                                                                   |
| ------------------ | -------- | ------- | ----------------------------------------------------------------------------- |
| `--yes`            | no       | `false` | Required for non-TTY shells; explicit acknowledgment that this is destructive |
| `--base-url <url>` | no       |         | Server base URL                                                               |
| `--json`           | no       |         | Output the raw server response as JSON                                        |

### `eigenpal workflow dataset example get [options] <workflow-id> <exampleId>`

Fetch one eval example with full triggerInput, expectedOutput, and metadata.

### Arguments

| Name          | Required | Variadic | Description |
| ------------- | -------- | -------- | ----------- |
| `workflow-id` | yes      | no       |             |
| `exampleId`   | yes      | no       |             |

### Options

| Flag               | Required | Default | Description                            |
| ------------------ | -------- | ------- | -------------------------------------- |
| `--base-url <url>` | no       |         | Server base URL                        |
| `--json`           | no       |         | Output the raw server response as JSON |

### `eigenpal workflow dataset validate [options] [path]`

Validate a dataset folder against the examples/<name>/{input,expected,meta} convention. Defaults to ./dataset/.

### Arguments

| Name   | Required | Variadic | Description |
| ------ | -------- | -------- | ----------- |
| `path` | no       | no       |             |

### `eigenpal workflow experiment list [options] <workflow-id>`

List executions for the workflow, newest first.

### Arguments

| Name          | Required | Variadic | Description |
| ------------- | -------- | -------- | ----------- |
| `workflow-id` | yes      | no       |             |

### Options

| Flag               | Required | Default | Description                            |
| ------------------ | -------- | ------- | -------------------------------------- |
| `--batch-id <id>`  | no       |         | Filter by batch                        |
| `--limit <n>`      | no       | `50`    | Page size                              |
| `--offset <n>`     | no       | `0`     | Page offset                            |
| `--base-url <url>` | no       |         | Server base URL                        |
| `--json`           | no       |         | Output the raw server response as JSON |

### `eigenpal workflow experiment run [options] <workflow-id>`

Start a batch eval against the workflow's dataset.

### Arguments

| Name          | Required | Variadic | Description |
| ------------- | -------- | -------- | ----------- |
| `workflow-id` | yes      | no       |             |

### Options

| Flag                | Required | Default | Description                                          |
| ------------------- | -------- | ------- | ---------------------------------------------------- |
| `--example-id <id>` | no       | `[]`    | Run only this example (repeatable)                   |
| `--wait`            | no       | `false` | Poll until terminal; non-zero exit on passRate < 1.0 |
| `--interval <n>`    | no       | `10`    | Polling interval in seconds (default 10)             |
| `--base-url <url>`  | no       |         | Server base URL                                      |
| `--json`            | no       |         | Output the raw server response as JSON               |

### `eigenpal workflow experiment status [options] <workflow-id> <batchId>`

Aggregate progress for a batch by `batchId`.

### Arguments

| Name          | Required | Variadic | Description |
| ------------- | -------- | -------- | ----------- |
| `workflow-id` | yes      | no       |             |
| `batchId`     | yes      | no       |             |

### Options

| Flag                   | Required | Default | Description                                                                                          |
| ---------------------- | -------- | ------- | ---------------------------------------------------------------------------------------------------- |
| `--watch`              | no       | `false` | Poll until every execution reaches a terminal state (completed/failed/cancelled/rejected), then exit |
| `--interval <seconds>` | no       | `5`     | Poll interval in seconds when --watch is set (default 5)                                             |
| `--max-wait <seconds>` | no       | `1800`  | Hard ceiling for --watch in seconds (default 1800 = 30 min)                                          |
| `--base-url <url>`     | no       |         | Server base URL                                                                                      |
| `--json`               | no       |         | Output the raw server response as JSON                                                               |

### `eigenpal workflow experiment results [options] <workflow-id> [batchId]`

Download eval results in CSV or JSON.

### Arguments

| Name          | Required | Variadic | Description |
| ------------- | -------- | -------- | ----------- |
| `workflow-id` | yes      | no       |             |
| `batchId`     | no       | no       |             |

### Options

| Flag                   | Required | Default | Description                                              |
| ---------------------- | -------- | ------- | -------------------------------------------------------- |
| `--format <csv\|json>` | yes      |         | Output format                                            |
| `--out <path>`         | no       |         | Output file. When omitted, the binary streams to stdout. |
| `--base-url <url>`     | no       |         | Server base URL                                          |

### `eigenpal workflow experiment compare [options] <batchIdA> <batchIdB>`

Diff eval scores between two experiment batches.

### Arguments

| Name       | Required | Variadic | Description |
| ---------- | -------- | -------- | ----------- |
| `batchIdA` | yes      | no       |             |
| `batchIdB` | yes      | no       |             |

### Options

| Flag                                                   | Required | Default            | Description                                            |
| ------------------------------------------------------ | -------- | ------------------ | ------------------------------------------------------ |
| `--sort <abs-delta-desc\|delta-asc\|delta-desc\|name>` | no       | `"abs-delta-desc"` | Row sort order (default: biggest movers first)         |
| `--regression-threshold <n>`                           | no       | `0.05`             | Δ below this is flagged as a regression (default 0.05) |
| `--base-url <url>`                                     | no       |                    | Server base URL                                        |
| `--json`                                               | no       |                    | Output the raw server response as JSON                 |

### `eigenpal workflow execution run [options] <workflow-id> [examples...]`

Run a saved workflow against local dataset examples.

### Arguments

| Name          | Required | Variadic | Description |
| ------------- | -------- | -------- | ----------- |
| `workflow-id` | yes      | no       |             |
| `examples`    | no       | yes      |             |

### Options

| Flag                | Required | Default | Description                                  |
| ------------------- | -------- | ------- | -------------------------------------------- |
| `--dir <dir>`       | no       |         | Local eigenpal directory                     |
| `--concurrency <n>` | no       |         | Max examples to run in parallel (default: 3) |
| `--base-url <url>`  | no       |         | Server base URL                              |
| `--json`            | no       |         | Output the raw server response as JSON       |

### `eigenpal workflow execution get [options] <executionId>`

Fetch a single execution payload. Optionally narrow to one step.

### Arguments

| Name          | Required | Variadic | Description |
| ------------- | -------- | -------- | ----------- |
| `executionId` | yes      | no       |             |

### Options

| Flag                | Required | Default                         | Description                                           |
| ------------------- | -------- | ------------------------------- | ----------------------------------------------------- |
| `--step <name>`     | no       |                                 | Show only this step (or comma-separated list)         |
| `--include <kinds>` | no       | `"input,output,error,duration"` | Comma-separated subset of input,output,error,duration |
| `--base-url <url>`  | no       |                                 | Server base URL                                       |
| `--json`            | no       |                                 | Output the raw server response as JSON                |

### `eigenpal workflow execution list [options] <workflow-id>`

List recent executions for a workflow.

### Arguments

| Name          | Required | Variadic | Description |
| ------------- | -------- | -------- | ----------- |
| `workflow-id` | yes      | no       |             |

### Options

| Flag                | Required | Default | Description                                                      |
| ------------------- | -------- | ------- | ---------------------------------------------------------------- |
| `--status <status>` | no       |         | Filter by status: pending\|running\|completed\|failed\|cancelled |
| `--limit <n>`       | no       | `50`    | Page size                                                        |
| `--offset <n>`      | no       | `0`     | Page offset                                                      |
| `--base-url <url>`  | no       |         | Server base URL                                                  |
| `--json`            | no       |         | Output the raw server response as JSON                           |

### `eigenpal workflow execution watch [options] <executionId>`

Stream live execution status until terminal or 30-min detach.

### Arguments

| Name          | Required | Variadic | Description |
| ------------- | -------- | -------- | ----------- |
| `executionId` | yes      | no       |             |

### Options

| Flag                   | Required | Default | Description                                    |
| ---------------------- | -------- | ------- | ---------------------------------------------- |
| `--max-wait <seconds>` | no       | `1800`  | Detach after N seconds (default 1800 = 30 min) |
| `--base-url <url>`     | no       |         | Server base URL                                |

### `eigenpal workflow execution compare [options] <executionA> <executionB>`

Diff two executions side-by-side, per step.

### Arguments

| Name         | Required | Variadic | Description |
| ------------ | -------- | -------- | ----------- |
| `executionA` | yes      | no       |             |
| `executionB` | yes      | no       |             |

### Options

| Flag               | Required | Default | Description                     |
| ------------------ | -------- | ------- | ------------------------------- |
| `--step <name>`    | no       |         | Restrict comparison to one step |
| `--base-url <url>` | no       |         | Server base URL                 |

### `eigenpal workflow execution cancel [options] <executionId>`

Cancel an execution. Idempotent on already-terminal runs.

### Arguments

| Name          | Required | Variadic | Description |
| ------------- | -------- | -------- | ----------- |
| `executionId` | yes      | no       |             |

### Options

| Flag               | Required | Default | Description                                                           |
| ------------------ | -------- | ------- | --------------------------------------------------------------------- |
| `--yes`            | no       |         | Required for non-TTY shells (CI, pipes). Acts immediately, no prompt. |
| `--base-url <url>` | no       |         | Server base URL                                                       |
| `--json`           | no       |         | Output the raw server response as JSON                                |

### `eigenpal workflow versions list [options] <workflow-id>`

List historical workflow versions, newest first.

### Arguments

| Name          | Required | Variadic | Description |
| ------------- | -------- | -------- | ----------- |
| `workflow-id` | yes      | no       |             |

### Options

| Flag               | Required | Default | Description                            |
| ------------------ | -------- | ------- | -------------------------------------- |
| `--limit <n>`      | no       | `50`    | Page size                              |
| `--offset <n>`     | no       | `0`     | Page offset                            |
| `--base-url <url>` | no       |         | Server base URL                        |
| `--json`           | no       |         | Output the raw server response as JSON |

### `eigenpal workflow versions restore [options] <workflow-id> <versionId>`

Restore the workflow to a previous version.

### Arguments

| Name          | Required | Variadic | Description |
| ------------- | -------- | -------- | ----------- |
| `workflow-id` | yes      | no       |             |
| `versionId`   | yes      | no       |             |

### Options

| Flag               | Required | Default | Description                            |
| ------------------ | -------- | ------- | -------------------------------------- |
| `--base-url <url>` | no       |         | Server base URL                        |
| `--json`           | no       |         | Output the raw server response as JSON |

### `eigenpal workflow step-type list [options]`

List every step type the deployment supports.

### Options

| Flag               | Required | Default | Description                            |
| ------------------ | -------- | ------- | -------------------------------------- |
| `--search <q>`     | no       |         | Filter                                 |
| `--limit <n>`      | no       | `50`    | Page size                              |
| `--offset <n>`     | no       | `0`     | Page offset                            |
| `--base-url <url>` | no       |         | Server base URL                        |
| `--json`           | no       |         | Output the raw server response as JSON |

### `eigenpal workflow step-type get [options] <type>`

Return the full schema and behavioral docs for one step type.

### Arguments

| Name   | Required | Variadic | Description |
| ------ | -------- | -------- | ----------- |
| `type` | yes      | no       |             |

### Options

| Flag           | Required | Default | Description   |
| -------------- | -------- | ------- | ------------- |
| `--out <path>` | no       |         | Write to file |

### `eigenpal workflow evaluator-type list [options]`

List every evaluator type with a one-line description.

### Options

| Flag               | Required | Default | Description                            |
| ------------------ | -------- | ------- | -------------------------------------- |
| `--search <q>`     | no       |         | Filter by type, name, or description   |
| `--limit <n>`      | no       | `50`    | Page size                              |
| `--offset <n>`     | no       | `0`     | Page offset                            |
| `--base-url <url>` | no       |         | Server base URL                        |
| `--json`           | no       |         | Output the raw server response as JSON |

### `eigenpal workflow evaluator-type get [options] <type>`

Fetch the JSON Schema for one evaluator type. Pipe through `jq` to inspect specific fields.

### Arguments

| Name   | Required | Variadic | Description |
| ------ | -------- | -------- | ----------- |
| `type` | yes      | no       |             |

### Options

| Flag           | Required | Default | Description   |
| -------------- | -------- | ------- | ------------- |
| `--out <path>` | no       |         | Write to file |

### `eigenpal workflow step exec [options] <type>`

Run one step locally with sample inputs and print its output as JSON. <type> is any value from `workflow step-type list`; only types with a local runner actually execute (today: transform.script, ai.extract).

### Arguments

| Name   | Required | Variadic | Description |
| ------ | -------- | -------- | ----------- |
| `type` | yes      | no       |             |

### Options

| Flag                      | Required | Default | Description                                                                                                                                                                                                             |
| ------------------------- | -------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--config-json <json>`    | no       |         | Full step config as a JSON literal. Mutually exclusive with --config-file.                                                                                                                                              |
| `--config-file <path\|->` | no       |         | Full step config from a JSON file (or `-` for stdin). Mutually exclusive with --config-json.                                                                                                                            |
| `--inputs <k=v...>`       | no       | `[]`    | Repeatable. Value can be `@path` (file contents, JSON-parsed when applicable) or a literal string. Merges into the config `inputs` map for transform.script; provides the `input` for ai.extract when set as `input=…`. |
| `--output-schema <path>`  | no       |         | Optional JSON Schema. Validates the step output; defaults to the step type’s built-in `outputSchema` from STEP_SCHEMAS when omitted.                                                                                    |
| `--timeout-ms <n>`        | no       |         | Override transform.script wall-clock cap (default 5000)                                                                                                                                                                 |
| `--memory-mb <n>`         | no       |         | Override transform.script heap cap in MB (default 10)                                                                                                                                                                   |
