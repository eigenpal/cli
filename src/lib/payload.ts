/**
 * Shared payload building for exec (execute endpoint) and eval (eval endpoint).
 */

import {
  ExpectedOutputSchema,
  type ExpectedOutput,
  type ExpectedOutputFiles,
} from '@eigenpal/types';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { basename, join } from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { findTemplateDirs, guessMimeType, INDEX_FILE_EXTS } from './fs-helpers';

interface LocalTemplateForEval {
  id: string | null;
  name: string;
  relPath: string;
  slug: string;
  fileName: string;
  fileBuffer: Buffer;
}

interface TemplateRef {
  templateId: string;
  stepName: string | null;
  outputFilename: string | null;
  container: Record<string, unknown>;
}

export interface WorkflowPayload {
  yaml: string;
  templates: Array<{ id: string; content: string; filename?: string }>;
  blocks: Array<{ name: string; yaml: string }>;
}

export interface ExamplePayload {
  input?: Record<string, unknown>;
  overrides?: { steps: Record<string, Record<string, unknown>> } | null;
  expectedOutput?: ExpectedOutput | null;
  /** Per-example map of doc key to inline content (base64 or { content, filename?, mimeType? }). */
  expectedOutputFiles?: ExpectedOutputFiles;
}

function resolveInputToInline(value: unknown, evalDir: string): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((item) => resolveInputToInline(item, evalDir));
  }
  const obj = value as Record<string, unknown>;
  if (typeof obj._file === 'string' && Object.keys(obj).length === 1) {
    const localPath = join(evalDir, obj._file);
    if (!existsSync(localPath)) {
      throw new Error(`Missing file for input: ${obj._file} (resolved to ${localPath})`);
    }
    const fileBuffer = readFileSync(localPath);
    const filename = basename(obj._file);
    const mimeType = guessMimeType(filename);
    return {
      _inline: fileBuffer.toString('base64'),
      filename,
      ...(mimeType ? { mimeType } : {}),
    };
  }
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    result[key] = resolveInputToInline(val, evalDir);
  }
  return result;
}

/** Recursively resolve path refs (string or { _file }) to { _inline } in expectedDocuments. */
function resolveExpectedDocumentsToInlineRecursive(value: unknown, evalDir: string): unknown {
  if (value == null) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const localPath = join(evalDir, value.trim());
    if (existsSync(localPath)) {
      const buf = readFileSync(localPath);
      const mime = guessMimeType(value);
      return {
        _inline: buf.toString('base64'),
        filename: basename(value),
        ...(mime ? { mimeType: mime } : {}),
      };
    }
    return value;
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if ('_inline' in obj || ('fileId' in obj && !('_file' in obj))) return value;
    if ('_file' in obj && typeof obj._file === 'string') {
      const localPath = join(evalDir, obj._file);
      if (existsSync(localPath)) {
        const buf = readFileSync(localPath);
        const mime = guessMimeType(obj._file);
        return {
          _inline: buf.toString('base64'),
          filename: basename(obj._file),
          ...(mime ? { mimeType: mime } : {}),
        };
      }
      return value;
    }
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = resolveExpectedDocumentsToInlineRecursive(v, evalDir);
    }
    return result;
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveExpectedDocumentsToInlineRecursive(item, evalDir));
  }
  return value;
}

function resolveExpectedDocumentsToInline(expectedOutput: ExpectedOutput, evalDir: string): void {
  const raw = expectedOutput.expectedDocuments;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
  expectedOutput.expectedDocuments = resolveExpectedDocumentsToInlineRecursive(
    raw,
    evalDir
  ) as typeof raw;
}

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function collectLocalTemplatesForEval(dir: string): LocalTemplateForEval[] {
  const templatesDir = join(dir, 'templates');
  const templates: LocalTemplateForEval[] = [];
  if (!existsSync(templatesDir)) return templates;
  const templateEntries = findTemplateDirs(templatesDir, '');
  for (const { relPath, absDir } of templateEntries) {
    const metaPath = join(absDir, 'meta.json');
    let templateId: string | null = null;
    let templateName = relPath.split('/').pop() || relPath;
    if (existsSync(metaPath)) {
      try {
        const meta = JSON.parse(readFileSync(metaPath, 'utf-8')) as {
          id?: unknown;
          name?: unknown;
        };
        if (typeof meta.id === 'string' && meta.id.trim() !== '') templateId = meta.id;
        if (typeof meta.name === 'string' && meta.name.trim() !== '') templateName = meta.name;
      } catch {
        // keep fallback
      }
    }
    const files = readdirSync(absDir);
    const indexFile = files.find((f) => INDEX_FILE_EXTS.some((ext) => f === `index${ext}`));
    if (!indexFile) continue;
    templates.push({
      id: templateId,
      name: templateName,
      relPath,
      slug: normalizeToken(relPath.split('/').pop() || templateName),
      fileName: indexFile,
      fileBuffer: readFileSync(join(absDir, indexFile)),
    });
  }
  return templates;
}

