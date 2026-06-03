---
name: eigenpal
description: Build, run, and iterate on Eigenpal workflows and agents from the command line. Use `eigenpal workflow` for YAML workflows, datasets, evaluators, executions, and experiments. Use `eigenpal agents` for agent workspaces, runs, feedback, traces, files, and expected artifacts.
license: Apache-2.0
compatibility: Requires eigenpal CLI.
metadata:
  author: eigenpal
  version: '1.0'
  generatedBy: 'eigenpal@__CLI_VERSION__'
---

# Eigenpal

Eigenpal has two major CLI surfaces:

- `eigenpal workflow` — build and operate YAML workflows: definitions,
  datasets, evaluators, executions, experiments, versions, and schema
  introspection.
- `eigenpal agents` — build and operate agent workspaces: agent files, triggers,
  runs, traces, feedback, expected artifacts, and reruns.

Use long command names in generated commands and documentation. They are more
readable and cost very little for agents to type. Some short aliases exist for
interactive users; understand them if you see them, but do not prefer them:

- `agents exec` = `agents runs`
- `agents runs fb` = `agents runs feedback`
- `agents runs artifact` = `agents runs artifacts`
- `workflow exec` = `workflow execution`
- `workflow exp` = `workflow experiment`
- `ls` = `list` anywhere in the CLI
- `diff` = `compare` anywhere in the CLI

For exact flags and defaults, prefer the generated references:

- [`reference/cli/workflow.md`](reference/cli/workflow.md)
- [`reference/cli/agents.md`](reference/cli/agents.md)
- [`reference/cli/git.md`](reference/cli/git.md)

## Pick The Surface

Choose `workflow` when the work is about a workflow definition, dataset,
evaluator, experiment, or workflow execution.

Choose `agents` when the work is about an agent workspace, agent file, trigger,
agent execution, trace, feedback entry, expected artifact, or rerun.

Agents and workflows are related, but their iteration loops are different:
workflow experiments evaluate datasets with evaluators; agent workflows do not
currently expose that same experiment/evaluator loop through the CLI.

## Workflow Iteration Loop

```bash
# 1. Create or edit the local project.
eigenpal init workflow invoices --template pdf-extraction
cd invoices
$EDITOR workflow.yaml

# 2. Inspect schemas before guessing config fields.
eigenpal workflow step-type list --search extract
eigenpal workflow step-type get ai.extract --json | jq '.configSchema.properties'

# 3. Validate and push the workflow definition.
eigenpal workflow validate ./workflow.yaml
eigenpal workflow push --file workflow.yaml

# 4. Run one example while iterating.
eigenpal workflow execution run <workflow-id> <example-name>
eigenpal workflow execution watch <execution-id>
eigenpal workflow execution get <execution-id> --json

# 5. Manage the dataset and evaluators when ready to evaluate.
eigenpal workflow dataset validate ./dataset
eigenpal workflow dataset push <workflow-id> --file ./dataset --mode replace
eigenpal workflow evaluators validate ./evaluators.yaml
eigenpal workflow evaluators push <workflow-id> --file ./evaluators.yaml

# 6. Run and inspect a batch experiment.
eigenpal workflow experiment run <workflow-id>
eigenpal workflow experiment watch <workflow-id> <batch-id>
eigenpal workflow experiment results <workflow-id> <batch-id> --format csv --out results.csv
```

Workflow commands that take `<workflow-id>` accept the stable `wf_...` id. Many
also accept the workflow slug for convenience, but use the id in scripts.

Useful workflow ids are not interchangeable:

- `<workflow-id>` identifies a workflow (`wf_...`).
- `<execution-id>` identifies one workflow execution.
- `<batch-id>` identifies one experiment batch.
- `<example-id>` identifies one dataset example.

### Organize workflows into folders

Folders live on the server, not in `workflow.yaml`. `workflow push` and
`workflow pull` do not read or write folder placement. Use `workflow move`
to move workflows between dashboard folders:

```bash
eigenpal workflow move <workflow-id> --folder billing/invoices
eigenpal workflow move <workflow-id> --folder /
```

`--folder /` means root.
Missing folders in the path are created automatically.
Default to creating workflows at the top level. Do not move a workflow into
a folder unless the user specifically asks for that placement.

## Agent Iteration Loop

