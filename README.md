# @eigenpal/cli

Create, evaluate, and deploy workflows from your terminal. Agent-ready.

[![npm](https://img.shields.io/npm/v/@eigenpal/cli?color=3B5BDB&labelColor=555&label=npm)](https://www.npmjs.com/package/@eigenpal/cli)
[![downloads](https://img.shields.io/npm/dm/@eigenpal/cli?color=3B5BDB&labelColor=555&label=downloads)](https://www.npmjs.com/package/@eigenpal/cli)
[![license](https://img.shields.io/badge/license-Apache--2.0-3B5BDB?labelColor=555)](https://github.com/eigenpal/cli/blob/main/LICENSE)
[![docs](https://img.shields.io/badge/docs-eigenpal%2Fcli-3B5BDB?labelColor=555)](https://github.com/eigenpal/cli)

## Install

```bash
npm i -g @eigenpal/cli
eigenpal auth login            # or set EIGENPAL_API_KEY in CI
eigenpal skill install         # install skill for your agent
```

## Commands

| Command                                   | Purpose                                               |
| ----------------------------------------- | ----------------------------------------------------- |
| [`eigenpal status`](./docs/status.md)     | Server, tenant, user, key id, workflow count.         |
| [`eigenpal init`](./docs/init.md)         | Scaffold a `workflow` or `agent` project.             |
| [`eigenpal auth`](./docs/auth.md)         | Profile management.                                   |
| [`eigenpal workflow`](./docs/workflow.md) | Workflow, evaluators, dataset, experiment, execution. |
| [`eigenpal agent`](./docs/agent.md)       | Agent ops (coming soon).                              |
| [`eigenpal skill`](./docs/skill.md)       | Install the agent skill across AI tools.              |

## Use it

`cd` into a folder with your data, then ask your agent:

> Build a workflow that extracts line items from these PDFs, judge with an
> LLM, seed five dataset examples, and run an experiment.

The skill teaches your agent the schemas. The platform handles versioning,
evals, traces, and governance.

```bash
eigenpal init workflow extract --template pdf-extraction
eigenpal workflow validate                              # local validation
eigenpal workflow execution run <id> <example> --watch  # one-shot run
eigenpal workflow dataset push <id> --file ./dataset    # upload dataset
eigenpal workflow experiment run <id>                   # batch eval
eigenpal workflow execution list <id> --json | jq       # query as JSON
```

## Primitives

| Primitive      | Purpose                                                 |
| -------------- | ------------------------------------------------------- |
| **Workflow**   | Versioned DAG of steps. The thing that runs in prod.    |
| **Dataset**    | `(input, expected_output)` examples. Your ground truth. |
| **Evaluator**  | Scorers: LLM judge, exact match, custom.                |
| **Experiment** | Batch run of a workflow over a dataset, scored.         |

## Environment variables

Most users never need to set these — `eigenpal auth login` writes a profile to `~/.config/eigenpal/credentials.json` and every command derives its config from there. Reach for env vars when you can't run an interactive login (CI), need to switch context for one shell, or want to override a single field without editing the credentials file.

| Variable            | Purpose                                                                                                                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `EIGENPAL_API_KEY`  | Bypass the profile entirely. Set in CI to skip `auth login`. When set, `EIGENPAL_BASE_URL` (or the cloud default) is used — the active profile is **not** consulted, so a stale profile can't redirect a CI run to the wrong server. |
| `EIGENPAL_BASE_URL` | Override the server URL for one command or shell. Pairs with `EIGENPAL_API_KEY` to point CI at an on-prem deployment. Without `EIGENPAL_API_KEY`, this overrides whatever the active profile would have used.                        |
| `EIGENPAL_PROFILE`  | Switch the active profile for one shell without touching `~/.config/eigenpal/credentials.json`. Useful for ad-hoc context switches: `EIGENPAL_PROFILE=staging eigenpal status`. Persistent equivalent: `eigenpal auth use <name>`.   |
| `EIGENPAL_DIR`      | Override the workflow project directory used by `init` / `validate`. Defaults to `./eigenpal`.                                                                                                                                       |

Resolution precedence: command-line flags > env vars > active profile > defaults.

## Support

File issues at [github.com/eigenpal/cli/issues](https://github.com/eigenpal/cli/issues).

## License

Apache-2.0. See [LICENSE](./LICENSE).
