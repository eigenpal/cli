# @eigenpal/cli

## 0.10.24

### Patch Changes

- 6d1913f: Agent example runs now report a real evaluator verdict in the CLI: `eigenpal run agents.<name> --example <name> --wait` waits for the verdict, prints the weighted score and pass/fail result, and `--fail-on-mismatch` exits non-zero when the run fails its evaluators, matching the existing workflow behavior. When no evaluators are configured, the CLI says so instead of silently reporting nothing.
- 6d1913f: `agents secrets` is now one command group with `list`, `set`, `unset`, `import`, and `export` subcommands (`agents secret` remains as an alias). The new `agents secrets list` shows the secret names and descriptions declared in the package without ever printing values. Previously `set` and `unset` lived under a separate singular command and `secrets list` failed with an argument error.
- 6d1913f: `agents sync` retries automatically with a short backoff when the server reports the Git source as temporarily unavailable, so the sync right after `agents release` succeeds without manual retries.
- 6d1913f: `agents dataset validate` now checks the same layout the server accepts on `agents dataset push`: example folders under `examples/`, file inputs referenced from `input.json` with `{ "$file": "input/..." }`, and `expected.json` optional. Previously the local validator demanded a different layout that push would then reject, so no dataset could satisfy both. Validation errors now point at the exact rule that failed, including a hint when example folders sit at the dataset root instead of under `examples/`. When the agent package carries an input schema, each example's full input object is validated against it (required fields, unknown keys, and value types, with `{ "$file": ... }` references accepted for file fields), so inputs that would fail at run start are caught locally. Failure-expected examples (`expected.json` with `$error`) are rejected for agent datasets, since agent runs are evaluated only when they complete.
- 6d1913f: `workflow experiment run --json` now includes the documented `batchId` field, so scripts piping into `jq '.batchId'` get the real experiment id instead of null. `workflow experiment status` now fails with a clear message when the batch has no executions (for example when a bad batch id is passed) instead of reporting a misleading "0/0 terminal" success.
- 6d1913f: `runs trace` now works for workflow runs as well as agent runs. Workflow runs return execution phase and step trace events; previously the command always returned HTTP 404 for workflow run ids.
- 6d1913f: `workflow pull` no longer reports "no published version yet" for workflows that have a current published version. The command now reads the version payload the server actually returns, so freshly pushed workflows pull cleanly.

## 0.10.20

### Minor Changes

- 28f2e84: The bundled workflow reference now documents durable retry policies, inheritance, supported step types, and retry safety limits.

## 0.10.19

### Minor Changes

- b84a877: Workflow YAML reference docs now describe `action.invoke-workflow` as the single composition primitive, including inline and child execution modes.

## 0.10.16

### Patch Changes

- b1f0bca: `eigenpal run <workflow> --example <name>` now actually grades the example
  instead of printing `PASS` whenever the run merely finished. It runs the
  workflow's current published version on the server's stored dataset example, so
  configured evaluators run automatically and the CLI surfaces the real weighted
  score and per-evaluator pass/fail. Workflows with no evaluators fall back to a
  structural diff of the output against the example's stored expected output. The
  summary reports two separate signals: execution health (`ok`/`errored`) and
  accuracy. Add `--fail-on-mismatch` to exit non-zero when a graded example fails.

  Because the run uses the server-side example, push your latest dataset and
  evaluators (`eigenpal workflow dataset push`, `eigenpal workflow evaluators
push`) before running `--example`.

## 0.10.9

### Patch Changes

- 69fe792: The workflow step catalog now lists the new document-separation and multi-way routing steps, plus the grounded-extraction options, so authoring and validating workflows from the CLI stays in step with what the platform supports.

## 0.10.8

### Patch Changes

- df3468e: `eigenpal workflow validate` now tells you when a workflow contains Invoke Workflow steps that local validation cannot fully check. Because those steps reference other workflows that live on the server, the command prints a short note pointing you to `validate --online` (or push) to verify the invoke targets, input types, and cycles. The skill guidance now shows the `--online` step in the validate-then-push flow as well.
- 1010d2e: The evaluator configuration reference now reflects the single workflow-level pass threshold. A per-evaluator `passThreshold` is documented as legacy — pass/fail is decided by the one workflow-level threshold — and that workflow-level threshold no longer shows a fixed default, since it is derived when omitted.

## 0.10.7

### Patch Changes

- 664bbed: `eigenpal --help` now groups `run`, `rerun`, and `runs` under a dedicated "Run" section instead of the catch-all "Other" bucket, so starting a run and reading its output is easy to find from the top-level help. The "Workflows" and "Agents" group descriptions were tightened to match.

## 0.10.5

### Minor Changes

- d3a8b79: Workflow dataset commands now handle nested file references in example inputs, so local dataset archives can round-trip file-backed examples through the CLI without flattening the input shape.

### Patch Changes

- 9343b8c: Add `eigenpal workflow schema <workflow>` to print a workflow's inferred output schema — the fields and files it returns, typed from its own steps — as JSON Schema, or as a TypeScript or Python type with `--format`.
- 9343b8c: `workflow validate` gains an `--online` flag that checks cross-workflow `action.invoke-workflow` references against the server (target existence, input type-match, missing/unknown input keys, undeclared output, and invoke cycles). Local validation can only check a workflow's own shape, so these reference errors previously surfaced only at push; run `eigenpal workflow validate --online` to catch them beforehand.

## 0.10.2

### Patch Changes

- ca9ae4f: Workflow inputs can declare an external file `source` (single-tenant on-prem). A `type: file` input with `source: <name>` (e.g. `gpfs`) is provided as a plain string id at run time; the worker resolves it to a file artifact via the configured source before the workflow executes.

## 0.9.0

### Minor Changes

- c35d5d4: Clean up the public runs and evaluation API surface: move workflow eval operations onto automations, expose run scores/artifacts through the unified runs API, and update CLI/SDK helpers to use the canonical routes.

  Breaking: `runs.evalResults` and `GET /api/v1/runs/{id}/eval-results` are replaced by `runs.scores` and `GET /api/v1/runs/{id}/scores`.

### Patch Changes

- c35d5d4: Clarify `--max-wait` help text so timeout exit behavior reads naturally.

## 0.8.0

### Minor Changes

- d620a00: Expose the clean public automation API around automations, runs, files/artifacts, datasets, evaluators, experiments, evaluation results, and run promotion. This intentionally breaks the pre-v1 SDK/CLI surface that exposed workflow- and agent-specific top-level resources outside the explicit legacy compatibility routes.

  > [!WARNING]
  > **Breaking change (pre-v1).** The workflow- and agent-specific top-level
  > resources have been removed in favor of a single automation-centric surface.
  > These packages are still 0.x, so this breaking redesign ships as a `minor`
  > bump. Update your integration before upgrading.

  #### Removed
  - Top-level workflow resources, e.g. `client.workflows.*`, including
    `client.workflows.executions.runAndWait(...)` and the rest of the
    `client.workflows.executions.*` tree.
  - Top-level agent resources, e.g. `client.agents.*` (runs, reviews, traces,
    files, expected artifacts).
  - Top-level source/git resources, e.g. `client.sources.*`.

  #### New equivalents
  - **Start a run:** use `client.run('workflows.<slug>', input, options)` (and
    `client.run('agents.<slug>', ...)`). In the TypeScript SDK, `run-and-wait`
    is `client.run(target, input, { waitForCompletion })`; in the Python SDK use
    `client.run_and_wait(target, input=...)`.
  - **Browse automations** (workflows + agents): `client.automations.list()`,
    `client.automations.get(id)`, `client.automations.versions(id)`,
    `client.automations.triggers(id)`, plus
    `client.automations.dataset|examples|evaluators|experiments.*`.
  - **Inspect & control runs:** `client.runs.list()`, `client.runs.get(id)`,
    `client.runs.cancel(id)`, `client.runs.rerun(id)`, `client.runs.promote(id)`,
    `client.runs.usage(id)`, `client.runs.steps(id)`, `client.runs.events(id)`,
    and `client.runs.artifacts|eval_results|reviews|trace.*`.
  - **Manage reusable files:** `client.files.upload(...)`, `client.files.get(id)`,
    `client.files.download(id)`, `client.files.delete(id)`.

  #### Migration
  - `client.workflows.executions.runAndWait('<slug>', input)` →
    `client.run('workflows.<slug>', input, { waitForCompletion })` (TS) /
    `client.run_and_wait('workflows.<slug>', input=...)` (Python).
  - `client.workflows.executions.create('<slug>', input)` →
    `client.run('workflows.<slug>', input)`.
  - `client.agents.runs.create('<slug>', input)` →
    `client.run('agents.<slug>', input)`.
  - `client.workflows.get('<slug>')` / `client.agents.get('<slug>')` →
    `client.automations.get('workflows.<slug>')` /
    `client.automations.get('agents.<slug>')`.
  - Listing/inspecting executions previously under
    `client.workflows.executions.*` / `client.agents.runs.*` →
    `client.runs.*` (e.g. `client.runs.list()`, `client.runs.get(id)`).
  - `eigenpal runs promote` now accepts only `--name` (optional). Use
    `eigenpal runs reviews update` to set corrected JSON before promoting.
    Review and corrected-file commands work for both workflow and agent runs.

  #### DX fixes
  - `client.runs.*` read methods are now typed against the generated OpenAPI
    models; use `isRunFinished()` to narrow `run()` / `rerun()` responses before
    accessing `output`.
  - `eigenpal agents dataset push --file` accepts a `.zip` archive (matching
    `pull` output) as well as a directory.