function collectTemplateRefsFromWorkflow(
  value: unknown,
  parent: Record<string, unknown> | null,
  out: TemplateRef[]
): void {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (const item of value) collectTemplateRefsFromWorkflow(item, parent, out);
    return;
  }
  if (typeof value !== 'object') return;
  const obj = value as Record<string, unknown>;
  if (typeof obj.templateId === 'string' && obj.templateId.trim() !== '') {
    out.push({
      templateId: obj.templateId,
      stepName: parent && typeof parent.name === 'string' ? parent.name : null,
      outputFilename: typeof obj.outputFilename === 'string' ? obj.outputFilename : null,
      container: obj,
    });
  }
  for (const val of Object.values(obj)) {
    collectTemplateRefsFromWorkflow(val, obj, out);
  }
}

function pickLocalTemplateForRef(
  ref: TemplateRef,
  localTemplates: LocalTemplateForEval[]
): LocalTemplateForEval | null {
  const byId = localTemplates.find((tmpl) => tmpl.id != null && tmpl.id === ref.templateId);
  if (byId) return byId;
  const hint = normalizeToken(`${ref.stepName ?? ''} ${ref.outputFilename ?? ''}`);
  const matches = localTemplates.filter((tmpl) => {
    const nameToken = normalizeToken(tmpl.name);
    return hint.includes(tmpl.slug) || (nameToken !== '' && hint.includes(nameToken));
  });
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) return matches.sort((a, b) => b.slug.length - a.slug.length)[0];
  return null;
}

function collectBlockNamesFromWorkflow(value: unknown, out: Set<string>): void {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (const item of value) collectBlockNamesFromWorkflow(item, out);
    return;
  }
  if (typeof value !== 'object') return;
  const obj = value as Record<string, unknown>;
  if (
    obj.type === 'control.block' &&
    typeof obj.blockName === 'string' &&
    obj.blockName.trim() !== ''
  ) {
    out.add(obj.blockName);
  }
  if (
    obj.type === 'control.block' &&
    obj.with &&
    typeof obj.with === 'object' &&
    !Array.isArray(obj.with) &&
    typeof (obj.with as Record<string, unknown>).blockName === 'string'
  ) {
    const withBlock = (obj.with as Record<string, unknown>).blockName as string;
    if (withBlock.trim() !== '') out.add(withBlock);
  }
  for (const nested of Object.values(obj)) {
    collectBlockNamesFromWorkflow(nested, out);
  }
}

function collectLocalWorkflowYamlsByName(dir: string): Map<string, string> {
  const byName = new Map<string, string>();
  const workflowsDir = join(dir, 'workflows');
  if (!existsSync(workflowsDir)) return byName;
  const slugs = readdirSync(workflowsDir).filter((f) =>
    statSync(join(workflowsDir, f)).isDirectory()
  );
  for (const slug of slugs) {
    const yamlPath = join(workflowsDir, slug, 'index.yaml');
    if (!existsSync(yamlPath)) continue;
    const rawYaml = readFileSync(yamlPath, 'utf-8');
    try {
      const parsed = parseYaml(rawYaml) as { name?: unknown };
      if (typeof parsed?.name === 'string' && parsed.name.trim() !== '') {
        byName.set(parsed.name, rawYaml);
      }
    } catch {
      // ignore
    }
  }
  return byName;
}

