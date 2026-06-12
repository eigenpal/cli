# Step types

The catalog is generated from `STEP_SCHEMAS` in
`@eigenpal/types/src/workflow/step-configs.ts`. **Don't memorize fields
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
  script, template, pdf-embed, xlsx-to-json). WASM sandboxed where applicable.
- `action.*` — external side effects (HTTP, invoke another workflow, website reader).
- `control.*` — flow control (if, foreach, parallel, parallel_map, wait, block, fail).

The full per-type catalog with field tables is auto-generated below from
`STEP_SCHEMAS`. The high-level map above tells you which family you want;
the catalog tells you what fields it takes.

## When to reach for what

| Use case                          | Step                                              |
| --------------------------------- | ------------------------------------------------- |
| Read a PDF / DOCX / image         | `ai.parse`                                        |
| Pull a typed object from text     | `ai.extract` with `config.schema`                 |
| Pick one label from a fixed set   | `ai.classify` with `config.labels`                |
| Reject bad inputs with a 4xx code | `control.fail` (often after `ai.classify`)        |
| Sum / filter / regex              | `transform.script` (NOT Liquid)                   |
| Render a DOCX template            | `transform.template`                              |
| Convert XLSX to JSON              | `transform.xlsx-to-json`                          |
| Merge or combine objects          | `transform.combine` / `transform.merge`           |
| Conditional execution             | `if:` on the step (Liquid) or `control.if`        |
| Map over an input array           | `forEach:` on the step or `control.foreach`       |
| Concurrent map over an array      | `control.parallel_map`                            |
| Independent parallel branches     | `control.parallel`                                |
| External HTTP call                | `action.http`                                     |
| Call another workflow             | `action.invoke-workflow`                          |
| Fetch a webpage as markdown       | `action.website-reader`                           |

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
and `control.block` contain nested steps. The auto-generated catalog below
can't render that shape, so the YAML form lives here. Same for the scoping
rules — important because the runtime treats nested steps differently from
top-level ones, and getting the access path wrong silently returns
`undefined` (no error).

### `control.parallel` — independent branches

Runs each branch concurrently. Use when several pieces of work share input
but don't depend on each other.

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
> resolves at runtime. That's an only-the-last-row footgun; the autocomplete
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

### `control.block` — call a reusable workflow block

```yaml
- name: invoice-flow
  type: control.block
  blockName: parse-invoice          # other workflow's `name:`
  inputs:
    contract: '{{ input.contract }}'
```

**Access the output:** the block's declared output fields are exposed as
top-level keys under `steps.<this-step>.output`. Block-internal steps are
not visible — the block runs in an isolated scope.

## Classify-and-fail pattern

`ai.classify` + `control.fail` together let a workflow reject bad inputs
fast with a typed HTTP-style status code that callers (and evals) can
match against. The classifier picks one label from a closed set; the
fail step terminates the run when the label is one you don't want to
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
`expected/error.json` (see `reference/dataset-format.md`). When
`condition` is omitted, `control.fail` always fails when reached, so
compose with `control.if` for legacy gating.

<!-- GENERATED:STEP_CATALOG START -->
## Full catalog

_Generated from `STEP_SCHEMAS` in `@eigenpal/types/src/workflow/step-configs.ts`. Do not hand-edit between the GENERATED fences — run `bun run --cwd packages/cli generate:skill`._

### AI steps — model-backed processing

#### `ai.parse` — Parse Document

Extract text from documents (PDF, DOCX, images) using OCR or vision models

**Config** (in `step.with`):

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `input` | string | yes |  | Storage reference or template expression for the document |
| `ocrModel` | string | no |  | OCR provider ID for PDF/image parsing |
| `llmModel` | string | no |  | LLM provider ID for vision-based parsing |
| `maxConcurrency` | number | no | `3` | Max concurrent VLM batch requests |
| `pagesPerBatch` | number | no | `5` | Number of page images per VLM request |
| `prompt` | string | no |  | Custom extraction prompt |
| `languages` | array<string> | no |  | OCR language hints |
| `outputFormat` | `"plain"` \| `"markdown"` \| `"djot"` \| `"html"` | no | `"markdown"` | Format for extracted text. `markdown` (default) keeps structure and is best for LLM extraction; `plain` is unstyled text; `djot`/`html` preserve more layout. Only the native (Kreuzberg) parser respects this — OCR/VLM always emit markdown. |
| `nativeText` | boolean | no | `false` | Extract native/embedded text from PDFs without OCR/VLM. Faster and uses no credits. Falls back to OCR/VLM if the PDF has no embedded text. |

**Output:** `object`

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `text` | string | yes |  | Extracted text content (combined from all pages) |
| `pages` | array<object> | no |  | Per-page content |
| `metadata` | record<string, unknown> | no |  | Document metadata |

#### `ai.extract` — Extract Data

Extract structured data from text using AI with a JSON schema

**Config** (in `step.with`):

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `input` | string | yes |  | Text content or template expression |
| `schema` | object | yes |  | JSON Schema defining the structure to extract |
| `prompt` | string | no |  | Custom prompt template for extraction |
| `provider` | string | no |  | Provider ID (e.g., "openai-gpt4o") |
| `model` | string | no |  | Model override |
| `maxInputTokens` | integer | no |  | Max input tokens. Truncates input text and logs a warning when exceeded. Omit for no limit. |

**Output:** `record<string, unknown>`

> Extracted structured data matching the provided schema

#### `ai.split` — Split Document

