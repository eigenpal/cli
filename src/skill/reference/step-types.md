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

- `ai.*` — model-backed processing (parse, extract). Cost + latency depend on the model.
- `transform.*` — deterministic data transforms (set, remove, combine, split, merge,
  script, template, pdf-embed, xlsx-to-json). WASM sandboxed where applicable.
- `action.*` — external side effects (HTTP, invoke another workflow, website reader).
- `control.*` — flow control (if, foreach, parallel, parallel_map, wait, approval, block).

The full per-type catalog with field tables is auto-generated below from
`STEP_SCHEMAS`. The high-level map above tells you which family you want;
the catalog tells you what fields it takes.

## When to reach for what

| Use case                      | Step                                              |
| ----------------------------- | ------------------------------------------------- |
| Read a PDF / DOCX / image     | `ai.parse`                                        |
| Pull a typed object from text | `ai.extract` with `config.schema`                 |
| Sum / filter / regex          | `transform.script` (NOT Liquid)                   |
| Render a DOCX template        | `transform.template`                              |
| Convert XLSX to JSON          | `transform.xlsx-to-json`                          |
| Merge or combine objects      | `transform.combine` / `transform.merge`           |
| Conditional execution         | `if:` on the step (Liquid) or `control.if`        |
| Map over an input array       | `forEach:` on the step or `control.foreach`       |
| Concurrent map over an array  | `control.parallel_map`                            |
| Independent parallel branches | `control.parallel`                                |
| Pause for human approval      | `control.approval`                                |
| External HTTP call            | `action.http`                                     |
| Call another workflow         | `action.invoke-workflow`                          |
| Fetch a webpage as markdown   | `action.website-reader`                           |

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

- Explicit `inputs:` declaration → the validator knows the data deps
- `outputSchema:` enforces the return shape at runtime
- Real JS — `Array.prototype.reduce`, `JSON.parse`, etc.
- Sandbox limits prevent infinite loops from blowing up an execution

> **Common gotcha — TDZ on shadowed input names.** Each entry in `inputs`
> becomes a top-level `const` binding inside your script. Re-declaring the
> same name in the body shadows the binding and triggers a `ReferenceError:
> Cannot access 'X' before initialization` (Temporal Dead Zone). For example:
>
> ```js
> // ✗ TDZ — `located` is the input AND the inner const
> const located = located || [];
>
> // ✓ Rename the inner variable
> const safeLocated = located ?? [];
> ```
>
> If you need a default, use `??` / `||` against the binding directly without
> redeclaring, or rename the local. The same applies to `let` redeclarations.

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
| `temperature` | number | no | `0` | Model temperature (0 = deterministic) |
| `maxInputTokens` | integer | no |  | Max input tokens. Truncates input text and logs a warning when exceeded. Omit for no limit. |

**Output:** `record<string, unknown>`

> Extracted structured data matching the provided schema

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

Execute JavaScript code in a secure sandbox. Input keys become TOP-LEVEL variables (use "items" not "inputs.items"). Must return a value.

**Config** (in `step.with`):

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `inputs` | record<string, string> | no |  | Named inputs mapped from template expressions. IMPORTANT: Keys become TOP-LEVEL variables in code (e.g., if key is "items", use "items" not "inputs.items"). |
| `code` | string | yes |  | JavaScript code. Input keys are available as top-level variables (NOT as inputs.key). Must return a value. |
| `outputSchema` | record<string, unknown> | no |  | JSON Schema describing the expected return value. Used for validation and type hints. |
| `timeout` | number | no | `5000` | Max execution time in milliseconds (default: 5000) |
| `memoryLimit` | number | no | `10485760` | Max memory in bytes (default: 10MB) |

**Output:** `unknown`

> Value returned from script (validated against outputSchema if provided)

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

#### `control.approval` — Approval

Pause workflow for human approval before continuing

**Config** (at step level):

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `message` | string | no |  | Message to display for approval |
| `timeoutMinutes` | number | no | `1440` | Auto-reject after timeout |
| `notifyEmail` | string | no |  | Email to notify |

**Output:** `object`

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `approved` | boolean | yes |  | Whether the request was approved |
| `approvedBy` | string | no |  | Who approved |
| `approvedAt` | string | no |  | When approved |
| `comment` | string | no |  | Approver comment |

#### `control.block` — Block

Execute a reusable block workflow inline with input/output mapping

**Config** (at step level):

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `blockName` | string | yes |  | Name of the block to execute |
| `inputs` | record<string, unknown> | no |  | Input mapping for the block |

**Output:** `record<string, unknown>`

> Output from block's declared output mapping
<!-- GENERATED:STEP_CATALOG END -->
