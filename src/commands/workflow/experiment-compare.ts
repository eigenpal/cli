/**
 * `eigenpal workflow experiment compare` — pure helpers.
 *
 * The Commander registration lives in `./index.ts` next to its sibling
 * experiment subcommands; everything in this file is side-effect-free
 * (apart from one `fetchEvalResults` that talks to the API client) so the
 * compare logic stays trivially unit-testable.
 *
 * Split out from `index.ts` purely for size — `registerExperimentCommands`
 * was ~750 LOC mixing Commander wiring with diff math, sorting, and
 * rendering; carving the math out drops `index.ts` by ~350 LOC and gives
 * tests a sharper import target.
 */

import type { ApiClient } from '../../lib/client';
import { table, ui } from '../../lib/ui';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Subset of `EvalResultExportRow` the compare command needs. */
export interface CompareInputRow {
  exampleId: string | null;
  exampleName: string | null;
  evaluatorName: string;
  score: number | null;
  [k: string]: unknown;
}

type CompareSort = 'abs-delta-desc' | 'delta-asc' | 'delta-desc' | 'name';

interface BatchDiffRow {
  example: string;
  evaluator: string;
  scoreA: number | null;
  scoreB: number | null;
  delta: number | null;
  status: 'regression' | 'improvement' | 'unchanged' | 'incomparable';
  // Index signature so this row is compatible with `table<T extends Record<string, unknown>>`.
  [k: string]: unknown;
}

interface BatchDiffSummary {
  regressions: number;
  improvements: number;
  /** Mean Δ across rows where both A and B have numeric scores. `null` when there are no comparable rows. */
  meanDelta: number | null;
  sharedExamples: number;
  onlyInA: string[];
  onlyInB: string[];
  /** The threshold used to classify regressions/improvements. */
  regressionThreshold: number;
  /**
   * Per-evaluator rollup so users don't have to fold the per-row table
   * themselves. Sorted by mean |Δ| desc (incomparable last), tiebreak alphabetical.
   */
  byEvaluator: BatchDiffEvaluatorAggregate[];
}

interface BatchDiffEvaluatorAggregate {
  evaluator: string;
  /** Comparable rows (both A and B had numeric scores) for this evaluator. */
  comparable: number;
  /** Mean Δ across the comparable rows. `null` when zero comparable rows. */
  meanDelta: number | null;
  regressions: number;
  improvements: number;
  unchanged: number;
  // Index signature so this row is compatible with `table<T extends Record<string, unknown>>`.
  [k: string]: unknown;
}

interface BatchDiffResult {
  batchA: string;
  batchB: string;
  rows: BatchDiffRow[];
  summary: BatchDiffSummary;
}

interface EvalResultsExportPayload {
  workflowId?: string;
  exportedAt?: string;
  results: CompareInputRow[];
}

// ---------------------------------------------------------------------------
// Pure helpers (testable)
// ---------------------------------------------------------------------------

/**
 * Map a user-facing `--sort` value (or the internal default) to the canonical
 * sort enum. Throws on unknown values so typo'd flags fail fast.
 */
export function normalizeCompareSort(value: string): CompareSort {
  switch (value) {
    case 'abs-delta-desc':
    case 'delta-asc':
    case 'delta-desc':
    case 'name':
      return value;
    default:
      throw new Error(
        `--sort must be one of: abs-delta-desc, delta-asc, delta-desc, name (got "${value}")`
      );
  }
}

/**
 * Build the side-by-side diff structure. Pure: takes raw eval-result rows
 * for two batches and returns rows + summary suitable for both human and
 * `--json` rendering. No network or process exits here — easy to unit test.
 *
 * Row keying is `(exampleLabel, evaluatorName)`. We prefer the example name
 * when present (the dashboard shows names; rows without a name fall back to
 * the example id, then to "(unknown)" for orphans where both are null).
 *
 * Examples that exist in only one batch are listed in `summary.onlyInA` /
 * `summary.onlyInB` and *not* surfaced as table rows — the row-level diff
 * is intentionally restricted to the shared set so |Δ| sort doesn't lie.
 */
