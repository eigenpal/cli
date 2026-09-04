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

### `exact-diff` — JSON deep-diff against `expected.json`

Author comparison with a per-field `rules` map. Each key is a path into the
workflow output (the `.data` object). Use `$` to target the full output.
An ancestor rule covers its whole subtree; more specific descendants override
inherited settings. `{}` selects a path with inherited platform defaults.

```yaml
- name: invoice-fields
  type: exact-diff
  config:
    rules:
      invoiceNumber: {}
      total:
        numericTolerance: 0.01
      lineItems:
        order: unordered
        items: exactly
        matchBy: sku
      lineItems[]:
        allowExtraFields: false
      lineItems[].unitPrice:
        numericTolerance: 0.01
      lineItems[].evidence:
        ignore: true
```

- `rules` — map of path → comparison settings. Only listed paths (and their
  descendants, unless a descendant adds its own rule) are scored. Omit a path
  to ignore it, or set `$: {}` to compare the entire output with defaults.
- `numericTolerance` — maximum absolute difference between expected and actual
  numeric values at this path. Use `0` for exact integers; `0.01` is typical
  for currency. When omitted, numeric comparison keeps the historical relative
  epsilon.
- `order: unordered` — on an array path, match items by value instead of
  position. Matches always use distinct item slots; whether missing expected
  items fail is controlled independently by `items`.
- `matchBy` — optional identity for unordered arrays of objects. Requires
  `order: unordered` on the same rule. Set on the array path (`lineItems`),
  not the item path (`lineItems[]`). A relative field (`sku`) or unique
  fields (`[country, sku]`) inside each item. Expected and actual objects are
  paired by exact identity first, then the paired objects are compared with
  inherited nested rules, so a matching SKU with the wrong amount reports
  `lineItems[i].amount` instead of "no matching item". Applies only at the
  array path where it is set and is not inherited. Identity type and value
  must both match: numeric `10` differs from string `'10'`; no coercion or
  numeric tolerance. With `items: at-least`, extra actual items may omit or
  duplicate identities; with `at-most`, missing expected identities are
  allowed but every actual item being checked needs a unique valid identity;
  `exactly` validates both sides. Omit `matchBy` to keep structural matching,
  which still allows legitimate duplicate objects.
- `items: at-least` — require every expected item while allowing additional
  actual items (the default). Use `at-most` to permit a subset of expected
  items but reject unexpected actual items, or `exactly` to permit neither.
- `order` is independent. Ordered arrays use positional prefix matching:
  `at-least` requires expected to match actual from index 0 (trailing actual
  extras only); `at-most` requires actual to match expected from index 0
  (trailing expected extras only); `exactly` is equal-length positional.
  `unordered` ignores positions. Set `order`, `items`, and `matchBy` on
  `lineItems`, not `lineItems[]`.
- `allowExtraFields: false` — on an object path (often `someArray[]`), reject
  object keys present in actual but absent from expected.
- `ignore: true` — remove that path and every descendant from both expected and
  actual output. This is useful for volatile evidence, citations, and timestamps
  under an otherwise selected parent. It cannot share a rule with other
  settings. An ignore-only rules map means full output minus those paths.

Path syntax: `lineItems` targets the array; `lineItems[]` targets each element;
`lineItems[].unitPrice` targets a field inside every element. Nested unordered
lists use paths such as `groups[].members` with `order: unordered` on that path.

Extract steps may attach `_grounding` metadata under output fields. Exact-diff
strips that metadata before comparison, so you do not need a rule to exclude it.

Configs authored before per-field rules used other top-level `exact-diff`
options. Those configs keep working unchanged. Do not mix legacy options with
`rules` in the same evaluator; validation rejects mixed configs.

