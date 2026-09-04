# eigenpal docs

List, search, and read the complete release-matched Eigenpal documentation offline.

## Contents

- [Surface](#surface)
- [Commands](#commands)
  - [Core](#core)
- [Details](#details)
  - [`eigenpal docs list|ls [options] [prefix]`](#eigenpal-docs-listls-options-prefix)
  - [`eigenpal docs search [options] <query>`](#eigenpal-docs-search-options-query)
  - [`eigenpal docs read [options] <topic>`](#eigenpal-docs-read-options-topic)

## Surface

```
docs
├── list|ls [prefix]
├── search <query>
└── read <topic>
```

## Commands

### Core

| Command                                     | Description                                                        |
| ------------------------------------------- | ------------------------------------------------------------------ |
| `eigenpal docs list\|ls [options] [prefix]` | List bundled documentation topics, optionally under a path prefix. |
| `eigenpal docs search [options] <query>`    | Search every public page and detailed agent reference.             |
| `eigenpal docs read [options] <topic>`      | Print one bundled documentation topic to stdout.                   |

## Details

### `eigenpal docs list|ls [options] [prefix]`

List bundled documentation topics, optionally under a path prefix.

### Arguments

| Name     | Required | Variadic | Description |
| -------- | -------- | -------- | ----------- |
| `prefix` | no       | no       |             |

### Options

| Flag                | Required | Default | Description                               |
| ------------------- | -------- | ------- | ----------------------------------------- |
| `--json`            | no       |         | Emit machine-readable JSON on stdout      |
| `--source <source>` | no       |         | Filter by public, agent-reference, or api |

### `eigenpal docs search [options] <query>`

Search every public page and detailed agent reference.

### Arguments

| Name    | Required | Variadic | Description |
| ------- | -------- | -------- | ----------- |
| `query` | yes      | no       |             |

### Options

| Flag          | Required | Default | Description                          |
| ------------- | -------- | ------- | ------------------------------------ |
| `--json`      | no       |         | Emit machine-readable JSON on stdout |
| `--limit <n>` | no       | `20`    | Maximum matches                      |

### `eigenpal docs read [options] <topic>`

Print one bundled documentation topic to stdout.

### Arguments

| Name    | Required | Variadic | Description |
| ------- | -------- | -------- | ----------- |
| `topic` | yes      | no       |             |

### Options

| Flag     | Required | Default | Description                          |
| -------- | -------- | ------- | ------------------------------------ |
| `--json` | no       |         | Emit machine-readable JSON on stdout |
