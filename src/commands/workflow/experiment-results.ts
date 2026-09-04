import { table, ui } from '../../lib/ui';

export interface ExperimentResultRow {
  executionId: string;
  exampleName: string | null;
  evaluatorName: string;
  evaluatorType: string;
  score: number | null;
  passed: boolean | null;
  weight: number;
  details?: unknown;
  error: string | null;
  [key: string]: unknown;
}

export interface ExperimentRunRow {
  id: string;
  status: string;
  exampleName: string | null;
  evalScore?: number | null;
  evalPassed?: boolean | null;
}

export interface ExperimentDetailResultRow {
  runId: string;
  evaluatorName: string;
  evaluatorType: string;
  score: number | string | null;
  passed: boolean | null;
  weight: number | string | null;
  details?: unknown;
  error: string | null;
  [key: string]: unknown;
}

export interface ExperimentDetailPayload {
  runs?: ExperimentRunRow[];
  resultsByRun?: Record<string, ExperimentDetailResultRow[]>;
}

export interface ExperimentDiscrepancy {
  example: string;
  executionId: string;
  evaluator: string;
  path: string;
  expected: unknown;
  actual: unknown;
  [key: string]: unknown;
}

interface ResultCounts {
  total: number;
  passed: number;
  failed: number;
  errors: number;
}

interface EvaluatorSummary extends ResultCounts {
  evaluator: string;
  averageScore: number | null;
  [key: string]: unknown;
}

export interface ExperimentResultsAnalysis {
  summary: ResultCounts & {
    averageScore: number | null;
    byEvaluator: EvaluatorSummary[];
  };
  discrepancies: ExperimentDiscrepancy[];
  results: ExperimentResultRow[];
}

export function experimentRowsFromDetail(detail: ExperimentDetailPayload): ExperimentResultRow[] {
  const namesByRun = new Map((detail.runs ?? []).map((run) => [run.id, run.exampleName]));
  return Object.entries(detail.resultsByRun ?? {}).flatMap(([executionId, rows]) =>
    rows.map((row) => ({
      ...row,
      executionId,
      exampleName: namesByRun.get(executionId) ?? null,
      score: numberOrNull(row.score),
      weight: numberOrNull(row.weight) ?? 1,
    }))
  );
}

export function analyzeExperimentResults(args: {
  rows: ExperimentResultRow[];
  runs: ExperimentRunRow[];
  evaluator?: string;
  failedOnly?: boolean;
}): ExperimentResultsAnalysis {
  let rows = args.evaluator
    ? args.rows.filter((row) => row.evaluatorName === args.evaluator)
    : [...args.rows];
  if (args.failedOnly) {
    rows = rows.filter((row) => row.error != null || row.passed === false);
  }

  const includedExecutionIds = new Set(rows.map((row) => row.executionId));
  const runs =
    args.evaluator || args.failedOnly
      ? args.runs.filter((run) => includedExecutionIds.has(run.id))
      : args.runs;
  const rowsByRun = groupBy(rows, (row) => row.executionId);
  const counts: ResultCounts = { total: runs.length, passed: 0, failed: 0, errors: 0 };
  const runScores: number[] = [];
  const usePersistedAggregate = !args.evaluator && !args.failedOnly;
  for (const run of runs) {
    const runRows = rowsByRun.get(run.id) ?? [];
    if (usePersistedAggregate && run.evalPassed != null) {
      if (['failed', 'cancelled', 'rejected'].includes(run.status) && run.evalPassed !== true) {
        counts.errors++;
      } else if (run.evalPassed) {
        counts.passed++;
      } else {
        counts.failed++;
      }
      if (typeof run.evalScore === 'number') runScores.push(run.evalScore);
      continue;
    }
    if (
      ['failed', 'cancelled', 'rejected'].includes(run.status) ||
      runRows.length === 0 ||
      runRows.some((row) => row.error != null)
    ) {
      counts.errors++;
      continue;
    }
    if (runRows.some((row) => row.passed === false)) counts.failed++;
    else counts.passed++;
    const score = weightedAverage(runRows);
    if (score != null) runScores.push(score);
  }

  const byEvaluator = [...groupBy(rows, (row) => row.evaluatorName)].map(
    ([evaluator, evaluatorRows]): EvaluatorSummary => ({
      evaluator,
      total: evaluatorRows.length,
      passed: evaluatorRows.filter((row) => row.error == null && row.passed === true).length,
      failed: evaluatorRows.filter((row) => row.error == null && row.passed === false).length,
      errors: evaluatorRows.filter((row) => row.error != null).length,
      averageScore: average(
        evaluatorRows.flatMap((row) => (typeof row.score === 'number' ? [row.score] : []))
      ),
    })
  );
  byEvaluator.sort((a, b) => a.evaluator.localeCompare(b.evaluator));

  return {
    summary: {
      ...counts,
      averageScore: average(runScores),
      byEvaluator,
    },
    discrepancies: flattenDiscrepancies(rows),
    results: rows,
  };
}