Agents are Git-backed source packages. The server runs released source packages
from the organization source repository; editing live files is not the normal
workflow. Prefer the Eigenpal CLI over raw provider/API calls because it handles
validation, source refs, release tags, and server sync consistently. Cloned
source repos also work with raw Git and IDE source-control panels: `agents clone`
and `eigenpal git -- ...` configure a repo-local credential helper for the
Eigenpal Git remote, so `git status`, `git log`, `git pull`, and `git push`
can authenticate without copying API keys into `.git/config`.

Core mental model:

- `agents/<slug>/` is one agent package.
- `resources/skills/<slug>/`, `resources/knowledge/<slug>/`,
  `resources/templates/<slug>/`, and `resources/rules/<slug>/` are shared
  packages that agents depend on through `eigenpal.yaml`.
- `eigenpal agents save` validates changed packages, commits if dirty, and
  pushes the current branch.
- `eigenpal agents release patch agents/<slug>` lands a package as an immutable
  release tag.
- `eigenpal agents sync agents.<slug>` applies the latest released agent
  manifest to the server DB, including triggers.
- `@latest` means latest released package, not your current branch.
- To test current branch work before release, run the exact commit SHA from
  `eigenpal git -- rev-parse HEAD`.

Use branches. Do not casually edit `main` unless the user explicitly wants that:

```bash
# 1. Clone org source and create a branch.
eigenpal agents clone --out ./source
cd ./source
eigenpal git -- switch -c <short-task-branch>

# 2. Inspect package state.
eigenpal agents status
eigenpal agents show agents.<slug> --json
eigenpal agents versions agents.<slug> --json

# 3. Edit source.
$EDITOR agents/<slug>/AGENT.md
$EDITOR agents/<slug>/eigenpal.yaml
$EDITOR agents/<slug>/input-schema.json agents/<slug>/output-schema.json
$EDITOR agents/<slug>/skills/<skill>/SKILL.md agents/<slug>/skills/<skill>/run.py

# 4. Validate and save the branch.
eigenpal agents validate agents/<slug>
eigenpal agents deps --dir agents/<slug>
eigenpal agents save -m "Improve <agent> behavior"

# 5. Test the exact saved commit.
SOURCE_REF="$(eigenpal git -- rev-parse HEAD)"
eigenpal agents run agents.<slug>@"$SOURCE_REF" --input-json '{"text":"hello"}' --wait
eigenpal agents run agents.<slug>@"$SOURCE_REF" --example example-name --wait
eigenpal agents runs get <run-id> --json | jq '.run | {status,schemaValid,error,requestedSourceRef,resolvedGitRef,resolvedGitTag,resolvedCommitSha,cost}'
eigenpal agents runs artifacts list <run-id>
eigenpal agents runs trace <run-id> --out ./review/<run-id>/trace.jsonl

# 6. Release and sync only when ready.
eigenpal agents release patch agents/<slug>
eigenpal agents sync agents.<slug>

# 7. Verify the released package.
eigenpal agents run agents.<slug>@latest --example example-name --wait --json
eigenpal agents runs get <released-run-id> --json | jq '.run | {status,schemaValid,error,resolvedGitTag,resolvedCommitSha,cost}'
```

File inputs must use schema field names when there is more than one file input:

```bash
eigenpal agents run agents.<slug>@latest \
  --input-file start_info_doc=./ZFRP.docx \
  --wait

eigenpal agents run agents.<slug>@latest \
  --input-file zfzal_doc=./ZFZAL.pdf \
  --input-file lv_doc=./list_vlastnictva.pdf \
  --input-json '{"skip_name_check":false}' \
  --wait
```

There is no live file upload command for Git-backed agents. `agents file list/get/diff`
are read/compare tools only. Source changes go through Git + `agents save` +
`agents release` + `agents sync`.

### Shared Resource Rollouts

When you edit a shared resource, do not assume every dependent agent should move
immediately. Find usage, then ask the user which dependents to bump:

```bash
# 1. Edit and validate the shared package.
$EDITOR resources/skills/<slug>/SKILL.md resources/skills/<slug>/run.py
eigenpal agents validate resources/skills/<slug>

# 2. Find dependent agents/resources.
rg '<slug>|resources/skills/<slug>|resources/knowledge/<slug>' agents/ resources/
eigenpal agents deps --dir agents/<dependent-slug>

# 3. Ask the user which dependents should move to the new resource version.

# 4. Release the shared package.
eigenpal agents save -m "Improve shared <slug>"
eigenpal agents release patch resources/skills/<slug>

# 5. Bump selected agents' eigenpal.yaml dependency refs, then release/sync them.
$EDITOR agents/<dependent-slug>/eigenpal.yaml
eigenpal agents validate agents/<dependent-slug>
eigenpal agents save -m "Bump <slug> dependency"
eigenpal agents release patch agents/<dependent-slug>
eigenpal agents sync agents.<dependent-slug>
```

