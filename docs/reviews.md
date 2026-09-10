# eigenpal reviews

Work the live human-review queue for paused runs: list pending tasks, confirm fields, approve, reject, and download attachments.

## Contents

- [Surface](#surface)
- [Commands](#commands)
  - [Core](#core)
- [Details](#details)
  - [`eigenpal reviews|rv list|ls [options]`](#eigenpal-reviewsrv-listls-options)
  - [`eigenpal reviews|rv get [options] <task-id>`](#eigenpal-reviewsrv-get-options-task-id)
  - [`eigenpal reviews|rv confirm [options] <task-id>`](#eigenpal-reviewsrv-confirm-options-task-id)
  - [`eigenpal reviews|rv approve [options] <task-id>`](#eigenpal-reviewsrv-approve-options-task-id)
  - [`eigenpal reviews|rv reject [options] <task-id>`](#eigenpal-reviewsrv-reject-options-task-id)
  - [`eigenpal reviews|rv download [options] <task-id> <file-id>`](#eigenpal-reviewsrv-download-options-task-id-file-id)

## Surface

```
reviews
├── list|ls
├── get <task-id>
├── confirm <task-id>
├── approve <task-id>
├── reject <task-id>
└── download <task-id> <file-id>
```

## Commands

### Core

| Command                                                       | Description                                                                                         |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `eigenpal reviews\|rv list\|ls [options]`                     | List pending human-review tasks (oldest first, cursor-paginated).                                   |
| `eigenpal reviews\|rv get [options] <task-id>`                | Get one human-review task with its field decisions and attached files.                              |
| `eigenpal reviews\|rv confirm [options] <task-id>`            | Confirm or edit one scalar review field. Use --withdraw to persist a draft edit without confirming. |
| `eigenpal reviews\|rv approve [options] <task-id>`            | Approve a review task after all required fields are confirmed.                                      |
| `eigenpal reviews\|rv reject [options] <task-id>`             | Reject a review task and fail the paused run with a reason.                                         |
| `eigenpal reviews\|rv download [options] <task-id> <file-id>` | Download one file attached to a review task.                                                        |

## Details

### `eigenpal reviews|rv list|ls [options]`

List pending human-review tasks (oldest first, cursor-paginated).

### Options

| Flag                     | Required | Default | Description                                                     |
| ------------------------ | -------- | ------- | --------------------------------------------------------------- |
| `--automation-id <id>`   | no       |         | Filter to one automation id                                     |
| `--waiting-before <iso>` | no       |         | Only tasks created before this ISO timestamp (queue age filter) |
| `--cursor <token>`       | no       |         | Pagination cursor from a previous list response                 |
| `--limit <n>`            | no       | `50`    | Page size (1–100)                                               |
| `--base-url <url>`       | no       |         | Server base URL                                                 |
| `--json`                 | no       |         | Emit machine-readable JSON on stdout                            |

### `eigenpal reviews|rv get [options] <task-id>`

Get one human-review task with its field decisions and attached files.

### Arguments

| Name      | Required | Variadic | Description |
| --------- | -------- | -------- | ----------- |
| `task-id` | yes      | no       |             |

### Options

| Flag               | Required | Default | Description                          |
| ------------------ | -------- | ------- | ------------------------------------ |
| `--base-url <url>` | no       |         | Server base URL                      |
| `--json`           | no       |         | Emit machine-readable JSON on stdout |

### `eigenpal reviews|rv confirm [options] <task-id>`

Confirm or edit one scalar review field. Use --withdraw to persist a draft edit without confirming.

### Arguments

| Name      | Required | Variadic | Description |
| --------- | -------- | -------- | ----------- |
| `task-id` | yes      | no       |             |

### Options

| Flag                      | Required | Default | Description                                               |
| ------------------------- | -------- | ------- | --------------------------------------------------------- |
| `--path <json-pointer>`   | yes      |         | Field JSON pointer (for example /vendor or /items/0/name) |
| `--value <scalar>`        | no       |         | Scalar value: string, number, true, false, or null        |
| `--value-json <json>`     | no       |         | Scalar JSON literal (alternative to --value)              |
| `--expected-version <n>`  | yes      |         | Optimistic concurrency version from get/list              |
| `--idempotency-key <key>` | no       |         | Durable idempotency key (auto-generated when omitted)     |
| `--withdraw`              | no       |         | Persist the edit without confirming (confirmed=false)     |
| `--base-url <url>`        | no       |         | Server base URL                                           |
| `--json`                  | no       |         | Emit machine-readable JSON on stdout                      |

### `eigenpal reviews|rv approve [options] <task-id>`

Approve a review task after all required fields are confirmed.

### Arguments

| Name      | Required | Variadic | Description |
| --------- | -------- | -------- | ----------- |
| `task-id` | yes      | no       |             |

### Options

| Flag                     | Required | Default | Description                                  |
| ------------------------ | -------- | ------- | -------------------------------------------- |
| `--expected-version <n>` | yes      |         | Optimistic concurrency version from get/list |
| `--base-url <url>`       | no       |         | Server base URL                              |
| `--json`                 | no       |         | Emit machine-readable JSON on stdout         |

### `eigenpal reviews|rv reject [options] <task-id>`

Reject a review task and fail the paused run with a reason.

### Arguments

| Name      | Required | Variadic | Description |
| --------- | -------- | -------- | ----------- |
| `task-id` | yes      | no       |             |

### Options

| Flag                      | Required | Default | Description                                           |
| ------------------------- | -------- | ------- | ----------------------------------------------------- |
| `--reason <text>`         | yes      |         | Human-readable rejection reason                       |
| `--expected-version <n>`  | yes      |         | Optimistic concurrency version from get/list          |
| `--idempotency-key <key>` | no       |         | Durable idempotency key (auto-generated when omitted) |
| `--base-url <url>`        | no       |         | Server base URL                                       |
| `--json`                  | no       |         | Emit machine-readable JSON on stdout                  |

### `eigenpal reviews|rv download [options] <task-id> <file-id>`

Download one file attached to a review task.

### Arguments

| Name      | Required | Variadic | Description |
| --------- | -------- | -------- | ----------- |
| `task-id` | yes      | no       |             |
| `file-id` | yes      | no       |             |

### Options

| Flag               | Required | Default | Description                   |
| ------------------ | -------- | ------- | ----------------------------- |
| `--out <path>`     | yes      |         | Write bytes to this file path |
| `--base-url <url>` | no       |         | Server base URL               |