export function flattenDiscrepancies(rows: ExperimentResultRow[]): ExperimentDiscrepancy[] {
  const discrepancies: ExperimentDiscrepancy[] = [];
  for (const row of rows) {
    const details = objectOrNull(row.details);
    const mismatches = Array.isArray(details?.mismatches) ? details.mismatches : [];
    for (const mismatch of mismatches) {
      const item = objectOrNull(mismatch);
      if (!item || typeof item.path !== 'string') continue;
      discrepancies.push({
        example: row.exampleName || row.executionId,
        executionId: row.executionId,
        evaluator: row.evaluatorName,
        path: item.path,
        expected: item.expected,
        actual: item.actual,
      });
    }
  }
  return discrepancies;
}

export function renderExperimentResultsSummary(analysis: ExperimentResultsAnalysis): void {
  const summary = analysis.summary;
  process.stderr.write(
    `${ui.bold('Experiment results')}  total=${summary.total}  ${ui.ok(`passed=${summary.passed}`)}  ` +
      `${ui.warn(`failed=${summary.failed}`)}  errors=${summary.errors}  ` +
      `average=${formatScore(summary.averageScore)}\n`
  );
  if (summary.byEvaluator.length > 0) {
    console.log(
      table(summary.byEvaluator, [
        { key: 'evaluator', header: 'evaluator' },
        { key: 'total', header: 'total', align: 'right' },
        { key: 'passed', header: 'pass', align: 'right' },
        { key: 'failed', header: 'fail', align: 'right' },
        { key: 'errors', header: 'error', align: 'right' },
        {
          key: 'averageScore',
          header: 'average',
          align: 'right',
          format: (value) => formatScore(value as number | null),
        },
      ])
    );
  }
  if (analysis.discrepancies.length > 0) {
    process.stderr.write(`\n${ui.bold('Discrepancies')}\n`);
    console.log(
      table(analysis.discrepancies, [
        { key: 'example', header: 'example' },
        { key: 'evaluator', header: 'evaluator' },
        { key: 'path', header: 'path' },
        { key: 'expected', header: 'expected', format: compactJson },
        { key: 'actual', header: 'actual', format: compactJson },
      ])
    );
  }
}

function weightedAverage(rows: ExperimentResultRow[]): number | null {
  let total = 0;
  let weight = 0;
  for (const row of rows) {
    if (typeof row.score !== 'number') continue;
    const rowWeight = Number.isFinite(row.weight) ? row.weight : 1;
    total += row.score * rowWeight;
    weight += rowWeight;
  }
  return weight > 0 ? total / weight : null;
}

function average(values: number[]): number | null {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function numberOrNull(value: number | string | null): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function groupBy<T>(values: T[], key: (value: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const value of values) {
    const name = key(value);
    const existing = groups.get(name);
    if (existing) existing.push(value);
    else groups.set(name, [value]);
  }
  return groups;
}

function objectOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function formatScore(value: number | null): string {
  return value == null ? '—' : value.toFixed(3);
}

function compactJson(value: unknown): string {
  const rendered = JSON.stringify(value);
  if (rendered === undefined) return 'undefined';
  return rendered.length > 80 ? `${rendered.slice(0, 77)}…` : rendered;
}
