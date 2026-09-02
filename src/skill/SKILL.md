---
name: eigenpal
description: Use the Eigenpal CLI to author workflows, manage agent source, run executions, inspect results, and download artifacts.
license: Apache-2.0
compatibility: Requires eigenpal CLI.
metadata:
  author: eigenpal
  version: '1.0'
  generatedBy: 'eigenpal@__CLI_VERSION__'
---

# Eigenpal CLI

Use long command names in generated commands and documentation. Short aliases may
appear in user examples, but do not prefer them.

## Non-interactive / agent terminals (read first)

**Never run a CLI command that opens a confirmation or picker without checking
`--help` first.** Agent terminals, CI, and piped shells are usually non-TTY — an
interactive prompt will hang indefinitely.

Rules:

- **`--yes`** — skip confirmations and pickers when a deterministic default exists,
  or acknowledge a destructive action in scripts. Required for most cancel/delete/replace
  flows in non-TTY.
- **`--force`** — only where documented: overwrite user-edited skill files on reinstall
  (`skill install --force`). Do not use as a generic “yes to everything”.
- **Provide explicit inputs** instead of prompts: `--file`, `--template`, `--tools`,
  `--stdin` / `--value-file`, `--base-url`, profile name for `auth use <name>`,
  `EIGENPAL_API_KEY` instead of `auth login` in CI.

Commands that can prompt or block (always inspect `--help` for the exact flag):

| Area | Command | Non-interactive bypass |
| --- | --- | --- |
| Init | `init [name]` | `--template <name>` and/or `--yes` (default template: blank) |
| Auth | `auth login` | Do not run non-interactively; set `EIGENPAL_API_KEY` and optionally `EIGENPAL_BASE_URL` |
| Auth | `auth use` | positional profile name |
| Skill | `skill install` | `--tools claude,cursor` and/or `--yes`; `--force` to overwrite edits |
| Skill | `skill uninstall` | tool ids, `--all`, or `--target` + `--yes` |
| Workflow | `workflow push` | `--file workflow.yaml` (TTY-only path picker otherwise) |
| Workflow | `workflow dataset push --mode replace` | `--yes` |
| Workflow | `workflow dataset example delete` | `--yes` |
| Workflow | `workflow experiment cancel` | `--yes` |
| Workflow | `workflow templates delete` | `--yes` |
| Agents | `agents dataset push --mode replace` | `--yes` |
| Agents | `agents experiment cancel` | `--yes` |
| Agents | `agents session stop` | `--yes` |
| Agents | `agents secrets set` | `--stdin` or `--value-file` |
| Runs | `runs cancel` | `--yes` |
| Runs | `runs reviews clear` | `--yes` |
| Runs | `runs expected delete` | `--yes` |

If a command fails with “requires --yes when run non-interactively”, re-run with
`--yes` only when the action is intentional — never to blindly retry.

## Choose A Command

- `eigenpal workflow` manages YAML workflow definitions, datasets, evaluators,
  experiments, versions, workspace templates, and step schemas.
- `eigenpal models list` inventories text, vision, and OCR models configured
  for the current tenant environment (`--json` for scripting). Health is
  `configured` or `unconfigured` from local credentials — not a live provider probe.
- `eigenpal agents` manages Git-backed agent source packages, shared resources,
  releases, sync, secrets, datasets, and live file inspection.
- `eigenpal run` starts a single workflow or agent run from a target. This is the
  command for running something once and reading its output, including
  API-triggered workflows. (`eigenpal workflow experiment` is a separate batch run
  over a whole dataset, not the single-run path.)
- `eigenpal runs` inspects, watches, compares, reruns, cancels, and downloads
  artifacts for workflow or agent runs.

## Authenticate And Select A Workspace

```bash
eigenpal auth login
eigenpal status --json
eigenpal auth list
eigenpal auth use <profile>
```

For CI, set `EIGENPAL_API_KEY` and optionally `EIGENPAL_BASE_URL` instead of
running the interactive login.

Use stable ids in scripts:

- Workflow id: `wf_...`
- Template id: `tmpl_...`
- Template revision id: `tmpr_...`
- Workflow execution id: `exec_...`
- Agent execution id: `aex_...`
- Experiment batch id: `evb_...`
- Workflow dataset example id: `evx_...`
- Agent dataset example id: `aeg_...`

## Workflow Loop

