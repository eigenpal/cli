# eigenpal runs

Deprecated: use `eigenpal agents runs list <target>`.

### Arguments

| Name     | Required | Variadic | Description |
| -------- | -------- | -------- | ----------- |
| `target` | yes      | no       |             |

### Options

| Flag                  | Required | Default | Description                  |
| --------------------- | -------- | ------- | ---------------------------- |
| `--status <status>`   | no       |         | Filter by run status         |
| `--include <items>`   | no       |         | Comma-separated include list |
| `--compact`           | no       |         | Render compact run rows      |
| `--sort <field>`      | no       |         | Sort field                   |
| `--order <asc\|desc>` | no       |         | Sort order                   |
| `--base-url <url>`    | no       |         | Server base URL              |
| `--json`              | no       |         | Emit machine-readable JSON   |
| `--limit <n>`         | no       |         | Page size                    |
| `--offset <n>`        | no       |         | Page offset                  |
