---
name: eigenpal
description: Build, run, and iterate on Eigenpal workflows and agents from the command line. Use `eigenpal workflow` for YAML workflows, datasets, evaluators, executions, and experiments. Use `eigenpal agent` for agent workspaces, executions, feedback, traces, files, and expected artifacts.
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
- `eigenpal agent` — build and operate agent workspaces: agent files, triggers,
  executions, traces, feedback, expected artifacts, and reruns.

Use long command names in generated commands and documentation. They are more
readable and cost very little for agents to type. Some short aliases exist for
interactive users; understand them if you see them, but do not prefer them:

- `agent exec` = `agent execution`
- `agent execution fb` = `agent execution feedback`
- `agent execution artifact` = `agent execution artifacts`
- `workflow exec` = `workflow execution`
- `workflow exp` = `workflow experiment`
- `ls` = `list` anywhere in the CLI
- `diff` = `compare` anywhere in the CLI

For exact flags and defaults, prefer the generated references:

- [`reference/cli/workflow.md`](reference/cli/workflow.md)
- [`reference/cli/agent.md`](reference/cli/agent.md)

## Pick The Surface

Choose `workflow` when the work is about a workflow definition, dataset,
evaluator, experiment, or workflow execution.

Choose `agent` when the work is about an agent workspace, agent file, trigger,
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

```bash
# 1. Find the agent and inspect its files.
eigenpal agent list
eigenpal agent file list <agent-id-or-slug>
eigenpal agent file get <agent-id-or-slug> agent/instructions.md --out instructions.md

# 2. Find executions that need attention.
eigenpal agent execution list <agent-id-or-slug> \
  --feedback-status open \
  --feedback-rating fail \
  --since-last-resolved \
  --include feedback,expected \
  --compact

# 3. Pull the execution context locally.
eigenpal agent execution pull <agent-execution-id> --include all --out ./review/<agent-execution-id>
eigenpal agent execution artifacts list <agent-execution-id>
eigenpal agent execution trace <agent-execution-id> --out ./review/<agent-execution-id>/trace.jsonl

# 4. Edit and preview agent files.
$EDITOR instructions.md
eigenpal agent file diff <agent-id-or-slug> agent/instructions.md instructions.md
eigenpal agent file put <agent-id-or-slug> agent/instructions.md instructions.md --preview
eigenpal agent file put <agent-id-or-slug> agent/instructions.md instructions.md

# 5. Rerun and compare.
eigenpal agent execution rerun <agent-execution-id> --wait
eigenpal agent execution compare <new-agent-execution-id> \
  --expected-from <source-agent-execution-id> \
  --normalize-dates
eigenpal agent execution compare <new-agent-execution-id> \
  --baseline-from <source-agent-execution-id> \
  --normalize-dates

# 6. Resolve feedback once verified.
eigenpal agent execution feedback resolve <source-agent-execution-id> \
  --message "Fixed and verified in <new-agent-execution-id>."
```

Agent commands commonly accept `<agent-id-or-slug>`. Agent execution commands
take an agent execution id. Execution pulls and comparisons write review
artifacts under `.eigenpal/artifacts/...` by default.

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
eigenpal agent list
eigenpal agent file list <agent-id-or-slug>
eigenpal agent file list <agent-id-or-slug> --prefix agent/knowledge
eigenpal agent file get <agent-id-or-slug> agent/instructions.md --out instructions.md
eigenpal agent file diff <agent-id-or-slug> agent/instructions.md instructions.md
eigenpal agent file put <agent-id-or-slug> agent/instructions.md instructions.md --preview
eigenpal agent file put <agent-id-or-slug> agent/instructions.md instructions.md
```

Use `--preview` before writing substantial changes; it shows how the target file
would change.

### Inspect Agent Executions

```bash
eigenpal agent execution list <agent-id-or-slug> --status failed --limit 10
eigenpal agent execution list <agent-id-or-slug> --feedback-rating fail --include feedback,expected
eigenpal agent execution get <agent-execution-id> --include feedback,expected,files,trace,issues --json
eigenpal agent execution pull <agent-execution-id> --include all
eigenpal agent execution artifacts list <agent-execution-id>
```

Use `--compact` on execution lists when you only need triage rows.

### Download Agent Traces

```bash
eigenpal agent execution trace <agent-execution-id> --out trace.jsonl
eigenpal agent execution trace <agent-execution-id> | jq -r 'select(.toolName? or .tool_name? or .tool?)'
eigenpal agent execution trace <agent-execution-id> | rg 'error|tool'
```

`trace` streams the raw JSONL to stdout by default. Use shell tools such as
`jq`, `rg`, or `awk` for filtering; use `--out` when you want to save the file.

### Manage Agent Feedback And Expected Artifacts

```bash
eigenpal agent execution feedback get <agent-execution-id>
eigenpal agent execution feedback update <agent-execution-id> \
  --status open \
  --rating fail \
  --message "Expected the filing date to be extracted."
eigenpal agent execution feedback resolve <agent-execution-id> \
  --message "Fixed and verified."
eigenpal agent execution feedback clear <agent-execution-id> --yes

eigenpal agent execution expected list <agent-execution-id>
eigenpal agent execution expected upload <agent-execution-id> --file expected.json --name expected.json
eigenpal agent execution expected copy-output <agent-execution-id> --output-file result.json --name expected.json
eigenpal agent execution expected pull <agent-execution-id> --out expected/
```

Feedback is attached to one execution. Expected artifacts are the references
used when comparing future runs.

### Rerun And Compare Agent Executions

```bash
eigenpal agent execution rerun <agent-execution-id> --wait
eigenpal agent execution compare <new-agent-execution-id> --expected-from <source-agent-execution-id>
eigenpal agent execution compare <new-agent-execution-id> --baseline-from <source-agent-execution-id>
eigenpal agent execution compare <new-agent-execution-id> \
  --expected-from <source-agent-execution-id> \
  --normalize-dates \
  --fail-on-diff
```

Use `--expected-from` to compare a new output against stored expected artifacts.
Use `--baseline-from` to compare a new output against another execution's actual
output.

## Output And Exit Codes

Most `list`, `get`, and mutating commands support `--json`. Prefer JSON when a
script or agent needs to inspect the result with `jq`.

```bash
eigenpal workflow execution list <workflow-id> --json | jq '.data[0].id'
eigenpal agent execution list <agent-id-or-slug> --json | jq '.executions[0].id'
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
- [`reference/cli/agent.md`](reference/cli/agent.md)
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
├── agent
│   ├── list
│   ├── get
│   ├── push
│   ├── pull
│   ├── file
│   ├── trigger
│   ├── execution
│   └── experiment
└── skill
    ├── install
    ├── uninstall
    └── list
```
