/**
 * Local validation helpers, no server contact. Each helper registers a
 * `validate [path]` subcommand under the noun it belongs to so the CLI
 * surface reads:
 *
 *   eigenpal workflow validate [path]              all three (templated
 *                                                  layout), OR a single
 *                                                  workflow.yaml when [path]
 *                                                  points at one
 *   eigenpal workflow evaluators validate [path]   ./evaluators.yaml
 *   eigenpal workflow dataset    validate [path]   ./dataset/
 *
 * Verbs live UNDER the noun, never above it — consistent with push/pull/list,
 * and ready for `eigenpal agents <noun> validate` to mirror 1:1.
 *
 * Each subcommand exits 0 on success, 1 on any issue, and prints structured
 * `field: message` lines so an agent can target specific fixes.
 */

import { EvalConfigYamlSchema, ExpectedErrorSchema } from '@eigenpal/types';
import {
  parseWorkflow,
  validateSchemaQuality,
  WorkflowValidationError,
  YamlParseError,
  type SchemaQualityWarning,
} from '@eigenpal/workflow-yaml';
import type { Command } from 'commander';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { parse as parseYaml } from 'yaml';
import { ApiClient } from '../../lib/client';
import { requireApiKey, resolveConfig } from '../../lib/config';
import { action } from '../../lib/format-error';
import {
  countTemplateSteps,
  diagnoseTemplateSteps,
  type TemplateDiagnostic,
} from '../../lib/template-diagnostics';
import { error, info, success, ui, warn, withBaseUrl } from '../../lib/ui';

interface ValidationIssue {
  field: string;
  message: string;
}

const NAME_RE = /^[a-z0-9][a-z0-9-_]*$/;

/** `statSync` that doesn't crash on broken symlinks / FIFOs / permission
 *  errors — converts the syscall failure into a `false` and a structured issue. */
function isDirSafe(path: string, issues: ValidationIssue[], field: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch (err) {
    issues.push({
      field,
      message: `unreadable filesystem entry: ${err instanceof Error ? err.message : String(err)}`,
    });
    return false;
  }
}

// ---------- workflow.yaml -------------------------------------------------

/**
 * Count action.invoke-workflow steps anywhere in the tree (including nested
 * control containers). Used to decide whether to nudge the user toward
 * `--online`, since local validation cannot resolve invoke targets. Walks an
 * untyped shape so it stays robust to step variants.
 */
export function countInvokeWorkflowSteps(steps: unknown): number {
  if (!Array.isArray(steps)) return 0;
  let count = 0;
  for (const entry of steps) {
    if (!entry || typeof entry !== 'object') continue;
    const step = entry as Record<string, unknown>;
    if (step.type === 'action.invoke-workflow') count++;
    count += countInvokeWorkflowSteps(step.steps);
    count += countInvokeWorkflowSteps(step.then);
    count += countInvokeWorkflowSteps(step.else);
    if (Array.isArray(step.branches)) {
      for (const branch of step.branches) {
        if (branch && typeof branch === 'object') {
          count += countInvokeWorkflowSteps((branch as Record<string, unknown>).steps);
        }
      }
    }
  }
  return count;
}

function validateWorkflowYaml(path: string): {
  issues: ValidationIssue[];
  warnings: SchemaQualityWarning[];
  /** action.invoke-workflow step count — drives the `--online` nudge. */
  invokeStepCount: number;
  templateStepCount: number;
  steps: unknown;
} {
  if (!existsSync(path)) {
    return {
      issues: [{ field: path, message: 'File not found.' }],
      warnings: [],
      invokeStepCount: 0,
      templateStepCount: 0,
      steps: [],
    };
  }
  const text = readFileSync(path, 'utf-8');
  try {
    const definition = parseWorkflow(text);
    let warnings: SchemaQualityWarning[] = [];
    try {
      warnings = validateSchemaQuality(definition);
    } catch {
      warnings = [];
    }
    return {
      issues: [],
      warnings,
      invokeStepCount: countInvokeWorkflowSteps(definition.steps),
      templateStepCount: countTemplateSteps(definition.steps),
      steps: definition.steps,
    };
  } catch (err) {
    if (err instanceof YamlParseError) {
      const where = err.line !== undefined ? ` (line ${err.line})` : '';
      return {
        issues: [{ field: 'yaml', message: `${err.message}${where}` }],
        warnings: [],
        invokeStepCount: 0,
        templateStepCount: 0,
        steps: [],
      };
    }
    if (err instanceof WorkflowValidationError) {
      return {
        issues: err.errors.map((e) => ({
          field: e.path.length > 0 ? e.path.map(String).join('.') : '(root)',
          message: e.message,
        })),
        warnings: [],
        invokeStepCount: 0,
        templateStepCount: 0,
        steps: [],
      };
    }
    return {
      issues: [{ field: '(root)', message: err instanceof Error ? err.message : String(err) }],
      warnings: [],
      invokeStepCount: 0,
      templateStepCount: 0,
      steps: [],
    };
  }
}

