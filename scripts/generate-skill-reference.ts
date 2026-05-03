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
  ExactDiffConfigSchema,
  LlmJudgeConfigSchema,
  STEP_SCHEMAS,
  type StepCategory,
  type StepSchemaDefinition,
  WorkflowDefinitionSchema,
  WorkflowInputDefSchema,
} from '@eigenpal/types';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z, type ZodType } from 'zod';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SKILL_DIR = join(__dirname, '..', 'src', 'skill', 'reference');
const CLI_DOCS_SRC = join(__dirname, '..', 'docs');
const CLI_DOCS_DEST = join(SKILL_DIR, 'cli');
const REPO_ROOT = join(__dirname, '..', '..', '..');

interface JsonSchemaLike {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchemaLike>;
  required?: string[];
  default?: unknown;
  enum?: unknown[];
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
    return z.toJSONSchema(schema, { target: 'draft-7' }) as JsonSchemaLike;
  } finally {
    console.warn = originalWarn;
  }
}

function describeType(schema: JsonSchemaLike | undefined): string {
  if (!schema) return '—';
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
    lines.push('');
  }
  return lines.join('\n').trimEnd() + '\n';
}

// ---------------------------------------------------------------------------
// workflow-yaml.md — WORKFLOW_TOP_LEVEL + INPUT_FIELDS
// ---------------------------------------------------------------------------

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
    blocks: { WORKFLOW_REFERENCE: renderWorkflowTopLevel() },
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
