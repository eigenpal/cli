# Dataset folder format

A dataset is a folder of named example folders. The folder structure itself is
the manifest; there is no top-level `manifest.json`, and the import endpoint
rejects archives that contain one.

This is the archive format for automation datasets, shared by workflows and
agents. `eigenpal workflow dataset push <workflow-id> --file dataset/` builds
this archive locally and sends it to the server.

## Required layout

```text
dataset/
└── examples/
    ├── invoice-foo/
    │   ├── input.json                      REQUIRED — full run input object
    │   ├── input/
    │   │   ├── Contract_2026.pdf           referenced by input.json
    │   │   └── Appendix.pdf
    │   ├── expected.json                   OPTIONAL — expected output or { "$error": ... }
    │   ├── expected/
    │   │   └── Invoice.docx                referenced by expected.json
    │   └── meta.json                       OPTIONAL — { rowOrder?, annotation?, overrides? }
    │
    └── unsupported-format/
        ├── input.json
        └── expected.json                   { "$error": { "code": 422 } }
```

`input.json` is the source of truth for the full automation input. File values
are explicit references:

```json
{
  "language": "en",
  "contract": [
    { "$file": "input/Contract_2026.pdf" },
    { "$file": "input/Appendix.pdf" }
  ]
}
```

`expected.json` mirrors the expected automation output. Expected files use the
same reference shape with the `expected/` prefix.

## Rules

- Example folder names must match `[a-z0-9][a-z0-9-_]*`.
- Every example needs `input.json`, even if it is `{}`. It must be a JSON object.
- Files under `input/` must be referenced from `input.json` as
  `{ "$file": "input/<path>" }`.
- Files under `expected/` must be referenced from `expected.json` as
  `{ "$file": "expected/<path>" }`.
- File references cannot use `..`, absolute paths, backslashes, or null bytes.
- `expected.json` is optional. When present, it must be a JSON object.
- Failure-expected examples use `expected.json` with a single `$error` key.
  They are supported for workflow datasets only; agent datasets reject them,
  because agent runs are evaluated only when they complete:

```json
{
  "$error": {
    "code": 422,
    "messageContains": "unsupported document type",
    "step": "reject-unsupported"
  }
}
```

The `$error` object must contain at least one of `code`, `messageContains`, or
`step`. It asserts that the automation should fail with a matching typed
`control.fail` envelope.

## How a row materializes

For an example with:

- `input.json`: `{"language":"en","contract":[{"$file":"input/Contract_2026.pdf"},{"$file":"input/Appendix.pdf"}]}`
- `input/Contract_2026.pdf`
- `input/Appendix.pdf`
- `expected.json`: `{"invoiceNumber":"INV-001","generatedInvoice":{"$file":"expected/Invoice.docx"}}`
- `expected/Invoice.docx`

The stored row keeps the same input shape. When the example runs, each `$file`
reference is resolved into the S3 file descriptor the worker consumes.

```json
{
  "language": "en",
  "contract": [
    { "kind": "s3", "ref": ".../input/Contract_2026.pdf", "filename": "Contract_2026.pdf" },
    { "kind": "s3", "ref": ".../input/Appendix.pdf", "filename": "Appendix.pdf" }
  ]
}
```

Each file is uploaded to S3 and the original filename is preserved.

## Validate before pushing

```bash
eigenpal workflow dataset validate ./dataset
```

Example output:

```text
✗ dataset (./dataset) — 2 issues
  examples/Invoice-Foo              Folder name must be lowercase kebab/snake-case.
  examples/foo/input.json:contract  Referenced file does not exist: input/contract.pdf.
```

## Push

```bash
# Replace wipes existing examples for the automation, uploads the folder fresh.
eigenpal workflow dataset push <workflow-id> --file ./dataset --mode replace

# Append adds to whatever is already on the server.
eigenpal workflow dataset push <workflow-id> --file ./dataset --mode append
```

The endpoint streams progress as NDJSON. The terminal `done` event includes
`{ created, expectedSet, … }`:

- `created` — examples successfully persisted.
- `expectedSet` — how many of those carried an `expected.json`. If
  `expectedSet < created`, the rest run un-graded.

## Editing a dataset on the server

To inspect or round-trip what is currently on the server:

```bash
eigenpal workflow dataset list <workflow-id>
eigenpal workflow dataset pull <workflow-id> --out current.zip
```