/**
 * Print the `--online` nudge after a local validate when the workflow contains
 * action.invoke-workflow steps and the online check was not run. Local
 * validation cannot resolve invoke targets (they live in the server DB), so
 * these references go unchecked unless the user runs `--online` (or pushes).
 */
function printInvokeOnlineHint(
  invokeStepCount: number,
  templateStepCount: number,
  online: boolean | undefined
): void {
  if (online) return;
  if (invokeStepCount > 0) {
    const plural = invokeStepCount === 1 ? '' : 's';
    info(
      `${invokeStepCount} action.invoke-workflow step${plural} not checked locally. Run \`validate --online\` (or push) to validate invoke targets, input types, and cycles against the server.`
    );
  }
  if (templateStepCount > 0) {
    const plural = templateStepCount === 1 ? '' : 's';
    info(
      `${templateStepCount} transform.template step${plural} with tmpl_… ids are not checked against live template metadata unless you pass \`--online\`. Local \`template:\` paths are inspected on disk either way.`
    );
  }
}

function printTemplateDiagnostics(path: string, diagnostics: TemplateDiagnostic[]): boolean {
  if (diagnostics.length === 0) return true;
  const errors = diagnostics.filter((item) => item.severity === 'error');
  const warnings = diagnostics.filter((item) => item.severity === 'warning');
  if (warnings.length > 0) {
    warn(
      `transform.template ${ui.dim(`(${path})`)}: ${warnings.length} warning${warnings.length === 1 ? '' : 's'}`
    );
    for (const item of warnings) {
      warn(`  ${ui.dim(item.field)} ${item.message}`);
    }
  }
  if (errors.length === 0) return true;
  return printIssues(
    'transform.template',
    path,
    errors.map((item) => ({ field: item.field, message: item.message }))
  );
}

async function runTemplateDiagnostics(
  workflowFile: string,
  steps: unknown,
  opts: OnlineOpt
): Promise<boolean> {
  let client: ApiClient | undefined;
  if (opts.online) {
    const config = resolveConfig(opts);
    requireApiKey(config);
    client = new ApiClient(config);
  }
  const diagnostics = await diagnoseTemplateSteps({
    workflowFile,
    steps,
    client,
    allowExternal: Boolean(opts.allowExternalTemplates),
  });
  return printTemplateDiagnostics(workflowFile, diagnostics);
}

function printSchemaQualityWarnings(path: string, warnings: SchemaQualityWarning[]): void {
  if (warnings.length === 0) return;
  warn(
    `workflow.yaml ${ui.dim(`(${path})`)}: ${warnings.length} schema-quality warning${warnings.length === 1 ? '' : 's'}`
  );
  for (const w of warnings) {
    warn(`  ${ui.dim(w.field)} ${w.message}`);
    if (w.hint) warn(`    ${ui.dim('hint:')} ${w.hint}`);
  }
}

// ---------- evaluators.yaml -----------------------------------------------

function validateEvaluatorsYaml(path: string): ValidationIssue[] {
  if (!existsSync(path)) {
    return [{ field: path, message: 'File not found.' }];
  }
  const text = readFileSync(path, 'utf-8');
  let parsed: unknown;
  try {
    parsed = parseYaml(text);
  } catch (err) {
    return [{ field: 'yaml', message: err instanceof Error ? err.message : 'YAML parse error' }];
  }
  const result = EvalConfigYamlSchema.safeParse(parsed);
  if (result.success) return [];
  return result.error.issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.map(String).join('.') : '(root)',
    message: issue.message,
  }));
}

// ---------- dataset/ folder -----------------------------------------------

