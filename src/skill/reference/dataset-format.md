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
