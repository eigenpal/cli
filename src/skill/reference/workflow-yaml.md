# workflow.yaml — required schema

A workflow is a DAG of named steps with named inputs, named outputs, and
trigger metadata. The full Zod schema lives in
`@eigenpal/types/src/workflow/` and ships with the CLI — query the
authoritative shape per step type with:

```bash
eigenpal workflow step-type list         # all step types
eigenpal workflow step-type get <type>   # JSON Schema for one type's config + output
```

## Top-level required fields

```yaml
name: extract-invoices # string, lowercase kebab/snake-case, unique within tenant
version: 1.0.0 # bare semver `MAJOR.MINOR.PATCH`, no leading `v`
description: Parse a PDF and extract invoice fields. # string, optional
triggerMethods: [{ type: api }] # array, ≥1 entry with type: api | manual | email
inputs: [...] # array of input definitions (see below)
steps: [...] # array of steps, executed in topological order
output: {...} # object — the workflow's return shape
```

`name` + `version` together identify the version row. Pushing a new
version with the same `name` and a different `version` appends to history;
re-using the same `version` is rejected.

Folder placement is not part of `workflow.yaml`; it lives in the server
database. Use `workflow move <workflow-id> --folder <path>` to move a
workflow between dashboard folders. Missing folders in the path are
created automatically. Use `--folder /` for root. New workflows should stay
at the top level unless the user specifically asks to place them in a
folder.


### `triggerMethods`

Required. Each entry is an object that adds an invocation surface:

- `{ type: api }` — the workflow can be called via REST or the CLI's `run`
- `{ type: manual }` — the workflow can be started manually
- `{ type: email, whitelist?: ... }` — inbound email

If `{ type: api }` is missing, `eigenpal run workflows.<slug>` rejects with
`403` / issue code `api_trigger_disabled` — enable the API trigger in the
workflow editor or dashboard settings. Runtime gates read the
`automation_triggers` projection (synced on workflow publish).

### `inputs`

```yaml
inputs:
  - name: document # required — becomes a key on triggerInput
    type: file # one of: string | number | boolean | object | file
    file: true # required when type=file (legacy duplicate of `type: file`)
    description: PDF or image to extract from
    required: true # default true; pass false for optional inputs

  - name: language
    type: string
    description: Language hint
    default: auto
```

Per input:

- `name` — `[a-z0-9][a-z0-9-_]*`
- `type` — `string` | `number` | `boolean` | `object` | `array` | `file`
- `file: true` for binary inputs (PDF, DOCX, image). The CLI uploads,
  then references via `{{ input.<name> }}` which resolves to a
  `FilePathDescriptor` the worker reads.
- `default` — used when the input is omitted at runtime
- `description` — surfaced in the dashboard + agent tools

#### File input shape — single vs array

The materialized shape on `triggerInput` is driven by the YAML, not by
how many files the dataset uploaded. Get this wrong and the worker
sees the opposite shape:

| YAML                                       | durable `triggerInput.<name>` | Template                                |
| ------------------------------------------ | ------------------------------ | --------------------------------------- |
| `type: file`                               | `{ "$file": "input/..." }`     | `{{ input.<name> }}`                    |
| `type: array`, `items: { type: file }`     | `[{ "$file": "input/..." }]`   | `{{ input.<name>[0] }}` (or `forEach:`) |

API/SDK ingress can use `{ "$fileId": "file_..." }`, inline bytes via
`{ "$inline": { filename, mimeType, base64 } }`, or multipart file parts.
Eigenpal snapshots those into run-scoped artifacts before execution.

If you see `Invalid input ... expected object, received array` from a
step that takes a single file, the workflow input is `type: file` but
the dataset folder probably has multiple files in it (or the workflow
was on a stale version that materialized arrays unconditionally).
Trim the folder to one file, or switch the input to the array form.

### `steps`

```yaml
steps:
  - name: parse # required, unique within the workflow
    type: ai.parse # see `reference/step-types.md`; introspect with `step-type get`
    if: '{{ input.skipParse != true }}' # optional — Liquid expression; falsy skips the step
    forEach: '{{ input.documents }}' # optional — runs the step over each item; output is array
    with: # step-specific config — schema depends on `type`
      file: '{{ input.document }}'
      parser: auto

  - name: extract
    type: ai.extract
    with:
      input: '{{ steps.parse.output.text }}'
      schema:
        type: object
        properties:
          invoiceNumber: { type: string }
          totalAmount: { type: number }
        required: [invoiceNumber]
```

Step references resolve via Liquid template expressions:

- `{{ input.<name> }}` — workflow input
- `{{ steps.<step-name>.output.<field> }}` — prior step output
- `{{ item.<field> }}` — current item inside `forEach`

`steps[].name` is the only handle into the step from later steps. Use
short, descriptive names (`parse`, `extract`, `score`).

<!-- GENERATED:RETRY_REFERENCE START -->
## Durable retry policies

_Policy syntax is generated from `WorkflowRetryPolicySchema` and `StepRetryPolicySchema`; step capability notes are generated from `STEP_RETRY_CAPABILITIES` in `@eigenpal/types`._

- Workflow policy values: `automatic`, `never` or an object with `mode` and `maxAttempts`.
- Step policy values: `inherit`, `automatic`, `never`. `automatic` supports object form with `mode` and `maxAttempts`; `never` supports `{ mode: 'never' }`; `inherit` is string-only.
- The schema accepts `maxAttempts` from 1 through 10. Studio offers 2-3 total attempts, and the current worker ceiling is 3.
- `maxAttempts` includes the first attempt. If no policy is set, durable retries are off.