export function buildBatchDiff(args: {
  batchIdA: string;
  batchIdB: string;
  rowsA: CompareInputRow[];
  rowsB: CompareInputRow[];
  sort: CompareSort;
  regressionThreshold: number;
}): BatchDiffResult {
  const { batchIdA, batchIdB, rowsA, rowsB, sort, regressionThreshold } = args;

  // Aggregate scores per (example, evaluator). The export endpoint already
  // dedupes via the upsert constraint, but be defensive against duplicates.
  const indexed = (
    rows: CompareInputRow[]
  ): {
    examples: Set<string>;
    scores: Map<string, number | null>;
  } => {
    const examples = new Set<string>();
    const scores = new Map<string, number | null>();
    for (const r of rows) {
      const example = exampleLabelOf(r);
      examples.add(example);
      // NUL separator so example or evaluator names containing spaces don't
      // collide (split(' ') on `"covenant recall"` would silently lose the
      // second token). NUL is rejected by zod input validators upstream.
      const key = `${example}\x00${r.evaluatorName}`;
      // First-write wins (export route returns rows ordered by createdAt asc;
      // duplicates would be from a server-side bug — we keep the earliest).
      if (!scores.has(key)) scores.set(key, r.score);
    }
    return { examples, scores };
  };

  const a = indexed(rowsA);
  const b = indexed(rowsB);

  const sharedExampleSet = new Set<string>();
  for (const ex of a.examples) if (b.examples.has(ex)) sharedExampleSet.add(ex);
  const onlyInA = [...a.examples].filter((ex) => !b.examples.has(ex)).sort();
  const onlyInB = [...b.examples].filter((ex) => !a.examples.has(ex)).sort();

  // Build (example, evaluator) row set restricted to shared examples.
  const pairs = new Set<string>();
  for (const key of a.scores.keys()) {
    const [example] = key.split('\x00');
    if (sharedExampleSet.has(example)) pairs.add(key);
  }
  for (const key of b.scores.keys()) {
    const [example] = key.split('\x00');
    if (sharedExampleSet.has(example)) pairs.add(key);
  }

  const rows: BatchDiffRow[] = [...pairs].map((key) => {
    const [example, evaluator] = key.split('\x00');
    const scoreA = a.scores.get(key) ?? null;
    const scoreB = b.scores.get(key) ?? null;
    const delta = scoreA != null && scoreB != null ? scoreB - scoreA : null;
    let status: BatchDiffRow['status'];
    if (delta == null) status = 'incomparable';
    else if (delta < -regressionThreshold) status = 'regression';
    else if (delta > regressionThreshold) status = 'improvement';
    else status = 'unchanged';
    return { example, evaluator, scoreA, scoreB, delta, status };
  });

  sortDiffRows(rows, sort);

  const comparable = rows.filter((r) => r.delta != null) as Array<BatchDiffRow & { delta: number }>;
  const regressions = rows.filter((r) => r.status === 'regression').length;
  const improvements = rows.filter((r) => r.status === 'improvement').length;
  const meanDelta =
    comparable.length === 0
      ? null
      : comparable.reduce((sum, r) => sum + r.delta, 0) / comparable.length;

  return {
    batchA: batchIdA,
    batchB: batchIdB,
    rows,
    summary: {
      regressions,
      improvements,
      meanDelta,
      sharedExamples: sharedExampleSet.size,
      onlyInA,
      onlyInB,
      regressionThreshold,
      byEvaluator: aggregateByEvaluator(rows),
    },
  };
}

/**
 * Group `rows` by evaluator, fold deltas. Replaces the Python one-liner
 * users were writing on every iteration. Sorted by mean |Δ| desc; evaluators
 * with no comparable rows sort last under their own alphabetical tiebreak.
 */
