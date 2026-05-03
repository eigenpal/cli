import { existsSync, readdirSync, rmSync, statSync } from 'fs';
import { join } from 'path';
import { error, success, ui } from '../lib/ui';

interface ClearRetentionOptions {
  removeAll?: boolean;
}

interface ClearReport {
  removed: number;
  kept: number;
  touched: number;
}

function getTargetWorkflowSlugs(dir: string, workflowSlug?: string): string[] {
  const workflowsDir = join(dir, 'workflows');
  if (!existsSync(workflowsDir)) {
    error(`No workflows directory at ${workflowsDir}`);
    process.exit(1);
  }

  if (workflowSlug != null && workflowSlug !== '') return [workflowSlug];

  return readdirSync(workflowsDir).filter((entry) =>
    statSync(join(workflowsDir, entry)).isDirectory()
  );
}

function getDirectoryEntries(path: string): string[] {
  if (!existsSync(path)) return [];
  return readdirSync(path)
    .filter((entry) => statSync(join(path, entry)).isDirectory())
    .sort();
}

function removeDirEntriesWithRetention(path: string, removeAll: boolean): ClearReport {
  const entries = getDirectoryEntries(path);
  if (entries.length === 0) return { removed: 0, kept: 0, touched: 0 };

  const keepSet = new Set<string>();
  if (!removeAll) {
    const latest = entries[entries.length - 1];
    keepSet.add(latest);
  }

  let removed = 0;
  for (const entry of entries) {
    if (keepSet.has(entry)) continue;
    rmSync(join(path, entry), { recursive: true, force: true });
    removed++;
  }

  return {
    removed,
    kept: keepSet.size,
    touched: entries.length,
  };
}

function removeJudgeSummaryFilesWithRetention(evalDir: string, removeAll: boolean): ClearReport {
  if (!existsSync(evalDir)) return { removed: 0, kept: 0, touched: 0 };

  const allEntries = readdirSync(evalDir).sort();
  const stampByFile = new Map<string, string>();
  for (const fileName of allEntries) {
    const match = /^llm-judge-summary-(.+)\.(json|md)$/.exec(fileName);
    if (!match) continue;
    stampByFile.set(fileName, match[1]);
  }

  if (stampByFile.size === 0) return { removed: 0, kept: 0, touched: 0 };

  const uniqueStamps = Array.from(new Set(stampByFile.values())).sort();
  const keepStamps = new Set<string>();
  if (!removeAll) {
    keepStamps.add(uniqueStamps[uniqueStamps.length - 1]);
  }

  let removed = 0;
  let kept = 0;
  for (const [fileName, stamp] of stampByFile.entries()) {
    if (keepStamps.has(stamp)) {
      kept++;
      continue;
    }
    rmSync(join(evalDir, fileName), { force: true });
    removed++;
  }

  return {
    removed,
    kept,
    touched: stampByFile.size,
  };
}

async function clearEvalExecutions(
  dir: string,
  workflowSlug: string | undefined,
  exampleNames: string[] = [],
  options: ClearRetentionOptions = {}
): Promise<void> {
  const removeAll = options.removeAll === true;
  const slugs = getTargetWorkflowSlugs(dir, workflowSlug);

  let removed = 0;
  let kept = 0;
  let touched = 0;
  let examplesVisited = 0;

  for (const slug of slugs) {
    const evalBaseDir = join(dir, 'workflows', slug, 'eval');
    if (!existsSync(evalBaseDir)) continue;

    const allNames = readdirSync(evalBaseDir).filter((entry) =>
      statSync(join(evalBaseDir, entry)).isDirectory()
    );
    const names =
      exampleNames.length > 0 ? allNames.filter((name) => exampleNames.includes(name)) : allNames;

    for (const name of names) {
      examplesVisited++;
      const executionsDir = join(evalBaseDir, name, 'executions');
      if (!existsSync(executionsDir)) continue;

      const report = removeDirEntriesWithRetention(executionsDir, removeAll);
      removed += report.removed;
      kept += report.kept;
      touched += report.touched;

      if (report.touched > 0) {
        console.log(
          `  ${ui.dim(`${slug}/eval/${name}:`)} removed ${ui.bold(String(report.removed))} execution(s), kept ${report.kept}`
        );
      }
    }
  }

  console.log('');
  success('Execution cleanup complete');
  console.log(`  ${ui.dim('examples scanned:')} ${examplesVisited}`);
  console.log(`  ${ui.dim('runs seen:')}        ${touched}`);
  console.log(`  ${ui.dim('runs removed:')}     ${ui.bold(String(removed))}`);
  console.log(`  ${ui.dim('runs kept:')}        ${kept}`);
}

async function clearEvalJudgeSummaries(
  dir: string,
  workflowSlug: string | undefined,
  options: ClearRetentionOptions = {}
): Promise<void> {
  const removeAll = options.removeAll === true;
  const slugs = getTargetWorkflowSlugs(dir, workflowSlug);

  let removed = 0;
  let kept = 0;
  let touched = 0;
  let evalsScanned = 0;

  for (const slug of slugs) {
    const evalDir = join(dir, 'workflows', slug, 'eval');
    if (!existsSync(evalDir)) continue;
    evalsScanned++;

    const report = removeJudgeSummaryFilesWithRetention(evalDir, removeAll);
    removed += report.removed;
    kept += report.kept;
    touched += report.touched;

    if (report.touched > 0) {
      console.log(
        `  ${ui.dim(`${slug}/eval:`)} removed ${ui.bold(String(report.removed))} summary file(s), kept ${report.kept}`
      );
    }
  }

  console.log('');
  success('Judge summary cleanup complete');
  console.log(`  ${ui.dim('eval dirs scanned:')}     ${evalsScanned}`);
  console.log(`  ${ui.dim('summary files seen:')}    ${touched}`);
  console.log(`  ${ui.dim('summary files removed:')} ${ui.bold(String(removed))}`);
  console.log(`  ${ui.dim('summary files kept:')}    ${kept}`);
}

export async function clearEvalOutputs(
  dir: string,
  workflowSlug: string | undefined,
  exampleNames: string[] = [],
  options: ClearRetentionOptions = {}
): Promise<void> {
  await clearEvalExecutions(dir, workflowSlug, exampleNames, options);
  console.log('');
  await clearEvalJudgeSummaries(dir, workflowSlug, options);
}