```yaml
settings:
  retry:
    mode: automatic
    maxAttempts: 3

steps:
  - name: fetch-catalog
    type: action.http
    retry: inherit
    with:
      method: GET
      url: 'https://api.example.com/catalog'

  - name: read-product-page
    type: action.website-reader
    retry: never
    with:
      url: '{{ input.url }}'
```

`automatic` retries transient timeouts, rate limits, and selected retryable server failures. Delays use bounded exponential backoff, honor `Retry-After`, and stop after a five-minute elapsed budget.

Durable leaf retries are supported for Website Reader and HTTP `GET`/`HEAD`. Unsafe HTTP methods, Invoke Workflow, AI steps (which may have separate provider request retries), and transforms or file outputs are not durably replayed. Control containers are not attempts themselves; eligible leaves inside sequential If, Switch, and For Each scopes may retry, while concurrent Parallel and Parallel Map branches do not. See each generated step entry for its capability.

Legacy whole-run retry counts are accepted for compatibility but no longer restart failed runs. Move retry intent to the workflow retry default or an eligible step.
<!-- GENERATED:RETRY_REFERENCE END -->

### `output`

```yaml
output:
  invoiceNumber: '{{ steps.extract.output.invoiceNumber }}'
  totalAmount: '{{ steps.extract.output.totalAmount }}'
  confidence: '{{ steps.score.output.confidence | default: 0 }}'
```

Whatever shape you write here is the workflow's return value. Reference
any step's output. Static keys are fine — only the values are templated.

## Step types — pick the right one

See `reference/step-types.md` for the full catalog. Categories:

- `action.*` — side-effectful operations (HTTP, email, connectors)
- `ai.*` — model-backed processing (parse, extract, classify, judge)
- `transform.*` — deterministic data transforms (script, template, merge)
- `control.*` — flow control (if, for-each, parallel-map, fail)

When in doubt, use `eigenpal workflow step-type get <type>` — it returns
the exact JSON Schema for the step's `config` + `output` so you know
which fields are required and what values they accept.

## Liquid vs `transform.script`

Use Liquid `{{ ... }}` for one-liners:

| Use case      | Use                              |
| ------------- | -------------------------------- |
| Field access  | `{{ steps.x.output.field }}`     |
| Default value | `{{ value \| default: 0 }}`      |
| Simple math   | `{{ price \| times: quantity }}` |

Anything more complex (array reduce/filter, multi-step calc, date
arithmetic, regex) goes in `transform.script`. The function is
TypeScript; the return-type annotation IS this step's output schema
(there is no separate `outputSchema:` field):

```yaml
- name: total
  type: transform.script
  with:
    inputs: # explicit data deps — visible to the validator
      lineItems: '{{ steps.extract.output.lineItems }}'
      taxRate: '{{ input.taxRate }}'
    function: |
      function script(
        lineItems: { price: number; qty: number }[],
        taxRate: number,
      ): { subtotal: number; tax: number; total: number } {
        const subtotal = lineItems.reduce((s, i) => s + i.price * i.qty, 0);
        const tax = subtotal * taxRate;
        return { subtotal, tax, total: subtotal + tax };
      }
```

The `): { subtotal: number; tax: number; total: number }` annotation is
required and IS this step's output schema. Downstream steps autocomplete
against it and reference its fields via `{{ steps.<this>.output.<field> }}`,
and the worker validates the actual return value against it. Describe what
the function really returns: a too-loose annotation like `unknown` produces
an empty schema, which makes downstream `output.<field>` references
unresolvable and trips "field not found" warnings.

The script runs in a WASM sandbox: 5s wall clock, 10 MB heap, no network,
no filesystem. Trips show up as `script_timeout` / `script_memory_limit`
on the step execution.

## Be specific with types

Every output schema you write is read three times: by the LLM (for
`ai.extract`), by downstream steps (autocomplete + template resolution),
and by the runtime validator. **The more specific the type, the better
the workflow runs.**

### Use `enum` for coded values

Categorical fields like `category`, `status`, `kind`, `severity`,
`monitoring`, `frequency` should be enums whenever the value set is
closed. The LLM is constrained to emit only allowed values, and
downstream `transform.script` steps know exactly what they'll see.

```yaml
- name: classify
  type: ai.extract
  with:
    input: '{{ input.text }}'
    schema:
      type: object
      properties:
        category:
          type: string
          enum: ['901', '902']
          description: |
            Covenant category.
            901 = Odkladacie podmienky (conditions precedent).
            902 = Následné podmienky (subsequent / ongoing covenants).
      required: [category]
```

Per-value meanings go inline in the field's `description`. The LLM picks
them up reliably from there, and the scope browser renders the allowed
values when downstream steps reference the field.

### `transform.script` — TS literal unions become JSON Schema enums

A TS literal-union return type compiles to a JSON-Schema enum
automatically. Use it when the function returns a value from a closed set:

```yaml
- name: severity
  type: transform.script
  with:
    inputs:
      score: '{{ steps.score.output.value }}'
    function: |
      function script(score: number): { level: 'low' | 'medium' | 'high' } {
        return { level: score > 0.8 ? 'high' : score > 0.4 ? 'medium' : 'low' };
      }
```

Downstream steps autocomplete `low | medium | high` for `level`.

### `eigenpal workflow push` warns on weak types

Push surfaces non-fatal **schema-quality warnings** when it sees patterns
that hurt downstream typing. Common ones:

| Warning code                 | What it means                                                                                |
| ---------------------------- | -------------------------------------------------------------------------------------------- |
| `categorical-missing-enum`   | A field named like `category` / `status` / `kind` is a plain `string`. Consider declaring an `enum`. |
| `weak-script-return`         | A `transform.script` returns `any` or `unknown`. Replace with a concrete shape or a literal union. |
| `untyped-object`             | A `type: object` field has no `properties`. The LLM has no guidance on what to emit.         |
| `untyped-array-items`        | A `type: array` field has no `items:` declared.                                              |
| `unknown-step-reference`     | A Liquid expression references a step that is not in scope, often because it is inside a control container. |

