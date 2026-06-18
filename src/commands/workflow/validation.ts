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
import { error, success, ui, warn } from '../../lib/ui';

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

function validateWorkflowYaml(path: string): {
  issues: ValidationIssue[];
  warnings: SchemaQualityWarning[];
} {
  if (!existsSync(path)) {
    return { issues: [{ field: path, message: 'File not found.' }], warnings: [] };
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
    return { issues: [], warnings };
  } catch (err) {
    if (err instanceof YamlParseError) {
      const where = err.line !== undefined ? ` (line ${err.line})` : '';
      return { issues: [{ field: 'yaml', message: `${err.message}${where}` }], warnings: [] };
    }
    if (err instanceof WorkflowValidationError) {
      return {
        issues: err.errors.map((e) => ({
          field: e.path.length > 0 ? e.path.map(String).join('.') : '(root)',
          message: e.message,
        })),
        warnings: [],
      };
    }
    return {
      issues: [{ field: '(root)', message: err instanceof Error ? err.message : String(err) }],
      warnings: [],
    };
  }
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

    const argsPath = join(exampleFolder, 'input', 'arguments.json');
    if (!existsSync(argsPath)) {
      issues.push({
        field: `examples/${exampleName}/input/arguments.json`,
        message: 'Missing required arguments.json.',
      });
      continue;
    }

    let args: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(readFileSync(argsPath, 'utf-8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        issues.push({
          field: `examples/${exampleName}/input/arguments.json`,
          message: 'arguments.json must be a JSON object.',
        });
        continue;
      }
      args = parsed as Record<string, unknown>;
    } catch {
      issues.push({
        field: `examples/${exampleName}/input/arguments.json`,
        message: 'arguments.json is not valid JSON.',
      });
      continue;
    }

    const inputDir = join(exampleFolder, 'input');
    for (const entry of readdirSync(inputDir)) {
      if (entry === 'arguments.json') continue;
      const sub = join(inputDir, entry);
      const field = `examples/${exampleName}/input/${entry}`;
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
          message: 'Entries under input/ must live inside an argument folder.',
        });
        continue;
      }
      if (!NAME_RE.test(entry)) {
        issues.push({
          field: `examples/${exampleName}/input/${entry}`,
          message: 'Argument folder name must be lowercase kebab/snake-case.',
        });
      }
      if (Object.prototype.hasOwnProperty.call(args, entry)) {
        issues.push({
          field: `examples/${exampleName}/input/${entry}`,
          message: `Argument-name collision: "${entry}" appears in both arguments.json and as an input/ folder.`,
        });
      }
    }

    const expectedDir = join(exampleFolder, 'expected');
    if (existsSync(expectedDir)) {
      const expectedPath = join(expectedDir, 'output.json');
      const expectedErrorPath = join(expectedDir, 'error.json');
      const hasExpectedOutput = existsSync(expectedPath);
      const hasExpectedError = existsSync(expectedErrorPath);
      if (hasExpectedOutput && hasExpectedError) {
        issues.push({
          field: `examples/${exampleName}/expected`,
          message:
            'expected/output.json and expected/error.json are mutually exclusive (pick success-expected OR failure-expected).',
        });
      }
      if (hasExpectedOutput) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(readFileSync(expectedPath, 'utf-8'));
        } catch {
          issues.push({
            field: `examples/${exampleName}/expected/output.json`,
            message: 'expected/output.json is not valid JSON.',
          });
          continue;
        }
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          issues.push({
            field: `examples/${exampleName}/expected/output.json`,
            message:
              'expected/output.json must be a JSON object (mirrors the workflow `output:` shape).',
          });
        }
      }
      if (hasExpectedError) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(readFileSync(expectedErrorPath, 'utf-8'));
        } catch {
          issues.push({
            field: `examples/${exampleName}/expected/error.json`,
            message: 'expected/error.json is not valid JSON.',
          });
          continue;
        }
        // Delegate to the shared schema so the "at least one of code,
        // messageContains, step" rule and any future constraints (range
        // checks, length limits) live in exactly one place rather than
        // drifting between the CLI and the server importer.
        const result = ExpectedErrorSchema.safeParse(parsed);
        if (!result.success) {
          for (const err of result.error.issues) {
            issues.push({
              field: `examples/${exampleName}/expected/error.json${
                err.path.length > 0 ? `:${err.path.join('.')}` : ''
              }`,
              message: err.message,
            });
          }
        }
      }

      // expected/<docKey>/<file> — symmetric with input/<argName>/<file>.
      // Each <docKey> folder becomes an `expectedDocuments` entry on import.
      // `output.json` is the success-expected envelope; `error.json` is the
      // failure-expected assertion (mutually exclusive with output.json).
      for (const entry of readdirSync(expectedDir)) {
        if (entry === 'output.json' || entry === 'error.json') continue;
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
              'Entries under expected/ must be `output.json`, `error.json`, or a doc folder (`expected/<docKey>/<file>`).',
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

// ---------- registration --------------------------------------------------

interface DirOpt {
  dir?: string;
}

function rootDir(opts: DirOpt): string {
  return resolve(opts.dir ?? process.cwd());
}

/** Register `<parent> validate` (no subcommand): runs all three local checks
 *  against the templated project layout (`./workflow.yaml`, `./evaluators.yaml`,
 *  `./dataset/`). For targeted validation use the per-noun helpers. */
export function registerAllValidateCommand(parent: Command): void {
  parent
    .command('validate [path]')
    .description(
      'Local-only validation. Without [path]: runs the templated three-way check (./workflow.yaml + ./evaluators.yaml + ./dataset/). With [path] pointing at a YAML file: validates that workflow.yaml. For per-noun targeting use `evaluators validate` or `dataset validate`.'
    )
    .option(
      '--dir <path>',
      'Project root (defaults to cwd; resolves the three default paths from here)'
    )
    .action((path: string | undefined, opts: DirOpt) => {
      // Single-file mode: caller passed a positional path pointing at a YAML
      // file. Validate only that workflow and the schema-quality warnings;
      // skip evaluators/dataset entirely so a quick `validate ./wf.yaml`
      // doesn't error on missing project siblings.
      if (path) {
        const target = resolve(path);
        const wfResult = validateWorkflowYaml(target);
        const wfOk = printIssues('workflow.yaml', target, wfResult.issues);
        if (wfOk) printSchemaQualityWarnings(target, wfResult.warnings);
        if (!wfOk) process.exit(1);
        return;
      }

      const root = rootDir(opts);
      const wfResult = validateWorkflowYaml(join(root, 'workflow.yaml'));
      const wfPath = relPath(root, join(root, 'workflow.yaml'));
      const wfOk = printIssues('workflow.yaml', wfPath, wfResult.issues);
      if (wfOk) printSchemaQualityWarnings(wfPath, wfResult.warnings);
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
      if (!wfOk || !evOk || !dsOk) process.exit(1);
    });
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
