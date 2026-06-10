# `workflow step exec` — currently disabled (EIG-104)

> **Status: disabled.** The local-runner implementation was removed in
> the ai.split branch (EIG-102). It mimicked production via a CLI-side
> QuickJS sandbox (`transform.script`) and direct OpenAI SDK calls
> (`ai.extract`), which diverged from the worker's behavior (no
> retries, no tracing, no credit metering, no tenant-default LLM, no
> strict-mode response_format) and assumed shell env state
> (`WORKER_LLM_*`) that real CLI users — who authenticate via
> `EIGENPAL_API_KEY` — don't have.
>
> Calling `eigenpal workflow step exec <type>` today exits 2 with a
> redirect message. The server-side replacement is tracked in EIG-104:
> a thin `POST /api/v1/workflows/step-exec` endpoint that runs the same
> code path executions take.

## What to use instead

Until EIG-104 lands, single-step iteration goes through the queue:

```bash
# Run the whole workflow once with a specific example.
eigenpal run workflows.<workflow-id>

# Or iterate on one example via the experiment surface.
eigenpal workflow experiment run <workflow-id> --example-id <name>

# Watch progress without dumping the full per-execution payload.
eigenpal workflow experiment status <workflow-id> <batchId> --watch
```

For `--example-id`, the human slug works too (`ex-01-koifer-97zf`),
not just the `evx_…` id — added as part of the same iteration.

To inspect what a step actually produced (input / output / resolved
config), use:

```bash
eigenpal runs get <executionId> --json --include input,output,config
```

The server returns `inputData` / `outputData` / `resolvedConfig` per
step on `?includeSteps=true`; the CLI projects them under shorter
names (`input` / `output` / `config`).

## Exit codes (current placeholder)

| Code | When |
| --- | --- |
| 2 | Always — the command is disabled and redirects to `run` / `workflow experiment run`. |

## When this comes back

When EIG-104 lands, this page will document the server-routed shape:

- `--inputs k=v` for binding values
- `--config-json` / `--config-file` for the `with:` block
- `--output-schema` for caller-supplied output validation
- Streaming output JSON from the same engine that runs production
- Same `output_schema_violation` envelope on stderr, exit 2

The CLI will be a thin client; the engine stays in one place.