function buildBlocksPayload(dir: string, rootYaml: string): Array<{ name: string; yaml: string }> {
  let rootParsed: unknown;
  try {
    rootParsed = parseYaml(rootYaml);
  } catch {
    return [];
  }
  const localYamlByName = collectLocalWorkflowYamlsByName(dir);
  const pendingNames = new Set<string>();
  collectBlockNamesFromWorkflow(rootParsed, pendingNames);
  const processed = new Set<string>();
  const blocks: Array<{ name: string; yaml: string }> = [];
  while (pendingNames.size > 0) {
    const current = pendingNames.values().next().value as string;
    pendingNames.delete(current);
    if (processed.has(current)) continue;
    processed.add(current);
    const localYaml = localYamlByName.get(current);
    if (!localYaml) continue;
    blocks.push({ name: current, yaml: localYaml });
    try {
      const parsed = parseYaml(localYaml);
      const nestedBlocks = new Set<string>();
      collectBlockNamesFromWorkflow(parsed, nestedBlocks);
      for (const nested of nestedBlocks) {
        if (!processed.has(nested)) pendingNames.add(nested);
      }
    } catch {
      // ignore
    }
  }
  return blocks;
}

/**
 * Resolve the path to a workflow YAML for a given slug, supporting two layouts:
 *
 *   1. Flat (the layout `eigenpal init workflow <name>` scaffolds, and the
 *      one the published skill recommends): `./workflow.yaml` at the cwd /
 *      `--dir` root. The slug must match the YAML's top-level `name:` field.
 *   2. Nested (legacy multi-workflow project): `<dir>/workflows/<slug>/index.yaml`.
 *
 * Flat is checked first because that's what `eigenpal init` produces today;
 * nested falls through for backward-compat with existing checkouts. Returns
 * `null` if neither layout matches so the caller can throw a clear error
 * with both candidates in the message.
 */
function resolveWorkflowYamlPath(dir: string, workflowSlug: string): string | null {
  // Flat layout — `<dir>/workflow.yaml` (or, when the user runs from inside
  // a scaffolded project, `./workflow.yaml`). Accept the slug only when it
  // matches the YAML's `name:` so users running `execution run wrong-slug`
  // still get a helpful error rather than the wrong workflow.
  const flatCandidates = [join(dir, 'workflow.yaml'), 'workflow.yaml'];
  for (const candidate of flatCandidates) {
    if (!existsSync(candidate)) continue;
    try {
      const parsed = parseYaml(readFileSync(candidate, 'utf-8')) as { name?: unknown };
      if (typeof parsed?.name === 'string' && parsed.name.trim() === workflowSlug) {
        return candidate;
      }
    } catch {
      // unparseable YAML → fall through to the nested check; the validator
      // surfaces parse errors with much better context than we could here.
    }
  }
  // Nested layout — `<dir>/workflows/<slug>/index.yaml`.
  const nested = join(dir, 'workflows', workflowSlug, 'index.yaml');
  if (existsSync(nested)) return nested;
  return null;
}

/** Build workflow YAML + templates + blocks for execute or eval. */
export function buildWorkflowPayload(dir: string, workflowSlug: string): WorkflowPayload {
  const yamlPath = resolveWorkflowYamlPath(dir, workflowSlug);
  if (!yamlPath) {
    const flat = join(dir, 'workflow.yaml');
    const nested = join(dir, 'workflows', workflowSlug, 'index.yaml');
    throw new Error(
      `Workflow "${workflowSlug}" not found. Looked for:\n  ${flat} (flat layout, requires \`name: ${workflowSlug}\` inside)\n  ${nested} (nested layout)`
    );
  }
  const yaml = readFileSync(yamlPath, 'utf-8');
  let parsed: unknown;
  try {
    parsed = parseYaml(yaml);
  } catch {
    return { yaml, templates: [], blocks: buildBlocksPayload(dir, yaml) };
  }
  const refs: TemplateRef[] = [];
  collectTemplateRefsFromWorkflow(parsed, null, refs);
  const localTemplates = collectLocalTemplatesForEval(dir);
  const templates: Array<{ id: string; content: string; filename?: string }> = [];
  const templateIdByRelPath = new Map<string, string>();
  for (const ref of refs) {
    const localTemplate = pickLocalTemplateForRef(ref, localTemplates);
    if (!localTemplate) continue;
    let syntheticId = templateIdByRelPath.get(localTemplate.relPath);
    if (!syntheticId) {
      syntheticId = `ephemeral-tpl-${templates.length}`;
      templateIdByRelPath.set(localTemplate.relPath, syntheticId);
      templates.push({
        id: syntheticId,
        content: localTemplate.fileBuffer.toString('base64'),
        filename: localTemplate.fileName,
      });
    }
    ref.container.templateId = syntheticId;
  }
  const blocks = buildBlocksPayload(dir, stringifyYaml(parsed));
  return { yaml: stringifyYaml(parsed), templates, blocks };
}

