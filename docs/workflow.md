# eigenpal workflow

Manage workflows: push, pull, and evaluate.

## Contents

- [Surface](#surface)
- [Commands](#commands)
  - [Core](#core)
  - [Evaluators](#evaluators)
  - [Dataset](#dataset)
  - [Templates](#templates)
  - [Experiment](#experiment)
  - [Versions](#versions)
  - [Step-type](#step-type)
  - [Evaluator-type](#evaluator-type)
  - [Step](#step)
- [Details](#details)
  - [`eigenpal workflow list|ls [options]`](#eigenpal-workflow-listls-options)
  - [`eigenpal workflow pull [options] <workflow-id>`](#eigenpal-workflow-pull-options-workflow-id)
  - [`eigenpal workflow schema [options] <workflow-id>`](#eigenpal-workflow-schema-options-workflow-id)
  - [`eigenpal workflow push [options]`](#eigenpal-workflow-push-options)
  - [`eigenpal workflow move [options] <workflow-id>`](#eigenpal-workflow-move-options-workflow-id)
  - [`eigenpal workflow validate [options] [path]`](#eigenpal-workflow-validate-options-path)
  - [`eigenpal workflow clear-local [options] [examples...]`](#eigenpal-workflow-clear-local-options-examples)
  - [`eigenpal workflow evaluators pull [options] <workflow-id>`](#eigenpal-workflow-evaluators-pull-options-workflow-id)
  - [`eigenpal workflow evaluators push [options] <workflow-id>`](#eigenpal-workflow-evaluators-push-options-workflow-id)
  - [`eigenpal workflow evaluators validate [options] [path]`](#eigenpal-workflow-evaluators-validate-options-path)
  - [`eigenpal workflow dataset list|ls [options] <workflow-id>`](#eigenpal-workflow-dataset-listls-options-workflow-id)
  - [`eigenpal workflow dataset pull [options] <workflow-id>`](#eigenpal-workflow-dataset-pull-options-workflow-id)
  - [`eigenpal workflow dataset push [options] <workflow-id>`](#eigenpal-workflow-dataset-push-options-workflow-id)
  - [`eigenpal workflow dataset example create [options] <workflow-id>`](#eigenpal-workflow-dataset-example-create-options-workflow-id)
  - [`eigenpal workflow dataset example update [options] <workflow-id> <exampleId>`](#eigenpal-workflow-dataset-example-update-options-workflow-id-exampleid)
  - [`eigenpal workflow dataset example delete [options] <workflow-id> <exampleId>`](#eigenpal-workflow-dataset-example-delete-options-workflow-id-exampleid)
  - [`eigenpal workflow dataset example get [options] <workflow-id> <exampleId>`](#eigenpal-workflow-dataset-example-get-options-workflow-id-exampleid)
  - [`eigenpal workflow dataset validate [options] [path]`](#eigenpal-workflow-dataset-validate-options-path)
  - [`eigenpal workflow templates upload [options] <file>`](#eigenpal-workflow-templates-upload-options-file)
  - [`eigenpal workflow templates list|ls [options]`](#eigenpal-workflow-templates-listls-options)
  - [`eigenpal workflow templates get|inspect [options] <template-id>`](#eigenpal-workflow-templates-getinspect-options-template-id)
  - [`eigenpal workflow templates download [options] <template-id>`](#eigenpal-workflow-templates-download-options-template-id)
  - [`eigenpal workflow templates replace [options] <template-id> <file>`](#eigenpal-workflow-templates-replace-options-template-id-file)
  - [`eigenpal workflow templates delete [options] <template-id>`](#eigenpal-workflow-templates-delete-options-template-id)
  - [`eigenpal workflow templates smoke [options] <template>`](#eigenpal-workflow-templates-smoke-options-template)
  - [`eigenpal workflow experiment|exp list|ls [options] <workflow-id>`](#eigenpal-workflow-experimentexp-listls-options-workflow-id)
  - [`eigenpal workflow experiment|exp run [options] <workflow-id>`](#eigenpal-workflow-experimentexp-run-options-workflow-id)
  - [`eigenpal workflow experiment|exp status [options] <workflow-id> <batchId>`](#eigenpal-workflow-experimentexp-status-options-workflow-id-batchid)
  - [`eigenpal workflow experiment|exp cancel [options] <workflow-id> <batchId>`](#eigenpal-workflow-experimentexp-cancel-options-workflow-id-batchid)
  - [`eigenpal workflow experiment|exp results [options] <workflow-id> [batchId]`](#eigenpal-workflow-experimentexp-results-options-workflow-id-batchid)
  - [`eigenpal workflow experiment|exp compare|diff [options] <batchIdA> <batchIdB>`](#eigenpal-workflow-experimentexp-comparediff-options-batchida-batchidb)
  - [`eigenpal workflow experiment|exp watch [options] <workflow-id> <batchId>`](#eigenpal-workflow-experimentexp-watch-options-workflow-id-batchid)
  - [`eigenpal workflow versions list|ls [options] <workflow-id>`](#eigenpal-workflow-versions-listls-options-workflow-id)
  - [`eigenpal workflow versions create [options] <workflow-id>`](#eigenpal-workflow-versions-create-options-workflow-id)
  - [`eigenpal workflow versions promote [options] <workflow-id> <versionId>`](#eigenpal-workflow-versions-promote-options-workflow-id-versionid)
  - [`eigenpal workflow versions restore [options] <workflow-id> <versionId>`](#eigenpal-workflow-versions-restore-options-workflow-id-versionid)
  - [`eigenpal workflow step-type list|ls [options]`](#eigenpal-workflow-step-type-listls-options)
  - [`eigenpal workflow step-type get [options] <type>`](#eigenpal-workflow-step-type-get-options-type)
  - [`eigenpal workflow evaluator-type list|ls [options]`](#eigenpal-workflow-evaluator-type-listls-options)
  - [`eigenpal workflow evaluator-type get [options] <type>`](#eigenpal-workflow-evaluator-type-get-options-type)
  - [`eigenpal workflow step exec [options] <type>`](#eigenpal-workflow-step-exec-options-type)

## Surface

```
workflow
├── list|ls
├── pull <workflow-id>
├── schema <workflow-id>
├── push
├── move <workflow-id>
├── evaluators
│   ├── pull <workflow-id>
│   ├── push <workflow-id>
│   └── validate [path]
├── dataset
│   ├── list|ls <workflow-id>
│   ├── pull <workflow-id>
│   ├── push <workflow-id>
│   ├── example
│   │   ├── create <workflow-id>
│   │   ├── update <workflow-id> <exampleId>
│   │   ├── delete <workflow-id> <exampleId>
│   │   └── get <workflow-id> <exampleId>
│   └── validate [path]
├── templates
│   ├── upload <file>
│   ├── list|ls
│   ├── get|inspect <template-id>
│   ├── download <template-id>
│   ├── replace <template-id> <file>
│   ├── delete <template-id>
│   └── smoke <template>
├── experiment|exp
│   ├── list|ls <workflow-id>
│   ├── run <workflow-id>
│   ├── status <workflow-id> <batchId>
│   ├── cancel <workflow-id> <batchId>
│   ├── results <workflow-id> [batchId]
│   ├── compare|diff <batchIdA> <batchIdB>
│   └── watch <workflow-id> <batchId>
├── versions
│   ├── list|ls <workflow-id>
│   ├── create <workflow-id>
│   ├── promote <workflow-id> <versionId>
│   └── restore <workflow-id> <versionId>
├── step-type
│   ├── list|ls
│   └── get <type>
├── evaluator-type
│   ├── list|ls
│   └── get <type>
├── validate [path]
├── clear-local [examples...]
└── step
    └── exec <type>
```

## Commands

### Core

| Command                                                 | Description                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `eigenpal workflow list\|ls [options]`                  | List workflows the caller can read.                                                                                                                                                                                                                                                                                                                                                                                                       |
| `eigenpal workflow pull [options] <workflow-id>`        | Download the YAML definition of the workflow at its current version.                                                                                                                                                                                                                                                                                                                                                                      |
| `eigenpal workflow schema [options] <workflow-id>`      | Show the inferred output schema for a workflow (what it returns).                                                                                                                                                                                                                                                                                                                                                                         |
| `eigenpal workflow push [options]`                      | Create or update a workflow from a YAML file.                                                                                                                                                                                                                                                                                                                                                                                             |
| `eigenpal workflow move [options] <workflow-id>`        | Move a workflow to a folder path, creating folders as needed                                                                                                                                                                                                                                                                                                                                                                              |
| `eigenpal workflow validate [options] [path]`           | Local-only validation. Without [path]: runs the templated three-way check (./workflow.yaml + ./evaluators.yaml + ./dataset/) in the project root. When the root has no workflow.yaml, discovers nested projects under eigenpal/workflows/<slug>/ or workflows/<slug>/ and validates each. With [path] pointing at a YAML file: validates that workflow.yaml only. For per-noun targeting use `evaluators validate` or `dataset validate`. |
| `eigenpal workflow clear-local [options] [examples...]` | Delete local execution artifacts under ./dataset/examples/. Keeps the latest run per example by default.                                                                                                                                                                                                                                                                                                                                  |

### Evaluators

| Command                                                     | Description                                                                                    |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `eigenpal workflow evaluators pull [options] <workflow-id>` | Download the workflow's evaluators YAML.                                                       |
| `eigenpal workflow evaluators push [options] <workflow-id>` | Overwrite the workflow's evaluator config from a YAML file.                                    |
| `eigenpal workflow evaluators validate [options] [path]`    | Validate an evaluators YAML file against the EvalConfig schema. Defaults to ./evaluators.yaml. |

### Dataset

| Command                                                                        | Description                                                                                                     |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `eigenpal workflow dataset list\|ls [options] <workflow-id>`                   | List eval examples for the workflow.                                                                            |
| `eigenpal workflow dataset pull [options] <workflow-id>`                       | Download the workflow's dataset as a ZIP archive.                                                               |
| `eigenpal workflow dataset push [options] <workflow-id>`                       | Replace or extend the workflow's dataset from a ZIP or folder.                                                  |
| `eigenpal workflow dataset example create [options] <workflow-id>`             | Create one eval example without re-uploading the dataset.                                                       |
| `eigenpal workflow dataset example update [options] <workflow-id> <exampleId>` | Patch one eval example. Omitted flags are left alone.                                                           |
| `eigenpal workflow dataset example delete [options] <workflow-id> <exampleId>` | Delete one eval example by id. Non-TTY shells require --yes.                                                    |
| `eigenpal workflow dataset example get [options] <workflow-id> <exampleId>`    | Fetch one eval example with full triggerInput, expectedOutput, and metadata.                                    |
| `eigenpal workflow dataset validate [options] [path]`                          | Validate a dataset folder against the examples/<name>/{input,expected,meta} convention. Defaults to ./dataset/. |

### Templates

| Command                                                              | Description                                                                                                                    |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `eigenpal workflow templates upload [options] <file>`                | Upload a DOCX or XLSX file as a new tmpl*… resource with an immutable tmpr*… revision.                                         |
| `eigenpal workflow templates list\|ls [options]`                     | List workspace templates.                                                                                                      |
| `eigenpal workflow templates get\|inspect [options] <template-id>`   | Inspect a tmpl*… resource: current tmpr*…, format, checksum, tokens, grammar.                                                  |
| `eigenpal workflow templates download [options] <template-id>`       | Download current (or pinned) template bytes.                                                                                   |
| `eigenpal workflow templates replace [options] <template-id> <file>` | Append an immutable revision and advance the tmpl\_… pointer.                                                                  |
| `eigenpal workflow templates delete [options] <template-id>`         | Delete the mutable tmpl*… pointer. Pinned tmpr*… revisions remain so workflows that set templateRevisionId still run.          |
| `eigenpal workflow templates smoke [options] <template>`             | Fill a local Office file or a tmpl\_… resource with a JSON fixture and write the result. Local files never contact the server. |

### Experiment

| Command                                                                           | Description                                                                                |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `eigenpal workflow experiment\|exp list\|ls [options] <workflow-id>`              | List executions for the workflow, newest first.                                            |
| `eigenpal workflow experiment\|exp run [options] <workflow-id>`                   | Start a batch eval against the workflow's dataset.                                         |
| `eigenpal workflow experiment\|exp status [options] <workflow-id> <batchId>`      | Aggregate progress for a batch by `batchId`.                                               |
| `eigenpal workflow experiment\|exp cancel [options] <workflow-id> <batchId>`      | Cancel every execution in a batch. Idempotent.                                             |
| `eigenpal workflow experiment\|exp results [options] <workflow-id> [batchId]`     | Download eval results in CSV or JSON.                                                      |
| `eigenpal workflow experiment\|exp compare\|diff [options] <batchIdA> <batchIdB>` | Compare evaluator scores or actual outputs between two experiment batches.                 |
| `eigenpal workflow experiment\|exp watch [options] <workflow-id> <batchId>`       | Poll until terminal, then auto-pull results — replaces `status --watch` + `results --out`. |

### Versions

| Command                                                                  | Description                                                                                           |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `eigenpal workflow versions list\|ls [options] <workflow-id>`            | List tagged workflow versions plus the current untagged snapshot when HEAD is untagged, newest first. |
| `eigenpal workflow versions create [options] <workflow-id>`              | Create a tagged workflow version from YAML or by copying an existing snapshot.                        |
| `eigenpal workflow versions promote [options] <workflow-id> <versionId>` | Make an existing tagged workflow version current without creating another snapshot.                   |
| `eigenpal workflow versions restore [options] <workflow-id> <versionId>` | Restore a previous snapshot as a new untagged current version. Does not retag the source.             |

### Step-type

| Command                                            | Description                                                   |
| -------------------------------------------------- | ------------------------------------------------------------- |
| `eigenpal workflow step-type list\|ls [options]`   | List every step type the deployment supports.                 |
| `eigenpal workflow step-type get [options] <type>` | Return the full schema and behavioral docs for one step type. |

### Evaluator-type

| Command                                                 | Description                                                                                 |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `eigenpal workflow evaluator-type list\|ls [options]`   | List every evaluator type with a one-line description.                                      |
| `eigenpal workflow evaluator-type get [options] <type>` | Fetch the JSON Schema for one evaluator type. Pipe through `jq` to inspect specific fields. |

### Step

| Command                                        | Description                                                                                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `eigenpal workflow step exec [options] <type>` | DISABLED — local mimic runners removed pending server-side redesign (EIG-104). Use `run` or `workflow experiment run` instead. |

## Details

### `eigenpal workflow list|ls [options]`

List workflows the caller can read.

### Options

| Flag               | Required | Default | Description                          |
| ------------------ | -------- | ------- | ------------------------------------ |
| `--search <q>`     | no       |         | Filter by name                       |
| `--limit <n>`      | no       | `50`    | Page size                            |
| `--offset <n>`     | no       | `0`     | Page offset                          |
| `--base-url <url>` | no       |         | Server base URL                      |
| `--json`           | no       |         | Emit machine-readable JSON on stdout |

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

### `eigenpal workflow schema [options] <workflow-id>`

Show the inferred output schema for a workflow (what it returns).

### Arguments

| Name          | Required | Variadic | Description |
| ------------- | -------- | -------- | ----------- |
| `workflow-id` | yes      | no       |             |

### Options

| Flag                | Required | Default  | Description                     |
| ------------------- | -------- | -------- | ------------------------------- |
| `--format <format>` | no       | `"json"` | json \| typescript \| python    |
| `--out <path>`      | no       |          | Write to file instead of stdout |
| `--base-url <url>`  | no       |          | Server base URL                 |

### `eigenpal workflow push [options]`

Create or update a workflow from a YAML file.

### Options

| Flag                         | Required | Default | Description                                                                                                                                                                             |
| ---------------------------- | -------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--file <yaml>`              | no       |         | Path to YAML file                                                                                                                                                                       |
| `--workflow-id <id>`         | no       |         | Update existing workflow (default: create new)                                                                                                                                          |
| `--bump <level>`             | no       |         | Auto-bump from the server's current version: patch \| minor \| major. Mutually exclusive with `--version` and with a top-level `version:` in the YAML.                                  |
| `--set-version <semver>`     | no       |         | Push at this exact semver (e.g. 1.4.0). Mutually exclusive with `--bump` and with a top-level `version:` in the YAML. (Named `--set-version` to avoid the global `-v, --version` flag.) |
| `--allow-external-templates` | no       |         | Allow local template: paths whose real path is outside the workflow project directory (the folder that contains the YAML file). Off by default; ../ and symlink escapes are rejected.   |
| `--base-url <url>`           | no       |         | Server base URL                                                                                                                                                                         |
| `--json`                     | no       |         | Emit machine-readable JSON on stdout                                                                                                                                                    |

### `eigenpal workflow move [options] <workflow-id>`

Move a workflow to a folder path, creating folders as needed

### Arguments

| Name          | Required | Variadic | Description |
| ------------- | -------- | -------- | ----------- |
| `workflow-id` | yes      | no       |             |

### Options

| Flag               | Required | Default | Description                          |
| ------------------ | -------- | ------- | ------------------------------------ |
| `--folder <path>`  | yes      |         | Target folder path (`/` for root)    |
| `--base-url <url>` | no       |         | Server base URL                      |
| `--json`           | no       |         | Emit machine-readable JSON on stdout |

### `eigenpal workflow validate [options] [path]`

Local-only validation. Without [path]: runs the templated three-way check (./workflow.yaml + ./evaluators.yaml + ./dataset/) in the project root. When the root has no workflow.yaml, discovers nested projects under eigenpal/workflows/<slug>/ or workflows/<slug>/ and validates each. With [path] pointing at a YAML file: validates that workflow.yaml only. For per-noun targeting use `evaluators validate` or `dataset validate`.

### Arguments

| Name   | Required | Variadic | Description |
| ------ | -------- | -------- | ----------- |
| `path` | no       | no       |             |

### Options

| Flag                         | Required | Default | Description                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------- | -------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--dir <path>`               | no       |         | Project root (defaults to cwd; resolves the three default paths from here)                                                                                                                                                                                                                                                                                                                                                                         |
| `--online`                   | no       |         | Authenticate and also validate action.invoke-workflow targets, transform.template tmpl\_… references, and explicitly selected OCR/vision/text models against this tenant environment (existence, format, revision pairing, tokens vs data, XLSX {{ }} mistakes, configured catalog). Local template: paths are inspected on disk with or without this flag. Model checks use the configured catalog only — they do not probe live provider health. |
| `--allow-external-templates` | no       |         | Allow local template: paths whose real path is outside the workflow project directory (the folder that contains the YAML file). Off by default; ../ and symlink escapes are rejected.                                                                                                                                                                                                                                                              |
| `--base-url <url>`           | no       |         | Server base URL                                                                                                                                                                                                                                                                                                                                                                                                                                    |

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

| Flag               | Required | Default | Description                          |
| ------------------ | -------- | ------- | ------------------------------------ |
| `--file <yaml>`    | yes      |         | Path to evaluators YAML file         |
| `--base-url <url>` | no       |         | Server base URL                      |
| `--json`           | no       |         | Emit machine-readable JSON on stdout |

### `eigenpal workflow evaluators validate [options] [path]`

Validate an evaluators YAML file against the EvalConfig schema. Defaults to ./evaluators.yaml.

### Arguments

| Name   | Required | Variadic | Description |
| ------ | -------- | -------- | ----------- |
| `path` | no       | no       |             |

### `eigenpal workflow dataset list|ls [options] <workflow-id>`

List eval examples for the workflow.

### Arguments

| Name          | Required | Variadic | Description |
| ------------- | -------- | -------- | ----------- |
| `workflow-id` | yes      | no       |             |

### Options

| Flag               | Required | Default | Description                          |
| ------------------ | -------- | ------- | ------------------------------------ |
| `--limit <n>`      | no       | `100`   | Page size                            |
| `--offset <n>`     | no       | `0`     | Page offset                          |
| `--base-url <url>` | no       |         | Server base URL                      |
| `--json`           | no       |         | Emit machine-readable JSON on stdout |

### `eigenpal workflow dataset pull [options] <workflow-id>`

Download the workflow's dataset as a ZIP archive.

### Arguments

| Name          | Required | Variadic | Description |
| ------------- | -------- | -------- | ----------- |
| `workflow-id` | yes      | no       |             |

### Options

| Flag                | Required | Default | Description                                                                         |
| ------------------- | -------- | ------- | ----------------------------------------------------------------------------------- |
| `--out <zip>`       | no       |         | Write the dataset ZIP to this path. When omitted, the binary streams to stdout.     |
| `--example-id <id>` | no       | `[]`    | Export only this example (repeatable). When omitted, the whole dataset is exported. |
| `--base-url <url>`  | no       |         | Server base URL                                                                     |

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
| `--json`                   | no       |            | Emit machine-readable JSON on stdout                                                       |

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
| `--json`                 | no       |         | Emit machine-readable JSON on stdout                |

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
| `--json`                 | no       |         | Emit machine-readable JSON on stdout                        |

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
| `--json`           | no       |         | Emit machine-readable JSON on stdout                                          |

### `eigenpal workflow dataset example get [options] <workflow-id> <exampleId>`

Fetch one eval example with full triggerInput, expectedOutput, and metadata.

### Arguments

| Name          | Required | Variadic | Description |
| ------------- | -------- | -------- | ----------- |
| `workflow-id` | yes      | no       |             |
| `exampleId`   | yes      | no       |             |

### Options

| Flag               | Required | Default | Description                          |
| ------------------ | -------- | ------- | ------------------------------------ |
| `--base-url <url>` | no       |         | Server base URL                      |
| `--json`           | no       |         | Emit machine-readable JSON on stdout |

### `eigenpal workflow dataset validate [options] [path]`

Validate a dataset folder against the examples/<name>/{input,expected,meta} convention. Defaults to ./dataset/.

### Arguments

| Name   | Required | Variadic | Description |
| ------ | -------- | -------- | ----------- |
| `path` | no       | no       |             |

### `eigenpal workflow templates upload [options] <file>`

Upload a DOCX or XLSX file as a new tmpl*… resource with an immutable tmpr*… revision.

### Arguments

| Name   | Required | Variadic | Description |
| ------ | -------- | -------- | ----------- |
| `file` | yes      | no       |             |

### Options

| Flag                   | Required | Default | Description                                               |
| ---------------------- | -------- | ------- | --------------------------------------------------------- |
| `--name <name>`        | no       |         | Display name (defaults to the filename without extension) |
| `--description <text>` | no       |         | Optional description                                      |
| `--base-url <url>`     | no       |         | Server base URL                                           |
| `--json`               | no       |         | Emit machine-readable JSON on stdout                      |

### `eigenpal workflow templates list|ls [options]`

List workspace templates.

### Options

| Flag               | Required | Default | Description                          |
| ------------------ | -------- | ------- | ------------------------------------ |
| `--limit <n>`      | no       | `50`    | Page size                            |
| `--offset <n>`     | no       | `0`     | Page offset                          |
| `--base-url <url>` | no       |         | Server base URL                      |
| `--json`           | no       |         | Emit machine-readable JSON on stdout |

### `eigenpal workflow templates get|inspect [options] <template-id>`

Inspect a tmpl*… resource: current tmpr*…, format, checksum, tokens, grammar.

### Arguments

| Name          | Required | Variadic | Description |
| ------------- | -------- | -------- | ----------- |
| `template-id` | yes      | no       |             |

### Options

| Flag               | Required | Default | Description                          |
| ------------------ | -------- | ------- | ------------------------------------ |
| `--base-url <url>` | no       |         | Server base URL                      |
| `--json`           | no       |         | Emit machine-readable JSON on stdout |

### `eigenpal workflow templates download [options] <template-id>`

Download current (or pinned) template bytes.

### Arguments

| Name          | Required | Variadic | Description |
| ------------- | -------- | -------- | ----------- |
| `template-id` | yes      | no       |             |

### Options

| Flag                   | Required | Default | Description                       |
| ---------------------- | -------- | ------- | --------------------------------- |
| `--out <path>`         | no       |         | Write to this file (required)     |
| `--revision-id <tmpr>` | no       |         | Pin an immutable tmpr\_… revision |
| `--base-url <url>`     | no       |         | Server base URL                   |

### `eigenpal workflow templates replace [options] <template-id> <file>`

Append an immutable revision and advance the tmpl\_… pointer.

### Arguments

| Name          | Required | Variadic | Description |
| ------------- | -------- | -------- | ----------- |
| `template-id` | yes      | no       |             |
| `file`        | yes      | no       |             |

### Options

| Flag               | Required | Default | Description                          |
| ------------------ | -------- | ------- | ------------------------------------ |
| `--base-url <url>` | no       |         | Server base URL                      |
| `--json`           | no       |         | Emit machine-readable JSON on stdout |

### `eigenpal workflow templates delete [options] <template-id>`

Delete the mutable tmpl*… pointer. Pinned tmpr*… revisions remain so workflows that set templateRevisionId still run.

### Arguments

| Name          | Required | Variadic | Description |
| ------------- | -------- | -------- | ----------- |
| `template-id` | yes      | no       |             |

### Options

| Flag               | Required | Default | Description                          |
| ------------------ | -------- | ------- | ------------------------------------ |
| `--yes`            | no       | `false` | Required for non-TTY shells          |
| `--base-url <url>` | no       |         | Server base URL                      |
| `--json`           | no       |         | Emit machine-readable JSON on stdout |

### `eigenpal workflow templates smoke [options] <template>`

Fill a local Office file or a tmpl\_… resource with a JSON fixture and write the result. Local files never contact the server.

### Arguments

| Name       | Required | Variadic | Description |
| ---------- | -------- | -------- | ----------- |
| `template` | yes      | no       |             |

### Options

| Flag                   | Required | Default | Description                                                  |
| ---------------------- | -------- | ------- | ------------------------------------------------------------ |
| `--data <file>`        | yes      |         | Path to a JSON fixture file (object with template data keys) |
| `--out <path>`         | yes      |         | Filled DOCX/XLSX output path                                 |
| `--revision-id <tmpr>` | no       |         | When <template> is a tmpl\_… id, pin this revision           |
| `--base-url <url>`     | no       |         | Server base URL                                              |
| `--json`               | no       |         | Emit machine-readable JSON on stdout                         |

### `eigenpal workflow experiment|exp list|ls [options] <workflow-id>`

List executions for the workflow, newest first.

### Arguments

| Name          | Required | Variadic | Description |
| ------------- | -------- | -------- | ----------- |
| `workflow-id` | yes      | no       |             |

### Options

| Flag               | Required | Default | Description                          |
| ------------------ | -------- | ------- | ------------------------------------ |
| `--batch-id <id>`  | no       |         | Filter by batch                      |
| `--limit <n>`      | no       | `50`    | Page size                            |
| `--offset <n>`     | no       | `0`     | Page offset                          |
| `--base-url <url>` | no       |         | Server base URL                      |
| `--json`           | no       |         | Emit machine-readable JSON on stdout |

### `eigenpal workflow experiment|exp run [options] <workflow-id>`

Start a batch eval against the workflow's dataset.

### Arguments

| Name          | Required | Variadic | Description |
| ------------- | -------- | -------- | ----------- |
| `workflow-id` | yes      | no       |             |

### Options

| Flag                   | Required | Default | Description                                          |
| ---------------------- | -------- | ------- | ---------------------------------------------------- |
| `--example-id <id>`    | no       | `[]`    | Run only this example (repeatable)                   |
| `--wait`               | no       | `false` | Poll until terminal; non-zero exit on passRate < 1.0 |
| `--interval <n>`       | no       | `10`    | Polling interval in seconds (default 10)             |
| `--max-wait <seconds>` | no       | `1800`  | Maximum wait before exit code 2 (default 1800)       |
| `--base-url <url>`     | no       |         | Server base URL                                      |
| `--json`               | no       |         | Emit machine-readable JSON on stdout                 |

### `eigenpal workflow experiment|exp status [options] <workflow-id> <batchId>`

Aggregate progress for a batch by `batchId`.

### Arguments

| Name          | Required | Variadic | Description |
| ------------- | -------- | -------- | ----------- |
| `workflow-id` | yes      | no       |             |
| `batchId`     | yes      | no       |             |

### Options

| Flag                   | Required | Default | Description                                                                                                                                                      |
| ---------------------- | -------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--watch`              | no       | `false` | Poll until every execution reaches a terminal state (completed/failed/cancelled/rejected), then exit                                                             |
| `--short`              | no       | `false` | Single-line plain-text summary on stdout (e.g. `6/6 done failed=0 cancelled=0 rejected=0`). Pipe-friendly for monitoring loops; mutually exclusive with --watch. |
| `--interval <seconds>` | no       | `5`     | Poll interval in seconds when --watch is set (default 5)                                                                                                         |
| `--max-wait <seconds>` | no       | `1800`  | Hard ceiling for --watch in seconds (default 1800 = 30 min)                                                                                                      |
| `--include <kinds>`    | no       | `""`    | Comma-separated extras to attach when --watch terminates: payload (full per-execution snapshot, can be hundreds of KB)                                           |
| `--base-url <url>`     | no       |         | Server base URL                                                                                                                                                  |
| `--json`               | no       |         | Emit machine-readable JSON on stdout                                                                                                                             |

### `eigenpal workflow experiment|exp cancel [options] <workflow-id> <batchId>`

Cancel every execution in a batch. Idempotent.

### Arguments

| Name          | Required | Variadic | Description |
| ------------- | -------- | -------- | ----------- |
| `workflow-id` | yes      | no       |             |
| `batchId`     | yes      | no       |             |

### Options

| Flag               | Required | Default | Description                                                           |
| ------------------ | -------- | ------- | --------------------------------------------------------------------- |
| `--yes`            | no       |         | Required for non-TTY shells (CI, pipes). Acts immediately, no prompt. |
| `--base-url <url>` | no       |         | Server base URL                                                       |
| `--json`           | no       |         | Emit machine-readable JSON on stdout                                  |

### `eigenpal workflow experiment|exp results [options] <workflow-id> [batchId]`

Download eval results in CSV or JSON.

### Arguments

| Name          | Required | Variadic | Description |
| ------------- | -------- | -------- | ----------- |
| `workflow-id` | yes      | no       |             |
| `batchId`     | no       | no       |             |

### Options

| Flag                   | Required | Default  | Description                                                                              |
| ---------------------- | -------- | -------- | ---------------------------------------------------------------------------------------- |
| `--format <csv\|json>` | no       | `"json"` | Output format (default json)                                                             |
| `--out <path>`         | no       |          | Output file. When omitted, the binary streams to stdout.                                 |
| `--summary`            | no       |          | Show total/pass/fail/error counts, average score, and evaluator rollups                  |
| `--failed-only`        | no       |          | Keep only failed or errored evaluator results                                            |
| `--evaluator <name>`   | no       |          | Keep only results from this evaluator                                                    |
| `--select <path>`      | no       |          | Print only a nested JSON value (for example summary.byEvaluator or discrepancies[].path) |
| `--base-url <url>`     | no       |          | Server base URL                                                                          |
| `--json`               | no       |          | Emit machine-readable JSON on stdout                                                     |

### `eigenpal workflow experiment|exp compare|diff [options] <batchIdA> <batchIdB>`

Compare evaluator scores or actual outputs between two experiment batches.

### Arguments

| Name       | Required | Variadic | Description |
| ---------- | -------- | -------- | ----------- |
| `batchIdA` | yes      | no       |             |
| `batchIdB` | yes      | no       |             |

### Options

| Flag                                                   | Required | Default            | Description                                            |
| ------------------------------------------------------ | -------- | ------------------ | ------------------------------------------------------ |
| `--outputs`                                            | no       |                    | Compare actual run outputs instead of evaluator scores |
| `--sort <abs-delta-desc\|delta-asc\|delta-desc\|name>` | no       | `"abs-delta-desc"` | Row sort order (default: biggest movers first)         |
| `--regression-threshold <n>`                           | no       | `0.05`             | Δ below this is flagged as a regression (default 0.05) |
| `--base-url <url>`                                     | no       |                    | Server base URL                                        |
| `--json`                                               | no       |                    | Emit machine-readable JSON on stdout                   |

### `eigenpal workflow experiment|exp watch [options] <workflow-id> <batchId>`

Poll until terminal, then auto-pull results — replaces `status --watch` + `results --out`.

### Arguments

| Name          | Required | Variadic | Description |
| ------------- | -------- | -------- | ----------- |
| `workflow-id` | yes      | no       |             |
| `batchId`     | yes      | no       |             |

### Options

| Flag                        | Required | Default  | Description                                                             |
| --------------------------- | -------- | -------- | ----------------------------------------------------------------------- |
| `--interval <seconds>`      | no       | `5`      | Poll interval in seconds (default 5)                                    |
| `--max-wait <seconds>`      | no       | `1800`   | Hard ceiling in seconds (default 1800 = 30 min)                         |
| `--pull-on-complete <path>` | no       |          | Destination for the results file. Default: ./results-<batchId>.<format> |
| `--format <csv\|json>`      | no       | `"json"` | Results export format (default json)                                    |
| `--no-pull`                 | no       |          | Skip auto-pulling results on terminal (watch only)                      |
| `--base-url <url>`          | no       |          | Server base URL                                                         |

### `eigenpal workflow versions list|ls [options] <workflow-id>`

List tagged workflow versions plus the current untagged snapshot when HEAD is untagged, newest first.

### Arguments

| Name          | Required | Variadic | Description |
| ------------- | -------- | -------- | ----------- |
| `workflow-id` | yes      | no       |             |

### Options

| Flag               | Required | Default | Description                                                                                   |
| ------------------ | -------- | ------- | --------------------------------------------------------------------------------------------- |
| `--limit <n>`      | no       | `50`    | Page size                                                                                     |
| `--offset <n>`     | no       | `0`     | Page offset                                                                                   |
| `--base-url <url>` | no       |         | Server base URL                                                                               |
| `--json`           | no       |         | Print the sliced { data, total, limit, offset } envelope as JSON (not the raw server payload) |

### `eigenpal workflow versions create [options] <workflow-id>`

Create a tagged workflow version from YAML or by copying an existing snapshot.

### Arguments

| Name          | Required | Variadic | Description |
| ------------- | -------- | -------- | ----------- |
| `workflow-id` | yes      | no       |             |

### Options

| Flag                         | Required | Default | Description                                                                                                                                                                                                    |
| ---------------------------- | -------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--file <yaml>`              | no       |         | Path to workflow YAML. Mutually exclusive with --from.                                                                                                                                                         |
| `--allow-external-templates` | no       |         | Allow local template paths outside the workflow project. Use only for trusted YAML.                                                                                                                            |
| `--from <version-id>`        | no       |         | Existing version id to copy into a new tagged snapshot. Leaves the source tag unchanged. Mutually exclusive with --file.                                                                                       |
| `--set-version <semver>`     | no       |         | Bare semver tag such as 1.4.0. Required when copying with --from. For --file, omit this flag if the YAML already has a top-level version: field. (Named --set-version to avoid the global -v, --version flag.) |
| `--no-activate`              | no       |         | Keep the tagged version off live traffic until you promote it. Default is to make it current. Requires an existing current version.                                                                            |
| `--base-url <url>`           | no       |         | Server base URL                                                                                                                                                                                                |
| `--json`                     | no       |         | Emit machine-readable JSON on stdout                                                                                                                                                                           |

### `eigenpal workflow versions promote [options] <workflow-id> <versionId>`

Make an existing tagged workflow version current without creating another snapshot.

### Arguments

| Name          | Required | Variadic | Description |
| ------------- | -------- | -------- | ----------- |
| `workflow-id` | yes      | no       |             |
| `versionId`   | yes      | no       |             |

### Options

| Flag               | Required | Default | Description                          |
| ------------------ | -------- | ------- | ------------------------------------ |
| `--base-url <url>` | no       |         | Server base URL                      |
| `--json`           | no       |         | Emit machine-readable JSON on stdout |

### `eigenpal workflow versions restore [options] <workflow-id> <versionId>`

Restore a previous snapshot as a new untagged current version. Does not retag the source.

### Arguments

| Name          | Required | Variadic | Description |
| ------------- | -------- | -------- | ----------- |
| `workflow-id` | yes      | no       |             |
| `versionId`   | yes      | no       |             |

### Options

| Flag               | Required | Default | Description                                      |
| ------------------ | -------- | ------- | ------------------------------------------------ |
| `--message <text>` | no       |         | Optional restore note stored on the new snapshot |
| `--base-url <url>` | no       |         | Server base URL                                  |
| `--json`           | no       |         | Emit machine-readable JSON on stdout             |

### `eigenpal workflow step-type list|ls [options]`

List every step type the deployment supports.

### Options

| Flag               | Required | Default | Description                          |
| ------------------ | -------- | ------- | ------------------------------------ |
| `--search <q>`     | no       |         | Filter                               |
| `--limit <n>`      | no       | `50`    | Page size                            |
| `--offset <n>`     | no       | `0`     | Page offset                          |
| `--base-url <url>` | no       |         | Server base URL                      |
| `--json`           | no       |         | Emit machine-readable JSON on stdout |

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

### `eigenpal workflow evaluator-type list|ls [options]`

List every evaluator type with a one-line description.

### Options

| Flag               | Required | Default | Description                          |
| ------------------ | -------- | ------- | ------------------------------------ |
| `--search <q>`     | no       |         | Filter by type, name, or description |
| `--limit <n>`      | no       | `50`    | Page size                            |
| `--offset <n>`     | no       | `0`     | Page offset                          |
| `--base-url <url>` | no       |         | Server base URL                      |
| `--json`           | no       |         | Emit machine-readable JSON on stdout |

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

DISABLED — local mimic runners removed pending server-side redesign (EIG-104). Use `run` or `workflow experiment run` instead.

### Arguments

| Name   | Required | Variadic | Description |
| ------ | -------- | -------- | ----------- |
| `type` | yes      | no       |             |

### Options

| Flag                     | Required | Default | Description                            |
| ------------------------ | -------- | ------- | -------------------------------------- |
| `--config-json <json>`   | no       |         | (unused; kept for back-compat parsing) |
| `--config-file <path>`   | no       |         | (unused)                               |
| `--inputs <pairs...>`    | no       |         | (unused)                               |
| `--output-schema <path>` | no       |         | (unused)                               |
