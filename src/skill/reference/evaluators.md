# evaluators.yaml — required schema

Evaluators run after a workflow execution to grade its output. They
attach to a workflow via `workflow evaluators push` and run in batch via
`workflow experiment run`. The full Zod schema is
`EvalConfigYamlSchema` in `@eigenpal/types/src/eval/evaluator-config.ts`;
this is the agent-facing summary.

Evaluator config does not control dashboard folder placement. Workflow
organization is managed with `workflow move --folder`;
`workflow evaluators push` leaves the workflow's folder unchanged.

## Top-level shape

```yaml
evaluators: # array of evaluator definitions, ≥1 entry
  - name: ... # required, unique within this file, [a-z0-9][a-z0-9-_]*
    description: ... # optional, ≤500 chars; one-sentence business explanation (see below)
    type: ... # required, one of: exact-diff | llm-judge | custom-script
    config: # required, shape depends on `type`
      passThreshold: 0.95 # 0..1, optional (default 1.0)
      ...

# OPTIONAL workflow-level pass threshold. A run passes when its weighted-mean
# score across evaluators clears this number. Defaults to 0.7.
passThreshold: 0.7
```

## Writing descriptions for stakeholders

Every evaluator entry takes an optional `description`. Always set it. The
dashboard surfaces this string to non-technical reviewers (legal, ops,
finance) who never see the YAML or the judge prompt. Write it for them:

- One short sentence, plain language.
- Name what the evaluator measures and why a business reader should care.
- Skip implementation detail (model names, thresholds, dot-paths). Those
  belong in `config`.
- Keep it under ~120 characters when you can; the schema caps it at 500.

```yaml
# Good. A non-technical reviewer immediately grasps the intent.
- name: covenants-recall
  description: Checks every covenant from the contract appears in the extraction.
  type: llm-judge
  config: ...

# Bad. Restates the config; teaches a stakeholder nothing.
- name: covenants-recall
  description: llm-judge with passThreshold 0.85 over the covenants array.
  type: llm-judge
  config: ...
```

## Evaluator types

### `exact-diff` — JSON deep-diff against `expected/output.json` or `expected/error.json`

```yaml
- name: invoice-fields
  type: exact-diff
  config:
    passThreshold: 1.0 # 1.0 = byte-equal; lower = allow some slack
    paths: [invoiceNumber, totalAmount] # OPTIONAL — restrict to specific dotted paths
```

- `passThreshold` — number in `[0, 1]`. The diff produces a similarity
  score; `score >= passThreshold` ⇒ `passed: true`.
- `paths` — array of dotted paths into the actual / expected outputs.
  When set, only those paths are diffed. When absent, the whole object
  is compared.

`exact-diff` branches on the example's expected shape: success-expected
examples (`expected/output.json`) are diffed against the workflow's actual
output, and failure-expected examples (`expected/error.json`, see
`reference/dataset-format.md`) are matched against the `control.fail`
envelope persisted to `executions.error`. The same evaluator handles both
paths; you do not need a separate evaluator for failure cases.

### `llm-judge` — LLM-as-judge scoring

```yaml
- name: covenants-recall
  type: llm-judge
  config:
    model: gpt-4o # OPTIONAL — falls back to the workspace default LLM provider
    mode: continuous # continuous | discrete (default: continuous)
    passThreshold: 0.85
    docLabel: extraction # what the judge calls the workflow output (default: "output")
    promptExtension: |
      Score how well the actual output captures every covenant in the
      expected output. Penalise missing covenants; do not penalise
      over-extraction. Be strict on covenants that change loan economics.

# discrete mode — the judge picks a label and the score table maps to a number
- name: tone-check
  type: llm-judge
  config:
    mode: discrete
    passThreshold: 0.7
    labels:
      excellent: 1.0
      acceptable: 0.7
      off-tone: 0.0
    promptExtension: |
      Pick the label that best matches the tone of the response.
```

