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
- [`reference/cli/run.md`](reference/cli/run.md)
- [`reference/cli/runs.md`](reference/cli/runs.md)

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

Git-backed agent source lives in the organization repository under `agents/<slug>/`.
Edit source in Git, save builder work with `eigenpal agents save`, and ship with
`eigenpal agents release` + `eigenpal agents sync`. Builder sessions usually work
on `builder/<agent>/<session>` branches. This is all Git under the hood, but use
the Eigenpal CLI whenever possible:

- `eigenpal agents save` = validate changed packages, commit if dirty, and push the current branch.
- `eigenpal agents release <version> agents/<slug>` = safely land the package onto the release/tag path. Treat this like the merge step.
- `eigenpal agents sync agents.<slug>` = apply the latest released manifest, including triggers, to the server DB.
- `eigenpal git -- <args>` = authenticated git passthrough. Use it for every git command, including nuanced/read-only commands (`status`, `diff`, `log`, `rev-parse HEAD`, `merge`) and conflict recovery. Do not call raw `git` directly in normal agent work.

Do not use `eigenpal agents push` or `agents file put` — those targeted the legacy
HTTP upload API. Configure triggers in `eigenpal.yaml`; `agents sync` applies the
latest release manifest to the DB.

```bash
# 1. Clone org source and open the agent package.
eigenpal agents clone --out ./source
cd source/agents/<slug>
eigenpal agents install

# 2. Edit agent source.
#    AGENT.md is the inference orchestrator. Schemas are plain JSON files.
$EDITOR AGENT.md eigenpal.yaml input-schema.json output-schema.json
$EDITOR skills/<skill>/SKILL.md skills/<skill>/run.py

# 3. Validate layout, manifest, and schema files; then save durable source changes on the current branch.
cd ../..   # repo root
eigenpal agents status
eigenpal agents validate agents/<slug>
eigenpal agents save -m "Improve invoice extraction prompts"

# 4. Run exactly what was saved.
SOURCE_REF="$(eigenpal git -- rev-parse HEAD)"
eigenpal agents run agents.<slug>@"$SOURCE_REF" --input-json '{"text":"hello"}' --wait
eigenpal agents run agents.<slug>@"$SOURCE_REF" --example example-name --wait
eigenpal agents runs get <agent-execution-id> --json
eigenpal agents runs trace <agent-execution-id> --out ./trace.jsonl

# 5. Release to main + tag when ready to ship (-m optional; defaults to "Release <packagePath>").
#    Release tags are immutable — never move, delete, or force-update a published tag.
#    If a release is wrong, ship a new patch (`eigenpal agents release patch`).
eigenpal agents release patch agents/<slug>
eigenpal agents sync agents.<slug>
```

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
eigenpal agents runs list agents.<slug> --status failed --compact
eigenpal agents runs pull <agent-execution-id> --include all --out ./review/<agent-execution-id>
eigenpal agents runs trace <agent-execution-id> --out ./review/<agent-execution-id>/trace.jsonl
eigenpal agents runs rerun <agent-execution-id> --wait
eigenpal agents runs compare <source-agent-execution-id> <new-agent-execution-id> \
  --normalize-dates

eigenpal agents runs feedback resolve <source-agent-execution-id> \
  --message "Fixed and verified in <new-agent-execution-id>."
```

Agent commands commonly accept `<agent-id-or-slug>`. Agent execution commands
take an agent execution id. Execution pulls and comparisons write review
artifacts under `.eigenpal/artifacts/...` by default.

Root `eigenpal run` / `eigenpal runs` and `eigenpal git <cmd>` (for moved subcommands) exit with a deprecation message — use `agents run`, `agents runs list`, and `agents <cmd>` instead.

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

### Inspect And Edit Agent Files

```bash
eigenpal agents list
eigenpal agents file list <agent-id-or-slug>
eigenpal agents file list <agent-id-or-slug> --prefix agent/knowledge
eigenpal agents file get <agent-id-or-slug> agent/instructions.md --out instructions.md
eigenpal agents file diff <agent-id-or-slug> agent/instructions.md instructions.md
eigenpal agents file put <agent-id-or-slug> agent/instructions.md instructions.md --preview
eigenpal agents file put <agent-id-or-slug> agent/instructions.md instructions.md
```

Use `--preview` before writing substantial changes; it shows how the target file
would change.

### Inspect Agent Executions

```bash
eigenpal agents runs list <agent-id-or-slug> --status failed --limit 10
eigenpal agents runs list <agent-id-or-slug> --feedback-rating fail --include feedback,expected
eigenpal agents runs get <agent-execution-id> --include feedback,expected,files,trace,issues --json
eigenpal agents runs pull <agent-execution-id> --include all
eigenpal agents runs artifacts list <agent-execution-id>
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
eigenpal agents runs rerun <agent-execution-id> --wait
eigenpal agents runs compare <source-agent-execution-id> <new-agent-execution-id>
eigenpal agents runs compare <source-agent-execution-id> <new-agent-execution-id> \
  --baseline \
  --normalize-dates \
  --fail-on-diff
```

By default, compare a new output against the reference execution's expected
artifacts. Use `--baseline` to compare actual outputs from both executions.

## Output And Exit Codes

Most `list`, `get`, and mutating commands support `--json`. Prefer JSON when a
script or agent needs to inspect the result with `jq`.

```bash
eigenpal workflow execution list <workflow-id> --json | jq '.data[0].id'
eigenpal agents runs list <agent-id-or-slug> --json | jq '.executions[0].id'
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
- [`reference/cli/run.md`](reference/cli/run.md)
- [`reference/cli/runs.md`](reference/cli/runs.md)
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
│   ├── list
│   ├── push
│   ├── pull
│   ├── validate
│   ├── file
│   ├── trigger
│   ├── execution
│   └── experiment
├── run
├── runs
└── skill
    ├── install
    ├── uninstall
    └── list
```
