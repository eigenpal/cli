# Step types

The catalog is generated from `STEP_SCHEMAS` in
`@eigenpal/types/src/workflow/step-configs.ts`. **Do not memorize fields
— introspect.** The CLI reads the live schema:

```bash
# List every step type with a one-line description
eigenpal workflow step-type list

# Filter by keyword
eigenpal workflow step-type list --search extract

# Full JSON Schema for one type's `config` + `output` + behavioral docs
eigenpal workflow step-type get ai.extract
```

The output of `step-type get` is the **authoritative source** for which
fields each step takes, what shapes they accept, and what behavior they
implement at runtime. Server-side validation errors point you here.

## Categories (high-level map)

- `ai.*` — model-backed processing (parse, extract, classify). Cost + latency depend on the model.
- `transform.*` — deterministic data transforms (set, remove, combine, split, merge,
  script, template, pdf-embed, xlsx-to-json, json-to-xlsx). WASM sandboxed where applicable.
- `action.*` — external side effects (HTTP, invoke another workflow, website reader).
- `control.*` — flow control (if, foreach, parallel, parallel_map, wait, fail).

The full per-type catalog with field tables is auto-generated below from
`STEP_SCHEMAS`. The high-level map above tells you which family you want;
the catalog tells you what fields it takes.

## When to reach for what

| Use case                          | Step                                              |
| --------------------------------- | ------------------------------------------------- |
| Read a PDF / DOCX / image (native-first) | `ai.parse` with `parseMode: native` or `native-or-ocr` |
| Read a PDF / DOCX / image (full OCR/vision) | `ai.parse` with `parseMode: ocr` or `vision` |
| Pull a typed object from text     | `ai.extract` with `config.schema`                 |
| Pick one label from a fixed set   | `ai.classify` with `config.labels`                |
| Reject bad inputs with a 4xx code | `control.fail` (often after `ai.classify`)        |
| Sum / filter / regex              | `transform.script` (NOT Liquid)                   |
| Render a DOCX or XLSX template (YAML workflow) | `transform.template` with `tmpl_...` or `./file.xlsx` |
| Fill a DOCX or XLSX template (runtime agent)   | fill-template platform skill         |
| Convert XLSX to JSON              | `transform.xlsx-to-json`                          |
| Convert JSON rows to XLSX         | `transform.json-to-xlsx`                          |
| Merge or combine objects          | `transform.combine` / `transform.merge`           |
| Conditional execution             | `if:` on the step (Liquid) or `control.if`        |
| Map over an input array           | `forEach:` on the step or `control.foreach`       |
| Concurrent map over an array      | `control.parallel_map`                            |
| Independent parallel branches     | `control.parallel`                                |
| External HTTP call                | `action.http`                                     |
| Call another workflow             | `action.invoke-workflow`                          |
| Fetch a webpage as markdown       | `action.website-reader`                           |

## Workspace vs Git templates

Two separate template systems share DOCX/XLSX placeholder syntax but not
references:

| Goal | Mechanism |
| --- | --- |
| YAML workflow produces a filled DOCX/XLSX | `transform.template` with `templateId: tmpl_...` or `template: ./templates/foo.xlsx` (CLI push uploads) |
| Runtime agent produces a filled DOCX/XLSX | fill-template platform skill against Git templates |

Git templates (`agents/<agent>/templates/<slug>/`, shared
`resources/templates/<slug>/`) never receive a `tmpl_...` ID and cannot be
used in `transform.template`. Manage Git templates through the agent source
loop — see the eigenpal skill's **Agent templates (Git source)** section.

Workspace templates are tenant-scoped `tmpl_...` resources with immutable
`tmpr_...` revisions. Manage them from the CLI (preferred) or Studio:

```bash
eigenpal workflow templates upload ./templates/roster.xlsx --json
eigenpal workflow templates list --json
eigenpal workflow templates get tmpl_... --json
eigenpal workflow templates smoke ./templates/roster.xlsx --data ./fixture.json --out ./filled.xlsx
eigenpal workflow validate ./workflow.yaml --online
eigenpal workflow push --file workflow.yaml
```

Author YAML with either a live id or a source-controlled path. Push uploads
the file (skipped when the SHA-256 still matches) and sends `templateId` +
current `templateRevisionId` to the server without rewriting the file on disk.

`templateId` must be `tmpl_...` when not using a local path; file IDs
(`file_...`) are rejected at validate/push.

In the Office file itself use `{placeholder}` and, for XLSX row expansion,
`{table:array.prop}`. `{{placeholder}}` is Liquid for YAML `data` mapping
only — putting it in an XLSX file fails at fill. Example prototype row:

```yaml
- name: fill-roster
  type: transform.template
  with:
    templateId: tmpl_...
    data:
      report_title: "{{ steps.extract.output.title }}"
      subjects: "{{ steps.extract.output.subjects }}"
```

Spreadsheet cells: `{report_title}`, `{table:subjects.first_name}`,
`{table:subjects.last_name}`. Null/blank cells stay empty; numbers and
booleans keep spreadsheet types; every sheet is filled; existing formulas
stay formulas.

## Liquid vs `transform.script`

| Logic shape                | Use                              |
| -------------------------- | -------------------------------- |
| `steps.x.output.field`     | Liquid `{{ ... }}`               |
| `value \| default: 0`      | Liquid                           |
| `price \| times: quantity` | Liquid                           |
| array `reduce` / `filter`  | `transform.script`               |
| multi-step calc            | `transform.script`               |
| conditional branches       | `transform.script` or `if:`      |
| date arithmetic            | `transform.script`               |
| regex                      | `transform.script`               |

`transform.script` advantages over Liquid:

- Explicit `inputs:` declaration; the validator knows the data deps
- Typed return annotation drives downstream autocomplete + runtime validation
- Real JS/TS (`Array.prototype.reduce`, `JSON.parse`, etc.)
- Sandbox limits prevent infinite loops from blowing up an execution

> The function is **TypeScript**. Each `inputs:` key becomes a parameter
> in declaration order: `inputs: { items, taxRate }` ⇒
> `function script(items: ..., taxRate: ...): R { ... }`. The return-type
> annotation `R` is **required** and IS this step's output schema; there
> is no separate `outputSchema:` field. Describe what your function
> actually returns: downstream steps reference its fields via
> `{{ steps.<this>.output.<field> }}`, so a too-loose annotation (e.g.
> `unknown`) makes those references unresolvable. The function must
> `return` (or `throw`) a value.

