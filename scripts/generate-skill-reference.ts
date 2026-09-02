#!/usr/bin/env bun
/**
 * Regenerate the auto-generated sections inside packages/cli/src/skill/reference/*.md
 * from the canonical Zod schemas in @eigenpal/types.
 *
 * Hand-written prose stays untouched. Only blocks fenced with
 *   <!-- GENERATED:NAME START --> ... <!-- GENERATED:NAME END -->
 * are rewritten.
 *
 * Usage:
 *   bun packages/cli/scripts/generate-skill-reference.ts          # write
 *   bun packages/cli/scripts/generate-skill-reference.ts --check  # diff-only, exit 1 on drift
 */

import {
  CustomScriptConfigSchema,
  EvalConfigYamlSchema,
  EvaluatorBaseEntrySchema,
  ExactDiffConfigSchema,
  ExactDiffPathRuleSchema,
  LlmJudgeConfigSchema,
  STEP_RETRY_CAPABILITIES,
  STEP_SCHEMAS,
  StepRetryPolicySchema,
  WorkflowDefinitionSchema,
  WorkflowInputDefSchema,
  WorkflowRetryPolicySchema,
  type StepCategory,
  type StepSchemaDefinition,
} from '@eigenpal/types';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toJSONSchema, type ZodType } from 'zod';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SKILL_DIR = join(__dirname, '..', 'src', 'skill', 'reference');
const CLI_DOCS_SRC = join(__dirname, '..', 'docs');
const CLI_DOCS_DEST = join(SKILL_DIR, 'cli');
const REPO_ROOT = join(__dirname, '..', '..', '..');

interface JsonSchemaLike {
  const?: unknown;
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchemaLike>;
  required?: string[];
  default?: unknown;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  items?: JsonSchemaLike | JsonSchemaLike[];
  anyOf?: JsonSchemaLike[];
  oneOf?: JsonSchemaLike[];
  additionalProperties?: boolean | JsonSchemaLike;
}

function toJsonSchema(schema: ZodType): JsonSchemaLike {
  // z.toJSONSchema can warn on recursive refs (e.g. control.if's self-referential
  // steps). Silence those — bottoming out at `any` is what we want for prose.
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    return toJSONSchema(schema, { target: 'draft-7' }) as JsonSchemaLike;
  } finally {
    console.warn = originalWarn;
  }
}

function describeType(schema: JsonSchemaLike | undefined): string {
  if (!schema) return '—';
  if (schema.const !== undefined) return `\`${JSON.stringify(schema.const)}\``;
  if (schema.enum) {
    return schema.enum.map((v) => `\`${JSON.stringify(v)}\``).join(' \\| ');
  }
  if (schema.anyOf || schema.oneOf) {
    const parts = (schema.anyOf ?? schema.oneOf ?? []).map((s) => describeType(s));
    const uniq = [...new Set(parts)];
    return uniq.join(' \\| ');
  }
  const t = Array.isArray(schema.type) ? schema.type.join(' \\| ') : schema.type;
  if (t === 'array') {
    const item = Array.isArray(schema.items) ? schema.items[0] : schema.items;
    return `array<${describeType(item) || 'unknown'}>`;
  }
  if (t === 'object') {
    if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
      return `record<string, ${describeType(schema.additionalProperties as JsonSchemaLike)}>`;
    }
    return 'object';
  }
  return t ?? 'unknown';
}

function escapeCell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim();
}

function formatDefault(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return `\`"${value}"\``;
  return `\`${JSON.stringify(value)}\``;
}

function renderObjectFields(schema: JsonSchemaLike): string {
  const props = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const rows: string[] = [];
  rows.push('| Field | Type | Required | Default | Description |');
  rows.push('| --- | --- | --- | --- | --- |');
  for (const [name, field] of Object.entries(props)) {
    // Hide fields whose description marks them deprecated. They stay in
    // the schema for backward-compatible YAML on disk (the worker still
    // accepts them via a BC adapter) but the skill catalog should only
    // surface the canonical shape — agents reading the docs shouldn't
    // see legacy options as a current authoring choice.
    if (/^deprecated\b/i.test(field.description ?? '')) continue;
    // Fields with a default are effectively optional from the user's POV — they
    // can omit the value and the default is applied. v4's `z.toJSONSchema` lists
    // them in `required` (correct per JSON Schema semantics), but the docs read
    // more cleanly as "no" when a default exists.
    const isReq = required.has(name) && field.default === undefined;
    const req = isReq ? 'yes' : 'no';
    const desc = escapeCell(field.description ?? '');
    rows.push(
      `| \`${name}\` | ${describeType(field)} | ${req} | ${formatDefault(field.default)} | ${desc} |`
    );
  }
  if (Object.keys(props).length === 0) return '_No fields._\n';
  return rows.join('\n') + '\n';
}