### Patch Changes

- e2e88d7: Drop the deprecated `git` passthrough and the `completion` helper from the generated CLI reference docs and bundled skill reference. Both commands remain fully functional and discoverable via `--help`.
- e67f2f3: Fix staging QA CLI gaps: resolve profiles by tenant display name (e.g. `EIGENPAL_PROFILE="Timur's org"`) and cap workflow experiment example pagination at the API `limit=100` maximum.

## 0.7.0

### Minor Changes

- 963fd6c: Unify run detail on `GET /api/v1/runs/{id}`: return the canonical Run object directly (no `{ run: ... }` envelope) and merge expanded fields in-place via documented `expand` tokens. Remove the session-only `expand=internal` dashboard escape hatch; SDKs and CLI now use explicit expand lists.

### Patch Changes

- 963fd6c: Update runs commands for the grouped run API shape and four expand tokens.

## 0.6.16

### Patch Changes

- 75dd64c: Internal refactor: move the skill tool registry into its own module so other tooling can import it. No change to any command, flag, argument, or output.

## 0.6.15

### Minor Changes

- ca87265: Unify workflow and agent run starts behind the canonical `/api/v1/run/{target}` endpoint, root `eigenpal run` / `eigenpal rerun` commands, and root SDK `client.run()` / `client.rerun()` methods.

  The old nested CLI commands and SDK resource methods for starting workflow or agent runs have been removed.

### Patch Changes

- 5ea0bb5: `workflow dataset pull` gains `--example-id <id>` (repeatable) to export a single example or a selected subset of a dataset, instead of always pulling the whole dataset. The subset ZIP uses the same archive layout as a full pull, so it re-imports into any dataset via `dataset push --mode append`. Requesting an example id that does not exist for the workflow exits non-zero.

## 0.6.10

### Patch Changes

- 99ca1b4: Unify agent and workflow run commands and SDK helpers on the shared `/api/v1/runs` API, including the public `client.runs` facade and regenerated SDK reference docs.

## 0.6.6

### Patch Changes

- 245f347: Clean up the agent CLI surface by removing obsolete compatibility commands, moving reruns to `agents rerun`, and replacing run pulls with canonical artifact fetching.
- 5ab00ee: Tighten permissions on `~/.config/eigenpal/credentials.json` and its parent directory to owner-only (0600 / 0700). Previously the file was written 0600 but the parent directory inherited the user's umask (typically 0755), allowing other local users to list the directory and stat the file. The CLI now also re-tightens permissions on every write, so installs created with older versions are corrected on the next `auth login` / `auth use`.

## 0.6.4

### Patch Changes

- c3486a5: Fix agent git cutover QA findings: dashboard runs now navigate to the created run, inbound email aliases preserve mixed-case organization qualifiers, sandbox source materializes under `/workspace/agent`, run artifact downloads use direct paths like `/files/eigenpal.lock`, wait-for-completion responses include source provenance, and CLI wait/watch commands exit nonzero for failed or cancelled runs.

## 0.6.2

### Patch Changes

- d2202b6: List all agent runs for unqualified targets, and reserve source-ref filtering for explicit `@ref` targets.

## 0.6.0

### Minor Changes

- 2aeeaf2: Add native source `git save` and branch-aware `git release` flows for Git-backed builder workspaces.

### Patch Changes

- 2aeeaf2: Complete the agent Git cutover with pluralized agent CLI commands, source-ref run support, lockfile metadata, and regenerated SDK/docs surfaces.
- 2aeeaf2: Expose Git-backed agent source refs and public source automation APIs consistently across CLI docs and SDK facades.

## 0.5.12

### Minor Changes

- d3b0768: Add `control.fail` and `ai.classify` step types, plus the `expected/error.json` dataset assertion format.
  - `control.fail` terminates a workflow with a typed status code + message envelope. Optional `condition` template gates the fail. Compose with `ai.classify` to reject documents that match an undesired label.
  - `ai.classify` runs single-label closed-set classification through the existing extract LLM pipeline. Output is `{ label, confidence, reason }`, where `label` is constrained to the configured names.
  - `examples/<name>/expected/error.json` (mutually exclusive with `output.json`) lets eval examples assert that a workflow should fail with a specific `{ code, messageContains, step }`. The exact-diff evaluator scores 1 on match, 0 otherwise.
  - `eigenpal workflow validate` now catches `expected/error.json` shape issues and per-step config violations (e.g. `ai.classify` with fewer than two labels) at push time instead of deferring to runtime.

  Skill reference docs (`step-types.md`, `dataset-format.md`, `evaluators.md`, `workflow-yaml.md`) updated.

### Patch Changes

- 99cad97: Skill reference (auto-generated from `WorkflowDefinitionSchema`) now documents the new `values` row for enum inputs, alongside the existing `items` row used by array inputs. Output-only doc refresh — no CLI behavior change.
- d70f697: Document the `control.parallel`, `control.parallel_map`, `control.foreach`, `control.if`, and `control.block` step types in the bundled skill reference. The auto-generated catalog cannot render nested step shapes, so the YAML form, output access paths (e.g. `steps.<parallel>.output.<branch>.<inner>.<field>`), and scoping rules now live as hand-written prose. Also documents the multi-step iteration hazard: only the LAST inner step's output is keyed into each `items[i]` for `parallel_map` / `foreach` — end the body with a `transform.script` if you need to preserve intermediate fields.
- ed2cde6: Fix `eigenpal workflow pull` writing a 0-byte file. The v1 single-workflow endpoint now returns the current YAML at the top level (`yamlContent`) via a new `WorkflowDetail` response shape, and the CLI throws a clear error instead of silently writing empty output when no version has been published. Also fixes adjacent regressions caused by the same picker: `workflow list` now shows the workflow name and version columns (previously always `-`), `workflow push --bump` reads the server's current version correctly, the "did you mean?" suggestion on a slug typo lists candidates again, and `workflow execution list` shows a duration column computed from the run start/end timestamps.

## 0.5.11

### Patch Changes

- 2958f4d: Fix Git-backed source smoke-test polish: hidden `git show` and `git sync` now accept bare agent slugs, and workflow scaffolds use the current `triggerMethods` YAML shape.

## 0.5.10

### Patch Changes

- aee7e0c: Add hidden Git source commands for editing trigger policy and encrypted secrets.

## 0.5.9

### Major Changes

- fadb59b: CLI command tree reorganized around the data model. Top-level surface is now
  `workflow`, `agent` (reserved), and `skill`; everything that operates on a
  workflow lives under `workflow`, grouped by sub-entity.

  Renames (clean break — no aliases):
  - `eigenpal exec <slug>` → `eigenpal workflow execution run <slug>`
  - `eigenpal clear` → `eigenpal workflow clear`
  - `eigenpal install-skill` → `eigenpal skill` (same interactive multiselect UX)
  - `eigenpal execution {get,list,watch,compare}` → `eigenpal workflow execution {…}`
  - `eigenpal workflow set-definition` → `eigenpal workflow push`
  - `eigenpal workflow get-definition` → `eigenpal workflow pull`
  - `eigenpal workflow set-evaluators` / `get-evaluators` → `workflow evaluators {push,pull}`
  - `eigenpal workflow set-dataset` / `get-dataset` / `list-examples` → `workflow dataset {push,pull,list}`
  - `eigenpal workflow run-experiment` / `get-experiment-status` / `get-experiment-results` /
    `get-eval-results` / `list-executions` → `workflow experiment {run,status,results,eval-results,list}`
  - `eigenpal workflow list-versions` / `restore-version` → `workflow version {list,restore}`
  - `eigenpal workflow list-step-types` / `get-step-type` → `workflow step-type {list,get}`
  - `eigenpal workflow get-execution` → `workflow execution get`
  - `eigenpal workflow get-active-tenant` → `workflow active-tenant`

  Removed:
  - `eigenpal generate-meta` — deleted. The IDs it generated were never read by
    any other CLI command; the server re-mints IDs on every push.

  Added:
  - `eigenpal agent` — reserved placeholder namespace. Prints a "Coming soon"
    message; agentic-process operations will land here in a future release.