Split a parsed document into named sections using an LLM. Consumes ai.parse output; emits per-section page ranges and text ready for downstream ai.extract via control.parallel_map.

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

#### `ai.classify` — Classify

Classify a document or text into one of a fixed label set using an LLM. Output exposes the picked label (constrained to the configured names), a coarse confidence, and a short justification. Pair with control.fail to reject documents that match an undesired label.

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

### Transform steps — deterministic data transforms

#### `transform.set` — Set Value

Set key-value pairs in the output object

**Config** (in `step.with`):

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `fields` | record<string, unknown> | yes |  | Key-value pairs to set in output |
| `input` | record<string, unknown> | no |  | Base object to extend |

**Output:** `record<string, unknown>`

> Object with all fields set

#### `transform.remove` — Remove Fields

Remove specified fields from an object

**Config** (in `step.with`):

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `input` | record<string, unknown> | no |  | Object to remove fields from |
| `fields` | array<string> | yes |  | Field names to remove |

**Output:** `record<string, unknown>`

> Object with fields removed

#### `transform.combine` — Combine Data

Merge multiple objects or concatenate arrays

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

Fill a DOCX template with data. Use list_templates tool to get template IDs and their placeholder schemas.

**Config** (in `step.with`):

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `templateId` | string | yes |  | ID of the template from templates table |
| `data` | record<string, unknown> | yes |  | Data object to merge into template. Each key must be explicitly defined - cannot pass a whole object as single expression |
| `outputFilename` | string | no |  | Output filename - supports {{field}} syntax |
| `highlightNotFound` | boolean | no | `true` | Highlight missing variables with red-colored text in the output document |
| `notFoundText` | string | no | `"NOT FOUND"` | Text to display for missing variables when highlightNotFound is enabled |

**Output:** `object`

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `fileId` | string | yes |  | File ID from files table |

#### `transform.pdf-embed` — Embed PDF Text

Embed OCR text layer into scanned PDFs/images to make them searchable

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

#### `transform.xlsx-to-json` — XLSX to JSON

Convert XLSX spreadsheet to JSON array of row objects for use in scripts or downstream steps

**Config** (in `step.with`):

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `input` | string | yes |  | File input - template expression e.g. {{input.document}} resolving to fileId or file path descriptor |
| `sheet` | integer \| string | no |  | Sheet to read: 0-based index or sheet name. Omit for first sheet. |
| `outputCsv` | boolean | no | `false` | If true, also write CSV to storage and include fileId in output |
| `outputFilename` | string | no |  | Output CSV filename when outputCsv is true - supports LiquidJS e.g. {{filename}}.csv |

**Output:** `object`

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `rows` | array<record<string, unknown>> | yes |  | Array of row objects (first row = headers as keys) |
| `fileId` | string | no |  | File ID of stored CSV when outputCsv is true |

#### `transform.script` — Script

Execute a TypeScript function in a QuickJS sandbox. Input keys become the function's parameter list, in declaration order, and the required `: R` return-type annotation IS this step's output schema: `inputs: { items, taxRate }` ⇒ `function script(items: …, taxRate: …): R { … }`.

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

**Config** (in `step.with`):

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `url` | string | yes |  | Request URL (supports template expressions) |
| `method` | `"GET"` \| `"POST"` \| `"PUT"` \| `"PATCH"` \| `"DELETE"` | no | `"GET"` |  |
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

**Config** (in `step.with`):

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `workflowId` | string | yes |  | ID of workflow to invoke |
| `input` | record<string, unknown> | no |  | Input to pass to workflow |
| `wait` | boolean | no |  | If true, wait for the invoked workflow to complete (default: false) |
| `timeout` | number | no |  | Max wait time in ms when wait=true (default: 300000) |
| `pollInterval` | number | no |  | How often to poll status in ms when wait=true (default: 1000) |

**Output:** `record<string, unknown>`

> Output from invoked workflow

#### `action.website-reader` — Website Reader

Fetch a webpage and convert content to markdown

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

#### `control.foreach` — For Each

Loop over an array and execute steps for each item

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

**Config** (at step level):

_No fields._

**Output:** `record<string, unknown>`

> Results keyed by branch name

#### `control.wait` — Wait

Pause workflow execution for a specified duration

**Config** (at step level):

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `duration` | number | yes |  | Duration in milliseconds |

**Output:** `object`

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `waited` | number | yes |  | Actual milliseconds waited |

#### `control.block` — Block

Execute a reusable block workflow inline with input/output mapping

**Config** (at step level):

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `blockName` | string | yes |  | Name of the block to execute |
| `inputs` | record<string, unknown> | no |  | Input mapping for the block |

**Output:** `record<string, unknown>`

> Output from block's declared output mapping

#### `control.fail` — Fail

Terminate the workflow with a typed status code + message. With an optional condition, only fails when the condition is truthy; otherwise always fails when reached. Pair with ai.classify or any prior step to fail fast on bad inputs.

**Config** (at step level):

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `condition` | string | no |  | Optional LiquidJS expression. When set, the step only fails if this evaluates truthy; when omitted, it always fails when reached (compose with control.if for legacy gating). |
| `statusCode` | integer | no | `422` | HTTP-style status code returned to the caller (sync runs) and persisted on the execution. Default 422 (Unprocessable Entity). |
| `message` | string | yes |  | Human-readable failure message. Supports template expressions, e.g. "Document classified as {{ steps.classify.output.label }}". |

**Output:** `unknown`

> control.fail never produces output — it terminates the workflow when triggered.
<!-- GENERATED:STEP_CATALOG END -->