function findPropertySchema(
  schema: JsonSchemaLike,
  propertyName: string
): JsonSchemaLike | undefined {
  const direct = schema.properties?.[propertyName];
  if (direct) return direct;
  for (const branch of [...(schema.anyOf ?? []), ...(schema.oneOf ?? [])]) {
    const found = findPropertySchema(branch, propertyName);
    if (found) return found;
  }
  return undefined;
}

function literalValues(schema: JsonSchemaLike): unknown[] {
  const values: unknown[] = [];
  if (schema.const !== undefined) values.push(schema.const);
  if (schema.enum) values.push(...schema.enum);
  for (const branch of [...(schema.anyOf ?? []), ...(schema.oneOf ?? [])]) {
    values.push(...literalValues(branch));
  }
  return [...new Set(values)];
}

function formatCodeValues(values: unknown[]): string {
  return values.map((value) => `\`${String(value)}\``).join(', ');
}

function retryCategoryLabel(category: string): string {
  if (category === 'rate_limited') return 'rate limits';
  if (category === 'temporarily_unavailable') return 'selected retryable server failures';
  return category;
}

function retryCapabilitySummary(def: StepSchemaDefinition): string {
  const capability = STEP_RETRY_CAPABILITIES[def.type];
  if (def.type === 'action.http') {
    return `HTTP \`GET\` and \`HEAD\` can durably retry transient ${capability.automaticCategories
      .map(retryCategoryLabel)
      .join(', ')} failures. Other methods are not replayed.`;
  }
  if (def.type === 'action.website-reader') {
    return `Supported for transient ${capability.automaticCategories
      .map(retryCategoryLabel)
      .join(', ')} failures.`;
  }
  if (def.type === 'action.invoke-workflow') {
    return 'Invoked workflows are not replayed as durable leaf attempts.';
  }
  if (capability.hasProviderRequestRetries) {
    return 'Provider request retries are separate; the workflow engine does not durably retry this step.';
  }
  if (def.category === 'transform') {
    return 'Transforms, including those that write files, are not durably retried.';
  }
  if (def.type === 'control.parallel' || def.type === 'control.parallel_map') {
    return 'The control container and leaves inside its concurrent branches do not retry durably.';
  }
  if (
    def.type === 'control.if' ||
    def.type === 'control.switch' ||
    def.type === 'control.foreach'
  ) {
    return 'The control container itself is not retried, but eligible leaves inside its sequential scope may retry durably.';
  }
  return 'This control step is not retried durably.';
}

// ---------------------------------------------------------------------------
// step-types.md — STEP_CATALOG
// ---------------------------------------------------------------------------

const CATEGORY_ORDER: StepCategory[] = ['ai', 'transform', 'action', 'control'];

const CATEGORY_HEADER: Record<StepCategory, string> = {
  ai: 'AI steps — model-backed processing',
  transform: 'Transform steps — deterministic data transforms',
  action: 'Action steps — external side effects',
  control: 'Control steps — flow control',
};