After a shared dependency rollout, run one affected agent and inspect
`eigenpal.lock` via `agents runs artifacts fetch` to confirm the dependency
version and commit that inference actually installed.

### Agent Datasets And Examples

Agent eval examples are runtime data, not Git source. `eigenpal agents save`
does not persist them. Keep local examples in a dataset directory and use the
dataset CLI:

```bash
# Builder sandboxes use /workspace/evals; local projects often use ./dataset.
eigenpal agents dataset validate /workspace/evals --agent-dir agents/<slug>
eigenpal agents dataset push agents.<slug> --file /workspace/evals
eigenpal agents dataset list agents.<slug>
eigenpal agents dataset pull agents.<slug> --out ./dataset
```

Example shape:

```text
evals/<name>/
  input.json        # scalar/object args
  input/<field>.*   # file input, when needed
  expected.json     # partial expected output: only stable fields
  expected/<file>   # golden file outputs
  feedback.md       # optional notes
```

For `expected.json`, include only fields that must be identical on every correct
run. Omit non-deterministic values such as timestamps, random IDs, and free-form
LLM text. Validate the actual agent output with the output schema; validate the
expected file as a partial assertion.
Run a persisted example with `eigenpal agents run agents.<slug>@<ref> --example <name> --wait`.

### Debug Agent Runs

```bash
eigenpal agents runs list agents.<slug> --compact
eigenpal agents runs list agents.<slug> --status failed --compact
eigenpal agents runs artifacts list <agent-execution-id>
eigenpal agents runs artifacts fetch <agent-execution-id> --include all --out ./review/<agent-execution-id>
eigenpal agents runs trace <agent-execution-id> --out ./review/<agent-execution-id>/trace.jsonl
eigenpal agents rerun <agent-execution-id> --wait
eigenpal agents rerun <agent-execution-id> --source-ref original --wait
eigenpal agents runs compare <source-agent-execution-id> <new-agent-execution-id> \
  --baseline \
  --normalize-dates

eigenpal agents runs feedback resolve <source-agent-execution-id> \
  --message "Fixed and verified in <new-agent-execution-id>."
```

Agent commands commonly accept `<agent-id-or-slug>`. Agent execution commands
take an agent execution id. Artifact fetches and comparisons write review
artifacts under `.eigenpal/artifacts/...` by default. Unqualified run-list
targets show all source refs; add `@<ref>` only when you want a specific
release, branch, tag, semver range, or commit. `runs list --json` returns
`{ runs, total, limit, offset }`; `runs get --json` returns `{ run }`.

`agents rerun <run-id>` reuses the previous input snapshot with `latest` source
by default. Use `--source-ref original` only when you need to reproduce the
previous resolved version exactly.

Use source refs such as `latest`, `main`, exact versions/tags (`1.2.3`),
semver ranges (`1.2.x`, `1.x`), or exact commit SHAs when you need provenance.

### Git-backed secrets

Set secrets with the authenticated CLI — plaintext goes to
`POST /api/v1/source/secrets/encrypt`; only ciphertext is written to
`secrets.enc.yaml`. Organization decrypt keys never leave the server.

```bash
echo -n "$VALUE" | eigenpal agents secret set OPENAI_API_KEY --stdin
eigenpal agents secret import ./local.env
eigenpal agents save -m "Add API key"
```

Runtime sandboxes decrypt via `eigenpal agents env pull` →
`POST /api/v1/source/secrets/decrypt` (same API key auth).

## Workflow Recipes

### Author And Validate A Workflow

```bash
eigenpal workflow step-type list
eigenpal workflow step-type get <step-type> --json
eigenpal workflow validate ./workflow.yaml
eigenpal workflow push --file workflow.yaml
```

The validator reports structured field-path errors. If the error hints at a
step type, inspect that type with `eigenpal workflow step-type get <type>`.

### Manage A Dataset