## Reference / output paths

After a step runs, its output is reachable via
`{{ steps.<name>.output.<field> }}`. The exact field set per type comes
from `step-type get`'s `outputSchema`. Example for `ai.extract`:

```bash
$ eigenpal workflow step-type get ai.extract | jq '.outputSchema'
{
  "type": "object",
  "properties": {
    "extracted": { /* matches the user-supplied config.schema */ },
    "rawResponse": { "type": "string" },
    "tokensUsed": { "type": "number" }
  }
}
```

Reference user-supplied schema fields the same way:
`{{ steps.extract.output.extracted.invoiceNumber }}`.

## Control containers — nested step shape and scoping

`control.parallel`, `control.parallel_map`, `control.foreach`, `control.if`,
and inline `action.invoke-workflow` (`execution: inline`) contain nested steps. The auto-generated catalog below
cannot render that shape, so the YAML form lives here. Same for the scoping
rules — important because the runtime treats nested steps differently from
top-level ones, and getting the access path wrong silently returns
`undefined` (no error).

### `control.parallel` — independent branches

Runs each branch concurrently. Use when several pieces of work share input
but do not depend on each other.

```yaml
- name: enrich
  type: control.parallel
  branches:
    - name: legal
      steps:
        - name: extract-clauses
          type: ai.extract
          with:
            input: '{{ steps.parse.output.markdown }}'
            schema: { clauses: { type: array, items: { type: string } } }
    - name: financial
      steps:
        - name: extract-totals
          type: ai.extract
          with:
            input: '{{ steps.parse.output.markdown }}'
            schema: { total: { type: number } }
```

**Access the output:** branch step outputs are stored under the parent
parallel step keyed by branch name, then by inner step name. There is no
flat top-level entry for branch-internal steps.

```liquid
{{ steps.enrich.output.legal.extract-clauses.clauses }}
{{ steps.enrich.output.financial.extract-totals.total }}
```

**Scope inside a branch:** top-level steps that ran before the parallel,
plus earlier siblings in the same branch. **Other branches' steps are
NOT visible** — each branch runs in an isolated child scope.

```liquid
# Inside branch `legal`, second step:
{{ steps.parse.output.markdown }}              # ancestor: visible
{{ steps.extract-clauses.output.clauses }}     # sibling: visible
{{ steps.extract-totals.output.total }}        # other branch: UNDEFINED
```

### `control.parallel_map` — fan-out over an array

Runs the inner step block concurrently for each item, up to `concurrency`.

```yaml
- name: process-pages
  type: control.parallel_map
  items: '{{ steps.split.output.pages }}'
  as: page
  indexAs: i           # optional
  concurrency: 5       # default 5, max 50
  steps:
    - name: extract-fields
      type: ai.extract
      with:
        input: '{{ page.text }}'
        schema: { fields: { type: object } }
```

**Access the output:** iteration results are returned as an array in the
original input order under the parent step's `items` field.

```liquid
{{ steps.process-pages.output.items[0].extract-fields.fields }}
{{ steps.process-pages.output.count }}            # number of completed iterations
{{ steps.process-pages.output.totalIterations }}
```

`steps.extract-fields.output.fields` (the flat form) is **not** addressable
from outside the parallel_map.

**Multi-step iterations only key the LAST step's output into `items[i]`.**
If your iteration body has steps `[parse, extract]`, each `items[i]` is
`{ extract: <extract output> }` — `parse`'s output is gone. To preserve
intermediate fields, end the body with a `transform.script` that returns
the combined shape:

```yaml
steps:
  - name: parse
    type: ai.parse
    with: { ... }
  - name: extract
    type: ai.extract
    with: { input: '{{ steps.parse.output.markdown }}', ... }
  - name: combine
    type: transform.script
    with:
      inputs:
        parsed: '{{ steps.parse.output }}'
        extracted: '{{ steps.extract.output }}'
      function: |
        function script(parsed, extracted): { parsed: any; extracted: any } {
          return { parsed, extracted };
        }
```

Now `items[i].combine.parsed` / `items[i].combine.extracted` both survive.

### `control.foreach` — sequential loop over an array

Same shape as `parallel_map` minus `concurrency`; iterations run in order.
Use when each iteration depends on the previous, or when concurrency would
cause downstream rate limits.

```yaml
- name: per-row
  type: control.foreach
  items: '{{ steps.fetch.output.rows }}'
  as: row
  steps:
    - name: persist
      type: action.http-request
      with:
        method: POST
        url: 'https://example.com/api/rows/{{ row.id }}'
        body: '{{ row }}'
```

**Access the output:** same shape as parallel_map — an `items[]` array of
per-iteration results, in iteration order. Same "only the LAST inner step
is keyed into `items[i]`" rule applies (use a trailing `transform.script`
to preserve intermediate outputs).

> ⚠️ Foreach does NOT isolate scopes — the last iteration's inner step
> outputs technically persist on the top-level `steps` map and `steps.<inner>.output.x`
> resolves at runtime. That is an only-the-last-row hazard; the autocomplete
> hides these names and you should treat `steps.<foreach>.output.items[]`
> as the only correct access.

### `control.if` — conditional branch

```yaml
- name: route
  type: control.if
  condition: '{{ input.priority == "high" }}'
  then:
    - name: rush-extract
      type: ai.extract
      with: { ... }
  else:
    - name: normal-extract
      type: ai.extract
      with: { ... }
```

**Access the output:** the `if` step's output is

```ts
{
  condition: boolean,                       // evaluated condition
  branch: 'then' | 'else',                  // which branch ran
  result: <last inner step's output> | null // null when chosen branch is empty
}
```

The canonical way to consume the result is through the if step itself:

```liquid
{{ steps.route.output.branch }}             # "then" or "else"
{{ steps.route.output.result.foo }}         # field from the branch's last step
```

`steps.<innerName>.output` references from outside the `if` also resolve
at runtime (unlike `parallel`/`parallel_map`, `if` does not isolate
scopes), but the template breaks the moment the OTHER branch runs. Use
`steps.<if>.output.result` so the access is branch-agnostic — or compute
the final shape in a trailing `transform.script` that handles both cases.

### `action.invoke-workflow` (inline) — call another workflow in the same run

