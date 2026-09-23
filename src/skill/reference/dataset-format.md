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
    │   │   └── invoice/                    file folder (one folder per expected file)
    │   │       └── Invoice.docx            referenced by expected.json
    │   └── meta.json                       OPTIONAL — { rowOrder?, annotation?, overrides?, review? }
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
- Entries directly under `expected/` must be file folders (one folder per
  expected file, lowercase kebab/snake-case) — bare files are rejected by
  `dataset validate`. `input/` files may sit at the top level.
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
- `expected.json`: `{"invoiceNumber":"INV-001","generatedInvoice":{"$file":"expected/invoice/Invoice.docx"}}`
- `expected/invoice/Invoice.docx`

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

## Human review fixtures (`meta.json`)

When a workflow includes `control.human_review`, attach optional `review`
fixtures to `examples/<name>/meta.json`. Evaluation runs simulate review and
never pause — fixtures assert selection routing and optional simulated edits.

```json
{
  "review": {
    "version": 1,
    "steps": {
      "review-invoice": {
        "fields": {
          "/total": {
            "expectedRoute": "review",
            "expectedReason": "low_confidence",
            "expectedValue": 42
          }
        },
        "simulate": {
          "outcome": "approved",
          "edits": { "/total": 42 }
        }
      }
    }
  }
}
```

Keys under `steps` match the human review step name. `expectedRoute` is `review`
or `skip`. `expectedReason` matches selection reason codes such as
`low_confidence`, `always`, or `threshold_met`. `simulate.outcome` is currently
`approved`; `simulate.edits` applies reviewer corrections during the simulated
path. Omit `simulate` to assert routing only.

<!-- GENERATED:DATASET_META_REVIEW START -->
Schema for `meta.json` → `review` (from `HumanReviewEvaluationFixtureSchema` in `@eigenpal/types`):

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "version": {
      "type": "number",
      "const": 1
    },
    "steps": {
      "type": "object",
      "propertyNames": {
        "type": "string",
        "minLength": 1
      },
      "additionalProperties": {
        "type": "object",
        "properties": {
          "fields": {
            "default": {},
            "type": "object",
            "propertyNames": {
              "type": "string"
            },
            "additionalProperties": {
              "type": "object",
              "properties": {
                "expectedRoute": {
                  "type": "string",
                  "enum": [
                    "review",
                    "skip"
                  ]
                },
                "expectedReason": {
                  "type": "string",
                  "enum": [
                    "always",
                    "explicit",
                    "low_confidence",
                    "missing_confidence",
                    "all",
                    "reviewer_edit",
                    "threshold_met",
                    "never",
                    "excluded",
                    "unmatched",
                    "missing_confidence_skip"
                  ]
                },
                "expectedValue": {
                  "anyOf": [
                    {
                      "type": "string"
                    },
                    {
                      "type": "number"
                    },
                    {
                      "type": "boolean"
                    },
                    {
                      "type": "null"
                    }
                  ]
                }
              },
              "additionalProperties": false
            }
          },
          "simulate": {
            "type": "object",
            "properties": {
              "outcome": {
                "type": "string",
                "const": "approved"
              },
              "edits": {
                "type": "object",
                "propertyNames": {
                  "type": "string"
                },
                "additionalProperties": {
                  "anyOf": [
                    {
                      "type": "string"
                    },
                    {
                      "type": "number"
                    },
                    {
                      "type": "boolean"
                    },
                    {
                      "type": "null"
                    }
                  ]
                }
              }
            },
            "additionalProperties": false
          }
        },
        "required": [
          "fields"
        ],
        "additionalProperties": false
      }
    }
  },
  "required": [
    "version",
    "steps"
  ],
  "additionalProperties": false
}
```
<!-- GENERATED:DATASET_META_REVIEW END -->

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

## Dataset review requests

> **Review-first flow (agents: follow this automatically).** When building a
> new workflow or agent and you were given any examples: push the dataset,
> ship a V0, then request a dataset review as the first step — before
> iterating to perfection. Light iteration on an unreviewed dataset is fine,
> but evaluators, experiments, and versions must wait for reviewed ground
> truth: poll `.progress.complete`, reconcile manually, then close the request.

When reviewers need to approve, edit, or reject ground-truth expected
outputs without direct dataset write access, create a review request that
snapshots selected examples. The server copies each example's `input.json`
and `expected.json` values at creation time; file pointers stay as S3
references. Reviewers approve, reject (recommendation only — nothing is
deleted), leave comments, and record per-field decisions. Expected-output
files are reviewable the same way: reviewers correct bytes (`edit-file`,
either fixing an existing path or uploading a brand-new one) and record
per-file approve/reject with notes (`file-decision`); items carry
`currentExpectedFiles` (null means pristine snapshot) and `fileDecisions`.
There is **no auto-apply** by design: after review, `dataset pull` and
manually reconcile each example into the live dataset (reviewers can err).
Close via `update --status closed`.

```bash
# Ask a reviewer to inspect specific fields, with reasons, then poll until done.
eigenpal workflow dataset review-request create <automation-id> \
  --title "Q1 invoice GT review" \
  --example-name invoice-foo --example-name invoice-bar \
  --instructions "Check IBAN checksums and invoice totals." \
  --focus vendor.iban --focus-reason 'vendor.iban=OCR often mangles IBANs' \
  --ignore currency \
  --field-note 'invoice-foo.total=off by 0.01 last run' \
  --status open --json