`exact-diff` branches on the example's expected shape: success-expected
examples (`expected.json`) are diffed against the workflow's actual output, and
failure-expected examples (`expected.json` with `$error`, see
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

`promptExtension` is the only required field — it is appended to the harness
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
      type WorkflowData = {
        totalAmount: number;
      };
      type WorkflowOutput = { data: WorkflowData };
      type Expected = WorkflowOutput;
      type Actual = WorkflowOutput;

      function scoreScript(expected: WorkflowOutput, actual: WorkflowOutput): number {
        const a = actual.data.totalAmount ?? 0;
        const e = expected.data.totalAmount ?? 0;
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
`unknown` works too if you do not want a typed signature.

Both arguments are envelopes. Read workflow fields from `expected.data` and
`actual.data`; the actual envelope may also include `files`.

The signature shape is **locked**:

- Function name MUST be `scoreScript`.
- Parameters MUST be `(expected, actual)` in that order. Swapping them
  would silently invert every score.
- Body MUST `return` a number in `[0, 1]`, or `throw` (which is caught
  and scored as 0).

`workflow validate` and `workflow evaluators validate` flag YAML where
the function fails to parse, the signature does not match, or the body
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
# Returns { batchId, total }.
eigenpal workflow experiment run <workflow-id>

# Or restrict to a single example:
eigenpal workflow experiment run <workflow-id> --example-id evx_…

# Watch progress.
eigenpal workflow experiment status <workflow-id> <batch-id>

# Pull results when done.
eigenpal workflow experiment results <workflow-id> <batch-id> \
  --format csv --out results.csv
```

The signed-URL pattern means large result sets do not go through the CLI
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
| `evaluators` | array<object> | no | `[]` | Evaluator entries run after each experiment execution. |
| `passThreshold` | number | no |  | Workflow-level pass threshold for the weighted mean score. When omitted, legacy evaluator thresholds are combined for compatibility, otherwise the platform default is 0.7. |

### Evaluator entry envelope

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `name` | string | yes |  | Identifier used in eval results and the weighted-mean formula. Use a short kebab-case slug like header-exact or covenants-recall. |
| `description` | string | no |  | One-sentence explanation, in business language, of what this evaluator measures and why a stakeholder should care. Shown in the dashboard to non-technical reviewers (legal, ops, finance) who never see the YAML or judge prompt. Skip implementation detail (model names, thresholds, dot-paths); those live in `config`. |
| `weight` | number | no | `1` | Relative importance in the weighted mean. The overall score is Σ(weightᵢ × scoreᵢ) / Σweight. Set to 0 to score-only without affecting overall. |

- `type` — required discriminator: `exact-diff`, `llm-judge`, `custom-script`.
- `config` — required object whose fields are defined by the selected evaluator type below.

### `exact-diff` — JSON deep-diff against expected output

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `rules` | record<string, object> | no |  | Per-path comparison rules. Non-ignored keys select compared paths (`$` = full output); an ignore-only map means full output minus those paths. More-specific keys inherit then override parent rules. `{}` selects a path using inherited platform defaults; `{ ignore: true }` excludes it. Do not mix with legacy `paths`, `unorderedPaths`, `numericTolerance`, or `allowExtraFields`. |
| `numericTolerance` | number | no |  | Legacy global numeric tolerance (absolute). When omitted, comparison uses historical relative epsilon. Prefer `rules.<path>.numericTolerance`. Accepted only when `rules` is omitted. |
| `allowExtraFields` | boolean | no |  | Legacy global extra-field/extra-item flag. Prefer `rules.<path>.allowExtraFields` and `rules.<path>.items`. `true` normalizes to object extras allowed and array `items: at-least`; `false` normalizes to object extras rejected and array `items: exactly`. Accepted only when `rules` is omitted. |
| `passThreshold` | number | no |  | Legacy per-evaluator pass threshold. Pass/fail now uses the single workflow-level pass threshold; this is read only to preserve the run gate of configs authored before the single-threshold model. |
| `paths` | array<string> | no |  | Legacy scoped paths. Prefer selecting those paths as `rules` keys. Syntax: `header.id`, `lineItems[].total`, `lineItems[0].sku`. |
| `unorderedPaths` | array<string> | no |  | Legacy unordered array paths. Prefer `rules.<path>.order: unordered`. Name the array field itself (`subjects`, not `subjects[]`). |

#### Per-path `rules` fields

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `ignore` | `true` | no |  | Exclude this path and every descendant from comparison. Cannot be combined with other settings on the same rule. |
| `order` | `"ordered"` \| `"unordered"` | no |  | Array matching mode at this path. Independent of `items`. Set on the array path (`lineItems`), not the item path (`lineItems[]`). `unordered` matches distinct items in any order. Arrays stay ordered when omitted. Unordered matching is limited to 1000 items, 1000000 candidate pairs, and 2000000 recursive operations per comparison. |
| `items` | `"at-least"` \| `"at-most"` \| `"exactly"` | no |  | How expected and actual array items relate. Set on the array path (`lineItems`), not the item path (`lineItems[]`). Independent of `order`. Ordered arrays use positional prefix matching: `at-least` (default) requires expected to match actual from index 0 and allows trailing actual extras; `at-most` requires actual to match expected from index 0 and allows trailing expected extras; `exactly` is equal-cardinality positional comparison. Unordered arrays match distinct items in any order: `at-least` requires every expected item and allows extra actual items (including extras with missing or duplicate identities); `at-most` requires every actual item and allows missing expected items (every actual item being checked needs a valid unique identity); `exactly` is a bijection (both sides need valid unique identities). |
| `matchBy` | string \| array<string> | no |  | Identity fields for unordered arrays of objects. Requires `order: unordered` on the same rule. Set on the array path (`lineItems`), not the item path (`lineItems[]`). A relative path (`sku`) or unique paths (`[country, sku]`) inside each item. Pairs expected and actual objects by exact identity, then diffs the paired objects with inherited nested rules. Identity type and value must both match: numeric `10` differs from string `'10'`; no coercion or numeric tolerance. Omitted = structural matching. Applies only at the array path where it is set and is not inherited by descendants. Nested object fields are allowed; array indexes, commas, and wildcards are not. Empty or comma-only values are rejected; composite paths must be unique. |
| `allowExtraFields` | boolean | no |  | When false, extra actual keys at this object fail the diff. When omitted, extra keys are allowed. Applies only to objects. |
| `numericTolerance` | number | no |  | Maximum absolute difference for numeric leaves at or under this path. Omitted = inherit, then historical relative epsilon. Explicit `0` is exact. |


### `llm-judge` — LLM-as-judge scoring

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `model` | string | no |  | Which LLM grades the output. Falls back to the workspace's default LLM provider when unset. |
| `reasoningEffort` | `"none"` \| `"minimal"` \| `"low"` \| `"medium"` \| `"high"` \| `"xhigh"` \| `"max"` | no |  | Reasoning effort for models that support it. Omit to preserve the current provider default. |
| `mode` | `"continuous"` \| `"discrete"` | no | `"continuous"` | Continuous = the LLM returns a free-form score in [0, 1]. Discrete = the LLM picks one of your labels and the score is looked up from the table. |
| `labels` | record<string, number> | no |  | Allowed labels and the score each maps to. Required in discrete mode. The judge MUST return one of these labels; each score must be in [0, 1]. |
| `passThreshold` | number | no |  | Legacy per-evaluator pass threshold. Pass/fail now uses the single workflow-level pass threshold; this is read only to preserve the run gate of configs authored before the single-threshold model. |
| `promptExtension` | string | yes |  | Required. Evaluation criteria appended to the judge prompt — describe what makes a good answer for this workflow (tone, completeness, edge cases). Cannot be empty: an empty prompt yields the model inventing its own criteria. |
| `docLabel` | string | no | `"output"` | Name the judge uses to refer to the output in its prompt (e.g. 'invoice', 'extraction'). Default is 'output'. |


### `custom-script` — JavaScript in the sandbox

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `function` | string | yes |  | Full TypeScript source for optional `type` aliases plus `function scoreScript(expected, actual): number { ... }`. Receives `expected` (the example's expected-output envelope (`{ data: ... }`)) and `actual` (the workflow result envelope (`{ data: ..., files?: ... }`)), returns a number in [0, 1] (the `: number` annotation is required). The `: number` return-type annotation is required and enforced at parse time. Throws are caught and scored as 0. |
| `timeoutMs` | integer | no | `5000` | Maximum wall-clock time the script can run before it is killed and the run is marked failed. |
| `memoryLimitMb` | integer | no | `10` | Maximum memory the sandbox may allocate. Increase if the script processes large arrays or strings. |
| `passThreshold` | number | no |  | Legacy per-evaluator pass threshold. Pass/fail now uses the single workflow-level pass threshold; this is read only to preserve the run gate of configs authored before the single-threshold model. |


### Complete machine-readable `evaluators.yaml` schema

Generated from the same discriminated union used by evaluator validation; YAML keys and nesting are identical.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "evaluators": {
      "default": [],
      "description": "Evaluator entries run after each experiment execution.",
      "type": "array",
      "items": {
        "oneOf": [
          {
            "type": "object",
            "properties": {
              "name": {
                "type": "string",
                "minLength": 1,
                "maxLength": 64,
                "pattern": "^[a-z0-9-]+$",
                "description": "Identifier used in eval results and the weighted-mean formula. Use a short kebab-case slug like header-exact or covenants-recall."
              },
              "description": {
                "description": "One-sentence explanation, in business language, of what this evaluator measures and why a stakeholder should care. Shown in the dashboard to non-technical reviewers (legal, ops, finance) who never see the YAML or judge prompt. Skip implementation detail (model names, thresholds, dot-paths); those live in `config`.",
                "type": "string",
                "maxLength": 500
              },
              "weight": {
                "default": 1,
                "description": "Relative importance in the weighted mean. The overall score is Σ(weightᵢ × scoreᵢ) / Σweight. Set to 0 to score-only without affecting overall.",
                "type": "number",
                "minimum": 0
              },
              "type": {
                "type": "string",
                "const": "exact-diff",
                "description": "Deterministic structured-output comparison."
              },
              "config": {
                "default": {},
                "description": "Configuration for exact-diff.",
                "type": "object",
                "properties": {
                  "rules": {
                    "description": "Per-path comparison rules. Non-ignored keys select compared paths (`$` = full output); an ignore-only map means full output minus those paths. More-specific keys inherit then override parent rules. `{}` selects a path using inherited platform defaults; `{ ignore: true }` excludes it. Do not mix with legacy `paths`, `unorderedPaths`, `numericTolerance`, or `allowExtraFields`.",
                    "type": "object",
                    "propertyNames": {
                      "type": "string"
                    },
                    "additionalProperties": {
                      "type": "object",
                      "properties": {
                        "ignore": {
                          "description": "Exclude this path and every descendant from comparison. Cannot be combined with other settings on the same rule.",
                          "type": "boolean",
                          "const": true
                        },
                        "order": {
                          "description": "Array matching mode at this path. Independent of `items`. Set on the array path (`lineItems`), not the item path (`lineItems[]`). `unordered` matches distinct items in any order. Arrays stay ordered when omitted. Unordered matching is limited to 1000 items, 1000000 candidate pairs, and 2000000 recursive operations per comparison.",
                          "type": "string",
                          "enum": [
                            "ordered",
                            "unordered"
                          ]
                        },
                        "items": {
                          "description": "How expected and actual array items relate. Set on the array path (`lineItems`), not the item path (`lineItems[]`). Independent of `order`. Ordered arrays use positional prefix matching: `at-least` (default) requires expected to match actual from index 0 and allows trailing actual extras; `at-most` requires actual to match expected from index 0 and allows trailing expected extras; `exactly` is equal-cardinality positional comparison. Unordered arrays match distinct items in any order: `at-least` requires every expected item and allows extra actual items (including extras with missing or duplicate identities); `at-most` requires every actual item and allows missing expected items (every actual item being checked needs a valid unique identity); `exactly` is a bijection (both sides need valid unique identities).",
                          "type": "string",
                          "enum": [
                            "at-least",
                            "at-most",
                            "exactly"
                          ]
                        },
                        "matchBy": {
                          "description": "Identity fields for unordered arrays of objects. Requires `order: unordered` on the same rule. Set on the array path (`lineItems`), not the item path (`lineItems[]`). A relative path (`sku`) or unique paths (`[country, sku]`) inside each item. Pairs expected and actual objects by exact identity, then diffs the paired objects with inherited nested rules. Identity type and value must both match: numeric `10` differs from string `'10'`; no coercion or numeric tolerance. Omitted = structural matching. Applies only at the array path where it is set and is not inherited by descendants. Nested object fields are allowed; array indexes, commas, and wildcards are not. Empty or comma-only values are rejected; composite paths must be unique.",
                          "anyOf": [
                            {
                              "type": "string",
                              "minLength": 1,
                              "pattern": "^[^.[\\]\\s$,]+(?:\\.[^.[\\]\\s$,]+)*$"
                            },
                            {
                              "minItems": 1,
                              "type": "array",
                              "items": {
                                "type": "string",
                                "minLength": 1,
                                "pattern": "^[^.[\\]\\s$,]+(?:\\.[^.[\\]\\s$,]+)*$"
                              }
                            }
                          ]
                        },
                        "allowExtraFields": {
                          "description": "When false, extra actual keys at this object fail the diff. When omitted, extra keys are allowed. Applies only to objects.",
                          "type": "boolean"
                        },
                        "numericTolerance": {
                          "description": "Maximum absolute difference for numeric leaves at or under this path. Omitted = inherit, then historical relative epsilon. Explicit `0` is exact.",
                          "type": "number",
                          "minimum": 0
                        }
                      },
                      "additionalProperties": false
                    }
                  },
                  "numericTolerance": {
                    "description": "Legacy global numeric tolerance (absolute). When omitted, comparison uses historical relative epsilon. Prefer `rules.<path>.numericTolerance`. Accepted only when `rules` is omitted.",
                    "type": "number",
                    "minimum": 0
                  },
                  "allowExtraFields": {
                    "description": "Legacy global extra-field/extra-item flag. Prefer `rules.<path>.allowExtraFields` and `rules.<path>.items`. `true` normalizes to object extras allowed and array `items: at-least`; `false` normalizes to object extras rejected and array `items: exactly`. Accepted only when `rules` is omitted.",
                    "type": "boolean"
                  },
                  "passThreshold": {
                    "description": "Legacy per-evaluator pass threshold. Pass/fail now uses the single workflow-level pass threshold; this is read only to preserve the run gate of configs authored before the single-threshold model.",
                    "type": "number",
                    "minimum": 0,
                    "maximum": 1
                  },
                  "paths": {
                    "description": "Legacy scoped paths. Prefer selecting those paths as `rules` keys. Syntax: `header.id`, `lineItems[].total`, `lineItems[0].sku`.",
                    "type": "array",
                    "items": {
                      "type": "string",
                      "minLength": 1
                    }
                  },
                  "unorderedPaths": {
                    "description": "Legacy unordered array paths. Prefer `rules.<path>.order: unordered`. Name the array field itself (`subjects`, not `subjects[]`).",
                    "type": "array",
                    "items": {
                      "type": "string",
                      "minLength": 1,
                      "pattern": "^[^.[\\]\\s]+(?:(?:\\[\\])?\\.[^.[\\]\\s]+)*$"
                    }
                  }
                },
                "additionalProperties": false
              }
            },
            "required": [
              "name",
              "weight",
              "type",
              "config"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "name": {
                "type": "string",
                "minLength": 1,
                "maxLength": 64,
                "pattern": "^[a-z0-9-]+$",
                "description": "Identifier used in eval results and the weighted-mean formula. Use a short kebab-case slug like header-exact or covenants-recall."
              },
              "description": {
                "description": "One-sentence explanation, in business language, of what this evaluator measures and why a stakeholder should care. Shown in the dashboard to non-technical reviewers (legal, ops, finance) who never see the YAML or judge prompt. Skip implementation detail (model names, thresholds, dot-paths); those live in `config`.",
                "type": "string",
                "maxLength": 500
              },
              "weight": {
                "default": 1,
                "description": "Relative importance in the weighted mean. The overall score is Σ(weightᵢ × scoreᵢ) / Σweight. Set to 0 to score-only without affecting overall.",
                "type": "number",
                "minimum": 0
              },
              "type": {
                "type": "string",
                "const": "llm-judge",
                "description": "Model-graded semantic comparison."
              },
              "config": {
                "type": "object",
                "properties": {
                  "model": {
                    "description": "Which LLM grades the output. Falls back to the workspace's default LLM provider when unset.",
                    "type": "string",
                    "minLength": 1
                  },
                  "reasoningEffort": {
                    "description": "Reasoning effort for models that support it. Omit to preserve the current provider default.",
                    "type": "string",
                    "enum": [
                      "none",
                      "minimal",
                      "low",
                      "medium",
                      "high",
                      "xhigh",
                      "max"
                    ]
                  },
                  "mode": {
                    "default": "continuous",
                    "description": "Continuous = the LLM returns a free-form score in [0, 1]. Discrete = the LLM picks one of your labels and the score is looked up from the table.",
                    "type": "string",
                    "enum": [
                      "continuous",
                      "discrete"
                    ]
                  },
                  "labels": {
                    "description": "Allowed labels and the score each maps to. Required in discrete mode. The judge MUST return one of these labels; each score must be in [0, 1].",
                    "type": "object",
                    "propertyNames": {
                      "type": "string",
                      "minLength": 1
                    },
                    "additionalProperties": {
                      "type": "number",
                      "minimum": 0,
                      "maximum": 1
                    }
                  },
                  "passThreshold": {
                    "description": "Legacy per-evaluator pass threshold. Pass/fail now uses the single workflow-level pass threshold; this is read only to preserve the run gate of configs authored before the single-threshold model.",
                    "type": "number",
                    "minimum": 0,
                    "maximum": 1
                  },
                  "promptExtension": {
                    "type": "string",
                    "minLength": 10,
                    "description": "Required. Evaluation criteria appended to the judge prompt — describe what makes a good answer for this workflow (tone, completeness, edge cases). Cannot be empty: an empty prompt yields the model inventing its own criteria."
                  },
                  "docLabel": {
                    "default": "output",
                    "description": "Name the judge uses to refer to the output in its prompt (e.g. 'invoice', 'extraction'). Default is 'output'.",
                    "type": "string"
                  }
                },
                "required": [
                  "mode",
                  "promptExtension",
                  "docLabel"
                ],
                "additionalProperties": false,
                "description": "Configuration for llm-judge."
              }
            },
            "required": [
              "name",
              "weight",
              "type",
              "config"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "name": {
                "type": "string",
                "minLength": 1,
                "maxLength": 64,
                "pattern": "^[a-z0-9-]+$",
                "description": "Identifier used in eval results and the weighted-mean formula. Use a short kebab-case slug like header-exact or covenants-recall."
              },
              "description": {
                "description": "One-sentence explanation, in business language, of what this evaluator measures and why a stakeholder should care. Shown in the dashboard to non-technical reviewers (legal, ops, finance) who never see the YAML or judge prompt. Skip implementation detail (model names, thresholds, dot-paths); those live in `config`.",
                "type": "string",
                "maxLength": 500
              },
              "weight": {
                "default": 1,
                "description": "Relative importance in the weighted mean. The overall score is Σ(weightᵢ × scoreᵢ) / Σweight. Set to 0 to score-only without affecting overall.",
                "type": "number",
                "minimum": 0
              },
              "type": {
                "type": "string",
                "const": "custom-script",
                "description": "Typed deterministic scoring script."
              },
              "config": {
                "type": "object",
                "properties": {
                  "function": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 10000,
                    "description": "Full TypeScript source for optional `type` aliases plus `function scoreScript(expected, actual): number { ... }`. Receives `expected` (the example's expected-output envelope (`{ data: ... }`)) and `actual` (the workflow result envelope (`{ data: ..., files?: ... }`)), returns a number in [0, 1] (the `: number` annotation is required). The `: number` return-type annotation is required and enforced at parse time. Throws are caught and scored as 0."
                  },
                  "timeoutMs": {
                    "default": 5000,
                    "description": "Maximum wall-clock time the script can run before it is killed and the run is marked failed.",
                    "type": "integer",
                    "exclusiveMinimum": 0,
                    "maximum": 30000
                  },
                  "memoryLimitMb": {
                    "default": 10,
                    "description": "Maximum memory the sandbox may allocate. Increase if the script processes large arrays or strings.",
                    "type": "integer",
                    "exclusiveMinimum": 0,
                    "maximum": 50
                  },
                  "passThreshold": {
                    "description": "Legacy per-evaluator pass threshold. Pass/fail now uses the single workflow-level pass threshold; this is read only to preserve the run gate of configs authored before the single-threshold model.",
                    "type": "number",
                    "minimum": 0,
                    "maximum": 1
                  }
                },
                "required": [
                  "function",
                  "timeoutMs",
                  "memoryLimitMb"
                ],
                "additionalProperties": false,
                "description": "Configuration for custom-script."
              }
            },
            "required": [
              "name",
              "weight",
              "type",
              "config"
            ],
            "additionalProperties": false
          }
        ]
      }
    },
    "passThreshold": {
      "description": "Workflow-level pass threshold for the weighted mean score. When omitted, legacy evaluator thresholds are combined for compatibility, otherwise the platform default is 0.7.",
      "type": "number",
      "minimum": 0,
      "maximum": 1
    }
  },
  "required": [
    "evaluators"
  ],
  "additionalProperties": false
}
```
<!-- GENERATED:EVALUATOR_CATALOG END -->