### Minor Changes

- c15ce88: Add the `eigenpal agent` command tree for managing agents, triggers, datasets, executions, experiments, and sessions from the terminal.
- c82a215: `eigenpal auth login` now shows an interactive server picker when no `--base-url` flag or `EIGENPAL_BASE_URL` env is set:
  - **Cloud** (`https://studio.eigenpal.com`) is the default highlighted option.
  - Any on-prem URLs already in your credentials file are surfaced as separate options labelled with the profile names that use them — re-login against an existing on-prem deployment without retyping the URL.
  - **Custom URL…** prompts for a URL with strict validation.

  URL handling is now bulletproof in all three input paths (flag, env, picker):
  - Trims leading/trailing whitespace, strips trailing slashes.
  - Auto-prepends `https://` when you paste a bare hostname (e.g. `eigenpal.example.com` → `https://eigenpal.example.com`).
  - Rejects non-http(s) schemes (`file://`, `ws://`, etc.) with a clear error.
  - Rejects URLs with paths, query strings, or hash fragments — baseUrl is an origin, not a route.
  - Warns when authenticating over `http://` against a non-loopback host (credentials sent unencrypted).

  Behavior with `--base-url` or `EIGENPAL_BASE_URL` set is unchanged — explicit overrides skip the picker, and an active profile's stored baseUrl is still inherited by all non-login commands.