Warnings do not block the push. They print to stderr as `! …` lines. Run
`eigenpal workflow validate` locally to surface them before pushing.

## Common patterns

### Conditional branches

```yaml
- name: classify
  type: ai.extract
  with:
    input: '{{ input.text }}'
    schema:
      type: object
      properties:
        kind: { type: string, enum: [invoice, contract, other] }

- name: extract-invoice
  type: ai.extract
  if: '{{ steps.classify.output.kind == "invoice" }}'
  with: { ... }

- name: extract-contract
  type: ai.extract
  if: '{{ steps.classify.output.kind == "contract" }}'
  with: { ... }
```

### Map over an array input

```yaml
- name: extract-each
  type: ai.extract
  forEach: '{{ input.documents }}'
  with:
    input: '{{ item.text }}'
    schema: { ... }
# steps.extract-each.output is an array of {invoiceNumber, totalAmount, ...}
```

### Parallel fan-out

```yaml
- name: extract-fields
  type: control.parallel-map
  forEach: '{{ input.fieldNames }}'
  with:
    steps:
      - name: extract-one
        type: ai.extract
        with:
          input: '{{ input.document }}'
          schema: { type: object, properties: { value: { type: string } } }
```

### Split a long doc into named sections, then extract each

For documents that bundle multiple sub-documents (e.g. a contract pack with
several annexes), use `ai.split` to find section boundaries with an LLM,
then `control.parallel_map` to run section-specific `ai.extract`. The
splitter operates on parsed pages, so DOCX / RTF / scans all reduce to the
same per-page representation.

Description-writing tips (mirrors Reducto's guidance):

- Use the document's own terminology — a Slovak contract calls it `Príloha`,
  not "annex". List the multilingual variants you have seen.
- Mention stable visual cues if any — a centered title-page header, a
  signature line, the start of a specific table.
- Be specific. "The collateral schedule table at the start of Príloha 2"
  beats "annex".

```yaml
- name: parse
  type: ai.parse
  with:
    input: '{{ input.document }}'

- name: split
  type: ai.split
  with:
    input: '{{ steps.parse.output }}'
    sections:
      - name: intro
        description: >-
          The introductory cover/preamble of the loan pack — borrower details,
          loan purpose, signature block. Always before any "Príloha".
      - name: priloha_2
        description: >-
          "Príloha č. 2 / Anlage 2 / Załącznik nr 2" — the collateral
          schedule. Starts with a section header on its own page; contains
          a table of pledged assets.
        required: true                  # warn if not found
        endHints:                       # LLM-judged end cues — phrases the model treats semantically
          - "PRÍLOHA Č. 3"
          - "ANLAGE 3"
      - name: priloha_3
        description: >-
          "Príloha č. 3 / Anlage 3" — the repayment schedule. Tabular
          amortization plan with monthly rows.
    rules: |
      End-of-section markers like *Koniec prílohy 2* close the current section.
      Repeated headers/footers are continuation, not new sections.

- name: extract-each-section
  type: control.parallel_map
  items: '{{ steps.split.output.splits }}'
  as: section
  steps:
    - name: extract-section-fields
      type: ai.extract
      with:
        input: '{{ section.text }}'
        schema:
          type: object
          properties:
            section_name: { type: string }
            key_facts: { type: array, items: { type: string } }
```

Each `splits[i]` carries `{ name, page_range, confidence, notes, evidence,
end_evidence, text, pages, pages_anchored, pages_inferred }`.

- `confidence` is `'low' | 'medium' | 'high'` — coarse enum, not a 0..1
  number. LLMs cluster numeric scores meaninglessly; the enum is reliable.
- `evidence.start_heading_text` is the verbatim heading the LLM cited (parse
  this instead of regexing over `notes`).
- `end_evidence` is set when the LLM detected a section close (matched
  against the section's `endHints` or an explicit closing marker like
  `*Koniec prílohy*`). Carries `{ end_page, confidence, notes }`. Absent
  when continuity-fill alone closed the section. Pair `evidence.notes` +
  `end_evidence.notes` for a reconciliation pass that judges whether the
  section is correctly bounded.
- `pages[i].source` is `'anchored'` (direct LLM evidence) or `'inferred'`
  (filled by continuity) — use it to deprioritize inferred content.

Pages that match no section are silently dropped (Reducto-style); add an
explicit "everything else" section if you need a catch-all.

Per-section knobs:

- `required: true` — log a warn if missing and lean the LLM toward expecting
  it. Default: false.
- `endHints: [string]` — natural-language cues the LLM uses to find the
  section's END. Treated semantically (casing variants, missing diacritics,
  multilingual phrasings all qualify) — this is NOT a regex match. The LLM
  emits a structured `end_anchor`; deterministic merge applies it. Replaces
  the older `endAnchors` line-prefix matcher.

`extract-each-section.output` is `{ items, count, totalIterations }`, not a
flat array — `items[i]` holds the per-iteration result keyed by the last
inner step's name (here `{ "extract-section-fields": {...} }`).

## Validate before pushing

```bash
eigenpal workflow validate ./workflow.yaml
```

Reports field-level issues:

```
✗ workflow (./workflow.yaml) — 2 issues
  steps.2.config.passThreshold  Required
  steps.2.type                  Invalid step type: 'eval.llm-judg'
```

Push:

```bash
# Create a new workflow (version comes from the YAML's top-level `version:` field)
eigenpal workflow push --file workflow.yaml

# Update an existing one — three ways to set the new version:
eigenpal workflow push --file workflow.yaml --workflow-id wf_…                       # bump in YAML's `version:`
eigenpal workflow push --file workflow.yaml --workflow-id wf_… --set-version 2.0.0   # explicit semver
eigenpal workflow push --file workflow.yaml --workflow-id wf_… --bump patch          # auto-bump (patch | minor | major)
```