```yaml
- name: invoice-flow
  type: action.invoke-workflow
  with:
    workflow: parse-invoice          # target workflow name or wf_ id
    execution: inline                # default; omit for same-run execution
    input:
      contract: '{{ input.contract }}'
```

**Access the output:** the target's declared output fields are exposed as
top-level keys under `steps.<this-step>.output`, with a `files` array alongside.
Invoked workflow steps run in an isolated scope inside the parent run.

For a separate child run (lineage, fire-and-forget, polling), set `execution: child`.

## Classify-and-fail pattern

`ai.classify` + `control.fail` together let a workflow reject bad inputs
fast with a typed HTTP-style status code that callers (and evals) can
match against. The classifier picks one label from a closed set; the
fail step terminates the run when the label is one you do not want to
process.

```yaml
- name: parse
  type: ai.parse
  with:
    input: '{{ input.document }}'

- name: classify
  type: ai.classify
  with:
    input: '{{ steps.parse.output.text }}'
    labels:
      - name: invoice
        description: A vendor invoice with line items and totals.
      - name: contract
        description: A multi-page contract or agreement.
      - name: other
        description: Anything that is not an invoice or contract.

- name: reject-unsupported
  type: control.fail
  condition: '{{ steps.classify.output.label == "other" }}'
  statusCode: 422
  message: 'Unsupported document: {{ steps.classify.output.reason }}'
```

> `control.fail` config is step-level (no `with:`), matching every other
> `control.*` step. `condition`, `statusCode`, and `message` sit directly
> on the step node.

The synchronous run endpoint surfaces the `statusCode` as the HTTP
response status; async runs persist `{ code, message, step }` to
`executions.error` so the eval scorer can match against
`expected.json` with `$error` (see `reference/dataset-format.md`). When
`condition` is omitted, `control.fail` always fails when reached, so
compose with `control.if` for legacy gating.

<!-- GENERATED:STEP_CATALOG START -->
## Full catalog

_Generated from `STEP_SCHEMAS` in `@eigenpal/types/src/workflow/step-configs.ts`. Do not hand-edit between the GENERATED fences — run `bun run --cwd packages/cli generate:skill`._

### AI steps — model-backed processing

#### `ai.parse` — Parse Document

Extract text from documents (PDF, DOCX, images) using native extraction, OCR, or vision models

**Durable retry:** Provider request retries are separate; the workflow engine does not durably retry this step.

**Config** (in `step.with`):

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `input` | string | yes |  | Storage reference or template expression for the document |
| `parseMode` | `"ocr"` \| `"vision"` \| `"native"` \| `"native-or-ocr"` | no |  | Base parser for PDF/image inputs. OCR is the default; vision uses the selected LLM. `native` extracts PDF embedded text only and never calls OCR or vision. `native-or-ocr` extracts native text, runs page-quality diagnostics, and requests OCR when pages have detectable anomalies (empty, U+FFFD, lone surrogates, forbidden controls, unassigned/noncharacter, heavy PUA). Page selection, subset egress, and billing are provider-dependent. Valid-looking wrong text and literal "?" are not flagged. Text and Office files always use local parsing. |
| `ocrModel` | string | no |  | OCR provider ID for PDF/image parsing |
| `llmModel` | string | no |  | LLM provider ID for vision-based parsing |
| `figureModel` | string | no |  | Vision model used only for the optional figure-description pass |
| `maxConcurrency` | number | no | `3` | Max concurrent VLM batch requests |
| `pagesPerBatch` | number | no | `5` | Number of page images per VLM request |
| `pdfRenderScale` | number | no | `1` | Scale factor for rendering PDF pages before VLM parsing. Higher values produce sharper images at larger payload sizes. |
| `imageQuality` | integer | no | `85` | JPEG quality for rendered PDF page images sent to VLM parsing. Higher values reduce compression artifacts at larger payload sizes. |
| `prompt` | string | no |  | Custom extraction prompt |
| `languages` | array<string> | no |  | OCR language hints |
| `outputFormat` | `"plain"` \| `"markdown"` \| `"djot"` \| `"html"` \| `"layout"` | no | `"markdown"` | Format for extracted text. `markdown` (default) keeps structure; `plain` is unstyled text; `djot`/`html` preserve more markup. `layout` is native-PDF spatial text with column gaps preserved as spaces. It requires `parseMode: native` or `parseMode: native-or-ocr` and a PDF — omitted parseMode and `nativeText: true` are not enough. Native mode is layout-only and fail-closed. `native-or-ocr` keeps layout text on accepted native pages and uses OCR markdown on suspect or empty pages, so the document can mix fixed-width layout and markdown. Extractor failure never falls back to another parser. Office, plaintext, and images fail. OCR/vision cannot request `layout`. |
| `nativeText` | boolean | no | `false` | Extract native/embedded text from PDFs without OCR/VLM. Faster and uses no credits. Falls back to OCR/VLM if the PDF has no embedded text. |
| `describeFigures` | boolean | no |  | Opt-in (default off). After text extraction, detect which pages contain figures with an in-worker layout model, then caption those pages with a vision model and append `<figure>description</figure>` to their text — so image-only pages (property photos, signatures, charts) become findable by text-based steps like ai.split. Note: the layout scan runs over all pages, and the caption step and its vision calls are billed. Skipped for plaintext. |
| `figureInstructions` | string | no |  | Custom instruction for the figure-description pass, e.g. "Describe each figure; label a handwritten signature as `<figure>signature</figure>` and a stamp as `<figure>stamp</figure>`; for property photos note the room or exterior shown." Applied only when describeFigures runs. |

**Output:** `object`

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `document` | object | yes |  |  |
| `usage` | object | yes |  |  |
| `pages` | array<object> | yes |  |  |
| `text` | string | yes |  | Combined text from all pages |
| `parserType` | `"plaintext"` \| `"office"` \| `"llm-vision"` \| `"ocr"` | yes |  |  |
| `parserVersion` | string | no |  |  |
| `model` | string | no |  | Model used (for LLM/OCR parsers) |
| `processingStrategy` | `"native"` \| `"ocr"` \| `"vision"` \| `"hybrid"` | no |  | How this result was produced: `native` (local PDF text only), `ocr`, `vision`, or `hybrid` (native pages merged with OCR on fallback pages). |
| `structured` | record<string, unknown> | no |  | Canonical structured document with ordered blocks, regions, bounding boxes, tables, figures, and chunks when supported by the parser |

