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
triggerMethods: [api] # array, ≥1 entry from: api | cron | email
inputs: [...] # array of input definitions (see below)
steps: [...] # array of steps, executed in topological order
output: {...} # object — the workflow's return shape
```

`name` + `version` together identify the version row. Pushing a new
version with the same `name` and a different `version` appends to history;
re-using the same `version` is rejected.

### `triggerMethods`

Required. Each entry adds an invocation surface:

- `api` — the workflow can be called via REST or the CLI's `workflow execution run`
- `cron` — scheduled. Add a sibling `cron: { schedule: "0 9 * * *", timezone: "UTC" }`
- `email` — inbound email. Add a sibling `email: { subject?: ..., aliases?: [...] }`

If `api` is missing, `eigenpal workflow execution run` and `workflow run` reject with a
403 / "Workflow does not have API trigger enabled."

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

| YAML                                       | `triggerInput.<name>` | Template                                |
| ------------------------------------------ | --------------------- | --------------------------------------- |
| `type: file`                               | `{ fileId }`          | `{{ input.<name> }}`                    |
| `type: array`, `items: { type: file }`     | `[{ fileId }, ...]`   | `{{ input.<name>[0] }}` (or `forEach:`) |

If you see `Invalid input ... expected object, received array` from a
step that takes a single file, the workflow input is `type: file` but
the dataset folder probably has multiple files in it (or the workflow
was on a stale version that materialized arrays unconditionally).
Trim the folder to one file, or switch the input to the array form.

### `steps`

```yaml
steps:
  - name: parse # required, unique within the workflow
    type: ai.document-parser # see `reference/step-types.md`; introspect with `step-type get`
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
- `control.*` — flow control (if, for-each, parallel-map)

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
arithmetic, regex) goes in `transform.script`:

```yaml
- name: total
  type: transform.script
  with:
    inputs: # explicit data deps — visible to the validator
      lineItems: '{{ steps.extract.output.lineItems }}'
      taxRate: '{{ input.taxRate }}'
    code: |
      const subtotal = lineItems.reduce((s, i) => s + i.price * i.qty, 0);
      const tax = subtotal * taxRate;
      return { subtotal, tax, total: subtotal + tax };
    outputSchema: # optional but recommended — runtime-validated
      type: object
      properties:
        subtotal: { type: number }
        tax: { type: number }
        total: { type: number }
```

The script runs in a WASM sandbox: 5s wall clock, 10 MB heap, no network,
no filesystem. Trips show up as `script_timeout` / `script_memory_limit`
on the step execution.

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
  not "annex". List the multilingual variants you've seen.
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
passed — server rejects pushes whose version doesn't strictly increase.

## Discover step + evaluator types

Don't memorize fields — introspect:

```bash
eigenpal workflow step-type      list                 # full step catalog
eigenpal workflow step-type      get <type>           # config + output schema for one step type
eigenpal workflow evaluator-type list                 # full evaluator catalog
eigenpal workflow evaluator-type get <type>           # config schema for one evaluator type
```

Both catalogs are generated from the canonical Zod schemas in
`@eigenpal/types`, so they're always in sync with what the deployment
supports.

<!-- GENERATED:WORKFLOW_REFERENCE START -->
## Top-level fields — full reference

_Generated from `WorkflowDefinitionSchema` in `@eigenpal/types/src/workflow/workflow.ts`. Do not hand-edit between the GENERATED fences — run `bun run --cwd packages/cli generate:skill`._

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `name` | string | yes |  |  |
| `kind` | `"workflow"` \| `"block"` | no | `"workflow"` |  |
| `version` | string | no | `"1.0.0"` |  |
| `description` | string | no |  |  |
| `enabled` | boolean | no | `true` |  |
| `triggerMethods` | array<object> | no | `[{"type":"manual"}]` |  |
| `inputs` | array<object> | no |  |  |
| `steps` | array<unknown> | yes |  |  |
| `output` | record<string, string> | no |  |  |
| `settings` | object | no |  |  |
| `defaultModel` | string | no |  |  |


## Per-input fields

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `name` | string | yes |  |  |
| `type` | string | yes |  |  |
| `description` | string | no |  |  |
| `required` | boolean | no | `true` |  |
| `default` | unknown | no |  |  |
| `items` | object | no |  |  |
<!-- GENERATED:WORKFLOW_REFERENCE END -->