`promptExtension` is the only required field — it's appended to the harness
prompt and tells the judge what "good" looks like for this workflow. The
harness handles JSON parsing, retries, and feeds the judge `actual`,
`expected`, and example metadata. In `discrete` mode the judge MUST return
one of the keys in `labels`; the harness then looks up the score.

### `custom-script` — JavaScript in the sandbox

```yaml
- name: total-with-tolerance
  type: custom-script
  config:
    passThreshold: 1.0
    function: |
      type WorkflowOutput = {
        totalAmount: number;
      };
      type Expected = WorkflowOutput;
      type Actual = WorkflowOutput;

      function scoreScript(expected: WorkflowOutput, actual: WorkflowOutput): number {
        const a = actual.totalAmount ?? 0;
        const e = expected.totalAmount ?? 0;
        return Math.abs(a - e) <= 0.01 ? 1 : 0;
      }
```

Same WASM sandbox as `transform.script` (5s wall clock, 10 MB heap, no
network). The YAML stores the **whole** typed score source (optional
`type` aliases plus `function scoreScript(expected, actual): number { ... }`)
verbatim, same text the dashboard editor shows. The `: number` return-type annotation is required and
enforced at parse time. The dashboard seeds new evaluators with a
`WorkflowOutput` type alias derived from the workflow's `output:`
declaration, plus `Expected` / `Actual` aliases for compatibility. Plain
`unknown` works too if you don't want a typed signature.

The signature shape is **locked**:

- Function name MUST be `scoreScript`.
- Parameters MUST be `(expected, actual)` in that order. Swapping them
  would silently invert every score.
- Body MUST `return` a number in `[0, 1]`, or `throw` (which is caught
  and scored as 0).

`workflow validate` and `workflow evaluators validate` flag YAML where
the function fails to parse, the signature doesn't match, or the body
contains neither `return` nor `throw` — so a hand-edited config errors
before it reaches the worker.

## Pass / fail vs score

Every evaluator emits both:

- `score` — numeric, typically `[0, 1]`
- `passed` — boolean, derived from `score >= passThreshold`

The batch pass-rate counts examples where **every** evaluator on the
workflow passed. A failing single evaluator is enough to fail the
example overall.

## Per-example overrides

Most useful for skipping steps that need external state. Example's
`meta.json`:

```json
{
  "overrides": {
    "steps": {
      "enrich_company": {
        "companyName": "Acme Corp",
        "registeredAt": "2020-01-01"
      }
    }
  }
}
```

When the workflow runs against this example, `enrich_company` is
short-circuited and the override JSON is used as the step's output.
The execution row records `overrideMode: 'skipped'` so you can audit
which steps were faked. See `dataset-format.md` for the full meta.json
schema.

## Validate before pushing

```bash
eigenpal workflow evaluators validate ./evaluators.yaml
```

Reports field-level issues:

```
✗ evaluators (./evaluators.yaml) — 1 issue
  evaluators.0.config.passThreshold  Number must be less than or equal to 1
```

## Push + run

```bash
# Push the evaluators (overwrites the workflow's existing config).
eigenpal workflow evaluators push <workflow-id> --file evaluators.yaml

# Kick off a server-side batch eval over the whole pushed dataset.
# Returns { batchId, executionIds }.
eigenpal workflow experiment run <workflow-id>

# Or restrict to a single example:
eigenpal workflow experiment run <workflow-id> --example-id evx_…

# Watch progress.
eigenpal workflow experiment status <workflow-id> --batch-id <id>

# Pull results when done.
eigenpal workflow experiment results <workflow-id> --batch-id <id> \
  --format csv --out results.csv
```

The signed-URL pattern means large result sets don't go through the CLI
process — `--out` writes the file directly from the server's storage.

## Stabilizing flaky judges

LLM-judge scores have variance. To reduce flake:

- Pin a specific model id (`gpt-4o-2024-08-06` rather than `gpt-4o`).
- Keep `promptExtension` narrow — score one dimension per evaluator. Use
  multiple judges instead of one omnibus prompt.
