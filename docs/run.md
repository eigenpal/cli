# eigenpal run

Deprecated: use `eigenpal agents run <target>`.

### Arguments

| Name     | Required | Variadic | Description |
| -------- | -------- | -------- | ----------- |
| `target` | yes      | no       |             |

### Options

| Flag                  | Required | Default | Description                                  |
| --------------------- | -------- | ------- | -------------------------------------------- |
| `--input-json <json>` | no       |         | JSON input object                            |
| `--input-file <path>` | no       |         | Input file to upload as multipart form-data  |
| `--wait`              | no       |         | Poll until the run reaches a terminal status |
| `--base-url <url>`    | no       |         | Server base URL                              |