/**
 * Resolve the eval-examples directory, supporting two layouts:
 *
 *   1. Flat — `./dataset/examples/<name>/input/arguments.json` (the layout
 *      `eigenpal init workflow` scaffolds and the dataset-archive format
 *      enforced server-side). Examples are folders directly under
 *      `dataset/examples/`; each carries an `input/arguments.json`.
 *   2. Nested (legacy) — `<dir>/workflows/<slug>/eval/<name>/input.json`.
 *      Examples are folders directly under `<slug>/eval/`; each carries an
 *      `input.json` at the top level.
 *
 * Returns `{ baseDir, layout }` so the caller knows how to interpret each
 * example path. Flat is preferred when both happen to exist.
 */
export interface ResolvedEvalDir {
  baseDir: string;
  layout: 'flat' | 'nested';
}

export function resolveEvalBaseDir(dir: string, workflowSlug: string): ResolvedEvalDir | null {
  const flatCandidates = [join(dir, 'dataset', 'examples'), join('dataset', 'examples')];
  for (const candidate of flatCandidates) {
    if (existsSync(candidate)) return { baseDir: candidate, layout: 'flat' };
  }
  const nested = join(dir, 'workflows', workflowSlug, 'eval');
  if (existsSync(nested)) return { baseDir: nested, layout: 'nested' };
  return null;
}

/** List example directory names sorted numerically; filter by exampleNames if provided. */
export function getExampleNames(
  dir: string,
  workflowSlug: string,
  exampleNamesFilter?: string[]
): string[] {
  const resolved = resolveEvalBaseDir(dir, workflowSlug);
  if (!resolved) {
    const flat = join(dir, 'dataset', 'examples');
    const nested = join(dir, 'workflows', workflowSlug, 'eval');
    throw new Error(
      `No eval examples directory. Looked for:\n  ${flat} (flat layout)\n  ${nested} (nested layout)`
    );
  }
  // Flat layout examples live at `<base>/<name>/input/arguments.json`.
  // Nested layout examples live at `<base>/<name>/input.json`.
  const inputMarker =
    resolved.layout === 'flat'
      ? (name: string) => join(resolved.baseDir, name, 'input', 'arguments.json')
      : (name: string) => join(resolved.baseDir, name, 'input.json');
  const all = readdirSync(resolved.baseDir)
    .filter((f) => statSync(join(resolved.baseDir, f)).isDirectory() && existsSync(inputMarker(f)))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!exampleNamesFilter?.length) return all;
  return all.filter((n) => exampleNamesFilter.includes(n));
}

/**
 * Build input, overrides, expectedOutput for one example dir. Supports both
 * layouts (see `resolveEvalBaseDir`):
 *
 *   Flat (canonical):
 *     <exampleDir>/input/arguments.json    REQUIRED
 *     <exampleDir>/input/<arg-name>/<file> file-arg folders (auto-inlined)
 *     <exampleDir>/expected/output.json    OPTIONAL
 *     <exampleDir>/expected/<doc-key>/...  OPTIONAL file outputs
 *     <exampleDir>/meta.json               OPTIONAL { rowOrder, annotation, overrides }
 *
 *   Nested (legacy):
 *     <exampleDir>/input.json              REQUIRED
 *     <exampleDir>/expected.json           OPTIONAL
 *     <exampleDir>/overrides.json          OPTIONAL
 */
