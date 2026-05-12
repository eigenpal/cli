# Debugging a failing workflow

Three tools cover most cases:

```bash
eigenpal workflow execution get   <exec-id>           # full payload, step-by-step
eigenpal workflow execution watch <exec-id>           # live status; 2s during transition / 5s steady
eigenpal workflow execution compare <a> <b>           # side-by-side diff of two runs
```

## 1. Reproduce the failure

```bash
eigenpal workflow execution run <workflow-id> <example-name>
```

`<workflow-id>` is either a `wf_…` id or a slug (the YAML's `name:`
field). The workflow must be pushed (`eigenpal workflow push`) before
`execution run` works — only saved workflows execute. Streams a live
step list as the run progresses. Bails to the prompt the moment a step
transitions to `failed`.

If the workflow is server-stable and the failure is on a real
historical execution, skip the rerun and pull the recorded execution
directly:

```bash
eigenpal workflow execution list <workflow-id> --status failed --limit 5
eigenpal workflow execution get exec_…
```

## 2. Pull the full execution

```bash
eigenpal workflow execution get <exec-id>
```

The payload includes:

- `status` — `pending` | `running` | `completed` | `failed` | `cancelled` | `skipped`
- `output` — the workflow's final return value (or partial when failed)
- `triggerInput` — the input the workflow was called with
- `stepExecutions` — one entry per step with:
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
    (orchestration steps don't have a meaningful resolved config).
  - `output` — what the step returned
  - `error` — error message + code when `status: 'failed'`
  - `durationMs`
  - `overrideMode` — `'skipped'` when the example's `meta.json`
    overrode this step; null otherwise

Quick triage with `jq`:

```bash
eigenpal workflow execution get <exec-id> \
  | jq '.stepExecutions[] | { step: .stepName, status, error }'
```

Narrow to a single step:

```bash
eigenpal workflow execution get <exec-id> --step extract --include input,output,error
```

Drill into one field:

```bash
eigenpal workflow execution get <exec-id> --json | jq '.stepExecutions[2].output.totalAmount'
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

`workflow.yaml` references a `type:` that the deployment doesn't know
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
eigenpal workflow execution compare <exec-a> <exec-b>
```

Output: per-step status / Δ duration / output diff. Useful for spotting
regressions between revisions of a workflow.

For a freer-form diff, dump both and compare with `jq`:

```bash
eigenpal workflow execution get <exec-a> > a.json
eigenpal workflow execution get <exec-b> > b.json
diff <(jq -S . a.json) <(jq -S . b.json)
```

## 5. Cancel a long-running execution

```bash
eigenpal workflow execution cancel <exec-id>           # TTY: silent
eigenpal workflow execution cancel <exec-id> --yes     # CI / pipes
eigenpal workflow execution cancel <exec-id> --json    # raw server payload
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

That's a **connection** error — the URL is wrong, the server is down,
or your network is blocked. The URL the CLI tried is echoed back so a
stale `EIGENPAL_BASE_URL` is immediately obvious.

If instead you see:

```
✗ Not authenticated.
  Run `eigenpal auth login`, or set EIGENPAL_API_KEY in your env.
```

That's an **auth** error — the URL works but your key is missing /
expired / scoped to the wrong tenant. Run `auth list` to see configured
profiles, or `auth use <name>` to switch.

## 8. Override a flaky step in eval mode

If a step calls an external system that's unreliable (an external API, a
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
# Kicks off, prints { batchId, executionIds }
eigenpal workflow experiment run <workflow-id>

# --watch polls until every execution is terminal, prints a per-example
# failure summary, and exits non-zero if any failed/cancelled.
eigenpal workflow experiment status <workflow-id> --batch-id <id> --watch

# Without --watch: one-shot snapshot, no polling. Prefer --watch in CI / agents.
eigenpal workflow experiment status <workflow-id> --batch-id <id>
```

The terminal `--watch` output looks like:

```
7/7 terminal  (failed=7)

✗ 7/7 did not pass

  invoice-2025-001  [failed]  template_resolution_failed at step `parse`: …
    eigenpal workflow execution get exec_…
  …

ℹ step-level errors live on `stepExecutions[].error` — see reference/debugging.md.
```

## 10. Drilling into a single failed execution

The summary surfaces the top-level execution error. For step-by-step
detail (which step failed, what input it received, what output it
returned before erroring) follow the suggested command:

```bash
eigenpal workflow execution get exec_…                                  # full payload
eigenpal workflow execution get exec_… --step <name> --include input,output,error
eigenpal workflow execution get exec_… --json | jq -r '.stepExecutions[0].error'
```

For per-execution live view, `eigenpal workflow execution watch <exec-id>` does
adaptive polling (2 s while transitioning, 5 s when steady) and prints
ASCII status badges that work in any terminal.
