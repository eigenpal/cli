---
name: eigenpal
description: Build, run, and iterate on Eigenpal workflows from the command line. The workflow engine, evaluators, dataset folders, and execution introspection are all controlled via `eigenpal` subcommands. The server is the source of truth — local files are inputs you push.
license: Apache-2.0
compatibility: Requires eigenpal CLI.
metadata:
  author: eigenpal
  version: '1.0'
  generatedBy: 'eigenpal@__CLI_VERSION__'
---

# Eigenpal

Eigenpal is a workflow engine. A workflow is a DAG of steps
(parsing, extraction, scripting, etc.). Iteration happens locally with the
`eigenpal` CLI; **execution + datasets + experiments live on the server**.

This skill is the schema reference. The CLI does the actual work.

## Iteration loop (end-to-end)

```
1.  eigenpal init workflow my-extraction --template pdf-extraction
2.  edit workflow.yaml + evaluators.yaml + dataset/examples/*/expected/output.json
3.  eigenpal workflow validate                                       # local: all three checks, no server contact
4.  eigenpal workflow push --file workflow.yaml                      # creates wf_… on first push
5.  eigenpal workflow execution run my-extraction sample-name        # one-off run for debugging
6.  eigenpal workflow evaluators push <workflow-id> --file evaluators.yaml
7.  eigenpal workflow dataset push <workflow-id> --file dataset/ --mode replace
8.  eigenpal workflow experiment run <workflow-id>                         # → { batchId, executionIds }
9.  eigenpal workflow experiment status <workflow-id> <batch-id>
10. eigenpal workflow experiment results <workflow-id> <batch-id> --format csv --out r.csv
```

> **`push` BEFORE `execution run`.** The CLI no longer ships YAML at run
> time — only saved workflows execute. `execution run <workflow-id>` reads
> the definition from the server, so any local edit to `workflow.yaml`
> must be `push`ed first or the run will use the previous version. If
> the workflow has never been pushed, `execution run` exits with
> `Workflow "<arg>" not found on the server. Push it first.`

## Identifying a workflow

Every command that takes `<workflow-id>` expects a **`wf_xxx` id** — the
opaque, server-generated identifier printed by `workflow push` and
`workflow list`. Stable across renames; this is the form to use in
scripts and CI.

As a typing convenience the workflow's slug (the YAML's `name:` field)
is also accepted — the CLI resolves it server-side. The resolver
detects the form by the `wf_` prefix:

| Argument starts with… | Looked up via                                     |
| --------------------- | ------------------------------------------------- |
| `wf_…`                | `GET /api/v1/workflows/<id>`                      |
| anything else         | `GET /api/v1/workflows?name=<slug>` (exact match) |

Workflow names are constrained to `[a-z0-9][a-z0-9_-]*` (lowercase
letters, digits, `_`, `-`; 1–64 chars), so every slug is terminal-safe
and url-safe by construction — no shell quoting required.

```bash
# Both work; prefer the id form in scripts.
eigenpal workflow execution run wf_abc123 sample-1
eigenpal workflow execution run my-extraction sample-1
```

If the workflow hasn't been pushed yet, the resolver fails fast:
`Workflow "<arg>" not found on the server. Push it first, or run \`eigenpal workflow list\` to see what's available.`

**Other id types — not interchangeable with workflow id:**

- `workflow execution {get,watch,cancel,compare} <executionId>` — `exec_…`
- `workflow experiment compare <batchA> <batchB>` — batch ids (`evb_…`)
- `workflow dataset example {get,update,delete} <wf-id> <exampleId>` — second positional is the example id (`evx_…`)

## Common recipes

### From zero — new workflow from a template

```bash
eigenpal init workflow invoices --template pdf-extraction   # scaffolds workflow.yaml + dataset/ + evaluators.yaml
cd invoices
eigenpal workflow validate                                   # confirm scaffold is valid before pushing
eigenpal workflow push --file workflow.yaml
# → ✓ Created wf_abc123  (`eigenpal workflow list` to see it again)
```

### Author + validate a workflow

```bash
# Pick the right step types BEFORE writing the workflow
eigenpal workflow step-type list --search extract
eigenpal workflow step-type get ai.extract | jq '.configSchema.properties'

# Validate locally (zod parse + step-type lookup, no server)
eigenpal workflow validate ./workflow.yaml

# Push (creates on first call; same name + new version appends to history)
eigenpal workflow push --file workflow.yaml --workflow-id wf_abc123

# Update an existing workflow with explicit / auto-bumped semver:
eigenpal workflow push --file workflow.yaml --workflow-id wf_abc123 --set-version 2.0.0
eigenpal workflow push --file workflow.yaml --workflow-id wf_abc123 --bump patch    # patch | minor | major
```