`--bump` requires `--workflow-id` (it bumps from the current server
version). `--set-version` works with or without `--workflow-id`. The
YAML's top-level `version:` field is the fallback when neither flag is
passed — server rejects pushes whose version does not strictly increase.

## Discover step + evaluator types

Do not memorize fields — introspect:

```bash
eigenpal workflow step-type      list                 # full step catalog
eigenpal workflow step-type      get <type>           # config + output schema for one step type
eigenpal workflow evaluator-type list                 # full evaluator catalog
eigenpal workflow evaluator-type get <type>           # config schema for one evaluator type
```

Both catalogs are generated from the canonical Zod schemas in
`@eigenpal/types`, so they are always in sync with what the deployment
supports.

<!-- GENERATED:WORKFLOW_REFERENCE START -->
## Top-level fields — full reference

_Generated from `WorkflowDefinitionSchema` in `@eigenpal/types/src/workflow/workflow.ts`. Do not hand-edit between the GENERATED fences — run `bun run --cwd packages/cli generate:skill`._

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `name` | string | yes |  | URL-safe workflow slug: 1-64 lowercase letters, digits, underscores, or hyphens; must start with a letter or digit. |
| `version` | string | no | `"1.0.0"` | Author-provided semantic version label stored with the definition. |
| `description` | string | no |  | Human-readable purpose of the workflow. |
| `enabled` | boolean | no | `true` | Whether the workflow may be run. |
| `triggerMethods` | array<object> | no | `[{"type":"manual"}]` | Ways this workflow can be invoked: manual, api, or email. |
| `inputs` | array<object> | no |  | Top-level inputs available under `input` in template expressions. |
| `steps` | array<unknown> | yes |  | Ordered workflow steps; names must be unique. |
| `output` | record<string, string> \| string | no |  | Final output as named field-to-template mappings or one passthrough template expression. |
| `settings` | object | no |  | Workflow-wide timeout and retry defaults. |
| `defaultModel` | string | no |  | Default configured LLM provider id used by AI steps when the step does not select one. |


## Per-input fields

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `name` | string | yes |  | Top-level input name used as `input.<name>` in template expressions. |
| `type` | string | yes |  | One of string, enum, number, integer, boolean, array, object, or file. |
| `description` | string | no |  | Human-readable input meaning shown to callers. |
| `required` | boolean | no | `true` | Whether callers must provide this input. |
| `default` | unknown | no |  | Value used when an optional input is omitted. |
| `values` | array<string> | no |  | Closed set of allowed strings when type is enum. |
| `items` | object | no |  | Element definition when type is array. |
| `properties` | array<unknown> | no |  | Recursive field definitions when type is object. |
| `source` | string | no |  | Registered external file resolver for single-tenant string-id file inputs, for example gpfs; valid only with type file. |
| `mimeType` | string | no |  | MIME hint such as application/pdf for a sourced file; mutually exclusive with extension. |
| `extension` | string | no |  | Extension hint such as pdf for a sourced file; mutually exclusive with mimeType. |


## Nested input property fields

Object inputs and object array items use this recursive shape. File inputs are top-level only.

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `name` | string | yes |  | JSON object key, addressable in templates with dot notation. |
| `type` | string | yes |  | One of string, enum, number, integer, boolean, array, or object. |
| `description` | string | no |  | Human-readable field meaning. |
| `required` | boolean | no |  | Whether this property must be present; defaults to true when omitted. |
| `values` | array<string> | no |  | Allowed strings when type is enum. |
| `items` | object | no |  | Element definition when type is array. |
| `properties` | array<unknown> | no |  | Recursive fields when type is object. |


## Trigger method variants

### `manual`

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `type` | `"manual"` | yes |  | Dashboard/manual run trigger. |
| `enabled` | boolean | no |  | Set false to disable dashboard runs; manual triggering is enabled by default. |
| `inputSchema` | record<string, unknown> | no |  | Optional JSON Schema for trigger input. |


### `api`

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `type` | `"api"` | yes |  | Public API run trigger. |
| `inputSchema` | record<string, unknown> | no |  | Optional JSON Schema for API input. |


### `email`

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `type` | `"email"` | yes |  | Inbound email trigger. |
| `whitelist` | object | no |  | Optional sender allowlist by exact email address or domain. |


## Workflow settings

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `timeout` | number | no |  | Default step timeout in milliseconds. |
| `retry` | `"automatic"` \| `"never"` \| object | no |  | Default durable retry policy for steps. |
| `retries` | integer | no |  |  |
| `retryDelay` | number | no |  |  |


## Complete machine-readable workflow schema