export function validateDatasetFolder(root: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!existsSync(root)) {
    return [{ field: root, message: 'Folder not found.' }];
  }
  if (existsSync(join(root, 'manifest.json'))) {
    issues.push({
      field: 'manifest.json',
      message:
        'Top-level manifest.json is the legacy format. Re-export the dataset using the folder convention.',
    });
  }
  const examplesDir = join(root, 'examples');
  if (!existsSync(examplesDir)) {
    issues.push({ field: 'examples/', message: 'No examples/ directory found at dataset root.' });
    return issues;
  }

  for (const exampleName of readdirSync(examplesDir)) {
    const exampleFolder = join(examplesDir, exampleName);
    if (!isDirSafe(exampleFolder, issues, `examples/${exampleName}`)) continue;

    if (!NAME_RE.test(exampleName)) {
      issues.push({
        field: `examples/${exampleName}`,
        message: 'Folder name must be lowercase kebab/snake-case.',
      });
      continue;
    }

    const inputJsonPath = join(exampleFolder, 'input.json');
    const hasInputJson = existsSync(inputJsonPath);
    if (!hasInputJson) {
      issues.push({
        field: `examples/${exampleName}/input.json`,
        message: 'Missing required input.json.',
      });
      continue;
    }

    let args: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(readFileSync(inputJsonPath, 'utf-8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        issues.push({
          field: `examples/${exampleName}/input.json`,
          message: 'input.json must be a JSON object.',
        });
        continue;
      }
      args = parsed as Record<string, unknown>;
    } catch {
      issues.push({
        field: `examples/${exampleName}/input.json`,
        message: 'input.json is not valid JSON.',
      });
      continue;
    }

    const inputDir = join(exampleFolder, 'input');
    if (existsSync(join(inputDir, 'arguments.json'))) {
      issues.push({
        field: `examples/${exampleName}/input/arguments.json`,
        message: 'Legacy input/arguments.json is no longer accepted. Use input.json instead.',
      });
    }
    const fileRefs = collectDatasetFileRefs(args);
    for (const issue of validateFileRefs({
      refs: fileRefs,
      filesRoot: inputDir,
      root: 'input',
      fieldPrefix: `examples/${exampleName}/input.json`,
    })) {
      issues.push(issue);
    }

    const expectedDir = join(exampleFolder, 'expected');
    const expectedJsonPath = join(exampleFolder, 'expected.json');
    if (existsSync(expectedDir)) {
      for (const entry of readdirSync(expectedDir)) {
        if (entry === 'output.json' || entry === 'error.json') {
          issues.push({
            field: `examples/${exampleName}/expected/${entry}`,
            message: 'Legacy expected files are no longer accepted. Use expected.json instead.',
          });
          continue;
        }
        const sub = join(expectedDir, entry);
        const field = `examples/${exampleName}/expected/${entry}`;
        let isDir: boolean;
        try {
          isDir = statSync(sub).isDirectory();
        } catch (err) {
          issues.push({
            field,
            message: `unreadable filesystem entry: ${err instanceof Error ? err.message : String(err)}`,
          });
          continue;
        }
        if (!isDir) {
          issues.push({
            field,
            message:
              'Entries under expected/ must be file folders referenced from expected.json with { "$file": "expected/..." }.',
          });
          continue;
        }
        if (!NAME_RE.test(entry)) {
          issues.push({
            field,
            message: 'Expected document folder name must be lowercase kebab/snake-case.',
          });
        }
      }
    }
    if (existsSync(expectedJsonPath)) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(readFileSync(expectedJsonPath, 'utf-8'));
      } catch {
        issues.push({
          field: `examples/${exampleName}/expected.json`,
          message: 'expected.json is not valid JSON.',
        });
        continue;
      }
      if (isExpectedErrorRef(parsed)) {
        const result = ExpectedErrorSchema.safeParse(parsed.$error);
        if (!result.success) {
          for (const err of result.error.issues) {
            issues.push({
              field: `examples/${exampleName}/expected.json:$error${
                err.path.length > 0 ? `.${err.path.join('.')}` : ''
              }`,
              message: err.message,
            });
          }
        }
      } else if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        issues.push({
          field: `examples/${exampleName}/expected.json`,
          message: 'expected.json must be a JSON object.',
        });
      } else {
        for (const issue of validateFileRefs({
          refs: collectDatasetFileRefs(parsed),
          filesRoot: join(exampleFolder, 'expected'),
          root: 'expected',
          fieldPrefix: `examples/${exampleName}/expected.json`,
        })) {
          issues.push(issue);
        }
      }
    }
  }
  return issues;
}

// ---------- shared printer ------------------------------------------------

