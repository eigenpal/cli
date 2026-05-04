/**
 * `eigenpal workflow clear-local` — delete LOCAL execution artifacts and
 * judge summaries written under `./dataset/examples/<name>/`. Server-side
 * data is never touched.
 *
 * Layout (the only one supported now that the legacy nested layout is gone):
 *
 *   dataset/examples/<name>/executions/<timestamp>/   ← per-run artifacts
 *   dataset/examples/<name>/llm-judge-summary-*.{json,md}
 */

import { existsSync, readdirSync, rmSync, statSync } from 'fs';
import { basename, join } from 'path';
import { resolveEvalBaseDir } from '../lib/payload';
import { error, success, ui, warn } from '../lib/ui';

interface ClearRetentionOptions {
  removeAll?: boolean;
}

interface ClearReport {
  removed: number;
  kept: number;
  touched: number;
}

const EMPTY_REPORT: ClearReport = { removed: 0, kept: 0, touched: 0 };

function getDirectoryEntries(path: string): string[] {
  if (!existsSync(path)) return [];
  return readdirSync(path)
    .filter((entry) => statSync(join(path, entry)).isDirectory())
    .sort();
}

function removeDirEntriesWithRetention(path: string, removeAll: boolean): ClearReport {
  const entries = getDirectoryEntries(path);
  if (entries.length === 0) return EMPTY_REPORT;

  const keepSet = new Set<string>();
  if (!removeAll) keepSet.add(entries[entries.length - 1]);

  let removed = 0;
  for (const entry of entries) {
    if (keepSet.has(entry)) continue;
    rmSync(join(path, entry), { recursive: true, force: true });
    removed++;
  }

  return { removed, kept: keepSet.size, touched: entries.length };
}

function removeJudgeSummaryFilesWithRetention(exampleDir: string, removeAll: boolean): ClearReport {
  if (!existsSync(exampleDir)) return EMPTY_REPORT;

  const stampByFile = new Map<string, string>();
  for (const fileName of readdirSync(exampleDir).sort()) {
    const match = /^llm-judge-summary-(.+)\.(json|md)$/.exec(fileName);
    if (match) stampByFile.set(fileName, match[1]);
  }
  if (stampByFile.size === 0) return EMPTY_REPORT;

  const uniqueStamps = Array.from(new Set(stampByFile.values())).sort();
  const keepStamps = new Set<string>();
  if (!removeAll) keepStamps.add(uniqueStamps[uniqueStamps.length - 1]);

  let removed = 0;
  let kept = 0;
  for (const [fileName, stamp] of stampByFile.entries()) {
    if (keepStamps.has(stamp)) {
      kept++;
      continue;
    }
    rmSync(join(exampleDir, fileName), { force: true });
    removed++;
  }

  return { removed, kept, touched: stampByFile.size };
}

function getTargetExampleDirs(dir: string, exampleNames: string[]): string[] {
  const baseDir = resolveEvalBaseDir(dir);
  if (!baseDir) {
    error(`No dataset/examples directory at ${join(dir, 'dataset', 'examples')}`);
    process.exit(1);
  }
  const all = readdirSync(baseDir).filter((entry) => statSync(join(baseDir, entry)).isDirectory());
  if (exampleNames.length === 0) return all.map((name) => join(baseDir, name));

  const matched = all.filter((name) => exampleNames.includes(name));
  // The first positional was previously `<workflow-slug>`; it's now
  // `[examples...]`. A user upgrading from the old layout who runs
  // `eigenpal workflow clear-local my-workflow` will hit this path with
  // no matches — surface the breaking change instead of silently doing
  // nothing.
  if (matched.length === 0) {
    warn(
      `None of [${exampleNames.join(', ')}] match an example under ./dataset/examples/. ` +
        `Heads up: the \`clear-local\` positional changed — it used to take a workflow slug, ` +
        `now it takes example names (or omit to clean every example).`
    );
  }
  return matched.map((name) => join(baseDir, name));
}

/**
 * Per-section cleanup: walk `exampleDirs`, run `clean(exampleDir)` on each,
 * accumulate the per-example reports, and print the summary footer. The
 * `noun` (singular / plural) is plugged into the per-example progress lines
 * and the totals footer — keeps the two sections (executions, judge
 * summaries) reading uniformly without duplicating the loop scaffolding.
 *
 * `scanned` differs subtly between sections — executions only count examples
 * with an `executions/` subdir, judge summaries count every example dir
 * touched. The `shouldCount` predicate captures that.
 */
function runSection(args: {
  exampleDirs: string[];
  clean: (exampleDir: string) => ClearReport;
  shouldCount: (exampleDir: string) => boolean;
  successLabel: string;
  scannedLabel: string;
  seenLabel: string;
  removedLabel: string;
  keptLabel: string;
  perExampleNoun: string;
}): void {
  let removed = 0;
  let kept = 0;
  let touched = 0;
  let scanned = 0;

  for (const exampleDir of args.exampleDirs) {
    if (!args.shouldCount(exampleDir)) continue;
    scanned++;
    const report = args.clean(exampleDir);
    removed += report.removed;
    kept += report.kept;
    touched += report.touched;

    if (report.touched > 0) {
      const name = basename(exampleDir);
      console.log(
        `  ${ui.dim(`${name}:`)} removed ${ui.bold(String(report.removed))} ${args.perExampleNoun}, kept ${report.kept}`
      );
    }
  }

  console.log('');
  success(args.successLabel);
  console.log(`  ${ui.dim(args.scannedLabel)} ${scanned}`);
  console.log(`  ${ui.dim(args.seenLabel)} ${touched}`);
  console.log(`  ${ui.dim(args.removedLabel)} ${ui.bold(String(removed))}`);
  console.log(`  ${ui.dim(args.keptLabel)} ${kept}`);
}

export async function clearEvalOutputs(
  dir: string,
  exampleNames: string[] = [],
  options: ClearRetentionOptions = {}
): Promise<void> {
  const removeAll = options.removeAll === true;
  const exampleDirs = getTargetExampleDirs(dir, exampleNames);

  // Section 1: per-run execution artifacts under `executions/`. Only
  // examples with that subdir contribute to the scan count — examples that
  // never ran shouldn't show up as "scanned".
  runSection({
    exampleDirs,
    clean: (exampleDir) => removeDirEntriesWithRetention(join(exampleDir, 'executions'), removeAll),
    shouldCount: (exampleDir) => existsSync(join(exampleDir, 'executions')),
    successLabel: 'Execution cleanup complete',
    scannedLabel: 'examples scanned:',
    seenLabel: 'runs seen:       ',
    removedLabel: 'runs removed:    ',
    keptLabel: 'runs kept:       ',
    perExampleNoun: 'execution(s)',
  });

  console.log('');

  // Section 2: judge summary files at the example dir root. Every existing
  // example dir counts as scanned (the file pattern just may not be there).
  runSection({
    exampleDirs,
    clean: (exampleDir) => removeJudgeSummaryFilesWithRetention(exampleDir, removeAll),
    shouldCount: (exampleDir) => existsSync(exampleDir),
    successLabel: 'Judge summary cleanup complete',
    scannedLabel: 'examples scanned:     ',
    seenLabel: 'summary files seen:   ',
    removedLabel: 'summary files removed:',
    keptLabel: 'summary files kept:   ',
    perExampleNoun: 'summary file(s)',
  });
}