This JSON Schema is generated from the same Zod schema used to parse workflow YAML. YAML keys and nesting are identical.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "minLength": 1,
      "maxLength": 64,
      "pattern": "^[a-z0-9][a-z0-9_-]*$",
      "description": "URL-safe workflow slug: 1-64 lowercase letters, digits, underscores, or hyphens; must start with a letter or digit."
    },
    "kind": {
      "description": "Deprecated compatibility discriminator; omit for new workflows.",
      "default": "workflow",
      "type": "string",
      "enum": [
        "workflow"
      ]
    },
    "version": {
      "default": "1.0.0",
      "description": "Author-provided semantic version label stored with the definition.",
      "type": "string"
    },
    "description": {
      "description": "Human-readable purpose of the workflow.",
      "type": "string"
    },
    "enabled": {
      "default": true,
      "description": "Whether the workflow may be run.",
      "type": "boolean"
    },
    "triggerMethods": {
      "default": [
        {
          "type": "manual"
        }
      ],
      "description": "Ways this workflow can be invoked: manual, api, or email.",
      "type": "array",
      "items": {
        "oneOf": [
          {
            "type": "object",
            "properties": {
              "type": {
                "type": "string",
                "const": "manual",
                "description": "Dashboard/manual run trigger."
              },
              "enabled": {
                "description": "Set false to disable dashboard runs; manual triggering is enabled by default.",
                "type": "boolean"
              },
              "inputSchema": {
                "description": "Optional JSON Schema for trigger input.",
                "type": "object",
                "propertyNames": {
                  "type": "string"
                },
                "additionalProperties": {}
              }
            },
            "required": [
              "type"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "type": {
                "type": "string",
                "const": "api",
                "description": "Public API run trigger."
              },
              "inputSchema": {
                "description": "Optional JSON Schema for API input.",
                "type": "object",
                "propertyNames": {
                  "type": "string"
                },
                "additionalProperties": {}
              }
            },
            "required": [
              "type"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "type": {
                "type": "string",
                "const": "email",
                "description": "Inbound email trigger."
              },
              "whitelist": {
                "description": "Optional sender allowlist by exact email address or domain.",
                "type": "object",
                "properties": {
                  "domains": {
                    "description": "Allowed sender domains.",
                    "type": "array",
                    "items": {
                      "type": "string"
                    }
                  },
                  "emails": {
                    "description": "Allowed exact sender email addresses.",
                    "type": "array",
                    "items": {
                      "type": "string"
                    }
                  }
                },
                "additionalProperties": false
              }
            },
            "required": [
              "type"
            ],
            "additionalProperties": false
          }
        ]
      }
    },
    "inputs": {
      "description": "Top-level inputs available under `input` in template expressions.",
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "minLength": 1,
            "description": "Top-level input name used as `input.<name>` in template expressions."
          },
          "type": {
            "type": "string",
            "description": "One of string, enum, number, integer, boolean, array, object, or file."
          },
          "description": {
            "description": "Human-readable input meaning shown to callers.",
            "type": "string"
          },
          "required": {
            "default": true,
            "description": "Whether callers must provide this input.",
            "type": "boolean"
          },
          "default": {
            "description": "Value used when an optional input is omitted."
          },
          "values": {
            "description": "Closed set of allowed strings when type is enum.",
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "items": {
            "description": "Element definition when type is array.",
            "type": "object",
            "properties": {
              "type": {
                "type": "string",
                "description": "Array element type: string, enum, number, integer, boolean, object, or file."
              },
              "values": {
                "description": "Closed set of allowed strings when items.type is enum.",
                "type": "array",
                "items": {
                  "type": "string"
                }
              },
              "properties": {
                "description": "Recursive fields when items.type is object.",
                "type": "array",
                "items": {
                  "$ref": "#/definitions/__schema0"
                }
              }
            },
            "required": [
              "type"
            ],
            "additionalProperties": false
          },
          "properties": {
            "description": "Recursive field definitions when type is object.",
            "type": "array",
            "items": {
              "$ref": "#/definitions/__schema0"
            }
          },
          "source": {
            "description": "Registered external file resolver for single-tenant string-id file inputs, for example gpfs; valid only with type file.",
            "type": "string",
            "minLength": 1
          },
          "mimeType": {
            "description": "MIME hint such as application/pdf for a sourced file; mutually exclusive with extension.",
            "type": "string",
            "minLength": 1
          },
          "extension": {
            "description": "Extension hint such as pdf for a sourced file; mutually exclusive with mimeType.",
            "type": "string",
            "minLength": 1
          }
        },
        "required": [
          "name",
          "type",
          "required"
        ],
        "additionalProperties": false
      }
    },
    "steps": {
      "type": "array",
      "items": {
        "$ref": "#/definitions/__schema1"
      },
      "description": "Ordered workflow steps; names must be unique."
    },
    "output": {
      "description": "Final output as named field-to-template mappings or one passthrough template expression.",
      "anyOf": [
        {
          "type": "object",
          "propertyNames": {
            "type": "string"
          },
          "additionalProperties": {
            "type": "string"
          }
        },
        {
          "type": "string"
        }
      ]
    },
    "settings": {
      "description": "Workflow-wide timeout and retry defaults.",
      "type": "object",
      "properties": {
        "timeout": {
          "description": "Default step timeout in milliseconds.",
          "type": "number",
          "exclusiveMinimum": 0
        },
        "retry": {
          "description": "Default durable retry policy for steps.",
          "anyOf": [
            {
              "type": "string",
              "const": "automatic"
            },
            {
              "type": "string",
              "const": "never"
            },
            {
              "oneOf": [
                {
                  "type": "object",
                  "properties": {
                    "mode": {
                      "type": "string",
                      "const": "automatic"
                    },
                    "maxAttempts": {
                      "type": "integer",
                      "minimum": 1,
                      "maximum": 10
                    }
                  },
                  "required": [
                    "mode"
                  ],
                  "additionalProperties": false
                },
                {
                  "type": "object",
                  "properties": {
                    "mode": {
                      "type": "string",
                      "const": "never"
                    }
                  },
                  "required": [
                    "mode"
                  ],
                  "additionalProperties": false
                }
              ]
            }
          ]
        },
        "retries": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "retryDelay": {
          "type": "number",
          "exclusiveMinimum": 0
        }
      },
      "additionalProperties": false
    },
    "defaultModel": {
      "description": "Default configured LLM provider id used by AI steps when the step does not select one.",
      "type": "string"
    }
  },
  "required": [
    "name",
    "version",
    "enabled",
    "triggerMethods",
    "steps"
  ],
  "additionalProperties": false,
  "definitions": {
    "__schema0": {
      "type": "object",
      "properties": {
        "name": {
          "type": "string",
          "minLength": 1,
          "pattern": "^[a-zA-Z_][a-zA-Z0-9_]*$",
          "description": "JSON object key, addressable in templates with dot notation."
        },
        "type": {
          "type": "string",
          "description": "One of string, enum, number, integer, boolean, array, or object."
        },
        "description": {
          "description": "Human-readable field meaning.",
          "type": "string"
        },
        "required": {
          "description": "Whether this property must be present; defaults to true when omitted.",
          "type": "boolean"
        },
        "values": {
          "description": "Allowed strings when type is enum.",
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "items": {
          "description": "Element definition when type is array.",
          "type": "object",
          "properties": {
            "type": {
              "type": "string",
              "description": "Array element type: string, enum, number, integer, boolean, or object."
            },
            "values": {
              "description": "Allowed strings when items.type is enum.",
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            "properties": {
              "description": "Recursive object fields when items.type is object.",
              "type": "array",
              "items": {
                "$ref": "#/definitions/__schema0"
              }
            }
          },
          "required": [
            "type"
          ],
          "additionalProperties": false
        },
        "properties": {
          "description": "Recursive fields when type is object.",
          "type": "array",
          "items": {
            "$ref": "#/definitions/__schema0"
          }
        }
      },
      "required": [
        "name",
        "type"
      ],
      "additionalProperties": false
    },
    "__schema1": {
      "anyOf": [
        {
          "type": "object",
          "properties": {
            "type": {
              "type": "string",
              "enum": [
                "ai.parse",
                "ai.extract",
                "ai.split",
                "ai.segment",
                "ai.classify",
                "ai.classify-pages",
                "ai.vision"
              ]
            },
            "name": {
              "type": "string",
              "minLength": 1
            },
            "description": {
              "type": "string"
            },
            "if": {
              "type": "string"
            },
            "timeout": {
              "type": "number",
              "exclusiveMinimum": 0
            },
            "retry": {
              "anyOf": [
                {
                  "type": "string",
                  "const": "inherit"
                },
                {
                  "type": "string",
                  "const": "automatic"
                },
                {
                  "type": "string",
                  "const": "never"
                },
                {
                  "oneOf": [
                    {
                      "type": "object",
                      "properties": {
                        "mode": {
                          "type": "string",
                          "const": "automatic"
                        },
                        "maxAttempts": {
                          "type": "integer",
                          "minimum": 1,
                          "maximum": 10
                        }
                      },
                      "required": [
                        "mode"
                      ],
                      "additionalProperties": false
                    },
                    {
                      "type": "object",
                      "properties": {
                        "mode": {
                          "type": "string",
                          "const": "never"
                        }
                      },
                      "required": [
                        "mode"
                      ],
                      "additionalProperties": false
                    }
                  ]
                }
              ]
            },
            "retries": {
              "type": "integer",
              "minimum": 0,
              "maximum": 9007199254740991
            },
            "retryDelay": {
              "type": "number",
              "exclusiveMinimum": 0
            },
            "with": {
              "type": "object",
              "propertyNames": {
                "type": "string"
              },
              "additionalProperties": {}
            }
          },
          "required": [
            "type",
            "name"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "type": {
              "type": "string",
              "enum": [
                "transform.set",
                "transform.remove",
                "transform.combine",
                "transform.split",
                "transform.merge",
                "transform.template",
                "transform.pdf-embed",
                "transform.xlsx-to-json",
                "transform.json-to-xlsx",
                "transform.script",
                "transform.text-chunker",
                "transform.regex-extract"
              ]
            },
            "name": {
              "type": "string",
              "minLength": 1
            },
            "description": {
              "type": "string"
            },
            "if": {
              "type": "string"
            },
            "timeout": {
              "type": "number",
              "exclusiveMinimum": 0
            },
            "retry": {
              "anyOf": [
                {
                  "type": "string",
                  "const": "inherit"
                },
                {
                  "type": "string",
                  "const": "automatic"
                },
                {
                  "type": "string",
                  "const": "never"
                },
                {
                  "oneOf": [
                    {
                      "type": "object",
                      "properties": {
                        "mode": {
                          "type": "string",
                          "const": "automatic"
                        },
                        "maxAttempts": {
                          "type": "integer",
                          "minimum": 1,
                          "maximum": 10
                        }
                      },
                      "required": [
                        "mode"
                      ],
                      "additionalProperties": false
                    },
                    {
                      "type": "object",
                      "properties": {
                        "mode": {
                          "type": "string",
                          "const": "never"
                        }
                      },
                      "required": [
                        "mode"
                      ],
                      "additionalProperties": false
                    }
                  ]
                }
              ]
            },
            "retries": {
              "type": "integer",
              "minimum": 0,
              "maximum": 9007199254740991
            },
            "retryDelay": {
              "type": "number",
              "exclusiveMinimum": 0
            },
            "with": {
              "type": "object",
              "propertyNames": {
                "type": "string"
              },
              "additionalProperties": {}
            }
          },
          "required": [
            "type",
            "name"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "type": {
              "type": "string",
              "enum": [
                "action.http",
                "action.invoke-workflow",
                "action.website-reader"
              ]
            },
            "name": {
              "type": "string",
              "minLength": 1
            },
            "description": {
              "type": "string"
            },
            "if": {
              "type": "string"
            },
            "timeout": {
              "type": "number",
              "exclusiveMinimum": 0
            },
            "retry": {
              "anyOf": [
                {
                  "type": "string",
                  "const": "inherit"
                },
                {
                  "type": "string",
                  "const": "automatic"
                },
                {
                  "type": "string",
                  "const": "never"
                },
                {
                  "oneOf": [
                    {
                      "type": "object",
                      "properties": {
                        "mode": {
                          "type": "string",
                          "const": "automatic"
                        },
                        "maxAttempts": {
                          "type": "integer",
                          "minimum": 1,
                          "maximum": 10
                        }
                      },
                      "required": [
                        "mode"
                      ],
                      "additionalProperties": false
                    },
                    {
                      "type": "object",
                      "properties": {
                        "mode": {
                          "type": "string",
                          "const": "never"
                        }
                      },
                      "required": [
                        "mode"
                      ],
                      "additionalProperties": false
                    }
                  ]
                }
              ]
            },
            "retries": {
              "type": "integer",
              "minimum": 0,
              "maximum": 9007199254740991
            },
            "retryDelay": {
              "type": "number",
              "exclusiveMinimum": 0
            },
            "with": {
              "type": "object",
              "propertyNames": {
                "type": "string"
              },
              "additionalProperties": {}
            }
          },
          "required": [
            "type",
            "name"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "type": {
              "type": "string",
              "const": "control.wait"
            },
            "name": {
              "type": "string",
              "minLength": 1
            },
            "description": {
              "type": "string"
            },
            "if": {
              "type": "string"
            },
            "timeout": {
              "type": "number",
              "exclusiveMinimum": 0
            },
            "retry": {
              "anyOf": [
                {
                  "type": "string",
                  "const": "inherit"
                },
                {
                  "type": "string",
                  "const": "automatic"
                },
                {
                  "type": "string",
                  "const": "never"
                },
                {
                  "oneOf": [
                    {
                      "type": "object",
                      "properties": {
                        "mode": {
                          "type": "string",
                          "const": "automatic"
                        },
                        "maxAttempts": {
                          "type": "integer",
                          "minimum": 1,
                          "maximum": 10
                        }
                      },
                      "required": [
                        "mode"
                      ],
                      "additionalProperties": false
                    },
                    {
                      "type": "object",
                      "properties": {
                        "mode": {
                          "type": "string",
                          "const": "never"
                        }
                      },
                      "required": [
                        "mode"
                      ],
                      "additionalProperties": false
                    }
                  ]
                }
              ]
            },
            "retries": {
              "type": "integer",
              "minimum": 0,
              "maximum": 9007199254740991
            },
            "retryDelay": {
              "type": "number",
              "exclusiveMinimum": 0
            },
            "with": {
              "type": "object",
              "propertyNames": {
                "type": "string"
              },
              "additionalProperties": {}
            },
            "duration": {
              "type": "number",
              "exclusiveMinimum": 0
            }
          },
          "required": [
            "type",
            "name"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "type": {
              "type": "string",
              "const": "control.fail"
            },
            "name": {
              "type": "string",
              "minLength": 1
            },
            "description": {
              "type": "string"
            },
            "if": {
              "type": "string"
            },
            "timeout": {
              "type": "number",
              "exclusiveMinimum": 0
            },
            "retry": {
              "anyOf": [
                {
                  "type": "string",
                  "const": "inherit"
                },
                {
                  "type": "string",
                  "const": "automatic"
                },
                {
                  "type": "string",
                  "const": "never"
                },
                {
                  "oneOf": [
                    {
                      "type": "object",
                      "properties": {
                        "mode": {
                          "type": "string",
                          "const": "automatic"
                        },
                        "maxAttempts": {
                          "type": "integer",
                          "minimum": 1,
                          "maximum": 10
                        }
                      },
                      "required": [
                        "mode"
                      ],
                      "additionalProperties": false
                    },
                    {
                      "type": "object",
                      "properties": {
                        "mode": {
                          "type": "string",
                          "const": "never"
                        }
                      },
                      "required": [
                        "mode"
                      ],
                      "additionalProperties": false
                    }
                  ]
                }
              ]
            },
            "retries": {
              "type": "integer",
              "minimum": 0,
              "maximum": 9007199254740991
            },
            "retryDelay": {
              "type": "number",
              "exclusiveMinimum": 0
            },
            "with": {
              "type": "object",
              "propertyNames": {
                "type": "string"
              },
              "additionalProperties": {}
            },
            "condition": {
              "type": "string"
            },
            "statusCode": {
              "type": "integer",
              "minimum": 400,
              "maximum": 599
            },
            "message": {
              "type": "string",
              "minLength": 1
            }
          },
          "required": [
            "type",
            "name",
            "message"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "type": {
              "type": "string",
              "const": "control.block"
            },
            "name": {
              "type": "string",
              "minLength": 1
            },
            "description": {
              "type": "string"
            },
            "if": {
              "type": "string"
            },
            "timeout": {
              "type": "number",
              "exclusiveMinimum": 0
            },
            "retry": {
              "anyOf": [
                {
                  "type": "string",
                  "const": "inherit"
                },
                {
                  "type": "string",
                  "const": "automatic"
                },
                {
                  "type": "string",
                  "const": "never"
                },
                {
                  "oneOf": [
                    {
                      "type": "object",
                      "properties": {
                        "mode": {
                          "type": "string",
                          "const": "automatic"
                        },
                        "maxAttempts": {
                          "type": "integer",
                          "minimum": 1,
                          "maximum": 10
                        }
                      },
                      "required": [
                        "mode"
                      ],
                      "additionalProperties": false
                    },
                    {
                      "type": "object",
                      "properties": {
                        "mode": {
                          "type": "string",
                          "const": "never"
                        }
                      },
                      "required": [
                        "mode"
                      ],
                      "additionalProperties": false
                    }
                  ]
                }
              ]
            },
            "retries": {
              "type": "integer",
              "minimum": 0,
              "maximum": 9007199254740991
            },
            "retryDelay": {
              "type": "number",
              "exclusiveMinimum": 0
            },
            "with": {
              "type": "object",
              "propertyNames": {
                "type": "string"
              },
              "additionalProperties": {}
            },
            "blockName": {
              "type": "string",
              "minLength": 1
            },
            "inputs": {
              "type": "object",
              "propertyNames": {
                "type": "string"
              },
              "additionalProperties": {}
            }
          },
          "required": [
            "type",
            "name",
            "blockName"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "type": {
              "type": "string",
              "const": "control.if"
            },
            "name": {
              "type": "string",
              "minLength": 1
            },
            "description": {
              "type": "string"
            },
            "if": {
              "type": "string"
            },
            "timeout": {
              "type": "number",
              "exclusiveMinimum": 0
            },
            "retries": {
              "type": "integer",
              "minimum": 0,
              "maximum": 9007199254740991
            },
            "retryDelay": {
              "type": "number",
              "exclusiveMinimum": 0
            },
            "with": {
              "type": "object",
              "propertyNames": {
                "type": "string"
              },
              "additionalProperties": {}
            },
            "condition": {
              "type": "string"
            },
            "then": {
              "type": "array",
              "items": {
                "$ref": "#/definitions/__schema1"
              }
            },
            "else": {
              "type": "array",
              "items": {
                "$ref": "#/definitions/__schema1"
              }
            }
          },
          "required": [
            "type",
            "name",
            "condition",
            "then"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "type": {
              "type": "string",
              "const": "control.switch"
            },
            "name": {
              "type": "string",
              "minLength": 1
            },
            "description": {
              "type": "string"
            },
            "if": {
              "type": "string"
            },
            "timeout": {
              "type": "number",
              "exclusiveMinimum": 0
            },
            "retries": {
              "type": "integer",
              "minimum": 0,
              "maximum": 9007199254740991
            },
            "retryDelay": {
              "type": "number",
              "exclusiveMinimum": 0
            },
            "with": {
              "type": "object",
              "propertyNames": {
                "type": "string"
              },
              "additionalProperties": {}
            },
            "on": {
              "type": "string"
            },
            "cases": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "when": {
                    "anyOf": [
                      {
                        "type": "string"
                      },
                      {
                        "type": "number"
                      },
                      {
                        "type": "boolean"
                      }
                    ]
                  },
                  "steps": {
                    "type": "array",
                    "items": {
                      "$ref": "#/definitions/__schema1"
                    }
                  }
                },
                "required": [
                  "when",
                  "steps"
                ],
                "additionalProperties": false
              }
            },
            "default": {
              "type": "array",
              "items": {
                "$ref": "#/definitions/__schema1"
              }
            }
          },
          "required": [
            "type",
            "name",
            "on",
            "cases"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "type": {
              "type": "string",
              "const": "control.parallel"
            },
            "name": {
              "type": "string",
              "minLength": 1
            },
            "description": {
              "type": "string"
            },
            "if": {
              "type": "string"
            },
            "timeout": {
              "type": "number",
              "exclusiveMinimum": 0
            },
            "retries": {
              "type": "integer",
              "minimum": 0,
              "maximum": 9007199254740991
            },
            "retryDelay": {
              "type": "number",
              "exclusiveMinimum": 0
            },
            "with": {
              "type": "object",
              "propertyNames": {
                "type": "string"
              },
              "additionalProperties": {}
            },
            "branches": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "name": {
                    "type": "string",
                    "minLength": 1
                  },
                  "steps": {
                    "type": "array",
                    "items": {
                      "$ref": "#/definitions/__schema1"
                    }
                  }
                },
                "required": [
                  "name",
                  "steps"
                ],
                "additionalProperties": false
              }
            }
          },
          "required": [
            "type",
            "name",
            "branches"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "type": {
              "type": "string",
              "const": "control.foreach"
            },
            "name": {
              "type": "string",
              "minLength": 1
            },
            "description": {
              "type": "string"
            },
            "if": {
              "type": "string"
            },
            "timeout": {
              "type": "number",
              "exclusiveMinimum": 0
            },
            "retries": {
              "type": "integer",
              "minimum": 0,
              "maximum": 9007199254740991
            },
            "retryDelay": {
              "type": "number",
              "exclusiveMinimum": 0
            },
            "with": {
              "type": "object",
              "propertyNames": {
                "type": "string"
              },
              "additionalProperties": {}
            },
            "items": {
              "type": "string"
            },
            "as": {
              "type": "string"
            },
            "indexAs": {
              "type": "string"
            },
            "steps": {
              "type": "array",
              "items": {
                "$ref": "#/definitions/__schema1"
              }
            }
          },
          "required": [
            "type",
            "name",
            "items",
            "as",
            "steps"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "type": {
              "type": "string",
              "const": "control.parallel_map"
            },
            "name": {
              "type": "string",
              "minLength": 1
            },
            "description": {
              "type": "string"
            },
            "if": {
              "type": "string"
            },
            "timeout": {
              "type": "number",
              "exclusiveMinimum": 0
            },
            "retries": {
              "type": "integer",
              "minimum": 0,
              "maximum": 9007199254740991
            },
            "retryDelay": {
              "type": "number",
              "exclusiveMinimum": 0
            },
            "with": {
              "type": "object",
              "propertyNames": {
                "type": "string"
              },
              "additionalProperties": {}
            },
            "items": {
              "type": "string"
            },
            "as": {
              "type": "string"
            },
            "indexAs": {
              "type": "string"
            },
            "concurrency": {
              "default": 5,
              "type": "integer",
              "minimum": 1,
              "maximum": 50
            },
            "steps": {
              "type": "array",
              "items": {
                "$ref": "#/definitions/__schema1"
              }
            }
          },
          "required": [
            "type",
            "name",
            "items",
            "as",
            "steps"
          ],
          "additionalProperties": false
        }
      ]
    }
  }
}
```
<!-- GENERATED:WORKFLOW_REFERENCE END -->
