# Dataset folder format

A dataset is a folder of named example folders. The folder structure
itself is the manifest — there is no top-level `manifest.json`. The
import endpoint **rejects** archives that contain one (legacy format).

This is the format the CLI builds and ships to
`eigenpal workflow dataset push <workflow-id> --file dataset/`. After it lands
on the server, the canonical per-row surface is
`eigenpal workflow dataset example {get,create,update,delete}` (and
`dataset list` for a table view) — the local folder is a pre-push
staging area, not a synced mirror.

## Required layout

```
dataset/
└── examples/
    ├── invoice-foo/
    │   ├── input/
    │   │   ├── arguments.json              REQUIRED — { language: "en" }
    │   │   └── contract/                   file-argument folder
    │   │       ├── Contract_2026.pdf
    │   │       └── Appendix.pdf
    │   ├── expected/
    │   │   ├── output.json                 OPTIONAL — raw ground truth JSON
    │   │   └── generated_invoice/          OPTIONAL — expected file output
    │   │       └── Invoice.docx
    │   └── meta.json                       OPTIONAL — { rowOrder?, annotation?, overrides? }
    │
    └── invoice-bar/
        └── input/
            └── arguments.json              { amount: 42 }
```

The `expected/` subfolder mirrors `input/` exactly — `output.json` is
the scalar/object data ground truth, and any expected file outputs go
in `expected/<docKey>/<file>` folders (one folder per output path).

## Rules (every one is enforced server-side at import)

- **Folder names** (example names, argument names, expected document
  keys) must match `[a-z0-9][a-z0-9-_]*`.
- **`input/arguments.json`** is REQUIRED for every example, even if it's
  just `{}`. It must be a JSON object (not array, not literal).
- **File-arguments** live in `input/<arg-name>/<filename>`. The
  materialized shape on `triggerInput` is **driven by the workflow YAML's
  `inputs[].type`**, not by the file count:

  | workflow.yaml input                        | dataset folder            | `triggerInput.<name>` |
  | ------------------------------------------ | ------------------------- | --------------------- |
  | `type: file`                               | `input/<name>/<one-file>` | `{ fileId }`          |
  | `type: array`, `items: { type: file }`     | `input/<name>/<file>...`  | `[{ fileId }, ...]`   |

  Reference single-file inputs as `{{ input.<name> }}` (resolves to the
  `{ fileId }` object the worker reads). Reference array-of-file inputs
  as `{{ input.<name>[0] }}` etc. Dropping multiple binaries into an
  `input/<name>/` folder for an input declared `type: file` is rejected
  at import with `code: single_file_input_overpopulated` — either trim
  to one file or change the workflow input to the array form.
- **Argument-name collisions are rejected.** If `arguments.json` has
  `{"contract": "..."}` AND `input/contract/file.pdf` exists, import
  fails with `code: argument_name_collision`.
- **`expected/output.json`** is OPTIONAL. When present, it must be a
  JSON object that mirrors your workflow's `output:` shape 1:1 — no
  envelope, no wrapper. A scalar/array at the top level is rejected
  with `code: invalid_expected_output`.

  > **Note:** the importer is idempotent and accepts both bare objects and
  > pre-wrapped `{ data: { ... } }` forms; bare is preferred.

  ```json
  // workflow.yaml
  // output:
  //   invoiceNumber: '{{ steps.extract.output.invoiceNumber }}'
  //   totalAmount:   '{{ steps.extract.output.totalAmount }}'
  //
  // → expected/output.json
  {
    "invoiceNumber": "INV-001",
    "totalAmount": 1234.56
  }
  ```
- **Expected file outputs** live in `expected/<docKey>/<filename>` —
  symmetric with `input/<argName>/<file>`. Each `<docKey>` folder is
  uploaded and becomes an `expectedDocuments[docKey]` entry server-side
  (single file ⇒ `{fileId}`, multiple ⇒ `[{fileId}, …]`). The judge
  compares by file presence + content, not byte-equal.
- **`meta.json`** is OPTIONAL. Schema:
  ```json
  {
    "rowOrder": 0,
    "annotation": "free-form notes about this example",
    "overrides": {
      "steps": {
        "<stepName>": { ...stepOutputObject }
      }
    }
  }
  ```
  - `rowOrder` — sort order in the dashboard
  - `annotation` — surfaced in the UI; useful for "why this case is
    interesting" notes
  - `overrides.steps.<stepName>` — short-circuits the named step,
    returns the override as the step's output. Use for steps that
    depend on external state (third-party APIs, private connectors) so the rest
    of the example can still run.