```bash
# Create or edit a workflow project.
eigenpal init workflow invoices --template pdf-extraction
cd invoices
$EDITOR workflow.yaml

# Inspect step and evaluator schemas before editing config.
eigenpal workflow step-type list --search extract
eigenpal workflow step-type get ai.extract | jq '.configSchema.properties'
eigenpal workflow evaluator-type list
eigenpal workflow evaluator-type get exact-diff | jq '.configSchema'

# Validate and push.
eigenpal workflow validate ./workflow.yaml
# --online also checks action.invoke-workflow targets, transform.template
# tmpl_… ids, and explicitly selected OCR/vision/text models against live tenant
# catalog metadata. Local `template: ./file.xlsx` paths
# are inspected on disk with or without --online and must stay inside the
# workflow project unless you pass --allow-external-templates.
eigenpal workflow validate ./workflow.yaml --online
eigenpal models list --json
# First push creates a new wf_…; capture the id from --json output.
eigenpal workflow push --file workflow.yaml --json | jq '.id'
# Later pushes must pass --workflow-id to update in place (omit it only on first create).
eigenpal workflow push --file workflow.yaml --workflow-id wf_…

# Run with ad-hoc input and read the output (use this for API-triggered workflows).
# `--wait --json` polls to completion and prints the run with top-level `output`.
eigenpal run workflows.<workflow-id> --input-json '{"document":"..."}' --wait --json | jq '.output'
eigenpal run workflows.<workflow-id> --input-file document=./invoice.pdf --wait --json | jq '.output'

# Run one persisted example instead.
eigenpal run workflows.<workflow-id> --example <example-name>

# Inspect a run after the fact. `runs get --json` returns top-level
# `output`/`files`/`error` once the run is completed. Plain `run --wait`
# without `--json` only prints "Run <id> is completed", so pass `--json` or
# use `runs get` to see the output.
eigenpal runs watch <execution-id>
eigenpal runs get <execution-id> --json | jq '.output'

# Push dataset and evaluators.
eigenpal workflow dataset validate ./dataset
eigenpal workflow dataset push <workflow-id> --file ./dataset --mode replace
eigenpal workflow evaluators validate ./evaluators.yaml
eigenpal workflow evaluators push <workflow-id> --file ./evaluators.yaml

# Run an experiment.
eigenpal workflow experiment run <workflow-id>
eigenpal workflow experiment watch <workflow-id> <batch-id>
eigenpal workflow experiment results <workflow-id> <batch-id> --format csv --out results.csv

# Create a tagged candidate without moving live traffic, then promote it.
eigenpal workflow versions create <workflow-id> --file workflow.yaml --set-version 1.4.0 --no-activate
eigenpal workflow versions list <workflow-id>
eigenpal workflow versions promote <workflow-id> <version-id>
# Restore copies a snapshot into a new untagged current HEAD.
eigenpal workflow versions restore <workflow-id> <version-id>
```

Folders are server metadata, not `workflow.yaml` content:

```bash
eigenpal workflow move <workflow-id> --folder billing/invoices
eigenpal workflow move <workflow-id> --folder /
```

## Agent Source Loop

Agents are Git-backed source packages. Edit source in Git, save the branch, test
the exact commit, then release and sync.

Key rules:

- `agents/<slug>/` is one agent package.
- `resources/skills/<slug>/`, `resources/knowledge/<slug>/`,
  `resources/templates/<slug>/`, and `resources/rules/<slug>/` are shared
  packages.
- `eigenpal agents save` validates, commits if dirty, and pushes the branch.
- `eigenpal agents release patch agents/<slug>` creates an immutable release.
- `eigenpal agents sync agents.<slug>` applies the latest released manifest and
  triggers to the server.
- `@latest` means latest released package, not the current branch.

```bash
# Clone source and create a branch.
eigenpal agents clone --out ./source
cd ./source
# Use `agents save` to validate, commit, and push source. For other Git ops, use
# `eigenpal git -- <git-args>` (not bare `git` — the passthrough wires credentials).
eigenpal git -- switch -c <short-task-branch>

# Inspect source state.
eigenpal agents status
eigenpal agents show agents.<slug> --json
eigenpal agents versions agents.<slug> --json

# Edit source.
$EDITOR agents/<slug>/AGENT.md
$EDITOR agents/<slug>/eigenpal.yaml
$EDITOR agents/<slug>/input-schema.json agents/<slug>/output-schema.json

# Validate and save.
eigenpal agents validate agents/<slug>
eigenpal agents deps --dir agents/<slug>
eigenpal agents save -m "Improve <agent> behavior"

# Test the saved commit.
SOURCE_REF="$(eigenpal git -- rev-parse HEAD)"
eigenpal run agents.<slug>@"$SOURCE_REF" --input-json '{"text":"hello"}' --wait
eigenpal run agents.<slug>@"$SOURCE_REF" --example example-name --wait
eigenpal runs get <run-id> --json | jq '{status, schemaValid, error, requestedSourceRef, resolvedGitRef, resolvedGitTag, resolvedCommitSha, cost}'
eigenpal runs artifacts list <run-id>
eigenpal runs trace <run-id> --out ./review/<run-id>/trace.jsonl

# Release and sync.
eigenpal agents release patch agents/<slug>
eigenpal agents sync agents.<slug>
```

