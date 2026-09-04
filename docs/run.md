# eigenpal run

Start a workflow or agent run, e.g. workflows.extract-invoice.

### Arguments

| Name     | Required | Variadic | Description |
| -------- | -------- | -------- | ----------- |
| `target` | yes      | no       |             |

### Options

| Flag                        | Required | Default | Description                                                                                                                                                                                                      |
| --------------------------- | -------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--base-url <url>`          | no       |         | Server base URL                                                                                                                                                                                                  |
| `--json`                    | no       |         | Emit machine-readable JSON on stdout                                                                                                                                                                             |
| `--input-json <json>`       | no       |         | JSON input object                                                                                                                                                                                                |
| `--input-file <field=path>` | no       | `[]`    | Input file to upload. Files exceeding EIGENPAL_MULTIPART_MAX_BYTES (default 4.5 MiB; "none" disables) are pre-uploaded; smaller files stay on multipart. Repeat for multiple files; bare paths use field "file". |
| `--example <name>`          | no       |         | Run one persisted example by name                                                                                                                                                                                |
| `--dir <dir>`               | no       |         | Local eigenpal directory for workflow examples                                                                                                                                                                   |
| `--fail-on-mismatch`        | no       |         | For --example runs, exit non-zero when a graded example fails (evaluator fail, or output mismatch)                                                                                                               |
| `--wait`                    | no       |         | Poll until the run reaches a terminal status                                                                                                                                                                     |
| `--interval <seconds>`      | no       | `2`     | Polling interval in seconds                                                                                                                                                                                      |
| `--max-wait <seconds>`      | no       | `1800`  | Maximum wait before exit code 2                                                                                                                                                                                  |