# List requests; `.progress.complete` means every example was decided.
eigenpal workflow dataset review-request list <automation-id> --status open --json

# Inspect items (includes fieldDecisions, fileDecisions, currentExpectedFiles, inputDrifted), focus, and notes.
eigenpal workflow dataset review-request get <automation-id> <review-id> --json
eigenpal workflow dataset review-request events <automation-id> <review-id> --json

# Per-field decision (approved | rejected). --clear / --decision null removes it.
eigenpal workflow dataset review-request item <automation-id> <review-id> <item-id> \
  --action field-decision --field-path vendor.iban --decision approved \
  --expected-updated-at <iso> --json

# Expected-output files are first-class reviewable units, mirroring fields:
# identity-by-path, versioned bytes, durable approve/reject + notes. Fetch
# each example's files (reviewer-corrected when the item has an overlay entry,
# else the snapshot) into <out>/<example>/expected/ plus item.json, correct
# bytes with edit-file, then record per-file decisions.
eigenpal workflow dataset review-request pull <automation-id> <review-id> --out ./review-dsr
eigenpal workflow dataset review-request item <automation-id> <review-id> <item-id> \
  --action edit-file --file-path expected/report.pdf --file ./report-fixed.pdf \
  --comment "fixed total" --expected-updated-at <iso> --json
eigenpal workflow dataset review-request item <automation-id> <review-id> <item-id> \
  --action edit-file --new-path expected/appendix.pdf --file ./appendix.pdf \
  --expected-updated-at <iso> --json

# Per-file decision (approved | rejected). --clear / --decision null removes
# it. A --comment without a decision is a note and needs an existing decision.
eigenpal workflow dataset review-request item <automation-id> <review-id> <item-id> \
  --action file-decision --file-path expected/report.pdf --decision approved \
  --comment "totals match" --expected-updated-at <iso> --json

# Per-example reject is a recommendation only — nothing is deleted.
eigenpal workflow dataset review-request item <automation-id> <review-id> <item-id> \
  --action reject --comment "wrong vendor" --expected-updated-at <iso> --json

# Pull snapshots and MANUAL reconcile into the dataset, then close.
eigenpal workflow dataset pull <automation-id> --out ./dataset.zip
eigenpal workflow dataset review-request update <automation-id> <review-id> \
  --status closed --json
```

The same commands exist under `eigenpal agents dataset review-request …` for
agent automations.

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
| `review` | object | no |  | Optional human-review evaluation fixture: expected field routes and simulated approvals or edits for this example. |


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
    },
    "review": {
      "description": "Optional human-review evaluation fixture: expected field routes and simulated approvals or edits for this example.",
      "type": "object",
      "properties": {
        "version": {
          "type": "number",
          "const": 1
        },
        "steps": {
          "type": "object",
          "propertyNames": {
            "type": "string",
            "minLength": 1
          },
          "additionalProperties": {
            "type": "object",
            "properties": {
              "fields": {
                "default": {},
                "type": "object",
                "propertyNames": {
                  "type": "string"
                },
                "additionalProperties": {
                  "type": "object",
                  "properties": {
                    "expectedRoute": {
                      "type": "string",
                      "enum": [
                        "review",
                        "skip"
                      ]
                    },
                    "expectedReason": {
                      "type": "string",
                      "enum": [
                        "always",
                        "explicit",
                        "low_confidence",
                        "missing_confidence",
                        "all",
                        "reviewer_edit",
                        "threshold_met",
                        "never",
                        "excluded",
                        "unmatched",
                        "missing_confidence_skip"
                      ]
                    },
                    "expectedValue": {
                      "anyOf": [
                        {
                          "type": "string"
                        },
                        {
                          "type": "number"
                        },
                        {
                          "type": "boolean"
                        },
                        {
                          "type": "null"
                        }
                      ]
                    }
                  },
                  "additionalProperties": false
                }
              },
              "simulate": {
                "type": "object",
                "properties": {
                  "outcome": {
                    "type": "string",
                    "const": "approved"
                  },
                  "edits": {
                    "type": "object",
                    "propertyNames": {
                      "type": "string"
                    },
                    "additionalProperties": {
                      "anyOf": [
                        {
                          "type": "string"
                        },
                        {
                          "type": "number"
                        },
                        {
                          "type": "boolean"
                        },
                        {
                          "type": "null"
                        }
                      ]
                    }
                  }
                },
                "additionalProperties": false
              }
            },
            "required": [
              "fields"
            ],
            "additionalProperties": false
          }
        }
      },
      "required": [
        "version",
        "steps"
      ],
      "additionalProperties": false
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
