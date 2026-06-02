# eigenpal init

Scaffold a new workflow project. Without `[name]`, scaffolds into the current directory using the cwd basename as the workflow name. With `[name]`, creates `./<name>/` and uses that as the slug. The flat layout matches what `workflow execution run <slug>` already discovers — no manual file moves.

## Contents

- [Surface](#surface)
- [Commands](#commands)
  - [Core](#core)
- [Details](#details)
  - [`eigenpal init workflow [options] <name>`](#eigenpal-init-workflow-options-name)
  - [`eigenpal init agent [options] <name>`](#eigenpal-init-agent-options-name)

## Surface

```
init
├── workflow <name>
└── agent <name>
```

## Commands

### Core

| Command                                   | Description                                                                                                                                                             |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `eigenpal init workflow [options] <name>` | Alias of `eigenpal init <name>`. Kept so the `init {workflow,agent}` namespace stays visible — once the agent surface lights up, both kinds will live as siblings here. |
| `eigenpal init agent [options] <name>`    | Deprecated: use `eigenpal agents init <name> --template agent`.                                                                                                         |

## Details

### `eigenpal init workflow [options] <name>`

Alias of `eigenpal init <name>`. Kept so the `init {workflow,agent}` namespace stays visible — once the agent surface lights up, both kinds will live as siblings here.

### Arguments

| Name   | Required | Variadic | Description |
| ------ | -------- | -------- | ----------- |
| `name` | yes      | no       |             |

### Options

| Flag                | Required | Default | Description                                        |
| ------------------- | -------- | ------- | -------------------------------------------------- |
| `--template <name>` | no       |         | Skip the picker; use this template                 |
| `--dir <dir>`       | no       |         | Target directory (default: ./<name>)               |
| `--yes`             | no       |         | Non-interactive: pick the default template (blank) |

### `eigenpal init agent [options] <name>`

Deprecated: use `eigenpal agents init <name> --template agent`.

### Arguments

| Name   | Required | Variadic | Description |
| ------ | -------- | -------- | ----------- |
| `name` | yes      | no       |             |

### Options

| Flag          | Required | Default | Description                          |
| ------------- | -------- | ------- | ------------------------------------ |
| `--dir <dir>` | no       |         | Target directory (default: ./<name>) |