function renderStepCatalog(): string {
  const lines: string[] = [];
  lines.push('## Full catalog');
  lines.push('');
  lines.push(
    '_Generated from `STEP_SCHEMAS` in `@eigenpal/types/src/workflow/step-configs.ts`. Do not hand-edit between the GENERATED fences — run `bun run --cwd packages/cli generate:skill`._'
  );
  lines.push('');
  for (const cat of CATEGORY_ORDER) {
    const types = (Object.values(STEP_SCHEMAS) as StepSchemaDefinition[]).filter(
      (d) => d.category === cat
    );
    if (types.length === 0) continue;
    lines.push(`### ${CATEGORY_HEADER[cat]}`);
    lines.push('');
    for (const def of types) {
      lines.push(`#### \`${def.type}\` — ${def.name}`);
      lines.push('');
      lines.push(def.description);
      lines.push('');
      lines.push(`**Durable retry:** ${retryCapabilitySummary(def)}`);
      lines.push('');
      const where = def.configInWith ? '(in `step.with`)' : '(at step level)';
      lines.push(`**Config** ${where}:`);
      lines.push('');
      const cfg = toJsonSchema(def.configSchema);
      if (cfg.type === 'object' || cfg.properties) {
        lines.push(renderObjectFields(cfg));
      } else {
        lines.push(`Type: \`${describeType(cfg)}\`. ${cfg.description ?? ''}`);
        lines.push('');
      }
      const out = toJsonSchema(def.outputSchema);
      lines.push(`**Output:** \`${describeType(out)}\``);
      if (out.description) {
        lines.push('');
        lines.push(`> ${out.description}`);
      }
      if (out.type === 'object' && out.properties && Object.keys(out.properties).length > 0) {
        lines.push('');
        lines.push(renderObjectFields(out));
      } else {
        lines.push('');
      }
    }
  }
  return lines.join('\n').trimEnd() + '\n';
}

// ---------------------------------------------------------------------------
// evaluators.md — EVALUATOR_CATALOG
// ---------------------------------------------------------------------------