- c330c2a: CLI: bug fixes + new tooling.
  - `success()` / `info()` / `dim()` now write to stderr, not stdout. `cmd | jq` no longer mixes status lines with JSON output. (`error()` and `warn()` already correctly used stderr.)
  - `workflow execution watch <bad-id>` no longer treats 404 as a transient network blip; the loop exits immediately so the caller sees the structured `Execution not found` error and a non-zero exit instead of polling for 30 minutes.
  - `eigenpal status` exits non-zero when authentication fails, so scripts can `eigenpal status && deploy`.
  - New `eigenpal completion <bash|zsh|fish>` command — emits a shell-completion script for the live command tree. Install via `eigenpal completion bash > /usr/local/etc/bash_completion.d/eigenpal` (or your shell's equivalent).
  - New global `--quiet` / `-q` flag — suppresses `success()` / `info()` / `dim()` lines while keeping `error()` and `warn()` (and JSON output) intact.
  - New `addJsonFlagMutation()` helper alongside `addJsonFlag()`. Mutating commands that do not have a curated table view now use it so `--verbose` no longer appears in `--help` where it is a no-op. (Wire-up in mutating handlers happens in a follow-up commit on this branch.)

- b2c4308: CLI: per-example dataset CRUD.

  Three new subcommands under `workflow dataset` mean you no longer have to re-zip and re-push the whole folder when you only want to flip one row:
  - `workflow dataset create-example <wfId> --name <n> [--input-json | --input-file] [--expected-json | --expected-file] [--annotation]` — add one example.
  - `workflow dataset update-example <wfId> <exampleId> [--name] [--input-*] [--expected-*] [--annotation] [--row-order]` — partial PATCH; flags you omit are left alone, `--annotation ""` clears.
  - `workflow dataset delete-example <wfId> <exampleId> [--yes]` — `--yes` required for non-TTY shells.

  `--input-file` / `--expected-file` accept a path or `-` for stdin. Inline `--*-json` and the `-file` variant are mutually exclusive.

  Server: the `POST /api/workflows/:id/eval-examples` create schema now accepts the `name` and `annotation` fields the dashboard already exposed via the dashboard's PATCH path. No new endpoints — the v1 mirrors at `/api/v1/eval-examples/[id]` and `/api/v1/workflows/[id]/eval-examples` were already in place.

  Skill recipes restored: `SKILL.md` and `reference/dataset-format.md` document the three flows (capture corrected output as new GT, add one example, delete one bad row).

- d41ee8b: CLI: drop the `--wait` flag from `workflow execution run`. The local-folder runner already waits for every example to reach a terminal state, so the flag was a documented no-op kept "for symmetry with `experiment run --wait`." That symmetry is not worth a dead flag in the user-facing help screen — `experiment run --wait` is meaningful (it polls batch status), `execution run --wait` never was.

  Behavior is unchanged. Scripts that passed `--wait` will now see an unknown-option error from Commander; remove the flag.

- d41ee8b: CLI: drop `--jq` and `--output-path` from `workflow execution get`. Pipe `--json` through real `jq` instead.

  Rationale: our `--jq` was dotted-path only (`drillJsonPath`), not real jq syntax. Calling it `--jq` was misleading — `gh --jq '.foo[] | select(.bar)'` works; ours never could. Real `jq` is universally installed on dev machines and supports the full filter language.

  Migration:

  | Before                                                                          | After                                                                               |
  | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
  | `eigenpal workflow execution get exec_… --jq 'output.data'`                     | `eigenpal workflow execution get exec_… --json \| jq '.output.data'`                |
  | `eigenpal workflow execution get exec_… --output-path 'stepExecutions.0.error'` | `eigenpal workflow execution get exec_… --json \| jq -r '.stepExecutions[0].error'` |

  Updated SKILL.md and reference docs to use the canonical `--json | jq` pattern.

- c330c2a: CLI: small DX bundle + 5 audit follow-up fixes.
  - `eigenpal status` (and every other CLI call) now detects HTML-on-the-wire and throws a structured `HtmlResponseError` ("API not reachable at <url> — got HTML response (likely wrong base URL or API not running)") instead of dumping the 100 KB Next.js 404 body.
  - `workflow push --bump <patch|minor|major>` reads the server's current version and computes the next semver, splicing it into the YAML before sending. Pair with `--workflow-id`. Conflicts with a top-level `version:` in the YAML are rejected.
  - `workflow push --set-version <X.Y.Z>` for explicit overrides. (Named `--set-version` to avoid the global `-v, --version` flag.)
  - `workflow evaluator-type {list, get}` — parallel namespace to `step-type` for evaluator schemas (`exact-diff`, `llm-judge`, `custom-script`). Returns JSON Schema instead of 404.
  - `eigenpal init [name]` now works with no name — scaffolds into the current directory using the cwd basename as the workflow slug. Pair with `eigenpal workflow execution run <slug>` in the same dir; `execution run` discovers both flat (`./workflow.yaml` + `./dataset/examples/<name>/`) and nested (`./eigenpal/workflows/<slug>/...`) layouts.
  - `format-error` now appends `Run \`eigenpal auth login\` or set EIGENPAL_API_KEY.`to every 401, and includes the URL we tried +`EIGENPAL_BASE_URL`/`--base-url` hint on connection failures.
  - `execution get --jq <jsonpath>` is the new canonical name for what was `--output-path`. `--output-path` keeps working as a hidden alias; help text shows `--jq` only (matches `gh --jq` / `kubectl --jsonpath`).
  - `workflow push` without `--file` in TTY now prompts for the path; non-TTY (CI) still errors with the existing "Missing --file" message.
  - `transform.script` reference docs include a callout about TDZ on shadowed input names (`const located = located || []` triggers `ReferenceError`).
  - Dropped the half-promise comment in `addJsonFlag` about future `--fields` projection — the canonical answer is `jq` on the raw payload.

- c330c2a: CLI: execution + auth polish.
  - **`workflow execution run`** gains `--wait` and `--json`. The local-folder
    runner already polled every example to terminal, so `--wait` is currently a
    no-op accepted for symmetry with `experiment run --wait`. `--json` emits a
    single `{ workflowSlug, passed, failed, total }` summary on stdout (human
    progress lines + the "Results:" footer still go to stderr). Exits 1 when any
    example fails, same as before.
  - **`workflow execution watch`**: rename `--max-minutes <n>` → `--max-wait
<seconds>` (default 1800 = 30 min). Matches the units used by
    `experiment status --watch --max-wait`. Detach behavior unchanged: still
    exits 2 on timeout so callers distinguish "still running" from "completed".
  - **`workflow execution run`** + **`auth login`** now ship inline `Examples:`
    blocks via `addHelpText('after')`. Mirrors `gh repo create --help` style.

- d41ee8b: CLI: `workflow execution cancel <executionId>` — request cancellation of a
  running, queued, or just-created execution.

  Idempotent against the `POST /api/v1/executions/:executionId/cancel`
  endpoint. created/pending transitions straight to `cancelled`;
  running/waiting stamps `cancellationRequestedAt` for the worker to observe;
  already-terminal (completed / failed / cancelled) is a no-op exit-0 with an
  info line.

  Single-row destructive op — TTY proceeds silently (matches `gh run cancel`),
  non-TTY shells (CI, pipes) require `--yes`. Pass `--json` to print the raw
  server payload for scripting; 404 → error line + exit 1.

- d41ee8b: CLI: `workflow experiment compare <batchIdA> <batchIdB>`.

  Side-by-side eval-score diff between two experiment batches — no more exporting both result sets to a spreadsheet to spot regressions.

  ```
  eigenpal workflow experiment compare evb_old evb_new --workflow-id wf_abc
  ```

  One row per `(example, evaluator)` pair shared by both batches with `A`, `B`, and `Δ` columns. Regressions (Δ below threshold) are flagged with ⚠ and tinted; improvements show in green. Footer aggregates `regressions / improvements / mean Δ / examples shared / only-in-{A,B}` so you can tell at a glance whether the new batch is a net win.
  - `--sort delta-asc | delta-desc | name` — default is `|Δ|` descending so the biggest movers (in either direction) surface at the top.
  - `--regression-threshold <n>` — default `0.05`. Tighten to `0.10` if your evaluators are noisy.
  - `--json` — emits the full diff structure (`{ batchA, batchB, rows, summary }`) for piping into `jq`.
  - `--workflow-id <id>` — required; eval-results is workflow-scoped.

  Non-overlapping examples are listed in dedicated `only in A` / `only in B` blocks before the table so |Δ| sort stays meaningful.

- 9dc84b9: CLI: agent-friendly experiment polling, watching, and comparison.

  Four small additions so agents (and humans writing monitoring scripts) do not have to roll their own bash pollers, JSON parsers, or aggregators on top of `experiment status`.
  - **`experiment status --json` now includes a top-level `summary` rollup** — `{ total, terminal, complete, completedCount, failedCount, cancelledCount, rejectedCount, runningCount, pendingCount }`. Polling scripts can read `.summary.complete` / `.summary.failedCount` directly instead of folding `executions[].status` themselves. `executions[]` stays as-is for backwards compat.
  - **`experiment status --short`** — single-line, awk-friendly stdout summary (e.g. `6/6 done failed=0 cancelled=0 rejected=0`). Mutually exclusive with `--watch`. Drops the failure detail block + closing tip so monitoring loops stay clean.
  - **New `experiment watch <workflow-id> <batchId>`** — polls until terminal, then auto-pulls eval results to `./results-<batchId>.<format>` in one command. Replaces the old "monitor + status + pull + score" recipe. Flags: `--interval`, `--max-wait`, `--format csv|json`, `--pull-on-complete <path>` to override destination, `--no-pull` to opt out. Exit codes match `experiment status --watch` (0 clean, 1 any failure, 2 deadline).
  - **`experiment compare` adds a per-evaluator aggregate** — a "Per-evaluator deltas" table renders above the existing per-row table with rows, mean Δ, regressions, and improvements per evaluator (sorted by |meanΔ| desc). `--json` exposes it at `summary.byEvaluator[]`.

  Updated SKILL.md so the canonical "run an experiment + collect results" recipe uses `experiment watch` and adds a "monitoring scripts" section that calls out `--short` and `summary.complete`.

- 3da0612: CLI: pretty default rendering for `list`, `get`, and mutating commands; `--json` toggle for piping.
  - `workflow definition/dataset/experiment/version/step-type list` and `workflow execution list` render aligned ASCII tables. `--json` restores the legacy raw payload.
  - `workflow execution get` (no other flags) prints the vertical step list via `renderFrame` instead of dumping 1000+ lines of JSON. `--json` for the full payload; `--output-path` / `--step` / `--include` continue to print filtered JSON.
  - `workflow experiment status` (without `--watch`) prints a one-line summary plus the per-example failure block. `--json` for raw payload.
  - `workflow definition push`, `workflow evaluators push`, `workflow experiment run`, and `workflow version restore` print one-line `success(...)` summaries instead of dumping the response. `--json` recovers legacy output.

  No breaking changes: every legacy JSON shape is still available behind `--json`. Status hints route to stderr so `<command> | jq` keeps working.

- d41ee8b: **Breaking:** `workflow step exec` is now generic over step type. The two
  hardcoded subcommands (`workflow step exec transform.script` and
  `workflow step exec ai.extract`) become `workflow step exec <type>` with a
  unified flag set, mirroring the kubectl-style noun/verb pattern.
  - `<type>` accepts ANY step type registered in `STEP_SCHEMAS` (`@eigenpal/types`).
    Unknown types exit 2 with a message pointing to `workflow step-type list`;
    registered-but-unsupported types (everything except `transform.script` and
    `ai.extract` today) exit 2 with a "not yet supported locally" message instead
    of the previous "command not found" Commander error.
  - Flag set:
    - `--config-json <json>` — full step config as a JSON literal.
    - `--config-file <path|->` — full step config from JSON file or stdin.
    - `--inputs k=v` — repeatable; `v` may be `@path-to-file` (auto-JSON-parsed
      when applicable) or a literal string. For `transform.script` these merge
      into the config `inputs` map (flag wins); for `ai.extract` `input=…`
      supplies the document text.
    - `--output-schema <path>` — defaults to the step type's built-in
      `outputSchema` from `STEP_SCHEMAS` when omitted.
  - The previous per-type flags (`--code`, `--inputs-json`, `--input`,
    `--prompt`, `--schema`, `--provider`, `--model`, `--base-url`) are gone —
    pass them inside `--config-json`/`--config-file` instead. `--timeout-ms`
    and `--memory-mb` survive as `transform.script`-specific resource overrides.
  - Errors thrown by the handler now route through the same structured-envelope
    rendering used elsewhere in `workflow/*` commands (aligned `field` column +
    `hint` line for `{ issues, hint }` payloads), with a graceful fallback to
    `formatCliError` for plain errors. Schema violations and unknown-type errors
    keep their dedicated exit codes (2).

- c330c2a: CLI: workflow surface restructure — DX polish for the `workflow` namespace.

  Breaking-but-deliberate changes that mirror `gh` / `vercel` conventions:
  - **`dataset {create,update,delete}-example` → `dataset example {create,update,delete}`.** Verbs now live UNDER the `example` noun (matches `gh issue create`, `vercel project add`). No aliases — old form is removed.
  - **New `dataset example get <wfId> <exampleId>`** — single-row read with pretty `Inputs / Expected / Metadata` sections and `--json` for the full payload (`triggerInput`, `expectedOutput`, `annotation`, `rowOrder`, timestamps). Closes the gap between `dataset list` (table subset) and the previous "edit-blind" CRUD verbs.
  - **`dataset push --mode` defaults to `append`.** Was previously a required flag. Destructive `replace` keeps its `--yes` requirement for non-TTY plus typed-slug TTY confirmation.
  - **`experiment run`**: `--poll-interval-s` renamed to `--interval` (seconds), matching `experiment status --watch`'s flag. `--wait` no longer exits 1 when `passRate` is undefined (workflow with no graded examples). Now: graded + non-1.0 → exit 1; ungraded → exit 0.
  - **Mutating commands stop advertising `--verbose`.** `workflow push`, `evaluators push`, `dataset push`, `experiment run`, `versions restore`, and the new `dataset example {create,update,delete,get}` use `addJsonFlagMutation` (only `--json`). `--verbose` was a no-op on these — removing it from `--help` to stop lying.
  - **Command descriptions shortened.** First sentence stays as the description; rich behavioral notes (return types, NOTE warnings) move to `addHelpText('after')` blocks. Examples added to `workflow push`, `dataset push`, `experiment run`, and `dataset example create`.

  Skill (`SKILL.md` + `reference/dataset-format.md`) updated to use the new
  `dataset example {create,update,delete,get}` shape; recipes mention
  `example get` for single-row inspection.

- d41ee8b: CLI: `workflow step exec transform.script` and `workflow step exec ai.extract` for local single-step iteration.

  Two new commands under a fresh `workflow step exec` namespace let you run one step locally — no server, no queue, no worker — so the script/prompt edit loop is sub-second instead of sub-minute:
  - `workflow step exec transform.script --code <path|-> [--inputs k=v...] [--inputs-json <path|->] [--output-schema <path>] [--timeout-ms 5000] [--memory-mb 10]` — runs JS in QuickJS with the same TDZ + strict-mode + deep-frozen-input semantics the worker uses, so a script that crashes locally crashes the same way in production.
  - `workflow step exec ai.extract --input <path|-> --prompt <path|-> [--schema <path>] [--provider openai] [--model gpt-4o-mini] [--base-url <url>]` — one LLM call, structured output when `--schema` is provided, raw assistant text when omitted. Reads provider/model from `WORKER_LLM_*` env vars (or `OPENAI_API_KEY` for the openai default).

  Both commands write the step output as JSON to stdout. Schema validation failures exit 2 with `{ code: 'output_schema_violation', issues: [{ field, message }] }` on stderr — agent-readable so the iteration loop is autonomous.

  `@` path syntax (`--code @file.js`, `--inputs items=@arr.json`) matches `curl -d @file` / `gh --body-file -`. Bare paths and `-` (stdin) work too.

- 4137eb8: custom-script evaluator: the YAML now carries the entire
  `function scoreScript(expected, actual) { ... }` declaration in a single
  `function` field. Previous formats (`code`, then `body`) wrapped the
  text implicitly; the new shape stores the function declaration verbatim
  so the YAML matches the dashboard editor 1-for-1.

  `workflow validate` and `workflow evaluators validate` flag YAML where
  the function fails to parse, the signature does not match
  `function scoreScript(expected, actual)` exactly, or the body contains
  neither `return` nor `throw` — same checks the dashboard runs at form
  save. The function must return a number in [0, 1]; throws are caught
  and scored as 0.

  Existing evaluator YAML must be ported by hand: rename `body` (or
  `code`) to `function`, and add the `function scoreScript(expected,
actual) {... }` declaration around your statements. Parameter order is
  load-bearing — swapping `expected` and `actual` would silently invert
  every score.

- 3da0612: All list commands now support `--limit` / `--offset` pagination consistently.
  - CLI: `workflow execution list`, `workflow version list`, and `workflow step-type list` previously had no `--offset` (or no pagination at all). All six list commands now accept `--limit`/`--offset` with defaults of 50/0.
  - Server: `GET /api/workflows/:id/versions` now reads `?limit=` and `?offset=` query params (defaults 50/0; max limit 100). The `listVersions` repo method gained an optional `{ limit, offset }` argument.
  - `step-type list` paginates locally over the static catalog so the UX is uniform; `total` reflects the full filtered set so callers can see how many rows are hidden by the page window.

- 3da0612: API: list endpoints now consistently return `{ data, total }`.
  - `GET /api/workflows/:id/experiments` previously returned `{ experiments }` — now returns `{ data, total }`.
  - `GET /api/workflows/:id/versions` previously returned a bare array — now returns `{ data, total }`.

  This is a breaking change for direct API consumers. The CLI, frontend, and `listWorkflowVersions` contract are all updated. CLI's `renderListResult` helper is simpler (single envelope, no per-endpoint `dataKey` workaround).

- d41ee8b: Add workflow-agnostic eval-results export endpoint
  (`GET /api/v1/eval-results/export?batchId=...&format=csv|json`) that
  resolves the owning workflow from the batch id server-side. The CLI's
  `workflow experiment compare batchA batchB` no longer requires
  `--workflow-id` — the flag is dropped (breaking change) and both batches
  are resolved through the new endpoint instead. The legacy workflow-scoped
  route stays in place for back-compat.

  Document the CLI exit-code contract (0 = success, 1 = runtime error,
  2 = misuse / recoverable failure) in `packages/cli/CLAUDE.md`.

- 4b1f81c: `transform.script` now accepts a full function declaration via
  `with.function:`, mirroring the custom-script evaluator. Parameter
  names and order must equal `Object.keys(inputs)`:

  ```yaml
  - type: transform.script
    with:
      inputs:
        items: '{{ steps.x.output }}'
        taxRate: '{{ input.rate }}'
      function: |
        function script(items, taxRate) {
          return items.length * taxRate;
        }
  ```

  Authoring is now Monaco-backed in the dashboard, with input keys
  surfaced as typed declarations so `items.` autocompletes against the
  upstream step's output schema.

  The legacy `with.code:` shape (a bare statement body, with input keys
  leaking in as globals) still loads — the worker auto-wraps it via
  `wrapBodyAsScriptFunction` at handler entry, and the dashboard
  migrates `code:` to `function:` on the next save. New workflows
  should use `function:`. The schema rejects:
  - function names other than `script`
  - parameter lists that do not match `Object.keys(inputs)` in order
  - `async` / `import()` / `require()` (sandbox-incompatible)
  - bodies with no `return` or `throw`

- 3da0612: CLI: cleaner workflow command tree + matching `--json` shape.

  **Tree restructure** — the `workflow definition` namespace is gone. Its three verbs are core operations on the workflow itself, so they move up one level:

  | Before                         | After                                    |
  | ------------------------------ | ---------------------------------------- |
  | `workflow definition list`     | `workflow list`                          |
  | `workflow definition push`     | `workflow push`                          |
  | `workflow definition pull`     | `workflow pull`                          |
  | `workflow definition validate` | dropped (use `workflow validate [path]`) |
  | `workflow version list`        | `workflow versions list` (plural)        |
  | `workflow version restore`     | `workflow versions restore`              |

  `evaluators`, `dataset`, `experiment`, `execution`, and `step-type` keep their nested structure.

  **`--json` returns the table's columns, not the server envelope.** Previously `--json` dumped `{ data: [{...full server rows}], total }`. Now it emits an array containing exactly the fields the table renders (e.g. `[{id, name, version, updatedAt}]` for `workflow list`). `total` still goes to stderr in both modes.

  **`--verbose`** opts into full rows: `--json --verbose` emits the full server rows for the rare cases you need fields the table does not surface.

  `workflow list --json | jq '.[0].id'` — the natural shape for piping.

### Patch Changes

- 5909b21: Add execution-scoped agent feedback filters and expected artifact management to the API, CLI, and SDKs.
- c15ce88: Rename agent API calls to `/v1/agents` and scope execution helpers under their owning workflow or agent.
- 71361fd: `auth login`: simplified flow. Removed the dead localhost-callback server (the
  dashboard never POSTed to it — every login fell through to copy-paste anyway).
  The browser now opens to `/developers/api-keys?from=cli` with a clearer prompt
  ("Create a new key, copy it, paste below"), and the API key prompt **hides
  input** as you type or paste — same as `gh auth login`, `stripe login`, etc.
- d41ee8b: CLI: two cleanups for the audit follow-ups.
  - **`init agent` and bare `agent` now exit 2** instead of 0 when invoked. Both subcommands are reserved-but-unimplemented placeholders, and exiting 0 made it possible for a CI script that misrouted into one of them to silently no-op. POSIX exit 2 ("command exists but is not usable as invoked") makes the misroute fail loudly. The human-readable "coming soon" stderr message is unchanged.
  - **New `--no-color` global flag.** Disables ANSI colors in all output, matching the convention shared by `gh`, `kubectl`, `npm`, and `terraform`. Equivalent to setting `NO_COLOR=1` in the environment, but takes effect for the current invocation only. Implemented as a lazy picocolors wrapper so the flip propagates to every helper in `lib/ui.ts` (and every downstream caller of `pc`) regardless of when in the command lifecycle the flag is parsed.

- 809f3d4: `auth list`: the org name is now the primary label (bold, immediately after
  the marker), the profile slug is dimmed beside it (still the value you feed
  to `auth use <name>` or `EIGENPAL_PROFILE=<name>`), and the base URL trails
  on the right. The redundant `(tenantId)` column was dropped — the profile
  slug already disambiguates. `auth use` (interactive picker) now prints the
  non-interactive form on success so you learn the slug you picked.
- 49a8f94: Fixed a stray `undefined` in the `eigenpal auth login` outro. The success message used `dim(...)` (a stderr printer that returns `void`) inside a template literal where `ui.dim(...)` (the inline string formatter) was meant. The dim "Saved profile X — switch with" hint now renders correctly instead of literal `undefined`.
- 16c6e83: Updated `@eigenpal/cli` author from `Eigenpal <hello@eigenpal.com>` to `Jedr Blaszyk <jedr@eigenpal.com>`. Surfaces on the npm package page and in `npm view @eigenpal/cli`.
- b1d2d77: CLI: default `baseUrl` is now `https://studio.eigenpal.com` instead of `http://localhost:3000`.

  Affects only the fallback when nothing else is set — the priority chain is `--base-url > EIGENPAL_BASE_URL > active profile > default`. Users who ran `eigenpal auth login` against any environment already have a `baseUrl` in their profile and are unaffected. CI scripts that set `EIGENPAL_API_KEY` but relied on the implicit `localhost:3000` will now hit production; set `EIGENPAL_BASE_URL=http://localhost:3000` if you want the old behavior.

  Aligns with the gh / vercel / kubectl convention of falling back to the public service rather than localhost.

  Also scrubs internal references from CLI source ahead of open-sourcing — generic placeholder names in docstrings and test fixtures, internal-tracker IDs stripped from comments, and one user-facing error message updated to point at the public issue tracker.

- 75caaec: `eigenpal workflow push` and `eigenpal workflow validate` now surface non-fatal **schema-quality warnings** when an output schema is loose enough to hurt downstream typing: categorical fields like `category`/`status`/`kind` declared as plain strings (no `enum`), `transform.script` functions returning `any`/`unknown`, untyped objects (`type: object` with no `properties`), and untyped arrays (`type: array` with no `items`). Warnings print to stderr and never block the push.

  Updated the bundled CLI skill (`workflow-yaml.md`) with a "Be specific with types" section teaching `enum` fields, per-value meanings inline in `description`, and how `transform.script` TS literal unions auto-produce JSON Schema enums.

- be693a3: `EIGENPAL_API_KEY` is now a complete profile bypass — when set, the active profile's `baseUrl` is also ignored (previously the env key was paired with the profile's URL, which is always wrong because an API key is provisioned for one server).

  In CI:
  - **Cloud:** set `EIGENPAL_API_KEY=eig_live_…` and you get `https://studio.eigenpal.com`.
  - **On-prem:** set both `EIGENPAL_API_KEY=…` and `EIGENPAL_BASE_URL=https://eigenpal.example.com`.

  Interactive profiles are unchanged: when you log in via `eigenpal auth login`, the profile stores both apiKey and baseUrl, and every subsequent command derives baseUrl from that profile. Set `EIGENPAL_PROFILE=<name>` to switch profiles per-shell without modifying state.