Use schema field names for file inputs when an agent has more than one file
field:

```bash
eigenpal run agents.<slug> \
  --input-file zfzal_doc=./ZFZAL.pdf \
  --input-file lv_doc=./list_vlastnictva.pdf \
  --input-json '{"skip_name_check":false}' \
  --wait
```

`agents file list/get/diff` are read/compare commands only. Change agent files
through Git source, then use `agents save`, `agents release`, and `agents sync`.

## Agent templates (Git source)

DOCX/XLSX templates for **runtime agents** live in Git source, not in the
workspace Templates table. YAML workflows use workspace templates via
`transform.template` and `tmpl_...` instead — see `reference/step-types.md`.

Workspace DOCX/XLSX templates for YAML workflows (`tmpl_…` / `tmpr_…`):

```bash
# Upload a new template (returns tmpl_… + tmpr_… with --json).
eigenpal workflow templates upload ./templates/roster.xlsx --json

# List and inspect server templates.
eigenpal workflow templates list --json
eigenpal workflow templates get tmpl_…
eigenpal workflow templates get tmpl_… --json | jq '.currentRevision.id'

# Download current bytes (--out required).
eigenpal workflow templates download tmpl_… --out ./templates/roster.xlsx

# Replace with a new local file (creates a new tmpr_… revision).
eigenpal workflow templates replace tmpl_… ./templates/roster-v2.xlsx --json

# Delete the tmpl_… pointer (--yes required outside a TTY).
eigenpal workflow templates delete tmpl_… --yes

# Smoke-fill locally (no server) or from a tmpl_… id (downloads bytes, fills locally).
eigenpal workflow templates smoke ./templates/roster.xlsx --data ./fixture.json --out ./filled.xlsx
eigenpal workflow templates smoke tmpl_… --data ./fixture.json --out ./filled.xlsx

# YAML may keep a source path; push uploads and sends tmpl_ + tmpr_ ids.
# template: ./templates/roster.xlsx
eigenpal workflow validate ./workflow.yaml --online
eigenpal workflow push --file workflow.yaml --workflow-id wf_…
```

**Local template** (one agent):

```text
agents/<slug>/templates/<template-slug>/
  template.docx   # or template.xlsx
  TEMPLATE.md     # frontmatter: name, description, type: docx|xlsx
```

**Shared template package** (reused across agents):

```text
resources/templates/<template-slug>/
  eigenpal.yaml   # required package manifest
  template.docx   # or template.xlsx
  TEMPLATE.md     # optional metadata
```

At runtime the agent fills templates with the baked-in **fill-template**
platform skill (`vars`, then `fill`) — not `transform.template`. Local
templates resolve by slug under `agent/templates/<slug>/`. Shared dependencies
install under `agent/eigenpal_modules/resources/templates/<slug>/`; pass that
file path to fill-template when the template is not copied locally.

```bash
# Add or update a local template, then validate and save.
cp ./invoice.docx agents/<slug>/templates/invoice/template.docx
$EDITOR agents/<slug>/templates/invoice/TEMPLATE.md
eigenpal agents validate agents/<slug>
eigenpal agents save -m "Add invoice template"
eigenpal agents release patch agents/<slug>
eigenpal agents sync agents.<slug>

# Shared template: validate, save, and release the package.
cp ./report.xlsx resources/templates/monthly-report/template.xlsx
$EDITOR resources/templates/monthly-report/eigenpal.yaml
eigenpal agents validate resources/templates/monthly-report
eigenpal agents save -m "Add monthly report template"
eigenpal agents release patch resources/templates/monthly-report

# Consuming agent: pin an exact dependency version, then release and sync.
$EDITOR agents/<slug>/eigenpal.yaml   # workspace:resources.templates.monthly-report: "1.0.0"
eigenpal agents validate agents/<slug>
eigenpal agents save -m "Use monthly report template"
eigenpal agents release patch agents/<slug>
eigenpal agents sync agents.<slug>
```

Updating a shared template does not auto-sync dependent agents. Release the
template package, bump each consumer's exact-version dependency, then release
and sync those agents. Workspace `tmpl_...` templates are a different system —
use `eigenpal workflow templates`, not `agents save`.

## Shared Resource Updates

Do not move every dependent agent automatically. Find dependents, ask which ones
to update, then release and sync only those agents.

