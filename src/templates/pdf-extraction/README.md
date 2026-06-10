# __NAME__

A PDF/document extraction workflow scaffolded by `eigenpal init workflow`. The
pipeline parses an uploaded document with the auto-detected parser
(plaintext / office / OCR / LLM-vision), then runs `ai.extract` against a
fixed JSON schema.

## Wire it up

1. Drop a sample PDF at `dataset/examples/sample-invoice/input/document/<filename>`.
2. Adjust the `extract.with.schema` to the fields your documents actually carry.
3. Run an example: `eigenpal run workflows.__NAME__ --example sample-invoice`.
4. When the output looks right, push: `eigenpal workflow push --file workflow.yaml`.

## Extending

- Multiple file inputs: declare more inputs in `workflow.yaml` and add
  `dataset/examples/<name>/input/<arg>/` folders with their files.
- Per-example overrides: drop a `meta.json` next to the example with
  `{ "overrides": { "steps": { "<step>": { ... } } } }` to skip steps in eval.