#### `ai.extract` — Extract Data

Extract structured data from text using AI with a JSON schema

**Durable retry:** Provider request retries are separate; the workflow engine does not durably retry this step.

**Config** (in `step.with`):

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `input` | string | yes |  | Text content or template expression |
| `schema` | object | yes |  | JSON Schema defining the structure to extract |
| `prompt` | string | no |  | Custom prompt template for extraction |
| `provider` | string | no |  | Provider ID (e.g., "openai-gpt4o") |
| `model` | string | no |  | Model override |
| `maxInputTokens` | integer | no |  | Max input tokens. Truncates input text and logs a warning when exceeded. Omit for no limit. |
| `grounded` | boolean | no |  | Grounding is ON by default: each schema field gets a source span + confidence (high=verbatim, medium=fuzzy, low=ungrounded) under a reserved `_grounding` output key, and fields whose value cannot be located in the source are flagged for human review. Values stay the reliable schema-typed ones. The pass runs through the workspace LLM (any provider) and chunks long documents automatically. Tri-state: unset (default) = on, degrading gracefully to deterministic text alignment (`_grounding._degraded: true`) if no grounding model is available; `true` = strict, the step fails when the grounding model cannot be resolved; `false` = off, no `_grounding` key at all. |
| `groundingModel` | string | no |  | Provider/model for the grounding pass. Defaults to the workspace default LLM. Any configured provider works; the pass only fails the step when `grounded: true` is set explicitly and no model resolves. |
| `groundingExamples` | array<object> | no |  | Optional few-shot examples pinning grounding to verbatim source text per field. |
| `reviewOn` | `"medium_or_low"` \| `"low_only"` | no |  | Which grounding confidences set needsReview on a field. Default: low_only (only fields whose value could not be located in the source). Use medium_or_low to also flag approximate and derived matches. |

**Output:** `record<string, unknown>`

> Extracted structured data matching the provided schema. Unless grounding is disabled (grounded: false), the output also carries a reserved `_grounding` map keyed by field name: `_grounding.<field> = { confidence: high|medium|low, needsReview, reason?, source_span: { start, end, text, alignment } | null }`, plus reserved `_degraded: true` / `_reason` markers when the grounding LLM pass could not run.

#### `ai.split` — Split Document

Split a parsed document into named sections using an LLM. Consumes ai.parse output; emits per-section page ranges and text ready for downstream ai.extract via control.parallel_map.

**Durable retry:** Provider request retries are separate; the workflow engine does not durably retry this step.

**Config** (in `step.with`):

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `input` | string | yes |  | Template expression resolving to ai.parse output, e.g. "{{ steps.parse.output }}" |
| `sections` | array<object> | yes |  | Named sections to find in the document |
| `rules` | string | no |  | Optional natural-language rules appended to the system prompt. E.g. "End-of-section markers like *Koniec prílohy 2* close the current section." |
| `provider` | string | no |  | Provider ID from eigenpal.config.yaml (e.g. "openai-gpt5.4-mini"). Falls back to the tenant default LLM provider when omitted. |
| `windowTokenBudget` | integer | no |  | Override the per-window token ceiling for this step. Defaults to env SPLIT_WINDOW_TOKEN_BUDGET or 20000. Smaller windows give sharper anchors on contract-style documents (less competing context for the LLM to mis-anchor on); bump to 50k–100k when sections routinely exceed per-window page count. |

**Output:** `object`

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `splits` | array<object> | yes |  | Sections found in the document, in page order. Absent sections are omitted. |
| `sections` | record<string, object> | yes |  | The same sections keyed by config name, so a downstream step can reference one directly: `{{ steps.<split>.output.sections.<name>.page_range }}`. Prefer this over filtering `splits`. On a duplicate name the last wins. |

#### `ai.segment` — Separate Documents

Separate a concatenated batch (one big scan) into typed document instances using an LLM. Consumes ai.parse output and a type taxonomy; discovers an unknown number of documents in any order and emits per-document page ranges + text + type, ready for type-specific ai.extract via control.parallel_map. The inverse of ai.split.

**Durable retry:** Provider request retries are separate; the workflow engine does not durably retry this step.

**Config** (in `step.with`):

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `input` | string | yes |  | Template expression resolving to ai.parse output, e.g. "{{ steps.parse.output }}" |
| `documentTypes` | array<object> | yes |  | The document-type taxonomy. The LLM tags each detected document with one of these names, or the reserved "unknown" type when none fit. |
| `rules` | string | no |  | Optional natural-language rules appended to the system prompt. |
| `provider` | string | no |  | Provider ID from eigenpal.config.yaml. Falls back to the tenant default LLM provider when omitted. |
| `windowTokenBudget` | integer | no |  | Override the per-window token ceiling. Defaults to env SPLIT_WINDOW_TOKEN_BUDGET or 20000. |

**Output:** `object`

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `summary` | object | yes |  | Batch-level escalation summary: labelled vs unlabelled counts + docs needing review. |
| `documents` | array<object> | yes |  | Documents discovered in the batch, in page order. The full batch is covered. |

#### `ai.classify` — Classify

Classify a document or text into one of a fixed label set using an LLM. Output exposes the picked label (constrained to the configured names), a coarse confidence, and a short justification. Pair with control.fail to reject documents that match an undesired label.

**Durable retry:** Provider request retries are separate; the workflow engine does not durably retry this step.

**Config** (in `step.with`):

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `input` | string | yes |  | Template expression for the text to classify. Typically the output of ai.parse, e.g. "{{ steps.parse.output.text }}". |
| `labels` | array<object> | yes |  | Allowed labels. The LLM is constrained to pick exactly one of these names. |
| `prompt` | string | no |  | Custom classification instructions appended to the system prompt. Use to clarify edge cases or emphasize evidence the model should weigh. |
| `provider` | string | no |  | Provider ID from eigenpal.config.yaml (e.g. "openai-gpt4o-mini"). Falls back to the tenant default LLM provider when omitted. |
| `model` | string | no |  | Model override (advanced) |
| `maxInputTokens` | integer | no |  | Max input tokens. Truncates input text when exceeded. Omit for no limit. |

