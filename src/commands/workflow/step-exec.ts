/**
 * `eigenpal workflow step exec <type>` — local single-step execution for the
 * iteration-loop debug path. Sidesteps the server, queue, and worker entirely.
 *
 * Generic dispatch (kubectl-style): `<type>` is validated against the live
 * `STEP_SCHEMAS` registry from `@eigenpal/types`, so every registered step
 * type is RECOGNISED. Two of them have local runners today:
 *
 *   workflow step exec transform.script   ← QuickJS sandbox, mirrors runtime
 *   workflow step exec ai.extract         ← one LLM call, structured output
 *
 * Anything else exits 2 with a "not yet supported locally" message — the
 * worker handles those types via `step-runner.ts → category dispatch`, which
 * the CLI cannot pull in (DB dep). As coverage grows, more types light up
 * via the dispatch in `runStep` below.
 *
 * Output goes to stdout as JSON (so it composes with `| jq`); status messages
 * and errors go to stderr. Schema-validation failures exit 2 with a structured
 * `{ code, issues }` envelope so agents can iterate without parsing prose.
 *
 * Why these two: they own the slowest debug loop in workflow authoring.
 * The pattern is extensible to other step types when their loops start
 * hurting — wire them into `LOCAL_RUNNERS` below.
 */

import Ajv from 'ajv';
import type { Command } from 'commander';
import { promises as fs } from 'node:fs';

import { listStepTypes, type StepType } from '@eigenpal/types';

import { env } from '../../env';
import { action } from '../../lib/format-error';
import { error, intArg } from '../../lib/ui';

const SCHEMA_VIOLATION_EXIT = 2;
const UNKNOWN_TYPE_EXIT = 2;
const UNSUPPORTED_TYPE_EXIT = 2;

// ---------------------------------------------------------------------------
// shared input-loading helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a `<path|->` flag value to its contents. `-` reads from stdin so
 * scripts can pipe (`cat code.js | … --code -`); any other value is treated
 * as a path on disk. A leading `@` is stripped so the same `@path` syntax
 * users learn for `--inputs k=@file` works on `--config-file @file.json` too —
 * matches curl / `gh --body-file -` conventions.
 */
async function readPathOrStdin(value: string): Promise<string> {
  if (value === '-') {
    return readStdin();
  }
  const path = value.startsWith('@') ? value.slice(1) : value;
  if (path === '-') return readStdin();
  return fs.readFile(path, 'utf8');
}

async function readStdin(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      buf += chunk;
    });
    process.stdin.once('end', () => resolve(buf));
    process.stdin.once('error', reject);
  });
}

/**
 * Unwrap an `@<path>` literal: `--inputs text=@parsed.txt` reads the file's
 * contents as the value. Plain values pass through unchanged.
 *
 * The `@`-prefix convention matches `curl -d @file` / `gh issue create
 * --body-file -`. Returns the raw text — JSON parsing is the caller's choice.
 */
async function resolveLiteralOrPath(value: string): Promise<string> {
  if (value.startsWith('@')) {
    const path = value.slice(1);
    return path === '-' ? readStdin() : fs.readFile(path, 'utf8');
  }
  return value;
}

/**
 * Parse `--inputs k=v` (repeatable) into a map. The value can be:
 *   - a literal string (`text=hello`)
 *   - a file reference (`items=@arr.json`) — JSON-parsed if the file looks like
 *     JSON (starts with `{`/`[`/`"`/digit/`-`/`true`/`false`/`null`),
 *     otherwise kept as text.
 *
 * Bindings become top-level globals in the sandbox, exactly mirroring runtime
 * semantics so TDZ traps reproduce locally.
 */
async function parseInputsFlag(pairs: string[]): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const pair of pairs) {
    const eq = pair.indexOf('=');
    if (eq <= 0) {
      throw new Error(`--inputs expects k=v, got: ${pair}`);
    }
    const key = pair.slice(0, eq);
    const rawValue = pair.slice(eq + 1);
    const text = await resolveLiteralOrPath(rawValue);
    out[key] = rawValue.startsWith('@') ? maybeParseJson(text) : text;
  }
  return out;
}

/** Try JSON.parse; fall back to the raw text on failure. Lets `@items.json`
 *  hand the script an array, while `@notes.txt` keeps the string verbatim. */