```bash
$EDITOR resources/skills/<slug>/SKILL.md resources/skills/<slug>/run.py
eigenpal agents validate resources/skills/<slug>

rg '<slug>|resources/skills/<slug>|resources/knowledge/<slug>' agents/ resources/
eigenpal agents deps --dir agents/<dependent-slug>

eigenpal agents save -m "Improve shared <slug>"
eigenpal agents release patch resources/skills/<slug>

$EDITOR agents/<dependent-slug>/eigenpal.yaml
eigenpal agents validate agents/<dependent-slug>
eigenpal agents save -m "Bump <slug> dependency"
eigenpal agents release patch agents/<dependent-slug>
eigenpal agents sync agents.<dependent-slug>
```

After rollout, run one affected agent and inspect `eigenpal.lock` from run
artifacts to confirm the dependency version.

## Agent Datasets

Agent examples are runtime data, not Git source. `agents save` does not persist
them.

```bash
eigenpal agents dataset validate ./dataset --agent-dir agents/<slug>
eigenpal agents dataset push agents.<slug> --file ./dataset
eigenpal agents dataset list agents.<slug>
eigenpal agents dataset pull agents.<slug> --out ./dataset.zip
```

Expected outputs should include stable fields only. Omit timestamps, random IDs,
and open-ended LLM text.

## Runs And Artifacts

```bash
eigenpal runs list <workflow-id> --type workflow --status failed --limit 10
eigenpal runs list <agent-id-or-slug> --type agent --status failed --compact
eigenpal runs watch <execution-id>
eigenpal runs get <execution-id> --expand input,execution --json
eigenpal runs artifacts list <execution-id>
eigenpal runs artifacts fetch <execution-id> --include all --out ./review/<execution-id>
eigenpal runs trace <execution-id> --out ./review/<execution-id>/trace.jsonl
eigenpal runs rerun <execution-id> --wait
eigenpal runs rerun <execution-id> --version original --wait
eigenpal runs compare <source-execution-id> <new-execution-id> --baseline --normalize-dates
```

`runs rerun` reuses the previous input snapshot with latest source by default.
Use `--version original` only to reproduce the previous resolved version.

## Reviews And Expected Artifacts

```bash
eigenpal runs reviews update <agent-execution-id> \
  --status open \
  --verdict incorrect \
  --note "Expected the filing date to be extracted."
eigenpal runs reviews close <agent-execution-id> \
  --note "Fixed and verified."
eigenpal runs reviews clear <agent-execution-id> --yes

eigenpal runs expected list <agent-execution-id>
eigenpal runs expected upload <agent-execution-id> expected.json --name expected.json
eigenpal runs expected copy-output <agent-execution-id> result.json --name expected.json
eigenpal runs expected pull <agent-execution-id> --out expected/
eigenpal runs expected rename <agent-execution-id> old.json new.json
eigenpal runs expected delete <agent-execution-id> old.json --yes
```

## Output

Prefer `--json` for scripts and agent work.

```bash
eigenpal runs list <workflow-id> --type workflow --json | jq '.runs[0].id'
eigenpal runs get <execution-id> --json | jq '.id'
```

Exit codes:

| Code | Meaning |
| --- | --- |
| 0 | Success |
| 1 | Runtime or command failure |
| 2 | Invalid invocation, unsupported option, timeout, or deadline |

Status messages go to stderr. Pipeable data goes to stdout.

## References

Use generated references for exact flags and defaults:

CLI command references:

- [`reference/cli/workflow.md`](reference/cli/workflow.md)
- [`reference/cli/agents.md`](reference/cli/agents.md)
- [`reference/cli/runs.md`](reference/cli/runs.md)
- [`reference/cli/run.md`](reference/cli/run.md)
- [`reference/cli/rerun.md`](reference/cli/rerun.md)
- [`reference/cli/auth.md`](reference/cli/auth.md)
- [`reference/cli/init.md`](reference/cli/init.md)
- [`reference/cli/models.md`](reference/cli/models.md)
- [`reference/cli/skill.md`](reference/cli/skill.md)
- [`reference/cli/status.md`](reference/cli/status.md)
- [`reference/cli/surface.md`](reference/cli/surface.md)

Workflow and eval references:

- [`reference/workflow-yaml.md`](reference/workflow-yaml.md)
- [`reference/step-types.md`](reference/step-types.md)
- [`reference/step-exec.md`](reference/step-exec.md)
- [`reference/dataset-format.md`](reference/dataset-format.md)
- [`reference/evaluators.md`](reference/evaluators.md)
- [`reference/debugging.md`](reference/debugging.md)

Use `eigenpal --help` for command groups and `eigenpal <command> --help` for live
command help.