**Output:** `object`

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `label` | string | yes |  | The selected label name (one of the configured labels). Compare against literal strings to gate downstream steps. |
| `confidence` | `"low"` \| `"medium"` \| `"high"` | yes |  | LLM confidence in the classification. Coarse enum — numeric scores cluster meaninglessly at 0.85-0.95. |
| `reason` | string | yes |  | Short justification for the chosen label — useful for debugging. |

#### `ai.classify-pages` — Label Pages

Assign zero or more labels to each page independently (multi-label) using an LLM. Consumes ai.parse output; emits per-page labels and a byLabel map (label -> page indices) that supports NON-contiguous selections. Feed byLabel.<label> straight into ai.vision `pageIndices` to inspect scattered pages of a type (e.g. every signature or property-photo page).

**Durable retry:** Provider request retries are separate; the workflow engine does not durably retry this step.

**Config** (in `step.with`):

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `input` | string | yes |  | The ai.parse output to label, e.g. "{{ steps.parse.output }}". Each page is labelled independently. |
| `labels` | array<string \| object> | yes |  | Labels a page can carry. A page may match ZERO, ONE, or MANY of them. Each entry is a bare name (e.g. "photo") or { name, description }. Names must be unique. |
| `prompt` | string | no |  | Extra classification guidance appended to the system prompt. |
| `provider` | string | no |  | Provider ID from eigenpal.config.yaml. Falls back to the tenant default. |
| `model` | string | no |  | Model override (advanced). |
| `windowTokenBudget` | integer | no |  | Per-window token ceiling. Pages are packed into windows under this budget; one LLM call per window. Defaults to env SPLIT_WINDOW_TOKEN_BUDGET (20000). |

**Output:** `object`

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `pages` | array<object> | yes |  | Every input page, in order, with the labels the model assigned to it. |
| `byLabel` | record<string, array<integer>> | yes |  | Label name -> ascending page indices carrying it. Every configured label is present (empty array when no page matched), so dot access is always safe: `{{ steps.<step>.output.byLabel.<label> }}` resolves to a number[] ready for ai.vision `pageIndices`. |

#### `ai.vision` — Inspect Pages (Vision)

Inspect rendered page images with a vision model and return structured JSON matching a schema. The visual counterpart to Extract Data: use it for conclusions that live in the pixels rather than the text (is the document signed? are the photos usable?). Renders PDF, image, or Office/Word inputs; route to specific pages with an ai.split page range to keep it cheap.

**Durable retry:** Provider request retries are separate; the workflow engine does not durably retry this step.

**Config** (in `step.with`):

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `document` | string | yes |  | Template expression resolving to the input file (PDF, image, or Office document). |
| `pageFrom` | integer \| string | no |  | First page to inspect (0-based, inclusive). Optional. Accepts a template expression. When omitted, starts from the first page. |
| `pageTo` | integer \| string | no |  | Last page to inspect (0-based, inclusive). Optional. Accepts a template expression. When omitted, runs to the last page. When BOTH pageFrom and pageTo are omitted, the whole document is inspected in chunks of maxPages (divide-and-conquer, results merged). |
| `pageIndices` | array<integer> \| string | no |  | Explicit list of 0-based page indices to inspect — supports NON-contiguous selections, e.g. [4, 11, 19], or a template resolving to a number[] such as "{{ steps.label_pages.output.byLabel.photo }}". Highest priority: when set, pageFrom/pageTo and pages are ignored. |
| `schema` | object | yes |  | JSON Schema defining the structure the vision model should return. |
| `prompt` | string | no |  | Optional instruction refining the extraction. The schema drives it when omitted. |
| `provider` | string | no |  | Provider ID (must support vision). |
| `model` | string | no |  | Model override (must support vision). |
| `renderScale` | number | no |  | PDF render scale (1.0 = 72 DPI). Raise for small text or weak VLM OCR. Capped at 6 to avoid oversized page rasters. |
| `imageQuality` | integer | no |  | JPEG quality for rendered pages (default 85). |
| `maxPages` | integer | no |  | Chunk size: the maximum pages sent to the vision model in a single call. When the inspected range (or the whole document) is larger, it is split into chunks of this size and the per-chunk results are merged by a reduce pass. The reduce follows each field's DESCRIPTION: a boolean described as "present on any page" is OR-ed, one described as "true for every page" is AND-ed, and list fields are concatenated. The merge is most reliable for boolean/scalar claims; for schemas that AGGREGATE long lists across chunks it can still drop or reorder items, so prefer a bounded page range for large list extraction. Default 20, capped at 100. |

**Output:** `record<string, unknown>`

> Structured data matching the provided schema. The output also carries a reserved `_vision` key recording the inspected source document ref and the page indices that were rendered, so the UI can re-rasterize exactly those pages client-side. `_vision` is excluded from user-schema validation.

### Transform steps — deterministic data transforms

#### `transform.set` — Set Value

Set key-value pairs in the output object

**Durable retry:** Transforms, including those that write files, are not durably retried.

**Config** (in `step.with`):

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `fields` | record<string, unknown> | yes |  | Key-value pairs to set in output |
| `input` | record<string, unknown> | no |  | Base object to extend |

**Output:** `record<string, unknown>`

> Object with all fields set

#### `transform.remove` — Remove Fields

Remove specified fields from an object

**Durable retry:** Transforms, including those that write files, are not durably retried.

**Config** (in `step.with`):

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `input` | record<string, unknown> | no |  | Object to remove fields from |
| `fields` | array<string> | yes |  | Field names to remove |

**Output:** `record<string, unknown>`

> Object with fields removed

#### `transform.combine` — Combine Data

Merge multiple objects or concatenate arrays

**Durable retry:** Transforms, including those that write files, are not durably retried.

**Config** (in `step.with`):

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `sources` | array<string> | yes |  | Template expressions for sources to combine |
| `target` | string | yes |  | Target path in output |
| `mode` | `"merge"` \| `"concat"` \| `"deep"` | no | `"merge"` |  |

**Output:** `record<string, unknown> \| array<unknown>`

> Combined result

#### `transform.split` — Split Data

Split a string by delimiter or extract keys from an object

**Durable retry:** Transforms, including those that write files, are not durably retried.

**Config** (in `step.with`):

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `input` | string \| record<string, unknown> | no |  | String or object to split |
| `source` | string | no |  | Template expression for source |
| `by` | string | no | `","` | Delimiter for string splitting |
| `delimiter` | string | no |  | Alias for by |
| `limit` | number | no |  | Max number of splits |
| `keys` | array<string> | no |  | Keys to extract from object |

