# eigenpal auth

> **Auto-generated.** This file is regenerated from the live Commander tree in
> `packages/cli/src/cli.ts` by `bun run --cwd packages/cli generate:cli-docs`.
> Do not hand-edit — your changes will be overwritten on the next run.

Manage authentication. Credentials live in ~/.config/eigenpal/credentials.json as named profiles. Switch tenants with `auth use <name>` or set `EIGENPAL_PROFILE=<name>` for one shell.

## Contents

- [Surface](#surface)
- [Commands](#commands)
  - [Core](#core)
- [Details](#details)
  - [`eigenpal auth login [options]`](#eigenpal-auth-login-options)
  - [`eigenpal auth logout [options] [profile]`](#eigenpal-auth-logout-options-profile)
  - [`eigenpal auth list [options]`](#eigenpal-auth-list-options)
  - [`eigenpal auth use [options] [profile]`](#eigenpal-auth-use-options-profile)

## Surface

```
auth
├── login
├── logout [profile]
├── list
└── use [profile]
```

## Commands

### Core

| Command                                    | Description                                                                                                                                                                                                                          |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `eigenpal auth login [options]`            | Authenticate with Eigenpal. Opens a browser to create an API key, stores it under a profile named after the tenant, and makes that profile active. Re-running `login` against the same tenant updates the existing profile in place. |
| `eigenpal auth logout [options] [profile]` | Remove a profile from the credentials file. Defaults to the active profile if no name is given. After removal the next available profile becomes active.                                                                             |
| `eigenpal auth list [options]`             | List configured profiles. The active one is marked ● — switch with `auth use`.                                                                                                                                                       |
| `eigenpal auth use [options] [profile]`    | Switch the active profile (persistent across shells). Omit `[profile]` to pick from a list. For one-shot per-shell switching, set `EIGENPAL_PROFILE=<name>` instead.                                                                 |

## Details

### `eigenpal auth login [options]`

Authenticate with Eigenpal. Opens a browser to create an API key, stores it under a profile named after the tenant, and makes that profile active. Re-running `login` against the same tenant updates the existing profile in place.

### Options

| Flag               | Required | Default | Description     |
| ------------------ | -------- | ------- | --------------- |
| `--base-url <url>` | no       |         | Server base URL |

### `eigenpal auth logout [options] [profile]`

Remove a profile from the credentials file. Defaults to the active profile if no name is given. After removal the next available profile becomes active.

### Arguments

| Name      | Required | Variadic | Description |
| --------- | -------- | -------- | ----------- |
| `profile` | no       | no       |             |

### `eigenpal auth list [options]`

List configured profiles. The active one is marked ● — switch with `auth use`.

### `eigenpal auth use [options] [profile]`

Switch the active profile (persistent across shells). Omit `[profile]` to pick from a list. For one-shot per-shell switching, set `EIGENPAL_PROFILE=<name>` instead.

### Arguments

| Name      | Required | Variadic | Description |
| --------- | -------- | -------- | ----------- |
| `profile` | no       | no       |             |