- 542fe0e: CLI: surface evaluator entry-level fields (`name`, `description`, `weight`) so agents and humans can discover the optional `description` field on every evaluator.
  - `workflow evaluator-type get <type>` now emits `entrySchema` alongside `configSchema`. Inspect with `eigenpal workflow evaluator-type get llm-judge | jq '.entrySchema'`.
  - The skill reference now renders a "Common entry fields" table per type and a "Writing descriptions for stakeholders" section explaining the convention: each evaluator's `description` should be a one-sentence, plain-language summary aimed at non-technical reviewers in the dashboard.
  - `init` templates `pdf-extraction` and `text-classification` now ship a `description:` line on their evaluator entries.

- d41ee8b: CLI: fix `eigenpal status` error UX + harden `formatCliError` for real-world connection failures.
  - `eigenpal status` against an unreachable base URL no longer mis-diagnoses the failure as an auth problem. Previously, `EIGENPAL_BASE_URL=http://localhost:9999 eigenpal status` printed "Authentication check failed; try `eigenpal auth login`" — the wrong rabbit hole. The status command now rethrows non-auth errors (connection refused, DNS NXDOMAIN, timeout, HTML responses, 5xx) so `formatCliError` upstream can surface the right hint: `Could not connect to the server at <url> ... Set EIGENPAL_BASE_URL or pass --base-url <url>.` Only real 401/403 responses are treated as auth failures.
  - `formatCliError` now detects connection failures wrapped in any Error shape — bare `Error('ENOTFOUND ...')`, `Error` with `code: 'ECONNREFUSED'`, and `TypeError('fetch failed')` whose `.cause` carries the underlying error. Previously only `TypeError` whose message contained `fetch`/`URL` was recognized, so `getaddrinfo`-style errors fell through to the generic raw-message branch and lost the URL context.

