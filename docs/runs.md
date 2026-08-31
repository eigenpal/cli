# eigenpal runs

Inspect, watch, and manage workflow, agent, and eval runs.

## Contents

- [Surface](#surface)
- [Commands](#commands)
  - [Core](#core)
  - [Artifacts](#artifacts)
  - [Reviews](#reviews)
  - [Expected](#expected)
- [Details](#details)
  - [`eigenpal runs list|ls [options] [source]`](#eigenpal-runs-listls-options-source)
  - [`eigenpal runs get [options] <run-id>`](#eigenpal-runs-get-options-run-id)
  - [`eigenpal runs compare|diff [options] <reference-run-id> <run-id>`](#eigenpal-runs-comparediff-options-reference-run-id-run-id)
  - [`eigenpal runs rerun [options] <run-id>`](#eigenpal-runs-rerun-options-run-id)
  - [`eigenpal runs promote [options] <run-id>`](#eigenpal-runs-promote-options-run-id)
  - [`eigenpal runs trace [options] <run-id>`](#eigenpal-runs-trace-options-run-id)
  - [`eigenpal runs watch [options] <run-id>`](#eigenpal-runs-watch-options-run-id)
  - [`eigenpal runs cancel [options] <run-id>`](#eigenpal-runs-cancel-options-run-id)
  - [`eigenpal runs artifacts|artifact list|ls [options] <run-id>`](#eigenpal-runs-artifactsartifact-listls-options-run-id)
  - [`eigenpal runs artifacts|artifact fetch [options] <run-id>`](#eigenpal-runs-artifactsartifact-fetch-options-run-id)
  - [`eigenpal runs artifacts|artifact inspect [options] [run-id] [artifact-path]`](#eigenpal-runs-artifactsartifact-inspect-options-run-id-artifact-path)
  - [`eigenpal runs reviews|rv update [options] <run-id>`](#eigenpal-runs-reviewsrv-update-options-run-id)
  - [`eigenpal runs reviews|rv close [options] <run-id>`](#eigenpal-runs-reviewsrv-close-options-run-id)
  - [`eigenpal runs reviews|rv clear [options] <run-id>`](#eigenpal-runs-reviewsrv-clear-options-run-id)
  - [`eigenpal runs expected list|ls [options] <run-id>`](#eigenpal-runs-expected-listls-options-run-id)
  - [`eigenpal runs expected pull [options] <run-id>`](#eigenpal-runs-expected-pull-options-run-id)
  - [`eigenpal runs expected upload [options] <run-id> <file>`](#eigenpal-runs-expected-upload-options-run-id-file)
  - [`eigenpal runs expected copy-output [options] <run-id> <output-file>`](#eigenpal-runs-expected-copy-output-options-run-id-output-file)
  - [`eigenpal runs expected rename [options] <run-id> <old-name> <new-name>`](#eigenpal-runs-expected-rename-options-run-id-old-name-new-name)
  - [`eigenpal runs expected delete [options] <run-id> <name>`](#eigenpal-runs-expected-delete-options-run-id-name)

## Surface

```
runs
├── list|ls [source]
├── get <run-id>
├── compare|diff <reference-run-id> <run-id>
├── rerun <run-id>
├── promote <run-id>
├── artifacts|artifact
│   ├── list|ls <run-id>
│   ├── fetch <run-id>
│   └── inspect [run-id] [artifact-path]
├── trace <run-id>
├── reviews|rv
│   ├── update <run-id>
│   ├── close <run-id>
│   └── clear <run-id>
├── expected
│   ├── list|ls <run-id>
│   ├── pull <run-id>
│   ├── upload <run-id> <file>
│   ├── copy-output <run-id> <output-file>
│   ├── rename <run-id> <old-name> <new-name>
│   └── delete <run-id> <name>
├── watch <run-id>
└── cancel <run-id>
```

## Commands

### Core

| Command                                                             | Description                                                                                                                     |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `eigenpal runs list\|ls [options] [source]`                         | List runs across workflows and agents, optionally scoped to one source.                                                         |
| `eigenpal runs get [options] <run-id>`                              | Get one run.                                                                                                                    |
| `eigenpal runs compare\|diff [options] <reference-run-id> <run-id>` | Compare one run against another run. PDF/DOCX use pdftotext/python3; XLSX compares structured workbook content (not ZIP bytes). |
| `eigenpal runs rerun [options] <run-id>`                            | Create a new run from a previous run's stored input snapshot.                                                                   |
| `eigenpal runs promote [options] <run-id>`                          | Promote a run into a dataset example on the run's automation.                                                                   |
| `eigenpal runs trace [options] <run-id>`                            | Print raw trace.jsonl for a run, or write it with --out.                                                                        |
| `eigenpal runs watch [options] <run-id>`                            | Watch a run until it reaches a terminal status.                                                                                 |
| `eigenpal runs cancel [options] <run-id>`                           | Cancel a run.                                                                                                                   |

### Artifacts

| Command                                                                        | Description                                                                                                         |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `eigenpal runs artifacts\|artifact list\|ls [options] <run-id>`                | List available run artifacts without downloading them.                                                              |
| `eigenpal runs artifacts\|artifact fetch [options] <run-id>`                   | Download run artifacts by canonical artifact path.                                                                  |
| `eigenpal runs artifacts\|artifact inspect [options] [run-id] [artifact-path]` | Inspect a run XLSX artifact as structured JSON (sheet names, headers, typed rows). Use --file for a local workbook. |

### Reviews

| Command                                               | Description                                                            |
| ----------------------------------------------------- | ---------------------------------------------------------------------- |
| `eigenpal runs reviews\|rv update [options] <run-id>` | Edit review verdict, status, note, or corrected JSON for a run.        |
| `eigenpal runs reviews\|rv close [options] <run-id>`  | Mark a run review as closed.                                           |
| `eigenpal runs reviews\|rv clear [options] <run-id>`  | Delete review metadata, corrected JSON, and corrected files for a run. |

### Expected

| Command                                                                  | Description                                           |
| ------------------------------------------------------------------------ | ----------------------------------------------------- |
| `eigenpal runs expected list\|ls [options] <run-id>`                     | List expected JSON and files attached to a run.       |
| `eigenpal runs expected pull [options] <run-id>`                         | Download expected JSON and files attached to a run.   |
| `eigenpal runs expected upload [options] <run-id> <file>`                | Upload a local file as an expected artifact.          |
| `eigenpal runs expected copy-output [options] <run-id> <output-file>`    | Copy a generated output file into expected artifacts. |
| `eigenpal runs expected rename [options] <run-id> <old-name> <new-name>` | Rename an expected artifact.                          |
| `eigenpal runs expected delete [options] <run-id> <name>`                | Delete an expected artifact.                          |

## Details

### `eigenpal runs list|ls [options] [source]`

List runs across workflows and agents, optionally scoped to one source.

### Arguments

| Name     | Required | Variadic | Description |
| -------- | -------- | -------- | ----------- |
| `source` | no       | no       |             |

### Options

| Flag                           | Required | Default | Description                                               |
| ------------------------------ | -------- | ------- | --------------------------------------------------------- |
| `--base-url <url>`             | no       |         | Server base URL                                           |
| `--limit <n>`                  | no       | `50`    | Page size                                                 |
| `--offset <n>`                 | no       | `0`     | Page offset                                               |
| `--json`                       | no       |         | Output the raw server response as JSON                    |
| `--type <type>`                | no       |         | Filter by run type: workflow\|agent                       |
| `--status <status>`            | no       |         | Filter by run status                                      |
| `--source-ref <ref>`           | no       |         | Filter agent runs by source ref                           |
| `--batch-id <id>`              | no       |         | Filter eval/experiment runs by batch id                   |
| `--example-id <id>`            | no       |         | Filter eval runs by example id                            |
| `--example-id-contains <text>` | no       |         | Filter eval runs by example id substring                  |
| `--from <date>`                | no       |         | Created at or after this ISO timestamp or relative date   |
| `--to <date>`                  | no       |         | Created before this ISO timestamp or relative date        |
| `--created-after <date>`       | no       |         | Alias for --from                                          |
| `--created-before <date>`      | no       |         | Alias for --to                                            |
| `--completed-after <date>`     | no       |         | Completed at or after this ISO timestamp or relative date |
| `--completed-before <date>`    | no       |         | Completed before this ISO timestamp or relative date      |
| `--compact`                    | no       |         | Render compact run rows                                   |
| `--sort <field>`               | no       |         | Sort field; only createdAt is supported                   |
| `--order <asc\|desc>`          | no       |         | Sort order; only desc is supported                        |

### `eigenpal runs get [options] <run-id>`

Get one run.

### Arguments

| Name     | Required | Variadic | Description |
| -------- | -------- | -------- | ----------- |
| `run-id` | yes      | no       |             |

### Options

| Flag                  | Required | Default    | Description                                                                                                                                                                                 |
| --------------------- | -------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--base-url <url>`    | no       |            | Server base URL                                                                                                                                                                             |
| `--json`              | no       |            | Output the raw server response as JSON                                                                                                                                                      |
| `--step <name>`       | no       |            | For workflow runs, show only this step (or comma-separated list)                                                                                                                            |
| `--expand <sections>` | no       |            | Comma-separated server expand sections for GET /api/v1/runs/:id: input, usage, execution, debug. Use execution for status/schemaValid; completed runs include top-level output/files/error. |
| `--include <parts>`   | no       | `"review"` | Comma-separated local workflow step projection fields (error, duration, inputRef, …). Legacy expand names are mapped when possible; use --expand for server sections.                       |

### `eigenpal runs compare|diff [options] <reference-run-id> <run-id>`

Compare one run against another run. PDF/DOCX use pdftotext/python3; XLSX compares structured workbook content (not ZIP bytes).

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
| `--step <name>`     | no       |         | For workflow runs, restrict comparison to one step                  |
| `--out <dir>`       | no       |         | Write comparison artifacts to this directory                        |
| `--normalize-dates` | no       |         | Normalize YYYYMMDD and YYYY-MM-DD tokens in filenames/text          |
| `--fail-on-diff`    | no       |         | Exit 1 when comparison status is fail                               |

### `eigenpal runs rerun [options] <run-id>`

Create a new run from a previous run's stored input snapshot.

### Arguments

| Name     | Required | Variadic | Description |
| -------- | -------- | -------- | ----------- |
| `run-id` | yes      | no       |             |

### Options

| Flag                   | Required | Default | Description                                                                                                       |
| ---------------------- | -------- | ------- | ----------------------------------------------------------------------------------------------------------------- |
| `--base-url <url>`     | no       |         | Server base URL                                                                                                   |
| `--json`               | no       |         | Output the raw server response as JSON                                                                            |
| `--version <version>`  | no       |         | Version/source ref for the new run: latest (default), original, or an explicit ref (same grammar as eigenpal run) |
| `--source-ref <ref>`   | no       |         | Alias for --version                                                                                               |
| `--wait`               | no       |         | Poll until the rerun reaches a terminal status                                                                    |
| `--interval <seconds>` | no       | `2`     | Polling interval in seconds                                                                                       |
| `--max-wait <seconds>` | no       | `1800`  | Maximum wait before exit code 2                                                                                   |

### `eigenpal runs promote [options] <run-id>`

Promote a run into a dataset example on the run's automation.

### Arguments

| Name     | Required | Variadic | Description |
| -------- | -------- | -------- | ----------- |
| `run-id` | yes      | no       |             |

### Options

| Flag               | Required | Default | Description                            |
| ------------------ | -------- | ------- | -------------------------------------- |
| `--base-url <url>` | no       |         | Server base URL                        |
| `--json`           | no       |         | Output the raw server response as JSON |
| `--name <name>`    | no       |         | Name for the created example           |

### `eigenpal runs trace [options] <run-id>`

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

### `eigenpal runs watch [options] <run-id>`

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
| `--max-wait <seconds>` | no       | `1800`  | Maximum wait before exit code 2        |

### `eigenpal runs cancel [options] <run-id>`

Cancel a run.

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

### `eigenpal runs artifacts|artifact list|ls [options] <run-id>`

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

### `eigenpal runs artifacts|artifact fetch [options] <run-id>`

Download run artifacts by canonical artifact path.

### Arguments

| Name     | Required | Variadic | Description |
| -------- | -------- | -------- | ----------- |
| `run-id` | yes      | no       |             |

### Options

| Flag                | Required | Default | Description                                                                     |
| ------------------- | -------- | ------- | ------------------------------------------------------------------------------- |
| `--base-url <url>`  | no       |         | Server base URL                                                                 |
| `--out <dir>`       | no       |         | Output directory                                                                |
| `--include <parts>` | no       | `"all"` | Comma-separated parts: output,input,metadata,issues,trace,lockfile,expected,all |
| `--path <path>`     | no       | `[]`    | Fetch one exact artifact path from `artifacts list`; repeatable                 |
| `--json`            | no       |         | Output a JSON summary of written artifacts                                      |

### `eigenpal runs artifacts|artifact inspect [options] [run-id] [artifact-path]`

Inspect a run XLSX artifact as structured JSON (sheet names, headers, typed rows). Use --file for a local workbook.

### Arguments

| Name            | Required | Variadic | Description |
| --------------- | -------- | -------- | ----------- |
| `run-id`        | no       | no       |             |
| `artifact-path` | no       | no       |             |

### Options

| Flag               | Required | Default | Description                                                                        |
| ------------------ | -------- | ------- | ---------------------------------------------------------------------------------- |
| `--base-url <url>` | no       |         | Server base URL                                                                    |
| `--json`           | no       |         | Output the raw server response as JSON                                             |
| `--file <path>`    | no       |         | Inspect a local .xlsx/.xls file instead of downloading a run artifact              |
| `--path <path>`    | no       |         | Canonical artifact path from `artifacts list` (alias for positional artifact-path) |
| `--sheet <names>`  | no       |         | Comma-separated sheet names or zero-based indices to include                       |
| `--max-sheets <n>` | no       |         | Maximum sheets to include (default 20)                                             |
| `--max-rows <n>`   | no       |         | Maximum data rows per sheet (default 500)                                          |
| `--max-cols <n>`   | no       |         | Maximum columns per sheet (default 50)                                             |

### `eigenpal runs reviews|rv update [options] <run-id>`

Edit review verdict, status, note, or corrected JSON for a run.

### Arguments

| Name     | Required | Variadic | Description |
| -------- | -------- | -------- | ----------- |
| `run-id` | yes      | no       |             |

### Options

| Flag                                | Required | Default | Description                            |
| ----------------------------------- | -------- | ------- | -------------------------------------- |
| `--base-url <url>`                  | no       |         | Server base URL                        |
| `--json`                            | no       |         | Output the raw server response as JSON |
| `--status <open\|closed\|wont_fix>` | no       |         | Set review lifecycle status            |
| `--verdict <correct\|incorrect>`    | no       |         | Set reviewer verdict                   |
| `--note <text>`                     | no       |         | Set review note                        |
| `--note-file <path>`                | no       |         | Read review note from a file           |
| `--corrected-json <json>`           | no       |         | Set corrected JSON output              |
| `--corrected-json-file <path>`      | no       |         | Read corrected JSON output from a file |
| `--clear-note`                      | no       |         | Clear the review note                  |
| `--clear-corrected-json`            | no       |         | Delete corrected JSON output           |

### `eigenpal runs reviews|rv close [options] <run-id>`

Mark a run review as closed.

### Arguments

| Name     | Required | Variadic | Description |
| -------- | -------- | -------- | ----------- |
| `run-id` | yes      | no       |             |

### Options

| Flag                 | Required | Default | Description                            |
| -------------------- | -------- | ------- | -------------------------------------- |
| `--base-url <url>`   | no       |         | Server base URL                        |
| `--json`             | no       |         | Output the raw server response as JSON |
| `--note <text>`      | no       |         | Set developer close note               |
| `--note-file <path>` | no       |         | Read developer close note from a file  |

### `eigenpal runs reviews|rv clear [options] <run-id>`

Delete review metadata, corrected JSON, and corrected files for a run.

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

### `eigenpal runs expected list|ls [options] <run-id>`

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

### `eigenpal runs expected pull [options] <run-id>`

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

### `eigenpal runs expected upload [options] <run-id> <file>`

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

### `eigenpal runs expected copy-output [options] <run-id> <output-file>`

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

### `eigenpal runs expected rename [options] <run-id> <old-name> <new-name>`

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

### `eigenpal runs expected delete [options] <run-id> <name>`

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
