# eigenpal models

Inspect models and providers configured for the current tenant environment (text, vision, OCR).

## Contents

- [Surface](#surface)
- [Commands](#commands)
  - [Core](#core)
- [Details](#details)
  - [`eigenpal models parser-readiness [options]`](#eigenpal-models-parser-readiness-options)
  - [`eigenpal models list|ls [options]`](#eigenpal-models-listls-options)

## Surface

```
models
├── parser-readiness
└── list|ls
```

## Commands

### Core

| Command                                      | Description                                                                                                                                                                                                                       |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `eigenpal models parser-readiness [options]` | Inspect deployment-approved ai.parse-v2 defaults. Catalog state only; document smoke tests are required for live readiness.                                                                                                       |
| `eigenpal models list\|ls [options]`         | List configured text, vision, and OCR models. This is a catalog inventory from the server, not a live provider health probe. `health` is `configured` or `unconfigured` from local credentials. Pair with `--json` for scripting. |

## Details

### `eigenpal models parser-readiness [options]`

Inspect deployment-approved ai.parse-v2 defaults. Catalog state only; document smoke tests are required for live readiness.

### Options

| Flag               | Required | Default | Description                          |
| ------------------ | -------- | ------- | ------------------------------------ |
| `--base-url <url>` | no       |         | Server base URL                      |
| `--json`           | no       |         | Emit machine-readable JSON on stdout |

### `eigenpal models list|ls [options]`

List configured text, vision, and OCR models. This is a catalog inventory from the server, not a live provider health probe. `health` is `configured` or `unconfigured` from local credentials. Pair with `--json` for scripting.

### Options

| Flag                  | Required | Default | Description                                                                |
| --------------------- | -------- | ------- | -------------------------------------------------------------------------- |
| `--capability <kind>` | no       |         | Filter to `text`, `vision`, or `ocr` (matches the API `capability` query). |
| `--base-url <url>`    | no       |         | Server base URL                                                            |
| `--json`              | no       |         | Emit machine-readable JSON on stdout                                       |