- d41ee8b: CLI: fix `workflow experiment compare --sort` advertised values + thread base URL into error rendering.
  - `workflow experiment compare --sort` now advertises all four valid values (`abs-delta-desc`, `delta-asc`, `delta-desc`, `name`) in `--help` and in the error message you get on a typo. Previously the help/error listed three; the default `abs-delta-desc` was accepted but undocumented.
  - The `action()` decorator that wraps every `workflow ...` handler now resolves the base URL from the parsed opts and forwards it to `printApiError`. Connection failures (`fetch failed`, invalid base URL) now echo the URL the CLI tried to reach — set via `--base-url`, `EIGENPAL_BASE_URL`, the active profile, or the default — so the user can see at a glance whether they pointed at the wrong server.
  - Note: the `--jq` rename / honesty pass for `--output-path` is deferred to a follow-up to avoid a merge conflict with the in-flight `execution cancel` change.

- d41ee8b: CLI: validate `workflow experiment results --format` locally; extract `experiment compare` helpers into a sibling file.
  - `workflow experiment results --format` now rejects bad values up-front via a Commander `InvalidArgumentError` parser-fn (modeled after `intArg`). `--format yaml` previously round-tripped to the server and returned a generic HTTP 400; now the command exits 1 with `error: option '--format <csv|json>' argument 'yaml' is invalid. must be 'csv' or 'json'` before any network I/O happens.
  - Internal refactor: `experiment compare`'s pure helpers (`buildBatchDiff`, `renderBatchDiffHuman`, `normalizeCompareSort`, `formatDelta`, `fetchEvalResults`, `exampleLabelOf`, plus their types) moved out of `commands/workflow/index.ts` into a new sibling `commands/workflow/experiment-compare.ts`. The Commander registration stays in `index.ts`. Tests follow the symbols into `experiment-compare.test.ts`. No user-visible behavior change from the refactor; `index.ts` shrinks by ~310 LOC.

- 2a15fc9: Add hidden Git-backed source inspection commands for early organization repository testing.
- c82a215: Polish on `eigenpal auth login` based on DX review:
  - **Browser fallback** — the prompt's note now repeats the API-keys URL prominently, so when `xdg-open`/`open`/`start` silently fails (headless VMs, WSL without xdg-open, restricted containers) the user has a copyable URL right next to the prompt instead of a dim status line above.
  - **Outro is informative** — distinguishes "Saved profile X" (first login to this tenant) from "Updated profile X" (re-login overwrote prior creds in place) and shows the exact `eigenpal auth use X` command to switch to it later. No more raw `(profile org_xxxx)` dead-end.
  - **Path-rejection error** suggests the corrected origin: instead of "URL must be the server origin only", it now says e.g. "Try https://studio.eigenpal.com instead of '/api/v1'".
  - **Non-TTY error copy** is consistent across CI and pipe-redirect paths — both name the missing piece (interactive terminal) and the workaround (`--base-url` / env var).

- be693a3: `eigenpal auth login` no longer opens your browser as the very first thing it does. The flow now mirrors mature CLIs (`gh auth login`, `vercel login`):
  1. **Pick the server** (existing select prompt).
  2. **Explain the flow** — a clear step-by-step note tells you what is about to happen and surfaces the dashboard URL prominently so you can copy it manually if you prefer.
  3. **Confirm browser launch** — "Open the dashboard in your browser?" (default Yes). Users on headless VMs, WSL without xdg-open, or who already have the dashboard open can answer No and skip the best-effort browser launch entirely.
  4. **Paste the API key** — same as before.

  No surprise side effects, no "wait, why did a browser pop?" moment. The URL is also in the explanation note so a failed `openBrowser` does not strand you.

