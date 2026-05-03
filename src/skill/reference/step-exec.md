# Run one step locally — `workflow step exec`

Tightest iteration loop in the CLI. One step, no server, no queue, no
DAG. Milliseconds per run. Use this when you're tweaking a single
step's logic; use `workflow execution run` when you need the whole
workflow.

```bash
eigenpal workflow step exec <type> [flags]
```

`<type>` is any value from `eigenpal workflow step-type list`. Only
some types have a local runner today (table below). The rest exit 2
with a "not yet supported locally" message — they still need the
server.

## What runs locally today

| Step type | Runner | Notes |
| --- | --- | --- |
| `transform.script` | QuickJS sandbox in-process | Same sandbox as prod. TDZ traps and timeout / memory limits reproduce here. |
| `ai.extract` | OpenAI SDK | Reads `WORKER_LLM_API_KEY` (or `OPENAI_API_KEY` for openai/openai-compatible providers) from env. Real network call. |
| anything else | — | Exits 2 with "isn't yet supported by 'workflow step exec' locally". |

If the runner you need isn't here yet, fall back to `workflow execution run`
on the server (slower loop, but covers every step type).

## Inputs — `--inputs k=v`

Repeatable. Three value forms:

```bash
--inputs limit=10                # inline literal (string; numeric strings stay strings)
--inputs items=@items.json       # file contents (JSON-parsed if valid; raw text otherwise)
--inputs payload=@-              # stdin (the `@` prefix is required; bare `-` is a literal)
```

For `transform.script`, every `--inputs k=v` becomes a top-level
binding in the sandbox (so `k` is referenced as `k` inside the code,
mirroring runtime semantics — including TDZ traps for `const x = x || []`).

For `ai.extract`, `--inputs input=…` is the document text.

## Config — `--config-json` or `--config-file`

Mutually exclusive. The shape is whatever the step type's `with:` block
accepts (see `eigenpal workflow step-type get <type>`).

```bash
--config-json '{"code":"return items.reduce((s,i)=>s+i.v,0)"}'
--config-file ./step-config.json
--config-file -                  # config from stdin (e.g. piped from `workflow pull`)
```

## Output

Goes to **stdout as JSON**. Status messages go to stderr — pipe stdout
into `jq` cleanly:

```bash
eigenpal workflow step exec transform.script --config-file cfg.json --inputs items=@arr.json | jq '.'
```

## Output schema validation — `--output-schema`

Optional. Pass a JSON Schema file:

```bash
--output-schema ./expected-schema.json
```

When omitted, the CLI falls back to the step type's built-in
`outputSchema` from `STEP_SCHEMAS` — so even without the flag, output
shape gets checked.

A violation **exits 2** with a machine-readable envelope on stderr:

```json
{ "code": "output_schema_violation", "issues": [
  { "field": "/total", "message": "must be number" }
]}
```

`field` is the JSON Pointer to the offending value (Ajv's `instancePath`,
remapped to `field` for stability) or `<root>` if the whole output is
wrong. Agents can parse this directly — no text scraping.

## Resource limits (transform.script only)

```bash
--timeout-ms 10000      # default 5000 (5 s wall clock)
--memory-mb 25          # default 10 MB heap
```

Use these when iterating on a memory-heavy reducer. They override the
config's `timeout` / `memoryLimit` fields just for this run.

## Worked examples

### Tweak a JS reducer until tests pass

Put the config in a file so the JS doesn't need escaping:

```bash
cat > cfg.json <<'EOF'
{ "code": "return items.reduce((sum, i) => sum + i.value, 0)" }
EOF
echo '[{"value":1},{"value":2},{"value":3}]' > items.json

eigenpal workflow step exec transform.script --config-file cfg.json --inputs items=@items.json
# 6
```

For a one-liner without a config file, `--config-json '{"code":"..."}'`
works too — but mind the shell escaping.

### Run an extract once with sample text

```bash
cat > extract.json <<'EOF'
{
  "prompt": "Extract the invoice total as a number.",
  "schema": { "type": "object", "properties": { "total": { "type": "number" } } }
}
EOF

eigenpal workflow step exec ai.extract \
  --config-file extract.json \
  --inputs input=@invoice.txt
# {"total": 1234.56}
```

### Pipe config straight from a workflow YAML

When you've already pushed a workflow and want to re-run one of its
steps locally:

```bash
eigenpal workflow pull wf_abc > workflow.yaml
jq '.steps[] | select(.name == "extract") | .with' workflow.yaml \
  | eigenpal workflow step exec ai.extract --config-file - --inputs input=@invoice.txt
```

## Exit codes

| Code | When |
| --- | --- |
| 0 | Step ran; output validated. |
| 1 | Runtime crash (sandbox blew up; `ai.extract` network failure; unexpected exception). |
| 2 | Misuse OR `output_schema_violation` (envelope on stderr) OR unknown / unsupported step type. |

Exit 2 is always recoverable — fix your input / config / schema and
re-run. Exit 1 means something is broken upstream (network, runtime,
your code).

## Discovery

```bash
eigenpal workflow step-type list              # all registered types
eigenpal workflow step-type get <type>        # config + output schema
```

The catalog is generated from `STEP_SCHEMAS` in `@eigenpal/types` and
is always in sync with what the deployment supports.