**Output:** `array<string> \| object`

> Split result - array or extracted/remaining object

#### `transform.merge` — Merge Inputs

Merge multiple named inputs into a single output

**Durable retry:** Transforms, including those that write files, are not durably retried.

**Config** (in `step.with`):

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `preservePortNames` | boolean | no | `true` |  |
| `outputKey` | string | no |  |  |

**Output:** `object`

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `items` | array<unknown> | yes |  |  |
| `count` | number | yes |  |  |
| `merged` | record<string, unknown> | no |  |  |

#### `transform.template` — Fill Template

Fill a DOCX or XLSX workspace template with data from previous steps. Reference a tmpl_... id, or a local ./templates/file.xlsx path (CLI push uploads it). Git agent templates use the fill-template skill instead and cannot be referenced here. File IDs (file_...) are not accepted. Placeholders are auto-detected. In the Office file use {placeholder} and {table:array.prop}; {{placeholder}} in an XLSX file is rejected ({{ }} is YAML Liquid only).

**Durable retry:** Transforms, including those that write files, are not durably retried.

**Config** (in `step.with`):

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `templateId` | string | no |  | Workspace template ID (tmpl_...) from the Templates table (DOCX or XLSX). Git agent templates cannot be referenced here. File IDs (file_...) are not accepted. Mutually exclusive with `template`. |
| `template` | string | no |  | Local DOCX or XLSX path relative to the workflow YAML (e.g. ./templates/foo.xlsx). CLI push keeps the real path inside the workflow project unless you pass --allow-external-templates, uploads unmatched files as new tmpl_ resources, and does not rewrite the source YAML. Mutually exclusive with templateId. |
| `templateRevisionId` | string | no |  | Immutable template revision ID (tmpr_...). Pin this when executions must keep using the same template bytes after replacements. Requires templateId; local `template` paths are pinned automatically on push. |
| `data` | record<string, unknown> | yes |  | Data object to merge into template. Each key must be explicitly defined - cannot pass a whole object as single expression. |
| `outputFilename` | string | no |  | Output filename - supports {{field}} syntax; .docx or .xlsx extension is added if omitted |
| `highlightNotFound` | boolean | no | `true` | Highlight missing variables with red-colored text in the output document (DOCX only; ignored for XLSX) |
| `notFoundText` | string | no | `"NOT FOUND"` | Text to display for missing variables when highlightNotFound is enabled (DOCX only; ignored for XLSX) |

**Output:** `object`

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `fileId` | string | yes |  | File ID from files table |

#### `transform.pdf-embed` — Embed PDF Text

Embed OCR text layer into scanned PDFs/images to make them searchable

**Durable retry:** Transforms, including those that write files, are not durably retried.

**Config** (in `step.with`):

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `input` | string | yes |  | File input - template expression e.g. {{input.document}} |
| `parseResult` | string | yes |  | Parse result - template expression e.g. {{steps.parse.output}} |
| `outputFilename` | string | no |  | Output filename - supports {{filename}} syntax |
| `confidenceThreshold` | number | no | `0.7` | Minimum OCR confidence (0-1) to include a word |

**Output:** `object`

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `fileId` | string | yes |  | File ID from files table |
| `pageCount` | number | yes |  | Number of pages in the output PDF |
| `wordCount` | number | yes |  | Number of words embedded |
| `text` | string | yes |  | Extracted text from the document |

#### `transform.xlsx-to-json` — Spreadsheet to JSON

Convert an XLS or XLSX spreadsheet to a JSON array of row objects. Supports headerless files, named or positional columns, displayed text, and a single rectangular range.

**Durable retry:** Transforms, including those that write files, are not durably retried.

**Config** (in `step.with`):

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `input` | string | yes |  | File input - template expression e.g. {{input.document}} resolving to a scoped $file artifact at runtime |
| `sheet` | integer \| string | no |  | Sheet to read: 0-based index or exact sheet name. Omit for the first sheet. |
| `outputCsv` | boolean | no | `false` | If true, also write CSV to storage and include fileId. Zero-config uses the historical full-sheet SheetJS CSV. When columns, range, headerRow, valueMode, blankCells, or blankRows are set, CSV matches that projection. |
| `includeMetadata` | boolean | no | `false` | If true, include sheet metadata and diagnostics in the step output. Omit to keep output as rows (and fileId when outputCsv is true). Warnings are still logged when this is false. |
| `outputFilename` | string | no |  | Output CSV filename when outputCsv is true - supports LiquidJS e.g. {{filename}}.csv |
| `headerRow` | `false` \| integer | no |  | Header row: a positive 1-based Excel row, or false to keep the first effective row as data. Omit to use the first effective row as the header. When range is set and this is omitted, the first range row is the header. |
| `columns` | array<object> | no |  | Ordered output columns. Each item needs a key and exactly one source: index (0-based absolute column) or header (exact displayed header text). Named header sources require a header row. Omit to keep every column in the effective range. |
| `valueMode` | `"raw"` \| `"displayed"` | no | `"raw"` | raw (default) returns typed cached cell values. displayed returns formatted cell text (dates, leading zeros, punctuation, diacritics, embedded newlines). Formulas are never calculated. |
| `range` | string | no |  | Optional rectangular A1 range without a sheet qualifier, e.g. A1:D20. Disjoint ranges are rejected. |
| `blankCells` | `"empty-string"` \| `"null"` \| `"omit"` | no | `"empty-string"` | How truly empty cells appear in each row object. Default empty-string. 0, false, and a formula that cached an empty string are not empty cells. |
| `blankRows` | `"skip"` \| `"keep"` | no | `"skip"` | skip (default) drops rows whose projected columns are all truly empty. keep retains them. Detection uses projected columns only. |
| `limits` | object | no |  | Optional workload caps that can only lower the server defaults. Omitted fields use the server defaults. |

**Output:** `object`

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `rows` | array<record<string, unknown>> | yes |  | Array of row objects (first row = headers as keys unless headerRow is false) |
| `fileId` | string | no |  | File ID of stored CSV when outputCsv is true |
| `sheet` | object | no |  | Selected sheet metadata after projection. Present only when includeMetadata is true. |
| `diagnostics` | array<object> | no |  | Non-fatal warnings collected while reading the sheet. Present only when includeMetadata is true. Warnings are still logged when metadata is omitted. |