export function printIssues(label: string, path: string, issues: ValidationIssue[]): boolean {
  if (issues.length === 0) {
    success(`${label} ${ui.dim(`(${path})`)} ✓`);
    return true;
  }
  error(`${label} ${ui.dim(`(${path})`)} — ${issues.length} issue${issues.length > 1 ? 's' : ''}`);
  const fieldWidth = Math.max(...issues.map((i) => i.field.length));
  for (const issue of issues) {
    const field = issue.field.padEnd(fieldWidth);
    console.error(`  ${ui.bold(field)}  ${issue.message}`);
  }
  console.error('');
  return false;
}

type DatasetFileRoot = 'input' | 'expected';

interface DatasetFileRef {
  path: string;
  jsonPath: string;
}

function isFileRef(value: unknown): value is { $file: string } {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof (value as { $file?: unknown }).$file === 'string'
  );
}

function isExpectedErrorRef(value: unknown): value is { $error: unknown } {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    Object.prototype.hasOwnProperty.call(value, '$error')
  );
}

function collectDatasetFileRefs(value: unknown, jsonPath = '<root>'): DatasetFileRef[] {
  if (isFileRef(value)) return [{ path: value.$file, jsonPath }];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectDatasetFileRefs(item, `${jsonPath}.${index}`));
  }
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) =>
      collectDatasetFileRefs(item, jsonPath === '<root>' ? key : `${jsonPath}.${key}`)
    );
  }
  return [];
}

function validateFileRefs(args: {
  refs: DatasetFileRef[];
  filesRoot: string;
  root: DatasetFileRoot;
  fieldPrefix: string;
}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const ref of args.refs) {
    const relative = parseDatasetFileRef(ref.path, args.root);
    if (!relative) {
      issues.push({
        field: `${args.fieldPrefix}:${ref.jsonPath}`,
        message: `File reference must point inside ${args.root}/ and must not contain path traversal.`,
      });
      continue;
    }
    if (!existsSync(join(args.filesRoot, relative))) {
      issues.push({
        field: `${args.fieldPrefix}:${ref.jsonPath}`,
        message: `Referenced file does not exist: ${ref.path}.`,
      });
    }
  }
  return issues;
}

function parseDatasetFileRef(path: string, root: DatasetFileRoot): string | null {
  if (!path.startsWith(`${root}/`)) return null;
  if (path.startsWith('/') || path.includes('\\') || path.includes('\u0000')) return null;
  const relative = path.slice(root.length + 1);
  const parts = relative.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) return null;
  return parts.join('/');
}

// ---------- registration --------------------------------------------------

interface DirOpt {
  dir?: string;
}

interface OnlineOpt extends DirOpt {
  online?: boolean;
  baseUrl?: string;
  allowExternalTemplates?: boolean;
}

function rootDir(opts: DirOpt): string {
  return resolve(opts.dir ?? process.cwd());
}

/**
 * Server-side validation of cross-workflow `action.invoke-workflow` references.
 * Local validation can only check a workflow's own shape; resolving invoke
 * targets (existence, input type-match, missing/unknown keys, output
 * declaration, cycles) needs the tenant's published workflows from the DB, so
 * `POST /api/workflows/validate` runs the same gate as push without persisting.
 * Returns the structured issues so the caller renders them like the local ones.
 */
async function onlineInvokeIssues(yamlText: string, opts: OnlineOpt): Promise<ValidationIssue[]> {
  const config = resolveConfig(opts);
  requireApiKey(config);
  const client = new ApiClient(config);
  const res = (await client.post('/api/workflows/validate', { yaml: yamlText })) as {
    valid: boolean;
    issues?: ValidationIssue[];
  };
  return res.issues ?? [];
}

/** Register `<parent> validate` (no subcommand): runs all three local checks
 *  against the templated project layout (`./workflow.yaml`, `./evaluators.yaml`,
 *  `./dataset/`). For targeted validation use the per-noun helpers. */