```bash
eigenpal workflow dataset validate ./dataset
eigenpal workflow dataset push <workflow-id> --file ./dataset --mode append
eigenpal workflow dataset list <workflow-id>
eigenpal workflow dataset pull <workflow-id> --out dataset.zip
```

Dataset archives use this folder shape:

```text
dataset/
└── examples/
    └── <example-name>/
        ├── input/
        │   ├── arguments.json
        │   └── <file-argument-name>/<file>
        ├── expected/output.json
        └── meta.json
```

For one-off changes, use the per-example commands instead of re-uploading the
whole dataset:

```bash
eigenpal workflow dataset example get <workflow-id> <example-id> --json
eigenpal workflow dataset example update <workflow-id> <example-id> --expected-file expected.json
eigenpal workflow dataset example create <workflow-id> --name edge-case --input-json '{"language":"en"}'
eigenpal workflow dataset example delete <workflow-id> <example-id> --yes
```

### Run And Compare Workflow Executions

```bash
eigenpal workflow execution run <workflow-id> <example-name>
eigenpal workflow execution watch <execution-id>
eigenpal workflow execution get <execution-id> --include input,output,error --json
eigenpal workflow execution list <workflow-id> --status failed --limit 10
eigenpal workflow execution compare <execution-id-a> <execution-id-b>
eigenpal workflow execution cancel <execution-id> --yes
```

### Run And Compare Experiments

```bash
eigenpal workflow experiment run <workflow-id>
eigenpal workflow experiment status <workflow-id> <batch-id> --json
eigenpal workflow experiment watch <workflow-id> <batch-id> --format json
eigenpal workflow experiment results <workflow-id> <batch-id> --format csv --out results.csv
eigenpal workflow experiment compare <batch-id-a> <batch-id-b> --regression-threshold 0.05
```

`workflow experiment compare` resolves the owning workflow from the batch ids;
both batches must belong to the same workflow.

## Agent Recipes

### Inspect Agent Source And Live Files

```bash
eigenpal agents list
eigenpal agents show agents.<slug> --json
eigenpal agents versions agents.<slug> --json
eigenpal agents clone --out ./source
cd ./source
eigenpal agents status
eigenpal agents deps --dir agents/<slug>

# Live file inspection only. Do not edit through this surface.
eigenpal agents file list <agent-id-or-slug>
eigenpal agents file list <agent-id-or-slug> --path agent/knowledge
eigenpal agents file get <agent-id-or-slug> agent/instructions.md --out instructions.md
eigenpal agents file diff <agent-id-or-slug> agent/instructions.md instructions.md
```

Edit `agents/<slug>/...` in Git source, then `agents save`, `agents release`,
and `agents sync`. Live file commands are read/compare tools.

### Inspect Agent Executions

```bash
eigenpal agents runs list <agent-id-or-slug> --status failed --limit 10
eigenpal agents runs list <agent-id-or-slug> --feedback-rating fail --include feedback,expected
eigenpal agents runs get <agent-execution-id> --include feedback,expected,files,trace,issues --json | jq '.run'
eigenpal agents runs artifacts list <agent-execution-id>
eigenpal agents runs artifacts fetch <agent-execution-id> --include all --out ./review/<agent-execution-id>
```

Use `--compact` on execution lists when you only need triage rows.

### Download Agent Traces

```bash
eigenpal agents runs trace <agent-execution-id> --out trace.jsonl
eigenpal agents runs trace <agent-execution-id> | jq -r 'select(.toolName? or .tool_name? or .tool?)'
eigenpal agents runs trace <agent-execution-id> | rg 'error|tool'
```

`trace` streams the raw JSONL to stdout by default. Use shell tools such as
`jq`, `rg`, or `awk` for filtering; use `--out` when you want to save the file.

### Manage Agent Feedback And Expected Artifacts

```bash
eigenpal agents runs feedback update <agent-execution-id> \
  --status open \
  --rating fail \
  --message "Expected the filing date to be extracted."
eigenpal agents runs feedback resolve <agent-execution-id> \
  --message "Fixed and verified."
eigenpal agents runs feedback clear <agent-execution-id> --yes

eigenpal agents runs expected list <agent-execution-id>
eigenpal agents runs expected upload <agent-execution-id> expected.json --name expected.json
eigenpal agents runs expected copy-output <agent-execution-id> result.json --name expected.json
eigenpal agents runs expected pull <agent-execution-id> --out expected/
```