export function buildExamplePayload(exampleDir: string): ExamplePayload {
  // Layout sniff: flat has `input/arguments.json`, nested has `input.json`.
  const flatInputPath = join(exampleDir, 'input', 'arguments.json');
  const isFlat = existsSync(flatInputPath);

  let input: Record<string, unknown> | undefined;
  if (isFlat) {
    // Flat layout: scalar args from arguments.json + file folders sit
    // alongside it. Materialize file folders into the input object so the
    // execute endpoint sees `{ arg: { _inline: ..., filename } }` for
    // single-file args, or an array of those for multi-file args.
    const rawArgs = JSON.parse(readFileSync(flatInputPath, 'utf-8')) as Record<string, unknown>;
    const inputDir = join(exampleDir, 'input');
    const merged: Record<string, unknown> = { ...rawArgs };
    for (const entry of readdirSync(inputDir)) {
      const full = join(inputDir, entry);
      if (!statSync(full).isDirectory()) continue;
      // Each subfolder is one file-arg. Multi-file → array; single-file → object.
      const files = readdirSync(full)
        .filter((f) => statSync(join(full, f)).isFile())
        .sort();
      if (files.length === 0) continue;
      const inlined = files.map((filename) => {
        const buf = readFileSync(join(full, filename));
        const mime = guessMimeType(filename);
        return {
          _inline: buf.toString('base64'),
          filename,
          ...(mime ? { mimeType: mime } : {}),
        };
      });
      merged[entry] = files.length === 1 ? inlined[0] : inlined;
    }
    input = merged;
  } else {
    const inputPath = join(exampleDir, 'input.json');
    if (existsSync(inputPath)) {
      const rawInput = JSON.parse(readFileSync(inputPath, 'utf-8'));
      input = resolveInputToInline(rawInput, exampleDir) as Record<string, unknown>;
    }
  }

  let overrides: { steps: Record<string, Record<string, unknown>> } | null | undefined;
  if (isFlat) {
    // Flat layout stores overrides nested under meta.json's `overrides`.
    const metaPath = join(exampleDir, 'meta.json');
    if (existsSync(metaPath)) {
      const raw = JSON.parse(readFileSync(metaPath, 'utf-8')) as unknown;
      const ov = (raw as { overrides?: unknown }).overrides;
      if (
        ov &&
        typeof ov === 'object' &&
        'steps' in ov &&
        typeof (ov as { steps: unknown }).steps === 'object'
      ) {
        overrides = ov as { steps: Record<string, Record<string, unknown>> };
      }
    }
  } else {
    const overridesPath = join(exampleDir, 'overrides.json');
    if (existsSync(overridesPath)) {
      const raw = JSON.parse(readFileSync(overridesPath, 'utf-8')) as unknown;
      if (
        raw &&
        typeof raw === 'object' &&
        'steps' in raw &&
        typeof (raw as { steps: unknown }).steps === 'object'
      ) {
        overrides = raw as { steps: Record<string, Record<string, unknown>> };
      }
    }
  }

  let expectedOutput: ExpectedOutput | null | undefined;
  if (isFlat) {
    const expectedDataPath = join(exampleDir, 'expected', 'output.json');
    const expectedDir = join(exampleDir, 'expected');
    let data: unknown | undefined;
    if (existsSync(expectedDataPath)) {
      data = JSON.parse(readFileSync(expectedDataPath, 'utf-8'));
    }
    // Expected file outputs live in `expected/<docKey>/<file>` symmetric with
    // input/<argName>/<file>. Single-file → object; multi-file → array.
    let expectedDocuments: Record<string, unknown> | undefined;
    if (existsSync(expectedDir)) {
      for (const entry of readdirSync(expectedDir)) {
        const full = join(expectedDir, entry);
        if (!statSync(full).isDirectory()) continue;
        const files = readdirSync(full)
          .filter((f) => statSync(join(full, f)).isFile())
          .sort();
        if (files.length === 0) continue;
        const inlined = files.map((filename) => {
          const buf = readFileSync(join(full, filename));
          const mime = guessMimeType(filename);
          return {
            _inline: buf.toString('base64'),
            filename,
            ...(mime ? { mimeType: mime } : {}),
          };
        });
        expectedDocuments = expectedDocuments ?? {};
        expectedDocuments[entry] = files.length === 1 ? inlined[0] : inlined;
      }
    }
    if (data !== undefined || expectedDocuments) {
      const envelope: Record<string, unknown> = {};
      if (data !== undefined) envelope.data = data;
      if (expectedDocuments) envelope.expectedDocuments = expectedDocuments;
      const parsed = ExpectedOutputSchema.safeParse(envelope);
      if (!parsed.success) {
        throw new Error(`Invalid expected output in ${expectedDataPath}: ${parsed.error.message}`);
      }
      expectedOutput = parsed.data;
    }
  } else {
    const expectedPath = join(exampleDir, 'expected.json');
    if (existsSync(expectedPath)) {
      const raw = JSON.parse(readFileSync(expectedPath, 'utf-8')) as unknown;
      const parsed = ExpectedOutputSchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error(
          `Invalid expected output in ${expectedPath}: expected object with optional "data" and "expectedDocuments". ${parsed.error.message}`
        );
      }
      expectedOutput = parsed.data;
      resolveExpectedDocumentsToInline(expectedOutput, exampleDir);
    }
  }
  return {
    input,
    overrides: overrides ?? null,
    expectedOutput: expectedOutput ?? null,
  };
}