function renderEvaluatorCatalog(): string {
  const lines: string[] = [];
  lines.push('## Evaluator types — full reference');
  lines.push('');
  lines.push(
    '_Generated from `EvalConfigYamlSchema` in `@eigenpal/types/src/eval/evaluator-config.ts`. Do not hand-edit between the GENERATED fences — run `bun run --cwd packages/cli generate:skill`._'
  );
  lines.push('');

  const top = toJsonSchema(EvalConfigYamlSchema);
  lines.push('### Top-level `evaluators.yaml`');
  lines.push('');
  lines.push(renderObjectFields(top));

  const baseEntry = toJsonSchema(EvaluatorBaseEntrySchema);
  lines.push('### Common entry fields (every evaluator type)');
  lines.push('');
  lines.push(renderObjectFields(baseEntry));

  const evaluators: Array<{ name: string; type: string; schema: ZodType }> = [
    {
      name: 'exact-diff',
      type: 'JSON deep-diff against expected output',
      schema: ExactDiffConfigSchema,
    },
    { name: 'llm-judge', type: 'LLM-as-judge scoring', schema: LlmJudgeConfigSchema },
    { name: 'custom-script', type: 'JavaScript in the sandbox', schema: CustomScriptConfigSchema },
  ];
  for (const ev of evaluators) {
    lines.push(`### \`${ev.name}\` — ${ev.type}`);
    lines.push('');
    const cfg = toJsonSchema(ev.schema);
    if (cfg.type === 'object' || cfg.properties) {
      lines.push(renderObjectFields(cfg));
    } else {
      lines.push(`Type: \`${describeType(cfg)}\`. ${cfg.description ?? ''}`);
    }
    if (ev.name === 'exact-diff') {
      lines.push('#### Per-path `rules` fields');
      lines.push('');
      lines.push(renderObjectFields(toJsonSchema(ExactDiffPathRuleSchema)));
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd() + '\n';
}

// ---------------------------------------------------------------------------
// workflow-yaml.md — WORKFLOW_TOP_LEVEL + INPUT_FIELDS
// ---------------------------------------------------------------------------

function renderRetryReference(): string {
  const workflowPolicy = toJsonSchema(WorkflowRetryPolicySchema);
  const stepPolicy = toJsonSchema(StepRetryPolicySchema);
  const maxAttempts = findPropertySchema(stepPolicy, 'maxAttempts');
  const workflowModes = literalValues(workflowPolicy).filter((value) => typeof value === 'string');
  const stepModes = literalValues(stepPolicy).filter((value) => typeof value === 'string');
  const schemaMinimum = maxAttempts?.minimum ?? 1;
  const schemaMaximum = maxAttempts?.maximum ?? 10;

  return [
    '## Durable retry policies',
    '',
    '_Policy syntax is generated from `WorkflowRetryPolicySchema` and `StepRetryPolicySchema`; step capability notes are generated from `STEP_RETRY_CAPABILITIES` in `@eigenpal/types`._',
    '',
    `- Workflow policy values: ${formatCodeValues(workflowModes)} or an object with \`mode\` and \`maxAttempts\`.`,
    `- Step policy values: ${formatCodeValues(stepModes)}. \`automatic\` supports object form with \`mode\` and \`maxAttempts\`; \`never\` supports \`{ mode: 'never' }\`; \`inherit\` is string-only.`,
    `- The schema accepts \`maxAttempts\` from ${schemaMinimum} through ${schemaMaximum}. Studio offers 2-3 total attempts, and the current worker ceiling is 3.`,
    '- `maxAttempts` includes the first attempt. If no policy is set, durable retries are off.',
    '',
    '```yaml',
    'settings:',
    '  retry:',
    '    mode: automatic',
    '    maxAttempts: 3',
    '',
    'steps:',
    '  - name: fetch-catalog',
    '    type: action.http',
    '    retry: inherit',
    '    with:',
    '      method: GET',
    "      url: 'https://api.example.com/catalog'",
    '',
    '  - name: read-product-page',
    '    type: action.website-reader',
    '    retry: never',
    '    with:',
    "      url: '{{ input.url }}'",
    '```',
    '',
    '`automatic` retries transient timeouts, rate limits, and selected retryable server failures. Delays use bounded exponential backoff, honor `Retry-After`, and stop after a five-minute elapsed budget.',
    '',
    'Durable leaf retries are supported for Website Reader and HTTP `GET`/`HEAD`. Unsafe HTTP methods, Invoke Workflow, AI steps (which may have separate provider request retries), and transforms or file outputs are not durably replayed. Control containers are not attempts themselves; eligible leaves inside sequential If, Switch, and For Each scopes may retry, while concurrent Parallel and Parallel Map branches do not. See each generated step entry for its capability.',
    '',
    'Legacy whole-run retry counts are accepted for compatibility but no longer restart failed runs. Move retry intent to the workflow retry default or an eligible step.',
    '',
  ].join('\n');
}

function renderWorkflowTopLevel(): string {
  const lines: string[] = [];
  lines.push('## Top-level fields — full reference');
  lines.push('');
  lines.push(
    '_Generated from `WorkflowDefinitionSchema` in `@eigenpal/types/src/workflow/workflow.ts`. Do not hand-edit between the GENERATED fences — run `bun run --cwd packages/cli generate:skill`._'
  );
  lines.push('');
  const top = toJsonSchema(WorkflowDefinitionSchema);
  lines.push(renderObjectFields(top));
  lines.push('');
  lines.push('## Per-input fields');
  lines.push('');
  const input = toJsonSchema(WorkflowInputDefSchema);
  lines.push(renderObjectFields(input));
  return lines.join('\n').trimEnd() + '\n';
}

// ---------------------------------------------------------------------------
// File rewriting — fence-aware
// ---------------------------------------------------------------------------

interface Generation {
  file: string;
  blocks: Record<string, string>;
}

const GENERATIONS: Generation[] = [
  {
    file: 'step-types.md',
    blocks: { STEP_CATALOG: renderStepCatalog() },
  },
  {
    file: 'evaluators.md',
    blocks: { EVALUATOR_CATALOG: renderEvaluatorCatalog() },
  },
  {
    file: 'workflow-yaml.md',
    blocks: {
      RETRY_REFERENCE: renderRetryReference(),
      WORKFLOW_REFERENCE: renderWorkflowTopLevel(),
    },
  },
];

function applyBlock(content: string, name: string, body: string): string {
  const fenceStart = `<!-- GENERATED:${name} START -->`;
  const fenceEnd = `<!-- GENERATED:${name} END -->`;
  const startIdx = content.indexOf(fenceStart);
  const endIdx = content.indexOf(fenceEnd);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error(
      `Missing fence ${fenceStart}…${fenceEnd}. Add the marker pair to the markdown before running.`
    );
  }
  const before = content.slice(0, startIdx + fenceStart.length);
  const after = content.slice(endIdx);
  return `${before}\n${body.trimEnd()}\n${after}`;
}

/**
 * Mirror `packages/cli/docs/*.md` (autogenerated by `generate-cli-docs.ts`
 * from the live Commander tree) into `packages/cli/src/skill/reference/cli/`
 * so the skill ships a self-contained flag reference. Agents can read these
 * directly instead of round-tripping through `eigenpal <cmd> --help`.
 *
 * Source of truth is still `docs/`; this is a copy. Run `generate:cli-docs`
 * before `generate:skill` to ensure a fresh mirror.
 */
function readFileOrNull(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function readMdFiles(dir: string): string[] {
  try {
    return readdirSync(dir).filter((f) => f.endsWith('.md'));
  } catch {
    return [];
  }
}

function syncCliDocs(check: boolean): boolean {
  const sourceFiles = readMdFiles(CLI_DOCS_SRC);
  let drift = false;

  // In write mode, blow away the dest dir first so a removed top-level command
  // doesn't leave a stale doc behind.
  if (!check) {
    rmSync(CLI_DOCS_DEST, { recursive: true, force: true });
    mkdirSync(CLI_DOCS_DEST, { recursive: true });
  }

  for (const file of sourceFiles) {
    const sourcePath = join(CLI_DOCS_SRC, file);
    const destPath = join(CLI_DOCS_DEST, file);
    const sourceContent = readFileSync(sourcePath, 'utf8');
    if (readFileOrNull(destPath) === sourceContent) continue;
    if (check) {
      drift = true;
      console.error(
        `✗ ${relative(REPO_ROOT, destPath)} is out of date vs ${relative(REPO_ROOT, sourcePath)}.`
      );
      continue;
    }
    writeFileSync(destPath, sourceContent);
    console.log(`✓ wrote ${relative(REPO_ROOT, destPath)}`);
  }

  // Detect stale dest files that no longer exist in the source. Write mode
  // already cleaned the dir above, so this only matters in check mode.
  if (check) {
    const expected = new Set(sourceFiles);
    for (const f of readMdFiles(CLI_DOCS_DEST)) {
      if (expected.has(f)) continue;
      drift = true;
      console.error(`✗ ${relative(REPO_ROOT, join(CLI_DOCS_DEST, f))} is stale (no source).`);
    }
  }

  return drift;
}

function main(): void {
  const check = process.argv.includes('--check');
  let drift = false;
  for (const gen of GENERATIONS) {
    const path = join(SKILL_DIR, gen.file);
    const original = readFileSync(path, 'utf8');
    let next = original;
    for (const [name, body] of Object.entries(gen.blocks)) {
      next = applyBlock(next, name, body);
    }
    if (next === original) continue;
    if (check) {
      drift = true;
      console.error(`✗ ${relative(REPO_ROOT, path)} is out of date.`);
      // Render a unified diff so CI logs show *what* changed, not just that
      // something did. Helps debug environment-specific drift (Bun version,
      // z.toJSONSchema resolution, ordering quirks).
      const origLines = original.split('\n');
      const nextLines = next.split('\n');
      const maxLines = Math.max(origLines.length, nextLines.length);
      const diff: string[] = [];
      for (let i = 0; i < maxLines; i++) {
        if (origLines[i] !== nextLines[i]) {
          if (origLines[i] !== undefined) diff.push(`  - ${origLines[i]}`);
          if (nextLines[i] !== undefined) diff.push(`  + ${nextLines[i]}`);
        }
      }
      if (diff.length > 0) {
        console.error('');
        console.error(diff.slice(0, 50).join('\n'));
        if (diff.length > 50) console.error(`  … (${diff.length - 50} more diff lines)`);
      }
      continue;
    }
    writeFileSync(path, next);
    console.log(`✓ wrote ${relative(REPO_ROOT, path)}`);
  }

  // Mirror the autogen CLI docs into the skill bundle.
  drift = syncCliDocs(check) || drift;

  if (check && drift) {
    console.error('');
    console.error(
      "Run 'bun run --cwd packages/cli generate:cli-docs' (if CLI docs are stale) followed by " +
        "'bun run --cwd packages/cli generate:skill' and commit the result."
    );
    process.exit(1);
  }
  if (!check) {
    const cliDocCount = readdirSync(CLI_DOCS_DEST).filter((f) => f.endsWith('.md')).length;
    console.log(
      `✓ skill reference up to date (${GENERATIONS.length} fenced + ${cliDocCount} CLI docs mirrored).`
    );
  }
}

main();