Feedback is attached to one execution. Expected artifacts are the references
used when comparing future runs.

### Rerun And Compare Agent Executions

```bash
eigenpal agents rerun <agent-execution-id> --wait
eigenpal agents rerun <agent-execution-id> --source-ref original --wait
eigenpal agents runs compare <source-agent-execution-id> <new-agent-execution-id>
eigenpal agents runs compare <source-agent-execution-id> <new-agent-execution-id> \
  --baseline \
  --normalize-dates \
  --fail-on-diff
```

By default, compare a new output against the reference execution's expected
artifacts. Use `--baseline` to compare actual outputs from both executions.
By default, rerun uses the previous inputs with latest source. Use
`--source-ref original` for provenance reproduction.

## Output And Exit Codes

Most `list`, `get`, and mutating commands support `--json`. Prefer JSON when a
script or agent needs to inspect the result with `jq`.

```bash
eigenpal workflow execution list <workflow-id> --json | jq '.data[0].id'
eigenpal agents runs list <agent-id-or-slug> --json | jq '.runs[0].id'
eigenpal agents runs get <agent-execution-id> --json | jq '.run.id'
```

General exit-code convention:

| Code | Meaning |
| --- | --- |
| 0 | Success. |
| 1 | Runtime or command failure. |
| 2 | Invalid invocation, unsupported option, or timeout/deadline condition. |

Status and progress messages go to stderr. Data intended for piping goes to
stdout.

## Schema And Reference Files

Workflow schemas:

- [`reference/workflow-yaml.md`](reference/workflow-yaml.md) — workflow file shape
- [`reference/step-types.md`](reference/step-types.md) — step-type catalog
- [`reference/step-exec.md`](reference/step-exec.md) — single-step execution command
- [`reference/dataset-format.md`](reference/dataset-format.md) — dataset folder format
- [`reference/evaluators.md`](reference/evaluators.md) — evaluator configuration
- [`reference/debugging.md`](reference/debugging.md) — workflow execution debugging

CLI command references:

- [`reference/cli/workflow.md`](reference/cli/workflow.md)
- [`reference/cli/agents.md`](reference/cli/agents.md)
- [`reference/cli/auth.md`](reference/cli/auth.md)
- [`reference/cli/status.md`](reference/cli/status.md)

Use `eigenpal --help` for the grouped command overview and
`eigenpal <command> --help` for live command help.

## CLI Surface

```text
eigenpal
├── auth
│   ├── login
│   ├── list
│   └── use
├── status
├── workflow
│   ├── list
│   ├── pull
│   ├── push
│   ├── validate
│   ├── move
│   ├── clear-local
│   ├── dataset
│   ├── evaluators
│   ├── execution
│   ├── experiment
│   ├── versions
│   ├── step-type
│   └── evaluator-type
├── agents
│   ├── run
│   ├── rerun
│   ├── list
│   ├── validate
│   ├── clone
│   ├── install
│   ├── init
│   ├── pull
│   ├── commit
│   ├── save
│   ├── push
│   ├── release
│   ├── sync
│   ├── status
│   ├── deps
│   ├── clean
│   ├── doctor
│   ├── show
│   ├── versions
│   ├── secret
│   ├── env
│   ├── file
│   ├── dataset
│   ├── runs
│   └── experiment
│   └── session
└── skill
    ├── install
    ├── uninstall
    └── list
```

Agent command roles:

- `agents clone` — clone organization source and configure raw Git/IDE auth.
- `agents pull` — fast-forward source from `origin/main`; not datasets or run artifacts.
- `agents status` / `agents doctor` / `agents clean` — inspect source health.
- `agents validate` / `agents deps` — validate one package and inspect workspace dependencies.
- `agents save` — validate, commit if dirty, and push the current branch.
- `agents release` — create immutable package release tags.
- `agents sync` — apply latest released agent manifest/triggers to the server.
- `agents run` — start a run from a source ref (`@latest`, version, branch, commit).
- `agents rerun` — reuse a previous input snapshot; defaults to latest source.
- `agents runs list/get/watch/cancel/compare/trace` — inspect and manage executions.
- `agents runs artifacts list/fetch` — inventory and download run artifacts by path.
- `agents dataset` — manage persisted agent examples; runtime data, not Git source.
- `agents file` — live read/diff inspection only.