For bulk changes, edit the local folder and re-push with
`dataset push --mode replace`. For one-row tweaks, use
`eigenpal workflow dataset example {get,create,update,delete}`. File uploads
still go through `dataset push`; CRUD only handles JSON input and
`expected.json`-style outputs.

<!-- GENERATED:DATASET_REFERENCE START -->
## Schema reference

_Generated from `@eigenpal/types/src/eval/dataset-archive.ts`, `expected-error.ts`, and `scoped-file-ref.ts`. Do not hand-edit between the GENERATED fences — run `bun run --cwd packages/cli generate:skill`._

### Archive layout (canonical)

```text
examples/<name>/input.json                REQUIRED — full run input object
examples/<name>/input/<file>              OPTIONAL — referenced from input.json
examples/<name>/expected.json             OPTIONAL — success output or `{ "$error": ... }`
examples/<name>/expected/<file>           OPTIONAL — referenced from expected.json
examples/<name>/meta.json                 OPTIONAL — see `DatasetMetaSchema` below
```

Importers reject any archive containing a top-level `manifest.json` (legacy layout). Example folder names must match:

`^[a-z0-9][a-z0-9-_]*$`

### `input.json` file references

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `$file` | string | yes |  | Owner-relative artifact path |


Input files live under `input/` and are referenced as `{ "$file": "input/<path>" }`. Expected files use the `expected/` prefix in `expected.json`.

### `expected.json` — success-expected output

When grading success, `expected.json` is a JSON object mirroring the workflow `output:` shape. File values use `{ "$file": "expected/<path>" }`.

### `expected.json` — failure-expected (`$error`)

Failure-expected examples store a single top-level `$error` object. At least one of `code`, `messageContains`, or `step` is required:

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `code` | integer | no |  |  |
| `messageContains` | string | no |  |  |
| `step` | string | no |  |  |


### `meta.json` (`DatasetMetaSchema`)

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `rowOrder` | integer | no |  | Non-negative display order hint for this example. |
| `annotation` | string | no |  | Free-form example note, limited to 2000 characters. |
| `overrides` | record<string, unknown> | no |  | Per-step output overrides as `{ "steps": { "<stepName>": <outputObject> } }`; overridden steps are skipped or partially merged during evaluation. |


### Import mode (`DatasetImportModeSchema`)

Allowed values: `"append"` \| `"replace"`

- `append` — add examples to the existing dataset.
- `replace` — wipe existing examples and import the archive fresh.

### Validation rules enforced at import

- Every example requires `input.json` as a JSON object (may be `{}`).
- Files under `input/` must be referenced from `input.json`; unreferenced files are rejected.
- Files under `expected/` must be referenced from `expected.json` when present.
- File reference paths cannot use `..`, absolute paths, backslashes, or null bytes.
- `$error` examples are supported for workflow datasets only; agent datasets reject them.
- Archives larger than 500 MB are rejected at import.

### Complete machine-readable component schemas

`meta.json`:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "rowOrder": {
      "description": "Non-negative display order hint for this example.",
      "type": "integer",
      "minimum": 0,
      "maximum": 9007199254740991
    },
    "annotation": {
      "description": "Free-form example note, limited to 2000 characters.",
      "type": "string",
      "maxLength": 2000
    },
    "overrides": {
      "description": "Per-step output overrides as `{ \"steps\": { \"<stepName>\": <outputObject> } }`; overridden steps are skipped or partially merged during evaluation.",
      "type": "object",
      "propertyNames": {
        "type": "string"
      },
      "additionalProperties": {}
    }
  },
  "additionalProperties": false
}
```


Failure-expected `$error` object:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "code": {
      "type": "integer",
      "minimum": 400,
      "maximum": 599
    },
    "messageContains": {
      "type": "string",
      "minLength": 1,
      "maxLength": 1000
    },
    "step": {
      "type": "string",
      "minLength": 1,
      "maxLength": 200
    }
  },
  "additionalProperties": false
}
```


Scoped `$file` reference:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "$file": {
      "type": "string",
      "minLength": 1,
      "description": "Owner-relative artifact path"
    }
  },
  "required": [
    "$file"
  ],
  "additionalProperties": false
}
```
<!-- GENERATED:DATASET_REFERENCE END -->
