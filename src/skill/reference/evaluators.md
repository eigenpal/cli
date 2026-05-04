# evaluators.yaml — required schema

Evaluators run after a workflow execution to grade its output. They
attach to a workflow via `workflow evaluators push` and run in batch via
`workflow experiment run`. The full Zod schema is
`EvalConfigYamlSchema` in `@eigenpal/types/src/eval/evaluator-config.ts`;
this is the agent-facing summary.

## Top-level shape

```yaml
evaluators: # array of evaluator definitions, ≥1 entry
  - name: ... # required, unique within this file, [a-z0-9][a-z0-9-_]*
    type: ... # required, one of: exact-diff | llm-judge | custom-script
    config: # required, shape depends on `type`
      passThreshold: 0.95 # 0..1, optional (default 1.0)
      ...

# OPTIONAL global config
concurrency: 4 # max examples in parallel during `experiment run` (default 1)
judge: # optional shared model defaults for llm-judge evaluators
  model: gpt-4o
  temperature: 0
```

## Evaluator types

### `exact-diff` — JSON deep-diff against `expected/output.json`

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

### `llm-judge` — LLM-as-judge scoring

```yaml
- name: covenants-recall
  type: llm-judge
  config:
    model: gpt-4o # string — the OpenAI model id
    temperature: 0 # number — for reproducibility
    passThreshold: 0.85
    prompt: |
      Score how well the actual output captures every covenant in the
      expected output, on a scale of 0..1. Penalise missing covenants;
      do not penalise over-extraction. Return JSON { score, rationale }.
```

The harness wraps your `prompt` and feeds:

- `actual` — the workflow's output
- `expected` — the example's `expected/output.json`
- `meta` — example metadata

It expects the model to return JSON with at least `score` (0..1) and
`rationale` (string). The fixed harness handles parse failures + retries.

### `custom-script` — JavaScript in the sandbox

```yaml
- name: total-with-tolerance
  type: custom-script
  config:
    passThreshold: 1.0
    code: |
      const a = actual.totalAmount ?? 0;
      const e = expected.totalAmount ?? 0;
      const score = Math.abs(a - e) <= 0.01 ? 1 : 0;
      return { score, rationale: `actual=${a}, expected=${e}` };
```

Same WASM sandbox as `transform.script` (5s wall clock, 10 MB heap, no
network). Receives `actual`, `expected`, `meta` in scope. Returns
`{ score: number, label?: string, rationale?: string }`.

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
- Set `temperature: 0`.
- Keep the prompt narrow — score one dimension per evaluator. Use
  multiple judges instead of one omnibus prompt.
- For high-stakes thresholds, run the experiment ≥3 times and average.

<!-- GENERATED:EVALUATOR_CATALOG START -->
## Evaluator types — full reference

_Generated from `EvalConfigYamlSchema` in `@eigenpal/types/src/eval/evaluator-config.ts`. Do not hand-edit between the GENERATED fences — run `bun run --cwd packages/cli generate:skill`._

### Top-level `evaluators.yaml`

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `evaluators` | array<object> | no | `[]` |  |
| `passThreshold` | number | no | `0.7` |  |

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
| `code` | string | yes |  | Sandboxed JavaScript. Receives `actual`, `expected`, `input` as variables and must return { score, label? } where score is in [0, 1]. |
| `timeoutMs` | integer | no | `5000` | Maximum wall-clock time the script can run before it's killed and the run is marked failed. |
| `memoryLimitMb` | integer | no | `10` | Maximum memory the sandbox may allocate. Increase if the script processes large arrays or strings. |
| `passThreshold` | number | no | `1` | Minimum script score this evaluator must reach for a run to pass. |
<!-- GENERATED:EVALUATOR_CATALOG END -->