- **Path-traversal patterns** (`..`, leading `/`, backslashes, null
  bytes) reject the whole archive.

## How the row materializes

For an example with:

- `arguments.json`: `{"language": "en"}`
- `input/contract/Contract_2026.pdf`
- `input/contract/Appendix.pdf`
- `expected/output.json`: `{"invoiceNumber": "INV-001"}`
- `expected/generated_invoice/Invoice.docx`

The server materializes:

```json
// eval_examples.triggerInput
{
  "language": "en",
  "contract": [
    { "fileId": "file_abc..." },
    { "fileId": "file_def..." }
  ]
}

// eval_examples.expectedOutput
{
  "data": { "invoiceNumber": "INV-001" },
  "expectedDocuments": {
    "generated_invoice": { "fileId": "file_ghi..." }
  }
}
```

Each file is uploaded to S3 with a fresh `fileId`; the original
filename is preserved on the `files` row and shows up in the dashboard.
The `expectedOutput` envelope (`{ data?, expectedDocuments? }`) is
internal storage shape — your dataset folder stays clean (raw
`output.json` + per-docKey folders).

## Validate before pushing

```bash
eigenpal workflow validate dataset ./dataset
```

Reports per-example issues:

```
✗ dataset (./dataset) — 2 issues
  examples/Invoice-Foo                   Folder name must be lowercase kebab/snake-case.
  examples/foo/input/contract            Argument-name collision: "contract" appears in both arguments.json and as an input/ folder.
```

## Push

```bash
# Replace = wipes existing examples for the workflow, uploads the folder fresh.
eigenpal workflow dataset push <workflow-id> --file ./dataset --mode replace

# Append = adds to whatever's already on the server.
eigenpal workflow dataset push <workflow-id> --file ./dataset --mode append
```

The endpoint streams progress as NDJSON. The terminal `done` event
includes `{ created, expectedSet, … }`:

- `created` — examples successfully persisted
- `expectedSet` — how many of those carried an `expected/output.json`.
  If `expectedSet < created`, your zip didn't include the `expected/`
  folders — the dashboard's "Expected" tab will be blank and evals
  will only run un-graded.

## Editing a dataset on the server

To inspect or round-trip what's currently on the server:

```bash
eigenpal workflow dataset list <workflow-id>
eigenpal workflow dataset pull <workflow-id> --out current.zip
# (or omit --out to stream the zip to stdout for piping)
```

For bulk changes — many examples at once, schema-level rework, file
swaps — edit the local folder and re-push with
`dataset push --mode replace`.

For one-row tweaks — capturing a corrected output as the new GT,
deleting one bad example, adding one example to a known dataset — use
the per-example CRUD commands instead. They avoid the round-trip of
re-zipping and re-uploading the whole folder.

### Inspect one example end-to-end

```bash
eigenpal workflow dataset example get <workflow-id> <example-id>
eigenpal workflow dataset example get <workflow-id> <example-id> --json | jq '.expectedOutput'
```

Pretty mode prints labelled `Inputs` / `Expected` / `Metadata` sections;
`--json` returns the full row (`triggerInput`, `expectedOutput`,
`annotation`, `rowOrder`, timestamps) for piping.

### Capture a corrected output as the new ground truth

```bash
# 1. Look at what the workflow actually returned for the example
eigenpal workflow execution get exec_… --json | jq '.output.data' > /tmp/correct.json

# 2. Patch the example's expected output in place. PATCH semantics:
#    every flag you omit is left alone.
eigenpal workflow dataset example update <workflow-id> <example-id> \
  --expected-file /tmp/correct.json
```

`--expected-file -` reads JSON from stdin if you'd rather pipe. Pass
empty string to clear an annotation: `--annotation ""`.

### Add one new example

```bash
eigenpal workflow dataset example create <workflow-id> \
  --name missing-required-field \
  --input-json '{"language":"en"}' \
  --expected-file /tmp/expected.json \
  --annotation "edge case: required field absent from input"
```

`--input-json` / `--expected-json` accept inline JSON literals; the
`-file` variants read from disk (or `-` for stdin). They're mutually
exclusive — pass one or the other, not both.

File-arg uploads still go through `dataset push`; CRUD only handles
scalar args + `expected/output.json`-style outputs.

### Delete one bad example

```bash
eigenpal workflow dataset example delete <workflow-id> <example-id> --yes
```

`--yes` is required for non-TTY shells (CI). Interactive shells may
omit it; single-row deletes have a small blast radius compared to
`dataset push --mode replace`, so no confirmation prompt fires.