- c82a215: `package.json` now carries full npm metadata: `license: Apache-2.0`, `keywords`, `repository`, `bugs`, `homepage`, and `author`. The published tarball also bundles `LICENSE` and `CHANGELOG.md` so the npm page renders the license badge instead of "License: none" and surfaces real keywords for search.
- ee32a73: Three fixes around the public CLI mirror and login UX:
  1. **Public mirror keeps history.** `sync_public_cli` no longer wipes `github.com/eigenpal/cli`'s git history on every release. It now clones the existing public repo, replaces the working tree with the new synth output, and pushes one commit per release. Each release adds `release: @eigenpal/cli@X.Y.Z` on top of the previous one. Tags accumulate too.
  2. **CHANGELOG no longer starts from `0.0.0`.** The `Pin CLI version + apply pending changesets` step in `sync_public_cli` was running `bunx changeset version` _before_ pinning the source `0.0.0-placeholder` to the real release tag, so changeset wrote CHANGELOG headings like `## 0.0.1` while the actual published version was e.g. `0.4.2`. Pin first, then run changeset version, then sed-rewrite the topmost heading to match the real release tag.
  3. **Login picker copy + URL cleanup.**
     - Hint `(saved profile)` had double parens because clack auto-wraps hints in parens — was rendering as `((saved profile) from acme)`. Now `saved profile: <names>`.
     - Dropped `?from=cli` from the dashboard URL — the dashboard ignores the param, and a clean URL is easier to copy/paste/visit manually.

- c82a215: Public README cleanup:
  - Removed the duplicated `# @eigenpal/cli` heading and redundant install snippet that was being prepended to the public mirror's README. The bundled CLI README is already self-contained, so the synth header was stacking a second title on top.
  - Reordered sections so users hit "what to install + what is available" first: Install → Commands → Use it → Primitives. Primitives is the conceptual reference; it now sits below the hands-on sections instead of above them.

