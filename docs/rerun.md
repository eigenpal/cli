# eigenpal rerun

Create a new run from a previous run's stored input snapshot.

### Arguments

| Name     | Required | Variadic | Description |
| -------- | -------- | -------- | ----------- |
| `run-id` | yes      | no       |             |

### Options

| Flag                   | Required | Default    | Description                                                              |
| ---------------------- | -------- | ---------- | ------------------------------------------------------------------------ |
| `--base-url <url>`     | no       |            | Server base URL                                                          |
| `--json`               | no       |            | Output the raw server response as JSON                                   |
| `--version <version>`  | no       | `"latest"` | Version/source ref for the new run: latest, original, or an explicit ref |
| `--wait`               | no       |            | Poll until the rerun reaches a terminal status                           |
| `--interval <seconds>` | no       | `2`        | Polling interval in seconds                                              |
| `--max-wait <seconds>` | no       | `1800`     | Maximum wait before exiting 2                                            |
