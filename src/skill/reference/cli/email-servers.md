# eigenpal email-servers

Manage outbound email servers (ems\_…): list, inspect, create, update, delete, and send a real test message.

## Contents

- [Surface](#surface)
- [Commands](#commands)
  - [Core](#core)
- [Details](#details)
  - [`eigenpal email-servers|email-server list|ls [options]`](#eigenpal-email-serversemail-server-listls-options)
  - [`eigenpal email-servers|email-server get [options] <id>`](#eigenpal-email-serversemail-server-get-options-id)
  - [`eigenpal email-servers|email-server create [options]`](#eigenpal-email-serversemail-server-create-options)
  - [`eigenpal email-servers|email-server update [options] <id>`](#eigenpal-email-serversemail-server-update-options-id)
  - [`eigenpal email-servers|email-server delete [options] <id>`](#eigenpal-email-serversemail-server-delete-options-id)
  - [`eigenpal email-servers|email-server test [options] <id>`](#eigenpal-email-serversemail-server-test-options-id)

## Surface

```
email-servers
├── list|ls
├── get <id>
├── create
├── update <id>
├── delete <id>
└── test <id>
```

## Commands

### Core

| Command                                                      | Description                                                                                                                                                                                                                                        |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `eigenpal email-servers\|email-server list\|ls [options]`    | List outbound email servers for the current workspace.                                                                                                                                                                                             |
| `eigenpal email-servers\|email-server get [options] <id>`    | Inspect one email server. Human output is redacted even if the API regresses.                                                                                                                                                                      |
| `eigenpal email-servers\|email-server create [options]`      | Create an outbound email server. Resend requires an API key; SMTP accepts optional username/password except with --security none, plus optional CA PEM, and defaults to starttls on port 587.                                                      |
| `eigenpal email-servers\|email-server update [options] <id>` | Update metadata or replace transport configuration. Omitted secrets are retained. Passing --transport smtp requires --host, --port, --security, --from-email, and --from-name (no security/port defaults). Metadata-only updates omit --transport. |
| `eigenpal email-servers\|email-server delete [options] <id>` | Soft-delete an outbound email server.                                                                                                                                                                                                              |
| `eigenpal email-servers\|email-server test [options] <id>`   | Send a real connectivity test email through the stored server to --to. Disabled servers fail with a conflict.                                                                                                                                      |

## Details

### `eigenpal email-servers|email-server list|ls [options]`

List outbound email servers for the current workspace.

### Options

| Flag               | Required | Default | Description                          |
| ------------------ | -------- | ------- | ------------------------------------ |
| `--limit <n>`      | no       | `50`    | Page size                            |
| `--offset <n>`     | no       | `0`     | Page offset                          |
| `--base-url <url>` | no       |         | Server base URL                      |
| `--json`           | no       |         | Emit machine-readable JSON on stdout |

### `eigenpal email-servers|email-server get [options] <id>`

Inspect one email server. Human output is redacted even if the API regresses.

### Arguments

| Name | Required | Variadic | Description |
| ---- | -------- | -------- | ----------- |
| `id` | yes      | no       |             |

### Options

| Flag               | Required | Default | Description                          |
| ------------------ | -------- | ------- | ------------------------------------ |
| `--base-url <url>` | no       |         | Server base URL                      |
| `--json`           | no       |         | Emit machine-readable JSON on stdout |

### `eigenpal email-servers|email-server create [options]`

Create an outbound email server. Resend requires an API key; SMTP accepts optional username/password except with --security none, plus optional CA PEM, and defaults to starttls on port 587.

### Options

| Flag                     | Required | Default | Description                                                                                                                                                             |
| ------------------------ | -------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--config-json <json>`   | no       |         | JSON object (non-secret fields only; use secret _-stdin/_-file flags)                                                                                                   |
| `--config-file <path>`   | no       |         | JSON file path (`-` reads stdin; non-secret fields only)                                                                                                                |
| `--name <name>`          | no       |         | Display name                                                                                                                                                            |
| `--transport <kind>`     | no       |         | Transport: resend or smtp                                                                                                                                               |
| `--from-email <email>`   | no       |         | From address                                                                                                                                                            |
| `--from-name <name>`     | no       |         | From display name (no control characters or <>)                                                                                                                         |
| `--enabled`              | no       |         | Enable the server (default on create)                                                                                                                                   |
| `--disabled`             | no       |         | Disable the server                                                                                                                                                      |
| `--host <host>`          | no       |         | SMTP host (required on update when --transport smtp)                                                                                                                    |
| `--port <n>`             | no       |         | SMTP port. Required on update when --transport smtp; create defaults from --security                                                                                    |
| `--security <mode>`      | no       |         | SMTP security: starttls, tls, or none (unauthenticated trusted relays; credentials are rejected). Required on update when --transport smtp; create defaults to starttls |
| `--username <user>`      | no       |         | SMTP username (non-secret)                                                                                                                                              |
| `--api-key-stdin`        | no       |         | Read the Resend API key from stdin                                                                                                                                      |
| `--api-key-file <path>`  | no       |         | Read the Resend API key from a file (`-` for stdin)                                                                                                                     |
| `--password-stdin`       | no       |         | Read the SMTP password from stdin                                                                                                                                       |
| `--password-file <path>` | no       |         | Read the SMTP password from a file (`-` for stdin)                                                                                                                      |
| `--ca-pem-stdin`         | no       |         | Read a custom SMTP CA PEM from stdin                                                                                                                                    |
| `--ca-pem-file <path>`   | no       |         | Read a custom SMTP CA PEM from a file (`-` for stdin)                                                                                                                   |
| `--base-url <url>`       | no       |         | Server base URL                                                                                                                                                         |
| `--json`                 | no       |         | Emit machine-readable JSON on stdout                                                                                                                                    |

### `eigenpal email-servers|email-server update [options] <id>`

Update metadata or replace transport configuration. Omitted secrets are retained. Passing --transport smtp requires --host, --port, --security, --from-email, and --from-name (no security/port defaults). Metadata-only updates omit --transport.

### Arguments

| Name | Required | Variadic | Description |
| ---- | -------- | -------- | ----------- |
| `id` | yes      | no       |             |

### Options

| Flag                     | Required | Default | Description                                                                                                                                                             |
| ------------------------ | -------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--config-json <json>`   | no       |         | JSON object (non-secret fields only; use secret _-stdin/_-file flags)                                                                                                   |
| `--config-file <path>`   | no       |         | JSON file path (`-` reads stdin; non-secret fields only)                                                                                                                |
| `--name <name>`          | no       |         | Display name                                                                                                                                                            |
| `--transport <kind>`     | no       |         | Transport: resend or smtp                                                                                                                                               |
| `--from-email <email>`   | no       |         | From address                                                                                                                                                            |
| `--from-name <name>`     | no       |         | From display name (no control characters or <>)                                                                                                                         |
| `--enabled`              | no       |         | Enable the server (default on create)                                                                                                                                   |
| `--disabled`             | no       |         | Disable the server                                                                                                                                                      |
| `--host <host>`          | no       |         | SMTP host (required on update when --transport smtp)                                                                                                                    |
| `--port <n>`             | no       |         | SMTP port. Required on update when --transport smtp; create defaults from --security                                                                                    |
| `--security <mode>`      | no       |         | SMTP security: starttls, tls, or none (unauthenticated trusted relays; credentials are rejected). Required on update when --transport smtp; create defaults to starttls |
| `--username <user>`      | no       |         | SMTP username (non-secret)                                                                                                                                              |
| `--api-key-stdin`        | no       |         | Read the Resend API key from stdin                                                                                                                                      |
| `--api-key-file <path>`  | no       |         | Read the Resend API key from a file (`-` for stdin)                                                                                                                     |
| `--password-stdin`       | no       |         | Read the SMTP password from stdin                                                                                                                                       |
| `--password-file <path>` | no       |         | Read the SMTP password from a file (`-` for stdin)                                                                                                                      |
| `--ca-pem-stdin`         | no       |         | Read a custom SMTP CA PEM from stdin                                                                                                                                    |
| `--ca-pem-file <path>`   | no       |         | Read a custom SMTP CA PEM from a file (`-` for stdin)                                                                                                                   |
| `--clear-ca-pem`         | no       |         | Remove a stored custom SMTP CA certificate                                                                                                                              |
| `--clear-username`       | no       |         | Clear stored SMTP username/password pair                                                                                                                                |
| `--base-url <url>`       | no       |         | Server base URL                                                                                                                                                         |
| `--json`                 | no       |         | Emit machine-readable JSON on stdout                                                                                                                                    |

### `eigenpal email-servers|email-server delete [options] <id>`

Soft-delete an outbound email server.

### Arguments

| Name | Required | Variadic | Description |
| ---- | -------- | -------- | ----------- |
| `id` | yes      | no       |             |

### Options

| Flag               | Required | Default | Description                          |
| ------------------ | -------- | ------- | ------------------------------------ |
| `--yes`            | no       | `false` | Required for non-TTY shells          |
| `--base-url <url>` | no       |         | Server base URL                      |
| `--json`           | no       |         | Emit machine-readable JSON on stdout |

### `eigenpal email-servers|email-server test [options] <id>`

Send a real connectivity test email through the stored server to --to. Disabled servers fail with a conflict.

### Arguments

| Name | Required | Variadic | Description |
| ---- | -------- | -------- | ----------- |
| `id` | yes      | no       |             |

### Options

| Flag               | Required | Default | Description                          |
| ------------------ | -------- | ------- | ------------------------------------ |
| `--to <email>`     | yes      |         | Recipient for the live test message  |
| `--base-url <url>` | no       |         | Server base URL                      |
| `--json`           | no       |         | Emit machine-readable JSON on stdout |
