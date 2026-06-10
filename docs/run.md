# eigenpal run

Start a workflow or agent run, e.g. workflows.extract-invoice.

### Arguments

| Name     | Required | Variadic | Description |
| -------- | -------- | -------- | ----------- |
| `target` | yes      | no       |             |

### Options

| Flag                        | Required | Default | Description                                                                                          |
| --------------------------- | -------- | ------- | ---------------------------------------------------------------------------------------------------- |
| `--base-url <url>`          | no       |         | Server base URL                                                                                      |
| `--json`                    | no       |         | Output the raw server response as JSON                                                               |
| `--input-json <json>`       | no       |         | JSON input object                                                                                    |
| `--input-file <field=path>` | no       | `[]`    | Input file to upload as multipart form-data. Repeat for multiple files; bare paths use field "file". |
| `--example <name>`          | no       |         | Run one persisted example by name                                                                    |
| `--dir <dir>`               | no       |         | Local eigenpal directory for workflow examples                                                       |
| `--wait`                    | no       |         | Poll until the run reaches a terminal status                                                         |
| `--interval <seconds>`      | no       | `2`     | Polling interval in seconds                                                                          |
| `--max-wait <seconds>`      | no       | `1800`  | Maximum wait before exiting 2                                                                        |