function maybeParseJson(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed === '') return text;
  const first = trimmed[0];
  const looksJson = /[{[\d"-]/.test(first) || /^(true|false|null)\b/.test(trimmed);
  if (!looksJson) return text;
  try {
    return JSON.parse(trimmed);
  } catch {
    return text;
  }
}

/**
 * Resolve the step config from `--config-json` and/or `--config-file`. Either
 * is acceptable; specifying both is a user error. Returns the parsed config
 * object (always an object — top-level arrays/scalars rejected since every
 * step's config schema is an object).
 */
async function resolveConfig(opts: {
  configJson?: string;
  configFile?: string;
}): Promise<Record<string, unknown>> {
  if (opts.configJson && opts.configFile) {
    throw new Error('pass either --config-json or --config-file, not both');
  }
  let raw: string;
  if (opts.configJson) {
    raw = opts.configJson;
  } else if (opts.configFile) {
    raw = await readPathOrStdin(opts.configFile);
  } else {
    // Empty config object is valid for some step types (everything via --inputs).
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`invalid JSON in step config: ${(err as Error).message}`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('step config must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// transform.script — QuickJS sandbox, identical semantics to the worker
// ---------------------------------------------------------------------------

/** JS reserved words rejected as binding names. Mirrors
 *  `packages/worker/src/sandbox/quickjs-sandbox.ts:RESERVED_WORDS`. */
const RESERVED_WORDS = new Set([
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'let',
  'new',
  'null',
  'return',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'undefined',
  'var',
  'void',
  'while',
  'with',
  'yield',
]);

/** Deep-freeze every input object so the script can't mutate them across runs.
 *  Matches the worker sandbox so a script that crashes locally crashes the
 *  same way in prod. */
const DEEP_FREEZE_CODE = `
function __deepFreeze(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  Object.freeze(obj);
  Object.getOwnPropertyNames(obj).forEach(function(prop) {
    var val = obj[prop];
    if (val !== null && typeof val === 'object' && !Object.isFrozen(val)) {
      __deepFreeze(val);
    }
  });
  return obj;
}
`;

interface ScriptResult {
  success: boolean;
  value?: unknown;
  error?: string;
}

/**
 * Execute JavaScript in QuickJS with named globals, a wall-clock interrupt,
 * and a memory cap. Same shape as the worker sandbox so we don't have two
 * places where TDZ / strict-mode behaviour can diverge.
 */
async function runScript(
  code: string,
  inputs: Record<string, unknown>,
  options: { timeoutMs: number; memoryLimitBytes: number }
): Promise<ScriptResult> {
  // Lazy import: keeps the QuickJS WASM blob out of `--help` cold paths.
  const { getQuickJS, shouldInterruptAfterDeadline } = await import('quickjs-emscripten');
  const quickjs = await getQuickJS();

  const runtime = quickjs.newRuntime();
  runtime.setMemoryLimit(options.memoryLimitBytes);
  runtime.setMaxStackSize(256 * 1024);
  runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + options.timeoutMs));
  const vm = runtime.newContext();

  try {
    const objectInputNames: string[] = [];
    for (const [name, value] of Object.entries(inputs)) {
      if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name)) {
        throw new Error(`Invalid input name: ${name}`);
      }
      if (RESERVED_WORDS.has(name)) {
        throw new Error(`Invalid input name '${name}': reserved JavaScript keyword`);
      }
      let json: string;
      try {
        json = JSON.stringify(value);
      } catch (err) {
        throw new Error(
          `Cannot serialize input '${name}': ${err instanceof Error ? err.message : String(err)}`
        );
      }
      const result = vm.evalCode(`(${json ?? 'undefined'})`);
      if (result.error) {
        const e = vm.dump(result.error);
        result.error.dispose();
        throw new Error(`Failed to inject input '${name}': ${formatVmError(e)}`);
      }
      try {
        vm.setProp(vm.global, name, result.value);
      } finally {
        result.value.dispose();
      }
      if (typeof value === 'object' && value !== null) objectInputNames.push(name);
    }

    if (objectInputNames.length > 0) {
      const freezeCode =
        DEEP_FREEZE_CODE + objectInputNames.map((n) => `__deepFreeze(${n});`).join('\n');
      const r = vm.evalCode(freezeCode);
      if (r.error) r.error.dispose();
      else r.value.dispose();
    }

    // `'use strict'` + IIFE wrapper → matches worker semantics. Preserves
    // TDZ behaviour (`const x = x || []` throws ReferenceError, the same
    // trap users hit at runtime — the whole point of this command).
    const result = vm.evalCode(`(function() { 'use strict'; ${code} })()`);
    if (result.error) {
      const e = vm.dump(result.error);
      result.error.dispose();
      return { success: false, error: formatVmError(e) };
    }
    const value = vm.dump(result.value);
    result.value.dispose();
    return { success: true, value };
  } finally {
    vm.dispose();
    runtime.dispose();
  }
}

function formatVmError(err: unknown): string {
  if (err === null || err === undefined) return 'Unknown error';
  if (typeof err === 'string') return err;
  if (typeof err === 'object') {
    const e = err as Record<string, unknown>;
    if (e.message) {
      const name = e.name ? `${String(e.name)}: ` : '';
      return `${name}${String(e.message)}`;
    }
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

// ---------------------------------------------------------------------------
// ai.extract — one LLM call, OpenAI-compatible by default
// ---------------------------------------------------------------------------

interface ExtractEnv {
  provider: string;
  apiKey: string;
  model: string;
  baseUrl?: string;
}

/**
 * Resolve the provider config from CLI flags + env. We deliberately do NOT
 * import @eigenpal/worker here — the CLI bundle has to cold-install on a
 * clean machine without any DB/storage deps. The env-var convention mirrors
 * worker docs (`WORKER_LLM_*`) so a user with a functioning worker
 * `.env.local` can run `step exec ai.extract` with zero new config.
 */
/**
 * Internal env-shape contract. Defaulting to the t3-env-validated `env`
 * means production callers get the validated values; tests can pass a plain
 * object to exercise edge cases without mutating `process.env`.
 */
interface ExtractEnvSource {
  WORKER_LLM_PROVIDER?: string;
  WORKER_LLM_API_KEY?: string;
  WORKER_LLM_MODEL?: string;
  WORKER_LLM_BASE_URL?: string;
  OPENAI_API_KEY?: string;
}

function resolveExtractEnv(
  flags: { provider?: string; model?: string; baseUrl?: string },
  source: ExtractEnvSource = env
): ExtractEnv {
  const provider = flags.provider ?? source.WORKER_LLM_PROVIDER ?? 'openai';
  const baseUrl = flags.baseUrl ?? source.WORKER_LLM_BASE_URL ?? undefined;
  const apiKey =
    source.WORKER_LLM_API_KEY ??
    (provider === 'openai' || provider === 'openai-compatible'
      ? source.OPENAI_API_KEY
      : undefined) ??
    '';
  const model = flags.model ?? source.WORKER_LLM_MODEL ?? 'gpt-4o-mini';
  if (!apiKey) {
    throw new Error(
      `No API key configured. Set WORKER_LLM_API_KEY (or OPENAI_API_KEY for openai) ` +
        `to use \`workflow step exec ai.extract\`.`
    );
  }
  return { provider, apiKey, model, baseUrl };
}

/**
 * One structured-output extraction. We use the OpenAI SDK directly — the
 * worker's BaseAIClient adds tracing, retries, credit metering, etc. that
 * are irrelevant for a one-shot CLI invocation. Keeps the bundle small and
 * the failure mode obvious.
 */
async function runExtract(args: {
  env: ExtractEnv;
  input: string;
  prompt: string;
  schema?: Record<string, unknown>;
}): Promise<unknown> {
  if (args.env.provider !== 'openai' && args.env.provider !== 'openai-compatible') {
    throw new Error(
      `Provider "${args.env.provider}" is not supported by the CLI step exec yet. ` +
        `Use --provider openai (or openai-compatible with --base-url) for now.`
    );
  }

  // Lazy import keeps the openai SDK off the `--help` cold path.
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({ apiKey: args.env.apiKey, baseURL: args.env.baseUrl });

  const fullPrompt = `${args.prompt}\n\nContent:\n${args.input}`;
  const messages = [{ role: 'user' as const, content: fullPrompt }];

  if (!args.schema) {
    // No schema → return raw assistant text. Matches the spec: "raw text if
    // schema omitted".
    const response = await client.chat.completions.create({
      model: args.env.model,
      messages,
      temperature: 0,
    });
    return response.choices[0]?.message?.content ?? '';
  }

  const response = await client.chat.completions.create({
    model: args.env.model,
    messages,
    temperature: 0,
    response_format: {
      type: 'json_schema',
      // strict: false is conservative — strict requires `additionalProperties:
      // false` everywhere and every `properties` key in `required`. Local
      // iteration commonly hands the CLI a sketch schema; non-strict is the
      // less-surprising default.
      json_schema: { name: 'extract', schema: args.schema, strict: false },
    },
  });
  const content = response.choices[0]?.message?.content ?? '';
  try {
    return JSON.parse(content);
  } catch (err) {
    throw new Error(
      `LLM returned non-JSON despite json_schema response_format: ${(err as Error).message}\n--- raw ---\n${content.slice(0, 500)}`
    );
  }
}

// ---------------------------------------------------------------------------
// schema validation (shared between transform.script and ai.extract)
// ---------------------------------------------------------------------------

interface SchemaIssue {
  field: string;
  message: string;
}

/** Validate `value` against `schema`. Returns `null` on pass; an array of
 *  `{ field, message }` issues on fail. We match the worker's ajv setup so
 *  CLI / runtime accept the same schemas. */
function validateAgainstSchema(
  value: unknown,
  schema: Record<string, unknown>
): SchemaIssue[] | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ajv = new (Ajv as any)({ allErrors: true });
  const validate = ajv.compile(schema);
  if (validate(value)) return null;
  return (validate.errors ?? []).map((e: { instancePath?: string; message?: string }) => ({
    field: e.instancePath || '<root>',
    message: e.message ?? 'invalid',
  }));
}

/** Print the canonical error envelope on stderr and exit 2. Shape matches
 *  the issue acceptance criteria so agents (and tests) can grep on `code`. */
function exitSchemaViolation(issues: SchemaIssue[]): never {
  const envelope = { code: 'output_schema_violation', issues };
  process.stderr.write(JSON.stringify(envelope, null, 2) + '\n');
  process.exit(SCHEMA_VIOLATION_EXIT);
}

/** Read + parse a JSON file, with a clear error on bad content. */
async function readJsonFile(path: string): Promise<Record<string, unknown>> {
  const raw = await fs.readFile(path, 'utf8');
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('expected a JSON object');
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    throw new Error(`invalid JSON in ${path}: ${(err as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// step-type dispatch
// ---------------------------------------------------------------------------

/**
 * Per-step-type local runner contract. Receives the resolved config (parsed
 * JSON object) and the user-supplied input bindings (from `--inputs`); writes
 * its result to stdout and may run schema validation along the way. Throws
 * on unrecoverable error — the wrapping `action` decorator surfaces it.
 */
type LocalStepRunner = (ctx: {
  config: Record<string, unknown>;
  inputs: Record<string, unknown>;
  outputSchemaPath?: string;
}) => Promise<void>;

/**
 * The two step types the CLI can run locally today. As more types graduate
 * (no DB / storage deps), add them here — the dispatch stays uniform and
 * `<type>` remains a single positional argument with `--config-*` flags.
 */
const LOCAL_RUNNERS: Partial<Record<StepType, LocalStepRunner>> = {
  'transform.script': runTransformScript,
  'ai.extract': runAiExtract,
};

async function runTransformScript(ctx: {
  config: Record<string, unknown>;
  inputs: Record<string, unknown>;
  outputSchemaPath?: string;
}): Promise<void> {
  const { config, inputs: flagInputs, outputSchemaPath } = ctx;

  const code = config.code;
  if (typeof code !== 'string' || code.length === 0) {
    throw new Error(
      'transform.script requires `code` (string) in --config-json/--config-file. ' +
        'Run `eigenpal workflow step-type get transform.script` for the full schema.'
    );
  }

  // Merge: --inputs flags overlay any `inputs` map in the config. Flag wins
  // so iteration is fast — keep the canonical config in a file, override one
  // binding from the CLI for a quick what-if.
  const configInputs =
    config.inputs && typeof config.inputs === 'object' && !Array.isArray(config.inputs)
      ? (config.inputs as Record<string, unknown>)
      : {};
  const inputs = { ...configInputs, ...flagInputs };

  const timeoutMs = numberOr(config.timeout, 5000);
  const memoryMb = numberOr(config.memoryLimit, 10);

  const result = await runScript(code, inputs, {
    timeoutMs,
    memoryLimitBytes: memoryMb * 1024 * 1024,
  });

  if (!result.success) {
    // Surface the script error as the CLI's own error envelope so it
    // looks the same as a thrown JS error from the IIFE wrapper.
    error(`Script error: ${result.error}`);
    process.exit(1);
  }

  // Output schema: explicit --output-schema flag wins; otherwise fall back
  // to the step type's `outputSchema` from STEP_SCHEMAS (so the CLI catches
  // shape regressions before the worker does).
  const schema = await resolveOutputSchema(outputSchemaPath, config.outputSchema);
  if (schema) {
    const issues = validateAgainstSchema(result.value, schema);
    if (issues) exitSchemaViolation(issues);
  }

  process.stdout.write(JSON.stringify(result.value, null, 2) + '\n');
}

async function runAiExtract(ctx: {
  config: Record<string, unknown>;
  inputs: Record<string, unknown>;
  outputSchemaPath?: string;
}): Promise<void> {
  const { config, inputs, outputSchemaPath } = ctx;

  // ai.extract config: { input, prompt?, schema?, provider?, model? }.
  // `input` may also be provided via --inputs input=... for parity with
  // transform.script; flag wins.
  const input = stringOr(inputs.input, stringOr(config.input, ''));
  if (!input) {
    throw new Error(
      'ai.extract requires `input` — pass it as `--inputs input=@doc.txt` or set ' +
        '`{ "input": "…" }` in --config-json/--config-file.'
    );
  }
  const prompt = stringOr(config.prompt, 'Extract the data described by the schema.');
  const provider = stringOr(config.provider, undefined);
  const model = stringOr(config.model, undefined);
  const baseUrl = stringOr(config.baseUrl, undefined);

  const inlineSchema = isObject(config.schema)
    ? (config.schema as Record<string, unknown>)
    : undefined;

  const llm = resolveExtractEnv({ provider, model, baseUrl });
  const result = await runExtract({ env: llm, input, prompt, schema: inlineSchema });

  // --output-schema validates the LLM output. If absent, fall back to the
  // inline schema in the config (so a schema-driven extract still validates
  // its own output without a separate flag).
  const schema = (await resolveOutputSchema(outputSchemaPath, undefined)) ?? inlineSchema;
  if (schema) {
    const issues = validateAgainstSchema(result, schema);
    if (issues) exitSchemaViolation(issues);
  }

  // Schema-mode result is JSON; no-schema result is a string. Both go to
  // stdout; piping consumers can disambiguate from the leading character.
  const out = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
  process.stdout.write(out + (out.endsWith('\n') ? '' : '\n'));
}

/** Type-coerce a config value to a number, or fall back to a default. */
function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Type-coerce a config value to a string, or fall back to a default. */
function stringOr<T extends string | undefined>(value: unknown, fallback: T): string | T {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function isObject(value: unknown): boolean {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Resolve the schema to validate the step output against. Precedence:
 *   1. `--output-schema <path>` (explicit user override)
 *   2. The supplied inline schema (e.g. `config.outputSchema`)
 *
 * Returns `undefined` when neither is set so the runner can skip validation.
 */
async function resolveOutputSchema(
  pathFromFlag: string | undefined,
  inline: unknown
): Promise<Record<string, unknown> | undefined> {
  if (pathFromFlag) return readJsonFile(pathFromFlag);
  if (isObject(inline)) return inline as Record<string, unknown>;
  return undefined;
}

// ---------------------------------------------------------------------------
// register
// ---------------------------------------------------------------------------

/**
 * Register the `step` sub-namespace under an existing `workflow` command.
 * Verbs live UNDER the noun (`step exec <type>`), matching pattern #1.
 *
 * Generic `<type>` argument: dispatches to `LOCAL_RUNNERS[<type>]` if one
 * exists, exits 2 with a "not yet supported locally" message otherwise. The
 * full `STEP_SCHEMAS` registry is the discovery surface — `step-type list`
 * shows everything, `step exec --help` lists only what the CLI can run.
 */
export function registerStepExecCommands(workflow: Command): void {
  const step = workflow
    .command('step')
    .description(
      'Execute a single workflow step locally (no server, no queue) for fast iteration.'
    );

  const exec = step
    .command('exec <type>')
    .description(
      'Run one step locally with sample inputs and print its output as JSON. <type> is any value from `workflow step-type list`; only types with a local runner actually execute (today: transform.script, ai.extract).'
    )
    .option(
      '--config-json <json>',
      'Full step config as a JSON literal. Mutually exclusive with --config-file.'
    )
    .option(
      '--config-file <path|->',
      'Full step config from a JSON file (or `-` for stdin). Mutually exclusive with --config-json.'
    )
    .option(
      '--inputs <k=v...>',
      'Repeatable. Value can be `@path` (file contents, JSON-parsed when applicable) or a literal string. Merges into the config `inputs` map for transform.script; provides the `input` for ai.extract when set as `input=…`.',
      (v: string, prev: string[]) => [...prev, v],
      [] as string[]
    )
    .option(
      '--output-schema <path>',
      'Optional JSON Schema. Validates the step output; defaults to the step type’s built-in `outputSchema` from STEP_SCHEMAS when omitted.'
    )
    // Legacy-friendly extras kept for transform.script: tuneable resource caps
    // for slow scripts. Not part of the canonical config, but useful when
    // iterating on a memory-heavy reduce.
    .option('--timeout-ms <n>', 'Override transform.script wall-clock cap (default 5000)', intArg)
    .option('--memory-mb <n>', 'Override transform.script heap cap in MB (default 10)', intArg)
    .addHelpText(
      'after',
      `
Examples
  # transform.script — config in a file, inputs from CLI
  $ echo '{"code":"return items.reduce((s,i)=>s+i.v,0)"}' > /tmp/cfg.json
  $ echo '[{"v":1},{"v":2}]' > /tmp/items.json
  $ eigenpal workflow step exec transform.script \\
      --config-file /tmp/cfg.json --inputs items=@/tmp/items.json
  3

  # ai.extract — inline config, document input
  $ eigenpal workflow step exec ai.extract \\
      --config-json '{"prompt":"Extract the invoice total"}' \\
      --inputs input=@invoice.txt

  # transform.script — config from stdin (e.g. piped from \`workflow pull\`)
  $ jq '.steps[0].with' workflow.yaml | eigenpal workflow step exec transform.script --config-file -

Output goes to stdout as JSON. On schema violation the command exits 2 with
\`{ code: 'output_schema_violation', issues: [...] }\` on stderr.

Discovery: \`eigenpal workflow step-type list\` shows every registered step
type. Today only \`transform.script\` and \`ai.extract\` have local runners;
all other types exit 2 with a "not yet supported locally" message.
`
    );

  exec.action(
    action(
      async (
        type: string,
        opts: {
          configJson?: string;
          configFile?: string;
          inputs: string[];
          outputSchema?: string;
          timeoutMs?: number;
          memoryMb?: number;
        }
      ) => {
        // 1. Validate <type> against the live STEP_SCHEMAS registry.
        const known = listStepTypes();
        if (!known.includes(type as StepType)) {
          error(
            `Unknown step type '${type}'. Run 'eigenpal workflow step-type list' to see all registered types.`
          );
          process.exit(UNKNOWN_TYPE_EXIT);
        }
        const stepType = type as StepType;

        // 2. Look up a local runner. Recognised-but-unsupported types get a
        //    distinct message (so users know the type is real, just not yet
        //    wired to the CLI).
        const runner = LOCAL_RUNNERS[stepType];
        if (!runner) {
          error(
            `Step type '${type}' isn't yet supported by 'workflow step exec' locally. ` +
              `Today only transform.script and ai.extract have CLI runners. ` +
              `File a GitHub issue to request local support for ${type}.`
          );
          process.exit(UNSUPPORTED_TYPE_EXIT);
        }

        // 3. Resolve the config + inputs once and hand them to the runner.
        const config = await resolveConfig({
          configJson: opts.configJson,
          configFile: opts.configFile,
        });

        // Per-step-type resource overrides are merged into the config object
        // so each runner sees a single source of truth.
        if (stepType === 'transform.script') {
          if (typeof opts.timeoutMs === 'number') config.timeout = opts.timeoutMs;
          if (typeof opts.memoryMb === 'number') config.memoryLimit = opts.memoryMb;
        }

        const inputs = await parseInputsFlag(opts.inputs);

        await runner({
          config,
          inputs,
          outputSchemaPath: opts.outputSchema,
        });
      }
    )
  );
}

// ---------------------------------------------------------------------------
// test exports — keep these out of the public surface, but expose them so the
// test file can exercise pure helpers without spinning up Commander.
// ---------------------------------------------------------------------------

export const __test = {
  parseInputsFlag,
  resolveLiteralOrPath,
  resolveConfig,
  maybeParseJson,
  runScript,
  validateAgainstSchema,
  resolveExtractEnv,
  // Keep the canonical step-type lookup discoverable from tests so a future
  // type addition can be exercised in unit tests too.
  listLocalRunnerTypes: () => Object.keys(LOCAL_RUNNERS) as StepType[],
};
