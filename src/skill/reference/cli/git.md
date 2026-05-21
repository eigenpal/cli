# eigenpal git

Experimental Git-backed source commands.

## Contents

- [Surface](#surface)
- [Commands](#commands)
  - [Core](#core)
- [Details](#details)
  - [`eigenpal git clone [options]`](#eigenpal-git-clone-options)
  - [`eigenpal git doctor [options]`](#eigenpal-git-doctor-options)
  - [`eigenpal git validate [options] [dir]`](#eigenpal-git-validate-options-dir)
  - [`eigenpal git status [options]`](#eigenpal-git-status-options)
  - [`eigenpal git deps [options]`](#eigenpal-git-deps-options)
  - [`eigenpal git clean [options]`](#eigenpal-git-clean-options)
  - [`eigenpal git list|ls [options]`](#eigenpal-git-listls-options)
  - [`eigenpal git show [options] <automation>`](#eigenpal-git-show-options-automation)
  - [`eigenpal git versions [options] <package>`](#eigenpal-git-versions-options-package)
  - [`eigenpal git release [options] <version> [dir]`](#eigenpal-git-release-options-version-dir)
  - [`eigenpal git sync [options] [automation]`](#eigenpal-git-sync-options-automation)

## Surface

```
git
├── clone
├── doctor
├── validate [dir]
├── status
├── deps
├── clean
├── list|ls
├── show <automation>
├── versions <package>
├── release <version> [dir]
└── sync [automation]
```

## Commands

### Core

| Command                                          | Description                                            |
| ------------------------------------------------ | ------------------------------------------------------ | ---------------------------- |
| `eigenpal git clone [options]`                   | Clone the organization source repository.              |
| `eigenpal git doctor [options]`                  | Check organization source repository health.           |
| `eigenpal git validate [options] [dir]`          | Validate the nearest source package.                   |
| `eigenpal git status [options]`                  | Show source repo and package status.                   |
| `eigenpal git deps [options]`                    | List package workspace dependencies.                   |
| `eigenpal git clean [options]`                   | Require a clean source working tree.                   |
| `eigenpal git list                               | ls [options]`                                          | List Git-backed automations. |
| `eigenpal git show [options] <automation>`       | Show Git-backed automation details.                    |
| `eigenpal git versions [options] <package>`      | List package release versions.                         |
| `eigenpal git release [options] <version> [dir]` | Create and push a package release tag.                 |
| `eigenpal git sync [options] [automation]`       | Sync an automation from the latest Git source release. |

## Details

### `eigenpal git clone [options]`

Clone the organization source repository.

### Options

| Flag               | Required | Default | Description      |
| ------------------ | -------- | ------- | ---------------- |
| `--base-url <url>` | no       |         | Server base URL  |
| `--out <dir>`      | no       |         | Output directory |

### `eigenpal git doctor [options]`

Check organization source repository health.

### Options

| Flag          | Required | Default | Description                            |
| ------------- | -------- | ------- | -------------------------------------- |
| `--json`      | no       |         | Output the raw server response as JSON |
| `--dir <dir>` | no       |         | Directory to inspect                   |

### `eigenpal git validate [options] [dir]`

Validate the nearest source package.

### Arguments

| Name  | Required | Variadic | Description |
| ----- | -------- | -------- | ----------- |
| `dir` | no       | no       |             |

### Options

| Flag     | Required | Default | Description                            |
| -------- | -------- | ------- | -------------------------------------- |
| `--json` | no       |         | Output the raw server response as JSON |

### `eigenpal git status [options]`

Show source repo and package status.

### Options

| Flag          | Required | Default | Description                            |
| ------------- | -------- | ------- | -------------------------------------- |
| `--json`      | no       |         | Output the raw server response as JSON |
| `--dir <dir>` | no       |         | Directory to inspect                   |

### `eigenpal git deps [options]`

List package workspace dependencies.

### Options

| Flag          | Required | Default | Description                            |
| ------------- | -------- | ------- | -------------------------------------- |
| `--json`      | no       |         | Output the raw server response as JSON |
| `--dir <dir>` | no       |         | Directory to inspect                   |

### `eigenpal git clean [options]`

Require a clean source working tree.

### Options

| Flag          | Required | Default | Description          |
| ------------- | -------- | ------- | -------------------- |
| `--dir <dir>` | no       |         | Directory to inspect |

### `eigenpal git list|ls [options]`

List Git-backed automations.

### Options

| Flag                 | Required | Default | Description                            |
| -------------------- | -------- | ------- | -------------------------------------- |
| `--base-url <url>`   | no       |         | Server base URL                        |
| `--limit <n>`        | no       | `50`    | Page size                              |
| `--offset <n>`       | no       | `0`     | Page offset                            |
| `--json`             | no       |         | Output the raw server response as JSON |
| `--type <type>`      | no       |         | Filter by automation type              |
| `--search <q>`       | no       |         | Search by slug, name, or description   |
| `--include-archived` | no       |         | Include archived automations           |

### `eigenpal git show [options] <automation>`

Show Git-backed automation details.

### Arguments

| Name         | Required | Variadic | Description |
| ------------ | -------- | -------- | ----------- |
| `automation` | yes      | no       |             |

### Options

| Flag               | Required | Default | Description                            |
| ------------------ | -------- | ------- | -------------------------------------- |
| `--base-url <url>` | no       |         | Server base URL                        |
| `--json`           | no       |         | Output the raw server response as JSON |

### `eigenpal git versions [options] <package>`

List package release versions.

### Arguments

| Name      | Required | Variadic | Description |
| --------- | -------- | -------- | ----------- |
| `package` | yes      | no       |             |

### Options

| Flag               | Required | Default | Description                            |
| ------------------ | -------- | ------- | -------------------------------------- |
| `--base-url <url>` | no       |         | Server base URL                        |
| `--json`           | no       |         | Output the raw server response as JSON |

### `eigenpal git release [options] <version> [dir]`

Create and push a package release tag.

### Arguments

| Name      | Required | Variadic | Description           |
| --------- | -------- | -------- | --------------------- |
| `version` | yes      | no       | Version or bump level |
| `dir`     | no       | no       | Package directory     |

### Options

| Flag                      | Required | Default | Description           |
| ------------------------- | -------- | ------- | --------------------- |
| `--base-url <url>`        | no       |         | Server base URL       |
| `-m, --message <message>` | yes      |         | Annotated tag message |

### `eigenpal git sync [options] [automation]`

Sync an automation from the latest Git source release.

### Arguments

| Name         | Required | Variadic | Description |
| ------------ | -------- | -------- | ----------- |
| `automation` | no       | no       |             |

### Options

| Flag               | Required | Default | Description          |
| ------------------ | -------- | ------- | -------------------- |
| `--base-url <url>` | no       |         | Server base URL      |
| `--dir <dir>`      | no       |         | Directory to inspect |