#### `transform.json-to-xlsx` — JSON to XLSX

Convert JSON rows into an XLSX spreadsheet. Pair with transform.xlsx-to-json. Formula-looking strings stay text; nested cell values are rejected.

**Durable retry:** Transforms, including those that write files, are not durably retried.

**Config** (in `step.with`):

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `filename` | string | no |  | Output filename — supports LiquidJS; .xlsx is added if omitted |
| `columns` | array<object> | no |  | Ordered columns for a single-sheet workbook. Use sheets for multiple sheets. |
| `rows` | string \| array<record<string, unknown>> | no |  | Array of row objects, or a template expression that resolves to one |
| `sheets` | array<object> | no |  | Multiple sheets. Do not combine with top-level columns/rows. |
| `limits` | object | no |  | Optional workload caps that can only lower the server defaults. Omitted fields use the server defaults. |

**Output:** `object`

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `fileId` | string | yes |  | File ID from the files table |
| `filename` | string | yes |  | Sanitized output filename including .xlsx |
| `sheetCount` | integer | yes |  | Number of sheets in the workbook |
| `sheets` | array<object> | yes |  | Per-sheet name and row count |

#### `transform.script` — Script

Execute a TypeScript function in a QuickJS sandbox. Input keys become the function's parameter list, in declaration order, and the required `: R` return-type annotation IS this step's output schema: `inputs: { items, taxRate }` ⇒ `function script(items: …, taxRate: …): R { … }`.

**Durable retry:** Transforms, including those that write files, are not durably retried.

**Config** (in `step.with`):

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `inputs` | record<string, string> | no |  | Named inputs mapped from template expressions. Keys become the function parameter list in declaration order: `inputs: { items, taxRate }` ⇒ `function script(items: …, taxRate: …): R { … }`. |
| `function` | string | yes |  | TypeScript function declaration. Must be `function script(args): R { … }` where the parameter list equals `Object.keys(inputs)` in order and `R` is a return type annotation. The annotation IS this step's output schema. |
| `timeout` | number | no | `5000` | Max execution time in milliseconds (default: 5000) |
| `memoryLimit` | number | no | `10485760` | Max memory in bytes (default: 10MB) |

**Output:** `unknown`

> Value returned from script. Validated at runtime against the JSON Schema derived from the function's return type annotation.

#### `transform.text-chunker` — Text Chunker

Split long text into chunks with regex-anchored boundaries, overlap, and header preservation. Accepts raw text or a parsed-document object; chunks carry source page indexes when pages are provided.

**Durable retry:** Transforms, including those that write files, are not durably retried.

**Config** (in `step.with`):

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `input` | string \| record<string, unknown> | yes |  | Either raw text or a parsed-document object `{ pages: [{ pageIndex, text }] }` (e.g. `{{ steps.parse.output }}`). Pages preserve per-chunk page provenance. |
| `maxChars` | integer | yes |  | Target chunk size in characters. Hard ceiling per chunk is 1.5×. |
| `overlap` | integer | no | `0` | Characters duplicated at chunk boundaries (default 0). Must be < maxChars / 2. |
| `splitOn` | array<string> | no |  | Ordered list of regexes; the first that matches near the chunk boundary wins. Falls back to char-cut when none match. Tip: list narrowest first (e.g. /\d+\.\d+\s+/ before /\n\n+/). |
| `maxChunks` | integer | no | `64` | Safety cap; later chunks are dropped and `summary.truncated` flips to true. |
| `preserveHeader` | integer | no | `0` | Prepend the first N characters of the input to every chunk (good for "always include the contract title"). |
| `minChunkChars` | integer | no | `0` | Trailing chunks shorter than this are merged into the previous chunk. |

**Output:** `object`

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `chunks` | array<object> | yes |  |  |
| `summary` | object | yes |  |  |

#### `transform.regex-extract` — Regex Extract

Pull named fields from text via regex patterns (deterministic counterpart to ai.extract). Accepts raw text or a parsed-document object; matches carry `_evidence.pageIndex` when pages are provided.

**Durable retry:** Transforms, including those that write files, are not durably retried.

**Config** (in `step.with`):

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `input` | string \| record<string, unknown> | yes |  | Either raw text or a parsed-document object `{ pages: [{ pageIndex, text }] }`. Pages enable per-match `_evidence.pageIndex`. |
| `fields` | record<string, object> | yes |  | Named field → pattern mapping. |
| `flags` | string | no |  | Default regex flags applied when a field omits its own `flags`. Subset of "gimsuy". |
| `searchWindow` | integer | no |  | Only search the first N characters of input (perf). Omit for full search. |

**Output:** `record<string, unknown>`

> Field name → extracted value (or default), plus `_evidence: { [field]: { pageIndex, matchOffset, raw } }` and `_unmatched: string[]`.

### Action steps — external side effects

#### `action.http` — HTTP Request

Make an HTTP request to an external API

**Durable retry:** HTTP `GET` and `HEAD` can durably retry transient timeout, rate limits, selected retryable server failures failures. Other methods are not replayed.

**Config** (in `step.with`):

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `url` | string | yes |  | Request URL (supports template expressions) |
| `method` | `"GET"` \| `"HEAD"` \| `"POST"` \| `"PUT"` \| `"PATCH"` \| `"DELETE"` | no | `"GET"` |  |
| `headers` | record<string, string> | no |  | HTTP headers |
| `body` | unknown | no |  | Request body (JSON or string) |
| `timeout` | number | no | `30000` | Timeout in milliseconds |
| `insecureSkipTlsVerify` | boolean | no | `false` | If true, skip TLS certificate verification (use only for read-only public endpoints with bad/expired certs) |

**Output:** `object`

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `status` | number | yes |  | HTTP status code |
| `statusText` | string | yes |  |  |
| `headers` | record<string, string> | yes |  |  |
| `body` | unknown | yes |  | Response body (parsed JSON or string) |
| `responseCharset` | string | yes |  | Charset used to decode the response body (e.g. utf-8, windows-1250) |

#### `action.invoke-workflow` — Invoke Workflow

Execute another workflow and return its output

**Durable retry:** Invoked workflows are not replayed as durable leaf attempts.