- ac95906: CLI: `eigenpal skill` now installs into 9 popular AI coding tools instead of 2.

  Previously the picker only listed Claude Code and Cursor. The new set covers:
  `claude`, `cursor`, `codex`, `gemini`, `antigravity`, `opencode`, `pi`,
  `windsurf`, `github-copilot`. Each tool follows the same
  `<root>/skills/eigenpal/SKILL.md` Anthropic-skill convention (paths mirror
  OpenSpec's canonical mapping) so a single skill bundle drops into whichever
  tool you already have installed.

  Detection heuristics were also broadened — each tool now matches against a
  list of sentinel files (e.g. `.claude` or `CLAUDE.md` for Claude Code; the
  several Copilot config paths for GitHub Copilot) instead of a single
  directory. The picker surfaces installed tools first, then detected, then
  the rest.

  Power-user flags are unchanged: `--target` for a custom path, `--tools` for
  a comma-separated id list, `--force` / `--yes` for non-interactive flows.

- 158d513: **Breaking change.** `eigenpal skill` is now a noun namespace with three explicit verbs: `install`, `uninstall`, `list`. The bare `eigenpal skill` invocation exits 2 with a usage error.

  Before:

  ```bash
  eigenpal skill                              # interactive picker (install + toggle-uninstall in one)
  eigenpal skill --tools claude,cursor --yes  # scripted install
  eigenpal skill --tools "" --yes             # uninstall everything
  ```

  After:

  ```bash
  eigenpal skill install                      # interactive picker (toggle-uninstall still works here)
  eigenpal skill install --tools claude,cursor --yes
  eigenpal skill uninstall claude cursor      # explicit removal
  eigenpal skill uninstall --all --yes        # wipe every install (CI / scripts)
  eigenpal skill uninstall                    # picker showing only installed tools
  eigenpal skill list                         # table of installed tools + CLI version + timestamp
  eigenpal skill list --json                  # `{ data, total }` envelope for scripting
  ```

  Mirrors `eigenpal auth login/logout/list/use` — every other CLI surface follows kind → noun → verb; `skill` was the only one-shot exception. Now uniform.

  Migration: scripts using `eigenpal skill` should switch to `eigenpal skill install`. The `--target` / `--tools` / `--force` / `--yes` flags moved to `install` unchanged.

- c330c2a: CLI skill (installed by `eigenpal skill`) updated to cover the recently-added command surface:
  - `SKILL.md` — three new recipes (local single-step iteration via `workflow step exec`, `workflow execution cancel`, `workflow experiment compare` without `--workflow-id`), an "Output convention" section (stdout=data / stderr=status / `--json`) with the 0/1/2 exit-code contract, `workflow push --bump/--set-version` mention, `workflow evaluator-type {list,get}` parallel to `step-type`.
  - New `reference/step-exec.md` — full deep-dive on `workflow step exec` (the iteration killer for agents): supported step types, `--inputs k=v` grammar, `--config-{json,file}`, `--output-schema` with the `{ code: 'output_schema_violation', issues: [...] }` envelope, resource limits, two worked examples.
  - `reference/debugging.md` — added `skipped` status + `skippedReason` + `resolvedConfig` field to the inspection section, full `execution cancel` section (cooperative; honored inside `control.foreach` / `control.parallel` / `control.block`), full `experiment compare` section, connection-vs-auth error distinction.
  - `reference/workflow-yaml.md` — `--bump` / `--set-version` push flags + `evaluator-type` introspection.
  - New `reference/cli/*.md` — autogen flag reference for every command (auth, status, init, agent, completion, skill, workflow), copied from `packages/cli/docs/` by `generate-skill-reference.ts` so agents have offline flag-level reference without `--help` round-trips. CI's `--check` mode catches drift.

  Re-run `eigenpal skill` after upgrading to install the new content.

- c82a215: Removed all `localhost:3000` references from user-visible help text and source comments. The `auth login --help` examples no longer suggest `--base-url http://localhost:3000` — local development is an internal concern, not something CLI users need to think about. Defaults still target `https://studio.eigenpal.com`; advanced users with their own deployments can still override via `--base-url` or `EIGENPAL_BASE_URL`.
- c82a215: `eigenpal --version` now prints `dev` for unpublished local builds instead of the confusing `0.0.0-placeholder`. If you ever see `dev`, the binary on your PATH is a local source build (e.g., `bun cli:install:local`), not the npm-published one — run `which -a eigenpal` to find it.

  CI publish also gained a hard check that fails the release if `dist/cli.js --version` does not match the `release_tag`, so a placeholder version can never reach users via npm.

- 71361fd: `eigenpal --version` (and `-v`) now reports the actual published package version instead of a hardcoded `0.0.1`. For local dev (`eigenpal-dev`) the placeholder value (`0.0.0-placeholder`) makes it obvious the bundle came from a workspace build, not npm.
- 71361fd: Dataset folder format made symmetric — `expected/` mirrors `input/` exactly:
  - `input/arguments.json` (scalar args) ↔ `expected/output.json` (raw data ground truth, **no envelope wrapper**)
  - `input/<argName>/<file>` (input file binary) ↔ `expected/<docKey>/<file>` (expected file output binary)

  `expected/output.json` is now the raw user JSON, mirroring the workflow's `output:` shape 1:1. Drop the `{ data, expectedDocuments }` envelope requirement at the dataset boundary; the server still stores the envelope shape internally but the translation happens at import/export time, matching input file uploads. This is a pre-launch breaking change to the dataset folder layout — re-export your datasets to pick up the cleaner shape.

  Server import walks `expected/<docKey>/` folders, uploads binaries via the workflow eval expected storage template, builds the `expectedDocuments` map server-side. Server export reverses: writes `expectedOutput.data` as raw `output.json`, emits each `expectedDocuments[docKey]` entry as a binary under `expected/<docKey>/<filename>`. Round-trip clean.

  CLI `validate dataset` accepts any JSON object as `output.json` (drops the envelope check), and validates `expected/<docKey>/` folder names match the same `[a-z0-9][a-z0-9-_]*` pattern as input arg folders. `reference/dataset-format.md` documents the new symmetric layout with a worked example.

- c330c2a: DX review — close 8 sharp edges that surfaced during long debugging loops:
  - `execution get --output-path` no longer prints the literal string `"undefined"` and exits 0 on a missed path. Now exits 2 with a structured error listing the top-level keys + step names actually present. (#3)
  - `workflow set-dataset --file <folder>` now works directly — the CLI zips the folder in memory before upload (matches the skill's recipes which always said `--file ./dataset/`). Pre-zipped archives still work. (#5)
  - Skill recipes (`SKILL.md`, `reference/dataset-format.md`) no longer reference unregistered commands (`workflow create-example/update-example/delete-example`). Replaced with the working `set-dataset --mode replace` recipe; per-example CRUD will land later. (#6)
  - `requireApiKey` now renders through the `lib/ui.ts` envelope (red `✗` icon, dimmed hint lines) instead of raw `console.error`. Matches the rest of the CLI's error visual. (#8)
  - `eigenpal exec` prints `→ <example>: <executionId>` to stderr immediately when the execute API returns. If polling or artifact-write fails, the user still has a handle to recover with `execution get <id>`. (#12)
  - `workflow get-experiment-results`, `get-eval-results`, `get-dataset` accept `--out` as optional. When omitted, the binary streams to stdout — pipe to `jq`, `> file.csv`, etc. Status line moved to stderr so stdout stays clean. (#15)
  - `auth list` shows the canonical `org_…` tenant id alongside the display name, so two profiles for the same tenantName are distinguishable. (#19)
  - `execution watch` exits 2 (timeout) on 30-min auto-detach instead of 0, so CI / agents distinguish "still running" from "completed". (#21)

  Adds `fflate` to `@eigenpal/cli` deps for the in-memory dataset folder zipping.

- 71361fd: **Breaking (pre-launch):** `expected/output.json` in dataset folders must follow the system-wide envelope `{ data?: object, expectedDocuments?: object }` — the same shape `eval_examples.expectedOutput` uses everywhere else. Put the workflow output you want to compare under `data`. Raw top-level objects (e.g. `{ header, covenants }`) are now rejected with `code: invalid_expected_output`.

  `eigenpal validate dataset` enforces this locally; the import endpoint enforces it server-side. Replaces the previous import-time auto-wrap (which silently mutated user input).

- 71361fd: `workflow get-experiment-status --watch` now prints a per-example failure summary on stderr when the batch finishes with any failed/cancelled execution: example name, top-level error (truncated), and the exact `eigenpal execution get <exec-id>` command to drill into step-by-step detail. Removes the need for the agent to grep through a 1000-line JSON dump to find which example broke and why. `reference/debugging.md` documents the discovery path.
- 71361fd: `eigenpal workflow get-experiment-status --watch` now polls until every execution in the batch reaches a terminal state (`completed` / `failed` / `cancelled`), then exits non-zero if any execution failed or was cancelled. Removes the need for agent-side polling loops that didn't notice all-terminal-already and kept ticking. Renders a one-line `N/M terminal (counts)` progress summary on stderr (in-place rewrite when stderr is a TTY), dumps the full JSON on stdout when done. `--interval <s>` and `--max-wait <s>` are configurable; defaults are 5s/30min.
- c3bc4e9: Fix Git-backed source release and status edge cases.
- 04e4018: Harden hidden Git materialization commands for package-ref installs, frozen lockfile replay, dependency materialization, and source authoring smoke flows.
- 71361fd: `install-skill`: multi-tool support via interactive multiselect.
  - Opens a `@clack/prompts` multiselect picker over supported agent tools
    (Claude Code, Cursor). Toggle on to install, toggle off to uninstall —
    one command covers both directions, so the separate `uninstall-skill`
    command is removed.
  - Picker pre-selects tools that already have an Eigenpal install or
    whose project directory exists in the cwd.
  - Non-interactive: pass `--tools <ids>` (comma-separated) to skip the
    picker; tools not listed get uninstalled. `--yes` keeps the currently
    installed set.
  - Help description and CLI grouping no longer hard-code Claude Code.

- f13cd4d: Release commits on the public CLI mirror (`github.com/eigenpal/cli`) are now authored by the **EigenPal Release Pal** GitHub App instead of an anonymous bot identity. The App has its own logo and renders as `eigenpal-release-pal[bot]` next to each commit, with the human who triggered the release shown as co-author. No user-visible CLI behavior change — the install path and tarball contents are identical.
- 71361fd: Review + simplification pass on the recent eval/dataset/error work:

  **Bug fixes** surfaced by code review:
  - `workflow get-experiment-status --watch` exited 0 when the first poll raced before the server enqueued executions (`0/0 terminal` was vacuously "done"). Now requires `total > 0` to consider the batch terminal.
  - `workflow set-dataset` exited 0 on an unrecognized terminal NDJSON phase (truncated stream or future server-side phase). Now exits 1 with a clear `Import response had unexpected terminal phase` message.
  - Dataset import silently dropped extra files when a folder under `input/<argName>/` had multiple binaries but the workflow input was declared `type: file` (single). Now rejects up front with `code: single_file_input_overpopulated` and a hint to either trim the folder or change the input to the array form.
  - Misleading import error: entries under `expected/` that didn't fit the `<docKey>/<file>` pattern got an error message saying "entry under input/..." with an `input/` example. Message now branches on the actual parent.
  - `validate dataset` could crash on broken symlinks / FIFOs. `statSync` now wrapped in try/catch with a structured "unreadable filesystem entry" issue.

  **Simplifications** (net −21 LOC after both passes):
  - Extracted a `uploadFolder` helper inside `uploadAllExampleBinaries` — the input and expected file-upload loops share a single body.
  - `set-dataset` extracted `postMultipart` and `parseNdjsonEvents` helpers.
  - Removed the unused `validateOrThrow` shim and the documentary `extractExpectedData` / `extractActualData` aliases.
  - `eval/route.ts`: extracted shared `fromBodyExample` mapper and `loadArtifact` helper.

  **Skill docs** (the agent's pain point): `reference/dataset-format.md` + `reference/workflow-yaml.md` now spell out the workflow-YAML-input → `triggerInput` shape mapping in a table — `type: file` materializes as `{fileId}` (template `{{ input.<name> }}`), `type: array, items: { type: file }` materializes as `[{fileId}, ...]` (template `{{ input.<name>[0] }}`). Removes the ambiguity that led to incorrect `[0]` indexing on single-file inputs.

- 71361fd: Polish + simplify CLI UX.
  - `install-skill`: project-level only (`./.claude/skills/eigenpal/`). The
    `--scope user|project` flag and the user-level (`~/.claude/skills/`)
    install path are removed — workflow projects are the unit of work, the
    skill belongs alongside them.
  - Switch interactive prompts to `@inquirer/prompts`: arrow-key selection
    for `init` template picker and the `install-skill` 3-way conflict
    resolver, hidden-input `password` for `auth login`, proper
    yes/no `confirm` for `uninstall-skill`.
  - Color output via `picocolors`: green checkmarks for success, red for
    errors, cyan for info hints, dim for secondary detail. Honors
    `NO_COLOR` and non-TTY stdout automatically.

- 71361fd: Add a "Common recipes" section to the bundled skill (`SKILL.md`) covering the typical end-to-end command sequences agents need: scaffolding a workflow, validating + pushing workflow YAML, validating + pushing evaluators, building + uploading a dataset (and editing examples server-side), running an experiment + collecting results, and debugging a failing execution.
- 71361fd: Generate the skill reference (step types, evaluators, workflow YAML) from the canonical Zod schemas in `@eigenpal/types` on every build, with a CI gate that blocks PRs whose schema changes do not ship the regenerated docs.
- 71361fd: Tighten error-message quality across the dataset/eval/execute pipeline so the CLI surfaces actionable feedback instead of opaque dumps.
  - `eigenpal workflow set-dataset` now decodes the import endpoint's NDJSON terminal event: `aborted` renders the structured `issues[]` with an aligned field column and exits non-zero; `done` warns loudly when `expectedSet < created` so missing `expected/output.json` files do not slip through silently. Adds smart hints for `invalid_expected_output` and `argument_name_collision` codes.
  - `POST /api/v1/execute` replaced its legacy `{ error, details }` payload with the structured envelope (`{ issues, hint, requestId, docsUrl }`) the CLI's `printApiError` already consumes.
  - `exact-diff` evaluator no longer falls back to "compare whole envelope when `.data` is missing." That fallback silently absorbed the import shape bugs we fixed; it now requires `.data` on both sides (matching the system-wide `WorkflowResult` and `ExpectedOutputSchema` contracts) so any future shape regression fails loudly.
  - Exports `printIssues` from the CLI's `validate` command so other commands reuse the same field-aligned issue formatter.

- 71361fd: Structured validation errors with introspection hints. `workflow set-definition`
  (and version creation) used to fail with an opaque `"Invalid workflow definition"`
  that left agents stuck. Now the response carries the canonical `{ issues, hint,
docsUrl, requestId }` envelope:
  - Each issue has a dotted field path (`steps.2.config.passThreshold`) and a
    human message — the agent can target the exact YAML line.
  - The hint points at `eigenpal workflow get-step-type <type>` when the failure
    is scoped to a single step type, or `eigenpal workflow list-step-types` for
    general schema browsing. Both commands read the authoritative catalog from
    `@eigenpal/types` — no docs scraping, no guessing.
  - YAML syntax errors include line/column when available.

  CLI renders the envelope with an aligned field column, the hint inline, and
  the request id for correlation. Legacy `{ error, details }` responses still
  render best-effort.