- Prefer `mode: discrete` with a small label set when the judgement is
  categorical (good / acceptable / bad) — it eliminates the model's
  free-form numeric drift.
- For high-stakes thresholds, run the experiment ≥3 times and average.

<!-- GENERATED:EVALUATOR_CATALOG START -->
## Evaluator types — full reference

_Generated from `EvalConfigYamlSchema` in `@eigenpal/types/src/eval/evaluator-config.ts`. Do not hand-edit between the GENERATED fences — run `bun run --cwd packages/cli generate:skill`._

### Top-level `evaluators.yaml`

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `evaluators` | array<object> | no | `[]` |  |
| `passThreshold` | number | no | `0.7` |  |

### Common entry fields (every evaluator type)

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `name` | string | yes |  | Identifier used in eval results and the weighted-mean formula. Use a short kebab-case slug like header-exact or covenants-recall. |
| `description` | string | no |  | One-sentence explanation, in business language, of what this evaluator measures and why a stakeholder should care. Shown in the dashboard to non-technical reviewers (legal, ops, finance) who never see the YAML or judge prompt. Skip implementation detail (model names, thresholds, dot-paths); those live in `config`. |
| `weight` | number | no | `1` | Relative importance in the weighted mean. The overall score is Σ(weightᵢ × scoreᵢ) / Σweight. Set to 0 to score-only without affecting overall. |

### `exact-diff` — JSON deep-diff against expected output

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `numericTolerance` | number | no | `0.000001` | Maximum absolute difference between numeric values that still counts as equal. Use 1e-6 for floats, 0 for exact integer match. |
| `allowExtraFields` | boolean | no | `true` | When on, extra fields in the actual output don't fail the diff. Off = actual must match expected exactly. |
| `passThreshold` | number | no | `1` | Minimum diff score this evaluator must reach for a run to pass. 1.0 = perfect match required. |
| `paths` | array<string> | no |  | Dot-paths to scope the diff to a subset of the expected tree. Empty = diff entire expected. Syntax: `header.id`, `lineItems[].total`, `lineItems[0].sku`. Use this when expected has noisy sections you don't want to score. |


### `llm-judge` — LLM-as-judge scoring

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `model` | string | no |  | Which LLM grades the output. Falls back to the workspace's default LLM provider when unset. |
| `mode` | `"continuous"` \| `"discrete"` | no | `"continuous"` | Continuous = the LLM returns a free-form score in [0, 1]. Discrete = the LLM picks one of your labels and the score is looked up from the table. |
| `labels` | record<string, number> | no |  | Allowed labels and the score each maps to. Required in discrete mode. The judge MUST return one of these labels; each score must be in [0, 1]. |
| `passThreshold` | number | no | `0.7` | Minimum judge score this evaluator must reach for a run to pass. |
| `promptExtension` | string | yes |  | Required. Evaluation criteria appended to the judge prompt — describe what makes a good answer for this workflow (tone, completeness, edge cases). Cannot be empty: an empty prompt yields the model inventing its own criteria. |
| `docLabel` | string | no | `"output"` | Name the judge uses to refer to the output in its prompt (e.g. 'invoice', 'extraction'). Default is 'output'. |


### `custom-script` — JavaScript in the sandbox

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `function` | string | yes |  | Full TypeScript source for optional `type` aliases plus `function scoreScript(expected, actual): number { ... }`. Receives `expected` (the example's expected output) and `actual` (the workflow's actual output), returns a number in [0, 1] (the `: number` annotation is required). The `: number` return-type annotation is required and enforced at parse time. Throws are caught and scored as 0. |
| `timeoutMs` | integer | no | `5000` | Maximum wall-clock time the script can run before it's killed and the run is marked failed. |
| `memoryLimitMb` | integer | no | `10` | Maximum memory the sandbox may allocate. Increase if the script processes large arrays or strings. |
| `passThreshold` | number | no | `1` | Minimum script score this evaluator must reach for a run to pass. |
<!-- GENERATED:EVALUATOR_CATALOG END -->
