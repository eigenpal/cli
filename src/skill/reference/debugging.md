# Debugging a failing workflow

Three tools cover most cases:

```bash
eigenpal runs get     <exec-id>           # full payload, step-by-step
eigenpal runs watch   <exec-id>           # live status; 2s during transition / 5s steady
eigenpal runs compare <a> <b>             # side-by-side diff of two runs
```

## 1. Reproduce the failure

```bash
eigenpal run workflows.<workflow-id> --example <example-name>
```

`<workflow-id>` is either a `wf_…` id or a slug (the YAML's `name:`
field). The workflow must be pushed (`eigenpal workflow push`) before
`eigenpal run` works — only saved workflows execute. Streams a live
step list as the run progresses. Bails to the prompt the moment a step
transitions to `failed`.

If the workflow is server-stable and the failure is on a real
historical execution, skip the rerun and pull the recorded execution
directly:

```bash
eigenpal runs list <workflow-id> --type workflow --status failed --limit 5
eigenpal runs get exec_…
```

If a `transform.template` fill looks wrong (leftover `{braces}`, empty
rows, or the wrong spreadsheet), smoke the Office file locally before
re-pushing. Local files never contact the server:

```bash
eigenpal workflow templates smoke ./templates/roster.xlsx \
  --data ./fixture.json --out ./filled.xlsx --json
```

XLSX prototype rows use `{table:subjects.first_name}` in the spreadsheet.
YAML `data` mapping still uses `{{ steps.extract.output.subjects }}` —
do not put `{{ }}` in the Office file. `tmpl_…` smoke downloads current
bytes through `GET /v1/templates/:id/content` and fills on this machine;
there is no private remote-render route.

## 2. Pull the full execution

```bash
eigenpal runs get <exec-id>
```

The grouped run payload includes:

- `id`, `type`, `finished` — run identity and whether it reached a terminal status
- `timing` — created/started/completed timestamps and duration
- `execution.status` — `pending` | `running` | `completed` | `failed` | `cancelled` | `skipped`
- `output` — the workflow's final return value when `finished` and completed (or partial when failed)
- `error` — terminal failure message when the run failed or was cancelled
- `input` — the input the workflow was called with (included on detail fetches)
- `execution.steps` — one entry per step when you pass `--expand execution` (the CLI also mirrors this as `stepExecutions`):
  - `stepName` — handle from `workflow.yaml`
  - `status` — same set as the top-level. `skipped` means the step's
    `if:` evaluated false, OR a `control.foreach` was passed an empty
    array. Check `skippedReason` for the human-readable cause.
  - `skippedReason` — populated when `status: 'skipped'`
  - `input` — fully resolved values (templates already expanded)
  - `resolvedConfig` — the step's `with:` block AFTER `{{template}}`
    substitution. Lets you see what the LLM actually got, what URL
    HTTP actually hit, what items the script actually saw. Populated
    for `ai.*` / `transform.*` / `action.*`. Null for `control.*`
    (orchestration steps do not have a meaningful resolved config).
  - `output` — what the step returned
  - `error` — error message + code when `status: 'failed'`
  - `durationMs`
  - `overrideMode` — `'skipped'` when the example's `meta.json`
    overrode this step; null otherwise

Quick triage with `jq`:

```bash
eigenpal runs get <exec-id> --expand execution --json \
  | jq '.stepExecutions[] | { step: .stepName, status, error }'
```

Narrow to a single step:

```bash
eigenpal runs get <exec-id> --expand execution --include input,output,error --json \
  | jq '.stepExecutions[] | select(.stepName == "extract")'
```

Drill into one field:

```bash
eigenpal runs get <exec-id> --expand execution --json | jq '.stepExecutions[2].output.totalAmount'
```

## 3. Common failure modes

### `validation_failed` on a step input

A step received an input that didn't match its `inputSchema`. Usually
upstream returned a different shape than expected. Inspect the upstream
step's `output` and adjust the template expression or schema.