The validator emits structured field-path errors with a hint pointing at
`step-type get <type>` for the offending step. Follow the hint.

Version bumping rules (`--bump` vs `--set-version` vs YAML `version:`)
live in [`reference/workflow-yaml.md`](reference/workflow-yaml.md#validate-before-pushing).

### Iterate fast on one step (no server, no DAG)

Tightest possible loop — local sandbox, milliseconds per run. Today
covers `transform.script` and `ai.extract`. For any other step type,
fall back to `workflow execution run` against the server.

```bash
eigenpal workflow step exec transform.script \
  --config-json '{"code":"return items.reduce((s,i)=>s+i.v,0)"}' \
  --inputs items=@items.json
# 3
```

See [`reference/step-exec.md`](reference/step-exec.md) for the full
grammar — inputs, config, output schema, exit codes.

### Cancel a long-running execution

```bash
eigenpal workflow execution cancel exec_abc        # TTY: silent; CI: needs --yes
eigenpal workflow execution cancel exec_abc --yes  # CI / pipes
```

The worker finishes the current step, then stops — the check happens
between every step transition, including inside `control.foreach` /
`control.parallel` / `control.block` bodies. Already-terminal
executions (completed/failed/cancelled) exit 0 with an info line. Safe
to retry.

### Compare two experiment batches (no workflow id needed)

```bash
eigenpal workflow experiment compare evb_old evb_new --regression-threshold 0.05
```

Output is two stacked tables: a per-evaluator aggregate (rows per evaluator
with mean Δ, regressions, improvements — sorted biggest mover first) followed
by a per-(example, evaluator) detail table. No need to write a Python
aggregator on top.

```bash
# JSON exposes both layers — `summary.byEvaluator` for the rollup,
# `rows` for the full per-example detail.
eigenpal workflow experiment compare evb_old evb_new --json | jq '.summary.byEvaluator'
```

Unlike its siblings, `compare` takes no `<workflow-id>` — the server resolves
the owning workflow from each batch id. Both batches must live in the
same workflow within your tenant. See [`reference/debugging.md`](reference/debugging.md#6-compare-two-experiment-batches)
for sort flags + `--json` shape.

### Author + validate evaluators

```bash
# Inspect what evaluator types exist + their config shape
cat packages/cli/src/skill/reference/evaluators.md   # or read this skill's `reference/`

# Validate locally (every evaluator entry parsed against its discriminated-union schema)
eigenpal workflow evaluators validate ./evaluators.yaml

# Push (overwrites the workflow's evaluator config)
eigenpal workflow evaluators push <workflow-id> --file evaluators.yaml
```

### Build + validate + upload a dataset

```bash
# Folder layout: dataset/examples/<name>/{input/arguments.json, input/<file-arg>/<file>, expected/output.json, meta.json}
eigenpal workflow dataset validate ./dataset            # rejects bad folder names, arg-name collisions, etc.

# Push. `replace` wipes server-side examples for this workflow first; `append` adds.
eigenpal workflow dataset push <workflow-id> --file ./dataset --mode replace
# Watch the `expectedSet` count in the final NDJSON `done` event — if 0, evals run un-graded.
```

To inspect or round-trip the server's current dataset:

```bash
eigenpal workflow dataset list <workflow-id>
eigenpal workflow dataset pull <workflow-id> --out current.zip   # round-trip back to local
```

### Edit one example without re-uploading the whole dataset

```bash
# Inspect one example end-to-end (triggerInput + expectedOutput + metadata):
eigenpal workflow dataset example get <workflow-id> <example-id>
eigenpal workflow dataset example get <workflow-id> <example-id> --json | jq '.expectedOutput'

# Capture a corrected output as the new ground truth (the most common one):
#   1. Look at what the workflow returned
eigenpal workflow execution get exec_… --json | jq '.output.data' > /tmp/correct.json
#   2. Patch that example's expected output in place
eigenpal workflow dataset example update <workflow-id> <example-id> \
  --expected-file /tmp/correct.json

# Add one new example to a known dataset:
eigenpal workflow dataset example create <workflow-id> \
  --name missing-required-field \
  --input-json '{"language":"en"}' \
  --expected-file /tmp/expected.json \
  --annotation "edge case: required field absent from input"

# Drop a bad example by id (CI requires --yes):
eigenpal workflow dataset example delete <workflow-id> <example-id> --yes
```

`example update` is a partial PATCH — any flag you omit is left alone. Pass
`--annotation ""` to clear an annotation. For bulk changes, edit the local
dataset folder and re-push with `dataset push --mode replace`.

### Run an experiment + collect results

```bash
# Kick off — runs every example in the dataset against every evaluator.
eigenpal workflow experiment run <workflow-id>                       # → { batchId, executionIds }

# Or restrict to one example:
eigenpal workflow experiment run <workflow-id> --example-id evx_…
```

**Recommended:** use `experiment watch` — it polls until terminal AND auto-pulls
results to disk in one command. Replaces the old "run → status (poll) → results"
chain so agents don't have to write a custom poller, parse `executions[].status`,
or chain `monitor + status + pull + score` shell logic.

```bash
# One command: watch until terminal, then write ./results-<batchId>.json on completion.
eigenpal workflow experiment watch <workflow-id> <batch-id>

# CSV output:
eigenpal workflow experiment watch <workflow-id> <batch-id> --format csv

# Custom destination (overrides the default ./results-<batchId>.<format>):
eigenpal workflow experiment watch <workflow-id> <batch-id> --pull-on-complete ./out/r.json

# Just watch, skip the pull (e.g. you only need the live tick + exit code):
eigenpal workflow experiment watch <workflow-id> <batch-id> --no-pull
```

Exit codes match `experiment status --watch`: `0` clean, `1` any
failed/cancelled/rejected execution, `2` `--max-wait` deadline reached
(30 min default — re-run to keep watching).

### Monitoring scripts — use `--short` and the JSON rollup

When a script needs to spot-check a batch (no waiting), prefer one of the two
machine-readable paths instead of folding `executions[].status` yourself.

```bash
# Single line on stdout, awk-friendly:
eigenpal workflow experiment status <wf> <batch> --short
# → 6/6 done failed=0 cancelled=0 rejected=0   (or "in-progress" while pending)

# Parse with awk:
DONE_STATE=$(eigenpal workflow experiment status <wf> <batch> --short | awk '{print $2}')
[ "$DONE_STATE" = "done" ] || exit 0   # not terminal yet, try again later
```

```bash
# JSON includes a top-level `summary` rollup so you don't count statuses by hand:
eigenpal workflow experiment status <wf> <batch> --json | jq '.summary'
# → { total: 6, terminal: 6, complete: true,
#     completedCount: 5, failedCount: 1,
#     cancelledCount: 0, rejectedCount: 0,
#     runningCount: 0, pendingCount: 0 }

# `summary.complete` is the canonical poll-completion flag.
```

`--short` and `--json` are mutually exclusive with `--watch` — for live
streaming use `experiment watch` instead.

If you need the raw eval-results export after watching with `--no-pull`, or
to refetch results outside a watch loop, fall back to:

```bash
eigenpal workflow experiment results <workflow-id> <batch-id> --format csv --out r.csv
```

### Long documents — split → chunk → extract

The canonical chain when a document is too long for one `ai.extract` call (loan
contracts, SaaS agreements, RFPs). Each step preserves source `pageIndex` so
the final extracted fields trace back to the originating page.

```yaml
- name: parse
  type: ai.parse
  with: { input: "{{ input.document }}" }

# LLM-driven section split — each split carries page_range + confidence
- name: sections
  type: ai.split
  with:
    input: "{{ steps.parse.output }}"
    sections:
      - { name: header,    description: "Title page + parties block" }
      - { name: priloha2,  description: "Príloha 2 odkladacie podmienky", required: true }

# Optional: chunk a long section before extraction (regex-anchored, keeps page refs)
- name: chunks
  type: transform.text-chunker
  with:
    input: "{{ steps.sections.output.splits[1] }}"   # priloha2 split
    maxChars: 8000
    overlap: 500
    splitOn: ['(?:^|\\n)\\s*\\d+\\.\\d+\\s+', '\\n\\n+', '\\n']

# Deterministic field extraction — counterpart to ai.extract; matches carry _evidence.pageIndex
- name: header_fields
  type: transform.regex-extract
  with:
    input: "{{ steps.parse.output }}"
    fields:
      contractNumber:
        pattern: 'č\\.\\s*(\\d{1,4}/\\w+/\\d{4})'
        normalize: strip-spaces
      signatureDate:
        pattern: 'uzavretá\\s+dňa\\s+(\\d{1,2})\\.(\\d{1,2})\\.(\\d{4})'
        format: iso-date
      currency:
        pattern: '\\b(EUR|USD|CZK)\\b'
        default: EUR
    flags: i
```

Discovery from the CLI:

```bash
eigenpal workflow step-type get ai.split | jq '.configSchema.properties'
eigenpal workflow step-type get transform.text-chunker | jq '.configSchema.properties'
eigenpal workflow step-type get transform.regex-extract | jq '.configSchema.properties'
```

Pick the right operator for the job:

| Goal                                     | Operator                  |
| ---------------------------------------- | ------------------------- |
| Extract structured data with an LLM      | `ai.extract`              |
| Pull fields by regex (no LLM)            | `transform.regex-extract` |
| Split a doc into named sections (LLM)    | `ai.split`                |
| Cut text by regex boundary + overlap     | `transform.text-chunker`  |

### Debug a failing workflow

```bash
# 1. Re-run a single example against the saved workflow (must be pushed first).
#    <workflow-id> accepts a `wf_…` id (preferred for scripts) or the slug.
eigenpal workflow execution run <workflow-id> <example-name>

# 2. Or pull a recorded failure from the server
eigenpal workflow execution list <workflow-id> --status failed --limit 5
eigenpal workflow execution get  exec_…                           # full payload, all steps
eigenpal workflow execution get  exec_… --step extract --include input,output,error

# 3. Compare two runs (e.g. before/after a workflow change)
eigenpal workflow execution compare <exec-a> <exec-b>

# 4. Wait for a kicked-off run to finish (use this whenever you need
#    to block until terminal — adaptive polling, 30-min auto-detach)
eigenpal workflow execution watch exec_…
```

See [`reference/debugging.md`](reference/debugging.md) for common failure
modes (`validation_failed`, `template_resolution_failed`, `script_timeout`,
`step_type_unknown`) and how to skip flaky external steps via
`meta.json` overrides.

## Output convention

Every command splits its output:

- **stdout** = data — JSON payloads, table rows, file contents from
  `pull` / `experiment results`. Pipe-safe.
- **stderr** = status — `✓` / `✗` / `ℹ` / `!` lines. Silenced by
  `-q` / `--quiet` (errors and warnings always fire; stdout never
  silenced).

The `--json` flag (on every `list` / `get` / mutating command) flips
the human-readable table on stdout to the raw server payload — pipe
through real `jq` to project:

```bash
eigenpal workflow execution list wf_abc --json | jq '.data[0].id'
eigenpal workflow execution get exec_abc --json | jq '.stepExecutions[].status'
```

### Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Success. |
| 1 | Runtime error — network, server 5xx, command-specific failure (e.g. `experiment status` (with or without `--watch`) reports a terminal batch where at least one execution failed or was cancelled). |
| 2 | Misuse or recoverable failure — bad flag, `step exec --output-schema` violation, `execution watch --max-wait` deadline, `step exec` against an unsupported step type. |

Exit 2 means "fix your invocation and re-run." Exit 1 means something
broke upstream — check the error.

## Where the schemas live

The CLI ships JSON Schema for every step type and every evaluator type.
Don't guess fields — introspect:

```bash
eigenpal workflow step-type      list                # full step catalog
eigenpal workflow step-type      get ai.extract      # config + output schema
eigenpal workflow evaluator-type list                # full evaluator catalog
eigenpal workflow evaluator-type get llm-judge       # config schema
```

For workflow / evaluators / dataset shape, see this skill's `reference/`:

- [`reference/workflow-yaml.md`](reference/workflow-yaml.md) — top-level shape, triggers, inputs, steps, output, template expressions
- [`reference/step-types.md`](reference/step-types.md) — step-type catalog + when to reach for each
- [`reference/step-exec.md`](reference/step-exec.md) — local single-step iteration (`workflow step exec`) — inputs, config, output schema, exit codes
- [`reference/dataset-format.md`](reference/dataset-format.md) — `dataset/examples/<name>/{input,expected,meta}` folder convention
- [`reference/evaluators.md`](reference/evaluators.md) — evaluators.yaml schema + judge patterns
- [`reference/debugging.md`](reference/debugging.md) — execution introspection + common failures
- [`reference/cli/`](reference/cli/) — full flag reference per command (autogenerated from the live Commander tree, never lies)

## Validation errors carry hints

Every server-side validation failure returns a structured envelope:

```json
{
  "issues": [
    { "field": "steps.2.config.passThreshold",
      "message": "Required, got undefined", "code": "invalid_value" }
  ],
  "hint": "Failing step is type `eval.llm-judge`. Run `eigenpal workflow step-type get eval.llm-judge` to inspect its config schema."
}
```

The CLI renders this with the field column aligned and the hint inline —
follow the hint, the schema lookup is one command away.

## Don't reach for

- `eval-local` / similar local-mirror commands — they don't exist. Drive
  the dataset by editing the local folder and pushing with
  `workflow dataset push --mode replace`, OR use the per-example CRUD
  (`dataset example {create,update,delete,get}`) when you only need to
  flip one row.
- The `manifest.json` dataset format — legacy, the import endpoint rejects
  it. Always use the folder convention.

## CLI surface

```bash
# Auth + tenant switching
eigenpal auth login              # add a profile (or update existing tenant's)
eigenpal auth list               # see all profiles, current marked ●
eigenpal auth use [profile]      # switch active (interactive picker if no arg)
eigenpal status                  # active tenant, user, key id, workflow count

# Definition
eigenpal workflow list
eigenpal workflow push --file workflow.yaml [--workflow-id <workflow-id>]
eigenpal workflow pull <workflow-id>
eigenpal workflow validate [path]

# Evaluators
eigenpal workflow evaluators push <workflow-id> --file evaluators.yaml
eigenpal workflow evaluators pull <workflow-id>
eigenpal workflow evaluators validate [path]

# Dataset
eigenpal workflow dataset push <workflow-id> --file dataset/ [--mode {append|replace}]      # default: append
eigenpal workflow dataset pull <workflow-id> --out dataset.zip
eigenpal workflow dataset list <workflow-id>
eigenpal workflow dataset validate [path]
eigenpal workflow dataset example create <workflow-id> --name <n> [--input-file] [--expected-file] [--annotation]
eigenpal workflow dataset example update <workflow-id> <example-id> [--name] [--input-file] [--expected-file] [--annotation] [--row-order]
eigenpal workflow dataset example delete <workflow-id> <example-id> --yes
eigenpal workflow dataset example get    <workflow-id> <example-id>                          # full row + metadata

# All-in-one validation against the templated project layout
eigenpal workflow validate                    # ./workflow.yaml + ./evaluators.yaml + ./dataset/

# Local artifacts
eigenpal workflow clear-local                 # delete local execution artifacts (no server impact)

# Experiments (batch eval runs)
eigenpal workflow experiment run     <workflow-id> [--example-id <id> ...]
eigenpal workflow experiment status  <workflow-id> <batch-id> [--watch] [--short] [--json]    # exit 1 on terminal w/ failures, 2 on --max-wait. --json includes top-level `summary` rollup.
eigenpal workflow experiment watch   <workflow-id> <batch-id> [--format csv|json] [--pull-on-complete <path>] [--no-pull]    # poll + auto-pull results in one shot
eigenpal workflow experiment results <workflow-id> [batch-id] --format {csv|json} --out r.csv
eigenpal workflow experiment list    <workflow-id>
eigenpal workflow experiment compare <batch-a> <batch-b> [--regression-threshold] [--sort]   # no --workflow-id; prints per-evaluator aggregate + per-row table

# Step-type / evaluator-type introspection
eigenpal workflow step-type      list
eigenpal workflow step-type      get <type>
eigenpal workflow evaluator-type list
eigenpal workflow evaluator-type get <type>

# Local single-step iteration (no server)
eigenpal workflow step exec <type> [--config-json | --config-file] [--inputs k=v...] [--output-schema]

# Execution (one-off run + read-side debugging + cancellation)
eigenpal workflow execution run     <workflow-id> [examples...]
eigenpal workflow execution get     <exec-id>
eigenpal workflow execution list    <workflow-id> [--status running|failed|completed]
eigenpal workflow execution watch   <exec-id>          # 2s/5s adaptive polling
eigenpal workflow execution compare <exec-a> <exec-b>
eigenpal workflow execution cancel  <exec-id>          # tells the worker to stop between steps; safe to retry

# Versions
eigenpal workflow versions list    <workflow-id>                          # pushed semver history (newest first)
eigenpal workflow versions restore <workflow-id> <version-id>             # re-activate a prior version as the live one

# Tooling
eigenpal skill install           # interactive multiselect for Claude Code, Cursor, …
eigenpal skill uninstall [toolIds...]  # name one or more tools, or pass --all
eigenpal skill list              # show what's installed where
```

`eigenpal --help` for the grouped overview, `eigenpal <command> --help`
for any specific command. The full per-command flag reference is also
bundled at [`reference/cli/`](reference/cli/) (autogenerated from the
live Commander tree, so it never lies). Read those when you need the
exact spelling / default / data type for a flag without round-tripping
to `--help`.