export function registerAllValidateCommand(parent: Command): void {
  const cmd = parent
    .command('validate [path]')
    .description(
      'Local-only validation. Without [path]: runs the templated three-way check (./workflow.yaml + ./evaluators.yaml + ./dataset/). With [path] pointing at a YAML file: validates that workflow.yaml. For per-noun targeting use `evaluators validate` or `dataset validate`.'
    )
    .option(
      '--dir <path>',
      'Project root (defaults to cwd; resolves the three default paths from here)'
    )
    .option(
      '--online',
      'Authenticate and also validate action.invoke-workflow targets, transform.template tmpl_… references, and explicitly selected OCR/vision/text models against this tenant environment (existence, format, revision pairing, tokens vs data, XLSX {{ }} mistakes, configured catalog). Local template: paths are inspected on disk with or without this flag. Model checks use the configured catalog only — they do not probe live provider health.'
    )
    .option(
      '--allow-external-templates',
      'Allow local template: paths whose real path is outside the workflow project directory (the folder that contains the YAML file). Off by default; ../ and symlink escapes are rejected.'
    )
    .addHelpText(
      'after',
      '\nNote\n' +
        '  Local validation cannot resolve action.invoke-workflow targets, tmpl_…\n' +
        '  template ids, or whether selected OCR/vision/text models exist in this\n' +
        '  environment (they live on the server). Run `validate --online` to check\n' +
        '  them before pushing. Source-controlled `template: ./file.xlsx` paths are\n' +
        '  inspected on disk without --online and must stay inside the workflow\n' +
        '  project unless you pass --allow-external-templates.\n'
    );
  withBaseUrl(cmd).action(
    action(async (path: string | undefined, opts: OnlineOpt) => {
      // Single-file mode: caller passed a positional path pointing at a YAML
      // file. Validate only that workflow and the schema-quality warnings;
      // skip evaluators/dataset entirely so a quick `validate ./wf.yaml`
      // doesn't error on missing project siblings.
      if (path) {
        const target = resolve(path);
        const wfResult = validateWorkflowYaml(target);
        const wfOk = printIssues('workflow.yaml', target, wfResult.issues);
        if (wfOk) {
          printSchemaQualityWarnings(target, wfResult.warnings);
          printInvokeOnlineHint(wfResult.invokeStepCount, wfResult.templateStepCount, opts.online);
        }
        const templateOk = wfOk ? await runTemplateDiagnostics(target, wfResult.steps, opts) : true;
        let onlineOk = true;
        if (wfOk && opts.online) {
          onlineOk = printIssues(
            'invoke refs (server)',
            target,
            await onlineInvokeIssues(readFileSync(target, 'utf-8'), opts)
          );
        }
        if (!wfOk || !templateOk || !onlineOk) process.exit(1);
        return;
      }

      const root = rootDir(opts);
      const wfFile = join(root, 'workflow.yaml');
      const wfResult = validateWorkflowYaml(wfFile);
      const wfPath = relPath(root, wfFile);
      const wfOk = printIssues('workflow.yaml', wfPath, wfResult.issues);
      if (wfOk) {
        printSchemaQualityWarnings(wfPath, wfResult.warnings);
        printInvokeOnlineHint(wfResult.invokeStepCount, wfResult.templateStepCount, opts.online);
      }
      const evOk = printIssues(
        'evaluators.yaml',
        relPath(root, join(root, 'evaluators.yaml')),
        validateEvaluatorsYaml(join(root, 'evaluators.yaml'))
      );
      const dsOk = printIssues(
        'dataset/',
        relPath(root, join(root, 'dataset')),
        validateDatasetFolder(join(root, 'dataset'))
      );
      // Online invoke check runs only when the local workflow shape is valid —
      // the server would just re-report the same parse/schema errors otherwise.
      let onlineOk = true;
      const templateOk =
        wfOk && existsSync(wfFile)
          ? await runTemplateDiagnostics(wfFile, wfResult.steps, opts)
          : true;
      if (wfOk && opts.online && existsSync(wfFile)) {
        onlineOk = printIssues(
          'invoke refs (server)',
          wfPath,
          await onlineInvokeIssues(readFileSync(wfFile, 'utf-8'), opts)
        );
      }
      if (!wfOk || !evOk || !dsOk || !templateOk || !onlineOk) process.exit(1);
    })
  );
}

export function registerEvaluatorsValidateCommand(parent: Command): void {
  parent
    .command('validate [path]')
    .description(
      'Validate an evaluators YAML file against the EvalConfig schema. Defaults to ./evaluators.yaml.'
    )
    .action((path: string | undefined) => {
      const target = resolve(path ?? 'evaluators.yaml');
      if (!printIssues('evaluators', target, validateEvaluatorsYaml(target))) process.exit(1);
    });
}

export function registerDatasetValidateCommand(parent: Command): void {
  parent
    .command('validate [path]')
    .description(
      'Validate a dataset folder against the examples/<name>/{input,expected,meta} convention. Defaults to ./dataset/.'
    )
    .action((path: string | undefined) => {
      const target = resolve(path ?? 'dataset');
      if (!printIssues('dataset', target, validateDatasetFolder(target))) process.exit(1);
    });
}

function relPath(root: string, target: string): string {
  if (target.startsWith(root + '/')) return target.slice(root.length + 1);
  if (target === root) return '.';
  return target;
}