```bash
# Check the step type's expected input shape
eigenpal workflow step-type get ai.extract | jq '.configSchema'
```

### `template_resolution_failed`

A `{{ ... }}` expression referenced a path that didn't exist
(`steps.foo.output.bar` when `steps.foo.output` is `null`). Either
guard with `| default:` or fix the upstream step.

### `script_timeout` / `script_memory_limit`

`transform.script` tripped its sandbox limits (5 s wall clock, 10 MB
heap). Optimize the code or split into smaller steps. The sandbox has
no network or filesystem, so most timeouts are infinite-loop bugs.

### `step_type_unknown`

`workflow.yaml` references a `type:` that the deployment does not know
about. Common after a typo or a step type that was renamed.

```bash
eigenpal workflow step-type list --search <partial-match>
```

### Eval flakiness with `llm-judge`

LLM-judge scores have variance. Stabilize: pin a specific model id
(`gpt-4o-2024-08-06`), set `temperature: 0`, narrow the prompt to one
dimension per judge, run multiple experiments and average.

### Workflow `Validation failed` on push

The error envelope tells you exactly where:

```
✗ Validation failed
  steps.2.config.passThreshold  Required, got undefined
  steps.2.type                  Invalid step type: 'eval.llm-judg'

ℹ Failing step is type `eval.llm-judge`. Run
  `eigenpal workflow step-type get eval.llm-judge` to inspect its
  config schema.
```

Follow the hint — every field path is dotted into the YAML so you can
jump straight to the broken line.

### Workflow appears in the wrong folder

Folder placement is controlled by server folder state, not by
`workflow.yaml`. Move by explicit folder path:

```bash
eigenpal workflow move <workflow-id> --folder billing/invoices
eigenpal workflow move <workflow-id> --folder /
```

`--folder /` moves the workflow back to root. `workflow push` and
`workflow pull` do not change folder placement. Missing folders in the
path are created automatically.

## 4. Compare two executions

```bash
eigenpal runs compare <exec-a> <exec-b>
```

Output: per-step status / Δ duration / output diff. Useful for spotting
regressions between revisions of a workflow.

For agent runs with spreadsheet outputs, `runs compare` compares XLSX
workbooks by structured sheet content (headers, typed rows, sheet order) —
not raw ZIP bytes — so metadata-only rewrites still match when cell data
matches. Comparison scans the full workbook (within CLI safety limits); the
`--max-*` caps below apply only to `artifacts inspect`, not to `compare`.
When a workbook exceeds compare safety limits, the file diff is reported as
`inconclusive` and `--fail-on-diff` does not treat it as a match.

Inspect a downloaded or remote XLSX artifact as machine-readable JSON:

```bash
eigenpal runs artifacts list <run-id>
eigenpal runs artifacts inspect <run-id> output/report.xlsx --json
eigenpal runs artifacts inspect <run-id> output/report.xlsx --sheet Summary,1 --max-rows 100 --json
eigenpal runs artifacts inspect --file ./report.xlsx --json
```

The JSON payload includes `sheetNames`, per-sheet `dimensions`, ordered
`headers`, typed `rows`, and `truncated` flags when `--max-*` caps apply
(defaults: 20 sheets, 500 rows/sheet, 50 cols/sheet).

For a freer-form diff, dump both and compare with `jq`:

```bash
eigenpal runs get <exec-a> > a.json
eigenpal runs get <exec-b> > b.json
diff <(jq -S . a.json) <(jq -S . b.json)
```

## 5. Cancel a long-running execution

```bash
eigenpal runs cancel <exec-id>           # TTY: silent
eigenpal runs cancel <exec-id> --yes     # CI / pipes
eigenpal runs cancel <exec-id> --json    # raw server payload
```

The worker finishes the current step, then stops — the cancellation
check happens between every step transition, including inside
`control.foreach` / `control.parallel` / `control.block` bodies.
Behavior by current state:

- `created` / `pending` — transitions straight to `cancelled`.
- `running` / `waiting` — stamps `cancelRequestedAt`; the worker
  observes it on the next step boundary and exits cleanly.
- already terminal (`completed` / `failed` / `cancelled`) — no-op,
  exits 0 with an info line. Safe to retry.

## 6. Compare two experiment batches

```bash
eigenpal workflow experiment compare <batch-a> <batch-b>
eigenpal workflow experiment compare <batch-a> <batch-b> --regression-threshold 0.10
eigenpal workflow experiment compare <batch-a> <batch-b> --json | jq '.summary.regressions'
```

Side-by-side score diff per `(example, evaluator)` pair. Highlights
regressions vs improvements; aggregate stats at the bottom.

- `--sort abs-delta-desc` (default — biggest movers first) | `delta-asc`
  (regressions first) | `delta-desc` (improvements first) | `name`
- `--regression-threshold 0.05` (default) — `Δ < -threshold` is a
  regression with `⚠`.

**No `--workflow-id` needed.** The server resolves the owning workflow
from each batch id. Both batches must belong to the same workflow within
your tenant. (Sibling `experiment` subcommands still take `<workflow-id>` as
the first positional — only `compare` is workflow-agnostic.)

## 7. Connection vs auth errors

`eigenpal status` reports them separately so you can tell which is
broken. If you see:

```
✗ Could not connect to https://… — invalid or unreachable base URL.
  Set EIGENPAL_BASE_URL or pass --base-url <url>.
```

That is a **connection** error — the URL is wrong, the server is down,
or your network is blocked. The URL the CLI tried is echoed back so a
stale `EIGENPAL_BASE_URL` is immediately obvious.

If instead you see:

```
✗ Not authenticated.
  Run `eigenpal auth login`, or set EIGENPAL_API_KEY in your env.
```

That is an **auth** error — the URL works but your key is missing /
expired / scoped to the wrong tenant. Run `auth list` to see configured
profiles, or `auth use <name>` to switch.

## 8. Override a flaky step in eval mode

If a step calls an external system that is unreliable (an external API, a
private API, a rate-limited connector), short-circuit it for evals via
the example's `meta.json`:

```json
{
  "overrides": {
    "steps": {
      "<stepName>": { ...stepOutputObject }
    }
  }
}
```

When the workflow runs against this example, the executor returns the
override as the step's output without running the real step. The
execution row shows `overrideMode: 'skipped'` so you can audit which
steps were faked. Re-import the dataset (`workflow dataset push
--mode replace`) for the change to land.

## 9. Watching a long batch

```bash
# Kicks off, prints { batchId, total }
eigenpal workflow experiment run <workflow-id>

# --watch polls until every execution is terminal, prints a per-example
# failure summary, and exits non-zero if any failed/cancelled.
eigenpal workflow experiment status <workflow-id> <batch-id> --watch

# Without --watch: one-shot snapshot, no polling. Prefer --watch in CI / agents.
eigenpal workflow experiment status <workflow-id> <batch-id>
```

The terminal `--watch` output looks like:

```
7/7 terminal  (failed=7)

✗ 7/7 did not pass

  invoice-2025-001  [failed]  template_resolution_failed at step `parse`: …
    eigenpal runs get exec_…
  …

ℹ step-level errors live on `stepExecutions[].error` — see reference/debugging.md.
```

## 10. Drilling into a single failed execution

The summary surfaces the top-level execution error. For step-by-step
detail (which step failed, what input it received, what output it
returned before erroring) follow the suggested command:

```bash
eigenpal runs get exec_…                                  # full payload
eigenpal runs get exec_… --expand execution --json | jq '.stepExecutions[] | select(.stepName == "<name>")'
eigenpal runs get exec_… --expand execution --json | jq -r '.stepExecutions[] | select(.error != null) | .error' | head -1
```

For per-execution live view, `eigenpal runs watch <exec-id>` does
adaptive polling (2 s while transitioning, 5 s when steady) and prints
ASCII status badges that work in any terminal.
