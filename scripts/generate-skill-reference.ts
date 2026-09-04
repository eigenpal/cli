#!/usr/bin/env bun
/**
 * Regenerate the auto-generated sections inside packages/cli/src/skill/reference/*.md
 * from the canonical Zod schemas in @eigenpal/types/docs.
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
  renderDatasetArchiveReference,
  renderEvaluatorCatalog,
  renderRetryReference,
  renderStepCatalog,
  renderWorkflowReference,
} from '@eigenpal/types/docs';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SKILL_DIR = join(__dirname, '..', 'src', 'skill', 'reference');
const CLI_DOCS_SRC = join(__dirname, '..', 'docs');
const CLI_DOCS_DEST = join(SKILL_DIR, 'cli');
const REPO_ROOT = join(__dirname, '..', '..', '..');

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
      WORKFLOW_REFERENCE: renderWorkflowReference(),
    },
  },
  {
    file: 'dataset-format.md',
    blocks: { DATASET_REFERENCE: renderDatasetArchiveReference() },
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