export function aggregateByEvaluator(rows: BatchDiffRow[]): BatchDiffEvaluatorAggregate[] {
  const buckets = new Map<string, BatchDiffRow[]>();
  for (const r of rows) {
    const list = buckets.get(r.evaluator);
    if (list) list.push(r);
    else buckets.set(r.evaluator, [r]);
  }
  const aggregates: BatchDiffEvaluatorAggregate[] = [];
  for (const [evaluator, group] of buckets) {
    const comparable = group.filter((r) => r.delta != null) as Array<
      BatchDiffRow & { delta: number }
    >;
    const meanDelta =
      comparable.length === 0
        ? null
        : comparable.reduce((sum, r) => sum + r.delta, 0) / comparable.length;
    aggregates.push({
      evaluator,
      comparable: comparable.length,
      meanDelta,
      regressions: group.filter((r) => r.status === 'regression').length,
      improvements: group.filter((r) => r.status === 'improvement').length,
      unchanged: group.filter((r) => r.status === 'unchanged').length,
    });
  }
  aggregates.sort((a, b) => {
    // null-meanDelta evaluators sort last regardless of magnitude — using a
    // numeric sentinel like -1 collides when scores aren't bounded to [0, 1]
    // (an evaluator with mean Δ < -1.0 would sort behind a no-data bucket).
    if (a.meanDelta == null && b.meanDelta == null) return a.evaluator.localeCompare(b.evaluator);
    if (a.meanDelta == null) return 1;
    if (b.meanDelta == null) return -1;
    const diff = Math.abs(b.meanDelta) - Math.abs(a.meanDelta);
    if (diff !== 0) return diff;
    return a.evaluator.localeCompare(b.evaluator);
  });
  return aggregates;
}

function sortDiffRows(rows: BatchDiffRow[], sort: CompareSort): void {
  // Secondary sort is always (example, evaluator) so rendering is deterministic
  // even when many rows share a delta.
  const tiebreak = (a: BatchDiffRow, b: BatchDiffRow): number => {
    const exCmp = a.example.localeCompare(b.example);
    if (exCmp !== 0) return exCmp;
    return a.evaluator.localeCompare(b.evaluator);
  };
  switch (sort) {
    case 'abs-delta-desc':
      rows.sort((a, b) => {
        const aAbs = a.delta == null ? -1 : Math.abs(a.delta);
        const bAbs = b.delta == null ? -1 : Math.abs(b.delta);
        if (bAbs !== aAbs) return bAbs - aAbs;
        return tiebreak(a, b);
      });
      return;
    case 'delta-asc':
      rows.sort((a, b) => {
        // Nulls (incomparable) sort last regardless of direction.
        if (a.delta == null && b.delta == null) return tiebreak(a, b);
        if (a.delta == null) return 1;
        if (b.delta == null) return -1;
        if (a.delta !== b.delta) return a.delta - b.delta;
        return tiebreak(a, b);
      });
      return;
    case 'delta-desc':
      rows.sort((a, b) => {
        if (a.delta == null && b.delta == null) return tiebreak(a, b);
        if (a.delta == null) return 1;
        if (b.delta == null) return -1;
        if (a.delta !== b.delta) return b.delta - a.delta;
        return tiebreak(a, b);
      });
      return;
    case 'name':
      rows.sort(tiebreak);
      return;
  }
}

function exampleLabelOf(row: CompareInputRow): string {
  if (row.exampleName && row.exampleName.length > 0) return row.exampleName;
  if (row.exampleId) return row.exampleId;
  return '(unknown)';
}

/**
 * Format a delta for display. Always two decimal places with explicit sign so
 * regressions and improvements are visually distinct (`-0.11` vs `+0.11`). A
 * neutral row (Δ = 0) renders as ` 0.00` (leading space) so columns line up.
 */
export function formatDelta(delta: number | null): string {
  if (delta == null) return '—';
  if (delta === 0) return ' 0.00';
  const sign = delta > 0 ? '+' : '-';
  return `${sign}${Math.abs(delta).toFixed(2)}`;
}

function formatScore(score: number | null): string {
  if (score == null) return '—';
  return score.toFixed(2);
}

/**
 * Render the diff to stdout in human mode. Stdout for the table itself
 * (a script that pipes `compare ... | head` should still see it); stderr for
 * the framing (batch labels, only-in-A/B blocks, summary footer).
 */
