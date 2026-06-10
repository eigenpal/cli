/**
 * `eigenpal init workflow <name>` — scaffold a new workflow project from a
 * bundled template. Templates live at `packages/cli/src/templates/<name>/`
 * and are copied into the user's working directory at `<name>/`, with
 * `__NAME__` placeholders rewritten to the project name.
 *
 * Templates ship with the §4 dataset folder convention pre-baked, so a
 * fresh project is `eigenpal run` ready out of the box.
 *
 * Git-backed agent packages are scaffolded with `eigenpal agents init`.
 */

import { cancel, isCancel, select } from '@clack/prompts';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dim, info, success, ui } from '../../lib/ui';

const TEMPLATE_NAMES = ['blank', 'pdf-extraction', 'text-classification'] as const;
type TemplateName = (typeof TEMPLATE_NAMES)[number];

const TEMPLATE_DESCRIPTIONS: Record<TemplateName, string> = {
  blank: 'Single-step pass-through. Good starting point when you know what you want to build.',
  'pdf-extraction':
    'Parse a PDF/image with the auto parser, then ai.extract structured fields against a JSON schema.',
  'text-classification':
    'Classify free-form text into one of a fixed set of labels (positive/neutral/negative).',
};

function isValidProjectName(name: string): boolean {
  // Must be a valid folder name + match the workflow name pattern (kebab/snake).
  return /^[a-z0-9][a-z0-9-_]*$/.test(name) && name.length <= 60;
}

/**
 * Resolve `packages/cli/src/templates/` regardless of whether we're running
 * from source (bun src/cli.ts) or from a published bundle (dist/cli.js).
 *
 * In src layout: `__dirname` is `packages/cli/src/commands/init/` → templates is
 * at `../../templates/`.
 *
 * In dist layout: bun bundles to `dist/cli.js`. We ship `dist/templates/` as
 * a sibling of the bundle (build script copies the directory).
 */
function resolveTemplatesRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // src layout
  const srcCandidate = resolve(here, '..', '..', 'templates');
  if (existsSync(srcCandidate)) return srcCandidate;
  // dist layout
  const distCandidate = resolve(here, 'templates');
  if (existsSync(distCandidate)) return distCandidate;
  throw new Error(
    `Cannot locate bundled templates. Looked in:\n  ${srcCandidate}\n  ${distCandidate}`
  );
}

interface InitOptions {
  template?: string;
  /** Skip interactive prompts when called by tests / CI. */
  yes?: boolean;
  /** Override target directory (defaults to ./<name>). */
  dir?: string;
}

export async function init(name: string, opts: InitOptions): Promise<void> {
  if (!isValidProjectName(name)) {
    throw new Error(
      `Invalid project name "${name}". Use lowercase kebab/snake-case (e.g. parse-invoices), max 60 chars.`
    );
  }

  const target = resolve(process.cwd(), opts.dir ?? name);
  assertSafeTargetDir(target, opts.dir);
  if (existsSync(target) && readdirSync(target).length > 0) {
    throw new Error(`Target directory ${relative(process.cwd(), target)} exists and is not empty.`);
  }

  let template: TemplateName;
  if (opts.template) {
    if (!isTemplateName(opts.template)) {
      throw new Error(
        `Unknown template "${opts.template}". Available: ${TEMPLATE_NAMES.join(', ')}.`
      );
    }
    template = opts.template;
  } else if (opts.yes || !process.stdin.isTTY) {
    template = 'blank';
  } else {
    template = await promptForTemplate();
  }

  const sourceRoot = join(resolveTemplatesRoot(), template);
  if (!existsSync(sourceRoot)) {
    throw new Error(`Template directory missing on disk: ${sourceRoot}`);
  }

  const written = copyTemplate(sourceRoot, target, name);

  const targetDisplay = relative(process.cwd(), target) || '.';
  success(`Created ${written} files in ${ui.bold(`${targetDisplay}/`)}`);
  console.log('');
  info('Next steps:');
  dim(`  cd ${targetDisplay}`);
  dim(`  eigenpal workflow validate                    # all three local checks`);
  dim(`  eigenpal run workflows.${name} --example sample`);
}

function assertSafeTargetDir(target: string, dir: string | undefined): void {
  // When --dir is supplied as an absolute path the user is being explicit;
  // accept it. Otherwise, refuse to traverse out of the cwd via "..".
  if (dir !== undefined && !dir.startsWith('/') && dir.split(/[/\\]/).some((s) => s === '..')) {
    throw new Error(
      `Refusing to scaffold into ${target}: --dir contains "..". Pass an absolute path if you intend this.`
    );
  }
}

function isTemplateName(value: string): value is TemplateName {
  return (TEMPLATE_NAMES as readonly string[]).includes(value);
}

async function promptForTemplate(): Promise<TemplateName> {
  const choice = await select({
    message: 'Pick a template',
    initialValue: TEMPLATE_NAMES[0],
    options: TEMPLATE_NAMES.map((t) => ({
      value: t,
      label: t,
      hint: TEMPLATE_DESCRIPTIONS[t],
    })),
  });
  if (isCancel(choice)) {
    cancel('Cancelled.');
    process.exit(0);
  }
  return choice as TemplateName;
}

const PLACEHOLDER = '__NAME__';

/**
 * Recursively copy `src` → `dst`, rewriting `__NAME__` placeholders in text
 * files. Returns the count of files written. Binary files (per extension)
 * are copied verbatim.
 */
function copyTemplate(src: string, dst: string, projectName: string): number {
  let count = 0;
  const stack: string[] = [src];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const entry of readdirSync(dir)) {
      const sourcePath = join(dir, entry);
      const relativePath = relative(src, sourcePath);
      const targetPath = join(dst, relativePath);
      const stats = statSync(sourcePath);
      if (stats.isDirectory()) {
        stack.push(sourcePath);
        continue;
      }
      mkdirSync(dirname(targetPath), { recursive: true });
      if (isTextFile(sourcePath)) {
        const text = readFileSync(sourcePath, 'utf-8').replaceAll(PLACEHOLDER, projectName);
        writeFileSync(targetPath, text);
      } else {
        copyFileSync(sourcePath, targetPath);
      }
      count += 1;
    }
  }
  return count;
}

const TEXT_EXTENSIONS = new Set([
  '.md',
  '.txt',
  '.yaml',
  '.yml',
  '.json',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.html',
  '.css',
]);

function isTextFile(path: string): boolean {
  const dotIndex = path.lastIndexOf('.');
  if (dotIndex < 0) return false;
  return TEXT_EXTENSIONS.has(path.slice(dotIndex).toLowerCase());
}

/** Test-only export so the unit test can avoid touching the user's home dir. */
export const __testing = {
  copyTemplate,
  resolveTemplatesRoot,
  isValidProjectName,
  TEMPLATE_NAMES,
};