**Config** (in `step.with`):

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `workflow` | string | no |  | Workflow to invoke — definition name or wf_ id (tenant-scoped) |
| `workflowId` | string | no |  | Legacy alias for workflow when the value is a wf_ id |
| `execution` | `"inline"` \| `"child"` | no |  | inline: run target steps in this execution (default). child: spawn a separate run with lineage. |
| `input` | record<string, unknown> | no |  | Input record keyed by the invoked workflow's declared inputs |
| `wait` | boolean | no |  | Child mode only. Wait for the invoked workflow to complete and return its output (default: true). Set false for fire-and-forget. |
| `timeout` | number | no |  | Child mode only. Max wait time in ms when waiting (default: 300000) |
| `pollInterval` | number | no |  | Child mode only. How often to poll status in ms when waiting (default: 1000) |

**Output:** `record<string, unknown>`

> When wait is true, the invoked workflow's declared output fields are flattened to the top level alongside a `files` array — reference them as {{ steps.<invoke>.output.<field> }} (there is no `.data` or `.result` wrapper). When wait is false, execution metadata. CLI authors can run `eigenpal workflow schema <workflow-id>` to inspect resolved fields; Studio builder agents can call `get_workflow_output_schema`.

#### `action.website-reader` — Website Reader

Fetch a webpage and convert content to markdown

**Durable retry:** Supported for transient timeout, rate limits, selected retryable server failures failures.

**Config** (in `step.with`):

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `url` | string | yes |  | Website URL to fetch (supports template expressions) |
| `timeout` | number | no | `30000` | Timeout in milliseconds |
| `encoding` | `"auto"` \| `"utf-8"` \| `"latin1"` \| `"windows-1250"` \| `"windows-1252"` \| `"iso-8859-2"` | no | `"auto"` | Response encoding. Auto detects from Content-Type header and HTML meta tags. |

**Output:** `object`

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `markdown` | string | yes |  | Page content converted to markdown |
| `title` | string \| null | yes |  | Page title |
| `excerpt` | string \| null | yes |  | Page excerpt/description |
| `byline` | string \| null | yes |  | Author information |
| `siteName` | string \| null | yes |  | Site name |
| `length` | number | yes |  | Content length in characters |
| `url` | string | yes |  | Final URL after redirects |

### Control steps — flow control

#### `control.if` — Condition

Branch execution based on a condition expression

**Durable retry:** The control container itself is not retried, but eligible leaves inside its sequential scope may retry durably.

**Config** (at step level):

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `condition` | string | yes |  | LiquidJS expression that evaluates to boolean |

**Output:** `object`

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `condition` | boolean | yes |  | Evaluated condition result |
| `branch` | `"then"` \| `"else"` | yes |  | Which branch was executed |
| `result` | unknown | yes |  | Output from executed branch |

#### `control.switch` — Switch

Multi-way routing: resolve an expression and run the first case whose value matches (else default). Cleaner than a nested control.if chain for routing an item to one of N pipelines by a discriminator field like a document type.

**Durable retry:** The control container itself is not retried, but eligible leaves inside its sequential scope may retry durably.

**Config** (at step level):

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `on` | string | yes |  | Template expression whose resolved value selects the case, e.g. "{{ doc.type }}". |
| `cases` | array<object> | yes |  | Ordered cases; the first whose `when` matches runs. Each case has its own `steps`. |

**Output:** `object`

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `matched` | string \| number \| boolean \| null | yes |  | The `when` value that matched, or null when the default (or no) branch ran. |
| `branch` | `"case"` \| `"default"` \| `"none"` | yes |  | Which branch executed. |
| `result` | unknown | yes |  | Output from the executed branch (its last step). |

#### `control.foreach` — For Each

Loop over an array and execute steps for each item

**Durable retry:** The control container itself is not retried, but eligible leaves inside its sequential scope may retry durably.

**Config** (at step level):

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `items` | string | yes |  | Expression resolving to array |
| `as` | string | yes |  | Variable name for current item |
| `indexAs` | string | no |  | Variable name for current index |

**Output:** `object`

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `items` | array<unknown> | yes |  | Results from each iteration |
| `count` | number | yes |  | Number of completed iterations |
| `totalIterations` | number | yes |  | Total iterations |

#### `control.parallel_map` — Parallel Map

Iterate over an array with concurrent execution up to a limit

**Durable retry:** The control container and leaves inside its concurrent branches do not retry durably.

**Config** (at step level):

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `items` | string | yes |  | Expression resolving to array |
| `as` | string | yes |  | Variable name for current item |
| `indexAs` | string | no |  | Variable name for current index |
| `concurrency` | integer | no | `5` | Maximum concurrent executions (1-50, default 5) |

**Output:** `object`

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `items` | array<unknown> | yes |  | Results from each iteration (maintains original order) |
| `count` | number | yes |  | Number of completed iterations |
| `totalIterations` | number | yes |  | Total iterations |

#### `control.parallel` — Parallel

Execute multiple branches concurrently

**Durable retry:** The control container and leaves inside its concurrent branches do not retry durably.

**Config** (at step level):

_No fields._

**Output:** `record<string, unknown>`

> Results keyed by branch name

#### `control.wait` — Wait

Pause workflow execution for a specified duration

**Durable retry:** This control step is not retried durably.

**Config** (at step level):

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `duration` | number | yes |  | Duration in milliseconds |

**Output:** `object`

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `waited` | number | yes |  | Actual milliseconds waited |

#### `control.fail` — Fail

Terminate the workflow with a typed status code + message. With an optional condition, only fails when the condition is truthy; otherwise always fails when reached. Pair with ai.classify or any prior step to fail fast on bad inputs.

**Durable retry:** This control step is not retried durably.

**Config** (at step level):

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `condition` | string | no |  | Optional LiquidJS expression. When set, the step only fails if this evaluates truthy; when omitted, it always fails when reached (compose with control.if for legacy gating). |
| `statusCode` | integer | no | `422` | HTTP-style status code returned to the caller (sync runs) and persisted on the execution. Default 422 (Unprocessable Entity). |
| `message` | string | yes |  | Human-readable failure message. Supports template expressions, e.g. "Document classified as {{ steps.classify.output.label }}". |

**Output:** `unknown`

> control.fail never produces output — it terminates the workflow when triggered.
<!-- GENERATED:STEP_CATALOG END -->