export function renderBatchDiffHuman(diff: BatchDiffResult): void {
  process.stderr.write(
    `${ui.dim('A =')} ${ui.bold(diff.batchA)}   ${ui.dim('B =')} ${ui.bold(diff.batchB)}\n`
  );

  if (diff.summary.onlyInA.length > 0 || diff.summary.onlyInB.length > 0) {
    process.stderr.write('\n');
    if (diff.summary.onlyInA.length > 0) {
      process.stderr.write(
        `${ui.warn('!')} only in A (${diff.summary.onlyInA.length}): ${diff.summary.onlyInA.join(', ')}\n`
      );
    }
    if (diff.summary.onlyInB.length > 0) {
      process.stderr.write(
        `${ui.warn('!')} only in B (${diff.summary.onlyInB.length}): ${diff.summary.onlyInB.join(', ')}\n`
      );
    }
  }
  process.stderr.write('\n');

  if (diff.summary.byEvaluator.length > 0) {
    process.stderr.write(`${ui.bold('Per-evaluator deltas')} ${ui.dim('(B − A):')}\n`);
    console.log(
      table(diff.summary.byEvaluator, [
        { key: 'evaluator', header: 'evaluator' },
        { key: 'comparable', header: 'rows', align: 'right' },
        {
          key: 'meanDelta',
          header: 'mean Δ',
          align: 'right',
          format: (v) => formatDelta(v as number | null),
        },
        { key: 'regressions', header: 'regressions', align: 'right' },
        { key: 'improvements', header: 'improvements', align: 'right' },
      ])
    );
    process.stderr.write('\n');
  }

  if (diff.rows.length === 0) {
    process.stderr.write(`${ui.dim('No shared (example, evaluator) pairs to compare.')}\n`);
  } else {
    process.stderr.write(`${ui.bold('Per-row deltas:')}\n`);
    console.log(
      table(diff.rows, [
        { key: 'example', header: 'example' },
        { key: 'evaluator', header: 'evaluator' },
        {
          key: 'scoreA',
          header: 'A',
          align: 'right',
          format: (v) => formatScore(v as number | null),
        },
        {
          key: 'scoreB',
          header: 'B',
          align: 'right',
          format: (v) => formatScore(v as number | null),
        },
        {
          key: 'delta',
          header: 'Δ',
          align: 'right',
          format: (v, row) => {
            const text = formatDelta(v as number | null);
            if (row.status === 'regression') return `${ui.warn(`${text} ⚠`)}`;
            if (row.status === 'improvement') return ui.ok(text);
            return text;
          },
        },
      ])
    );
  }

  // Footer on stderr so `compare ... | wc -l` stays accurate.
  process.stderr.write('\n');
  const meanDeltaText =
    diff.summary.meanDelta == null ? '—' : formatDelta(diff.summary.meanDelta).trim();
  const thresholdText = diff.summary.regressionThreshold.toFixed(2);
  process.stderr.write(
    `${ui.warn(`regressions: ${diff.summary.regressions}`)} ${ui.dim(`(Δ < -${thresholdText})`)}   ` +
      `${ui.ok(`improvements: ${diff.summary.improvements}`)} ${ui.dim(`(Δ > +${thresholdText})`)}\n`
  );
  process.stderr.write(
    `${ui.dim('mean Δ:')} ${meanDeltaText}   ` +
      `${ui.dim('examples shared:')} ${diff.summary.sharedExamples}   ` +
      `${ui.dim('only in A:')} ${diff.summary.onlyInA.length}   ` +
      `${ui.dim('only in B:')} ${diff.summary.onlyInB.length}\n`
  );
}

// ---------------------------------------------------------------------------
// API helper (small I/O wrapper kept here so the compare command's only
// remaining responsibility in index.ts is Commander wiring)
// ---------------------------------------------------------------------------

export async function fetchEvalResults(
  client: ApiClient,
  experimentId: string
): Promise<EvalResultsExportPayload> {
  const ref = (await client.get(`/api/v1/experiments/${encodeURIComponent(experimentId)}`)) as {
    automationId: string;
  };
  const raw = (await client.get(
    `/api/v1/automations/${encodeURIComponent(ref.automationId)}/experiments/${encodeURIComponent(experimentId)}/export`,
    { format: 'json' }
  )) as EvalResultsExportPayload;
  if (!raw || !Array.isArray(raw.results)) {
    throw new Error(
      `Unexpected experiment export response for ${experimentId}: missing 'results' array`
    );
  }
  return raw;
}
