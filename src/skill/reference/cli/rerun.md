# eigenpal rerun

Create a new run from a previous run's stored input snapshot.

### Arguments

| Name     | Required | Variadic | Description |
| -------- | -------- | -------- | ----------- |
| `run-id` | yes      | no       |             |

### Options

| Flag                   | Required | Default    | Description                                                                                                                                                                   |
| ---------------------- | -------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--base-url <url>`     | no       |            | Server base URL                                                                                                                                                               |
| `--json`               | no       |            | Emit machine-readable JSON on stdout                                                                                                                                          |
| `--version <version>`  | no       | `"latest"` | Version for the new run: latest, original (the source run version), an exact tag (1.2.3), a workflow range (^1, 1.2.x, ~1.2.3), or a version id. Agent reruns take a git ref. |
| `--wait`               | no       |            | Poll until the rerun reaches a terminal status                                                                                                                                |
| `--interval <seconds>` | no       | `2`        | Polling interval in seconds                                                                                                                                                   |
| `--max-wait <seconds>` | no       | `1800`     | Maximum wait before exit code 2                                                                                                                                               |
