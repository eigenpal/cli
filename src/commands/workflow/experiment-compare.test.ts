import { describe, expect, test } from 'bun:test';

import {
  aggregateByEvaluator,
  buildBatchDiff,
  buildExperimentOutputDiff,
  diffOutputJson,
  fetchExperimentOutputs,
  formatDelta,
  normalizeCompareSort,
  renderBatchDiffHuman,
  type CompareInputRow,
} from './experiment-compare';

describe('experiment output comparison', () => {
  test('compares actual outputs by example with structured paths', () => {
    const diff = buildExperimentOutputDiff({
      batchIdA: 'evb_a',
      batchIdB: 'evb_b',
      rowsA: [
        {
          executionId: 'run_a1',
          exampleId: 'evx_1',
          exampleName: 'invoice',
          status: 'completed',
          error: null,
          output: { subjects: [{ name: 'A', score: 1 }], nullable: null },
        },
      ],
      rowsB: [
        {
          executionId: 'run_b1',
          exampleId: 'evx_1',
          exampleName: 'invoice',
          status: 'completed',
          error: null,
          output: { subjects: [{ name: 'B', score: 1 }], nullable: 'now-set' },
        },
      ],
    });

    expect(diff.summary).toMatchObject({ sharedExamples: 1, identical: 0, changed: 1 });
    expect(diff.rows[0].differences).toEqual([
      { path: '$.subjects[0].name', type: 'changed', expected: 'A', actual: 'B' },
      { path: '$.nullable', type: 'changed', expected: null, actual: 'now-set' },
    ]);
  });

  test('reads run state from the canonical execution envelope', async () => {
    const client = {
      async get(path: string) {
        if (path === '/v1/experiments/evb_a') return { automationId: 'auto_1' };
        if (path === '/v1/automations/auto_1/experiments/evb_a') {
          return { runs: [{ id: 'run_a1', exampleName: 'invoice' }] };
        }
        if (path === '/v1/runs/run_a1') {
          return {
            execution: { status: 'failed' },
            error: { message: 'unable to fetch document' },
          };
        }
        throw new Error(`Unexpected path: ${path}`);
      },
    };

    const result = await fetchExperimentOutputs(client as never, 'evb_a');
    expect(result.rows).toEqual([
      {
        executionId: 'run_a1',
        exampleId: null,
        exampleName: 'invoice',
        status: 'failed',
        error: { message: 'unable to fetch document' },
        output: undefined,
      },
    ]);
  });

  test('does not report failed and successful runs without output as identical', () => {
    const diff = buildExperimentOutputDiff({
      batchIdA: 'evb_a',
      batchIdB: 'evb_b',
      rowsA: [
        {
          executionId: 'run_a1',
          exampleId: 'evx_1',
          exampleName: 'invoice',
          status: 'failed',
          error: 'unable to fetch document',
          output: undefined,
        },
      ],
      rowsB: [
        {
          executionId: 'run_b1',
          exampleId: 'evx_1',
          exampleName: 'invoice',
          status: 'completed',
          error: null,
          output: undefined,
        },
      ],
    });

    expect(diff.summary).toMatchObject({
      sharedExamples: 1,
      identical: 0,
      changed: 0,
      incomparable: 1,
    });
    expect(diff.rows[0]).toMatchObject({
      status: 'incomparable',
      differences: [
        {
          path: '$',
          type: 'incomparable',
          expected: { status: 'failed', error: 'unable to fetch document' },
          actual: { status: 'completed', error: null },
        },
      ],
    });
  });

  test('reports missing and extra array items', () => {
    expect(diffOutputJson([1], [1, 2])).toEqual([{ path: '$[1]', type: 'extra', actual: 2 }]);
    expect(diffOutputJson([1, 2], [1])).toEqual([{ path: '$[1]', type: 'missing', expected: 2 }]);
  });
});

describe('normalizeCompareSort', () => {
  test('passes through canonical values', () => {
    expect(normalizeCompareSort('abs-delta-desc')).toBe('abs-delta-desc');
    expect(normalizeCompareSort('delta-asc')).toBe('delta-asc');
    expect(normalizeCompareSort('delta-desc')).toBe('delta-desc');
    expect(normalizeCompareSort('name')).toBe('name');
  });

  test('throws on unknown sort key', () => {
    expect(() => normalizeCompareSort('alpha')).toThrow(
      /--sort must be one of: abs-delta-desc, delta-asc, delta-desc, name/
    );
  });
});

describe('formatDelta', () => {
  test('renders signed deltas with two decimals', () => {
    expect(formatDelta(0.18)).toBe('+0.18');
    expect(formatDelta(-0.11)).toBe('-0.11');
  });
  test('zero gets a leading space for column alignment', () => {
    expect(formatDelta(0)).toBe(' 0.00');
  });
  test('null renders as em-dash', () => {
    expect(formatDelta(null)).toBe('—');
  });
});

function row(
  example: string,
  evaluator: string,
  score: number | null,
  exampleId: string | null = example
): CompareInputRow {
  return { exampleId, exampleName: example, evaluatorName: evaluator, score };
}

describe('buildBatchDiff', () => {
  const sortDefault = 'abs-delta-desc' as const;

  test('happy path: classifies regressions, improvements, unchanged; sorts by |Δ| desc', () => {
    const rowsA = [
      row('example-001', 'covenant-recall', 0.82),
      row('example-001', 'field-exact', 1.0),
      row('example-002', 'covenant-recall', 0.65),
    ];
    const rowsB = [
      row('example-001', 'covenant-recall', 0.71),
      row('example-001', 'field-exact', 1.0),
      row('example-002', 'covenant-recall', 0.83),
    ];
    const diff = buildBatchDiff({
      batchIdA: 'evb_a',
      batchIdB: 'evb_b',
      rowsA,
      rowsB,
      sort: sortDefault,
      regressionThreshold: 0.05,
    });

    expect(diff.batchA).toBe('evb_a');
    expect(diff.batchB).toBe('evb_b');
    expect(diff.rows).toHaveLength(3);

    // Sorted by |Δ| desc: 0.18 > 0.11 > 0.00
    expect(diff.rows[0]).toMatchObject({
      example: 'example-002',
      evaluator: 'covenant-recall',
      scoreA: 0.65,
      scoreB: 0.83,
      status: 'improvement',
    });
    expect(diff.rows[0].delta).toBeCloseTo(0.18, 5);

    expect(diff.rows[1]).toMatchObject({
      example: 'example-001',
      evaluator: 'covenant-recall',
      status: 'regression',
    });
    expect(diff.rows[1].delta).toBeCloseTo(-0.11, 5);

    expect(diff.rows[2]).toMatchObject({
      example: 'example-001',
      evaluator: 'field-exact',
      delta: 0,
      status: 'unchanged',
    });

    expect(diff.summary.regressions).toBe(1);
    expect(diff.summary.improvements).toBe(1);
    expect(diff.summary.sharedExamples).toBe(2);
    expect(diff.summary.onlyInA).toEqual([]);
    expect(diff.summary.onlyInB).toEqual([]);
    expect(diff.summary.regressionThreshold).toBe(0.05);
    // mean Δ: (0.18 + -0.11 + 0.00) / 3 ≈ 0.0233
    expect(diff.summary.meanDelta).toBeCloseTo((0.18 - 0.11 + 0) / 3, 5);
  });

  test('non-overlapping examples: surfaces only-in-A / only-in-B; rows restricted to shared', () => {
    const diff = buildBatchDiff({
      batchIdA: 'evb_a',
      batchIdB: 'evb_b',
      rowsA: [row('shared', 'eval', 0.5), row('a-only', 'eval', 0.9)],
      rowsB: [row('shared', 'eval', 0.7), row('b-only', 'eval', 0.4)],
      sort: sortDefault,
      regressionThreshold: 0.05,
    });

    expect(diff.summary.onlyInA).toEqual(['a-only']);
    expect(diff.summary.onlyInB).toEqual(['b-only']);
    expect(diff.summary.sharedExamples).toBe(1);
    expect(diff.rows.map((r) => r.example)).toEqual(['shared']);
    expect(diff.rows[0].status).toBe('improvement');
  });

  test('all evaluators improved', () => {
    const diff = buildBatchDiff({
      batchIdA: 'evb_a',
      batchIdB: 'evb_b',
      rowsA: [row('ex-1', 'ev', 0.4), row('ex-2', 'ev', 0.5)],
      rowsB: [row('ex-1', 'ev', 0.6), row('ex-2', 'ev', 0.8)],
      sort: sortDefault,
      regressionThreshold: 0.05,
    });
    expect(diff.summary.improvements).toBe(2);
    expect(diff.summary.regressions).toBe(0);
    expect(diff.rows.every((r) => r.status === 'improvement')).toBe(true);
  });

  test('all regressed', () => {
    const diff = buildBatchDiff({
      batchIdA: 'evb_a',
      batchIdB: 'evb_b',
      rowsA: [row('ex-1', 'ev', 0.9), row('ex-2', 'ev', 0.8)],
      rowsB: [row('ex-1', 'ev', 0.6), row('ex-2', 'ev', 0.5)],
      sort: sortDefault,
      regressionThreshold: 0.05,
    });
    expect(diff.summary.regressions).toBe(2);
    expect(diff.summary.improvements).toBe(0);
    expect(diff.rows.every((r) => r.status === 'regression')).toBe(true);
  });

  test('empty batches produce empty rows + null mean Δ', () => {
    const diff = buildBatchDiff({
      batchIdA: 'evb_a',
      batchIdB: 'evb_b',
      rowsA: [],
      rowsB: [],
      sort: sortDefault,
      regressionThreshold: 0.05,
    });
    expect(diff.rows).toEqual([]);
    expect(diff.summary).toMatchObject({
      regressions: 0,
      improvements: 0,
      meanDelta: null,
      sharedExamples: 0,
      onlyInA: [],
      onlyInB: [],
    });
  });

  test('configurable threshold: 0.20 demotes a 0.11 regression to "unchanged"', () => {
    const diff = buildBatchDiff({
      batchIdA: 'evb_a',
      batchIdB: 'evb_b',
      rowsA: [row('ex-1', 'ev', 0.8)],
      rowsB: [row('ex-1', 'ev', 0.69)],
      sort: sortDefault,
      regressionThreshold: 0.2,
    });
    expect(diff.rows[0].status).toBe('unchanged');
    expect(diff.summary.regressions).toBe(0);
  });

  test('example or evaluator names containing spaces do not collide (NUL-separated keys)', () => {
    // Regression: earlier impl used a space as the (example, evaluator) key
    // separator and split('  ') on first space — `evaluator: "covenant recall"`
    // silently dropped "recall" and merged distinct rows.
    const diff = buildBatchDiff({
      batchIdA: 'evb_a',
      batchIdB: 'evb_b',
      rowsA: [
        row('contract A', 'covenant recall', 0.4),
        row('contract A', 'covenant precision', 0.8),
      ],
      rowsB: [
        row('contract A', 'covenant recall', 0.6),
        row('contract A', 'covenant precision', 0.9),
      ],
      sort: 'name',
      regressionThreshold: 0.05,
    });
    expect(diff.rows).toHaveLength(2);
    const recall = diff.rows.find((r) => r.evaluator === 'covenant recall');
    const precision = diff.rows.find((r) => r.evaluator === 'covenant precision');
    expect(recall?.delta).toBeCloseTo(0.2, 5);
    expect(precision?.delta).toBeCloseTo(0.1, 5);
  });

  test('null score in one batch yields incomparable row (delta null) and skipped from mean', () => {
    const diff = buildBatchDiff({
      batchIdA: 'evb_a',
      batchIdB: 'evb_b',
      rowsA: [row('ex-1', 'ev', null), row('ex-2', 'ev', 0.5)],
      rowsB: [row('ex-1', 'ev', 0.7), row('ex-2', 'ev', 0.7)],
      sort: sortDefault,
      regressionThreshold: 0.05,
    });
    const ex1 = diff.rows.find((r) => r.example === 'ex-1');
    expect(ex1?.delta).toBeNull();
    expect(ex1?.status).toBe('incomparable');
    expect(diff.summary.meanDelta).toBeCloseTo(0.2, 5);
  });

  test('sort=delta-asc puts regressions first; nulls trail', () => {
    const diff = buildBatchDiff({
      batchIdA: 'evb_a',
      batchIdB: 'evb_b',
      rowsA: [row('ex-1', 'ev', 0.8), row('ex-2', 'ev', 0.4), row('ex-3', 'ev', null)],
      rowsB: [row('ex-1', 'ev', 0.5), row('ex-2', 'ev', 0.9), row('ex-3', 'ev', 0.5)],
      sort: 'delta-asc',
      regressionThreshold: 0.05,
    });
    expect(diff.rows.map((r) => r.example)).toEqual(['ex-1', 'ex-2', 'ex-3']);
  });

  test('sort=name produces alphabetical (example, evaluator) order', () => {
    const diff = buildBatchDiff({
      batchIdA: 'evb_a',
      batchIdB: 'evb_b',
      rowsA: [row('beta', 'eval-z', 0.5), row('alpha', 'eval-a', 0.5), row('alpha', 'eval-b', 0.5)],
      rowsB: [row('beta', 'eval-z', 0.5), row('alpha', 'eval-a', 0.5), row('alpha', 'eval-b', 0.5)],
      sort: 'name',
      regressionThreshold: 0.05,
    });
    expect(diff.rows.map((r) => `${r.example}/${r.evaluator}`)).toEqual([
      'alpha/eval-a',
      'alpha/eval-b',
      'beta/eval-z',
    ]);
  });

  test('falls back to exampleId when name is missing, "(unknown)" when both are null', () => {
    const diff = buildBatchDiff({
      batchIdA: 'evb_a',
      batchIdB: 'evb_b',
      rowsA: [
        { exampleId: 'evx_111', exampleName: null, evaluatorName: 'ev', score: 0.5 },
        { exampleId: null, exampleName: null, evaluatorName: 'ev', score: 0.3 },
      ],
      rowsB: [
        { exampleId: 'evx_111', exampleName: null, evaluatorName: 'ev', score: 0.5 },
        { exampleId: null, exampleName: null, evaluatorName: 'ev', score: 0.3 },
      ],
      sort: 'name',
      regressionThreshold: 0.05,
    });
    expect(diff.rows.map((r) => r.example).sort()).toEqual(['(unknown)', 'evx_111']);
  });
});

describe('byEvaluator aggregate', () => {
  test('groups per-evaluator with mean Δ, regressions, improvements, unchanged', () => {
    const diff = buildBatchDiff({
      batchIdA: 'evb_a',
      batchIdB: 'evb_b',
      rowsA: [
        row('ex-1', 'recall', 0.5),
        row('ex-2', 'recall', 0.6),
        row('ex-1', 'precision', 0.9),
        row('ex-2', 'precision', 0.9),
      ],
      rowsB: [
        row('ex-1', 'recall', 0.7),
        row('ex-2', 'recall', 0.8),
        row('ex-1', 'precision', 0.4),
        row('ex-2', 'precision', 0.5),
      ],
      sort: 'abs-delta-desc',
      regressionThreshold: 0.05,
    });
    const byEval = diff.summary.byEvaluator;
    expect(byEval).toHaveLength(2);

    const recall = byEval.find((e) => e.evaluator === 'recall')!;
    const precision = byEval.find((e) => e.evaluator === 'precision')!;
    expect(recall).toMatchObject({
      comparable: 2,
      improvements: 2,
      regressions: 0,
      unchanged: 0,
    });
    expect(recall.meanDelta).toBeCloseTo(0.2, 5);
    expect(precision).toMatchObject({
      comparable: 2,
      improvements: 0,
      regressions: 2,
      unchanged: 0,
    });
    expect(precision.meanDelta).toBeCloseTo(-0.45, 5);
  });

  test('sorted by |meanDelta| desc; biggest movers first', () => {
    const diff = buildBatchDiff({
      batchIdA: 'evb_a',
      batchIdB: 'evb_b',
      rowsA: [row('ex-1', 'small-shift', 0.5), row('ex-1', 'big-shift', 0.5)],
      rowsB: [row('ex-1', 'small-shift', 0.55), row('ex-1', 'big-shift', 0.95)],
      sort: 'abs-delta-desc',
      regressionThreshold: 0.05,
    });
    expect(diff.summary.byEvaluator.map((e) => e.evaluator)).toEqual(['big-shift', 'small-shift']);
  });

  test('evaluator with no comparable rows: meanDelta=null, sorts last', () => {
    const diff = buildBatchDiff({
      batchIdA: 'evb_a',
      batchIdB: 'evb_b',
      rowsA: [row('ex-1', 'has-data', 0.4), row('ex-1', 'all-null', null)],
      rowsB: [row('ex-1', 'has-data', 0.7), row('ex-1', 'all-null', null)],
      sort: 'abs-delta-desc',
      regressionThreshold: 0.05,
    });
    const byEval = diff.summary.byEvaluator;
    expect(byEval[0].evaluator).toBe('has-data');
    expect(byEval[1]).toMatchObject({ evaluator: 'all-null', comparable: 0, meanDelta: null });
  });

  test('aggregateByEvaluator: empty input → empty output', () => {
    expect(aggregateByEvaluator([])).toEqual([]);
  });

  test('null-meanDelta evaluators sort last even when other |Δ| exceeds 1.0', () => {
    // Regression: an earlier sort used `-1` as the null sentinel, which would
    // mis-rank an evaluator with |Δ| > 1.0 against a no-data bucket if scores
    // ever escape the [0, 1] range (e.g. a custom regression-margin evaluator).
    const aggregates = aggregateByEvaluator([
      // mock rows reproducing the diff shape `aggregateByEvaluator` consumes
      {
        example: 'ex',
        evaluator: 'big-delta',
        scoreA: 0,
        scoreB: 5,
        delta: 5,
        status: 'improvement',
      },
      {
        example: 'ex',
        evaluator: 'no-data',
        scoreA: null,
        scoreB: null,
        delta: null,
        status: 'incomparable',
      },
    ]);
    expect(aggregates.map((a) => a.evaluator)).toEqual(['big-delta', 'no-data']);
    expect(aggregates[1].meanDelta).toBeNull();
  });

  test('byEvaluator empty when there are no shared examples', () => {
    const diff = buildBatchDiff({
      batchIdA: 'evb_a',
      batchIdB: 'evb_b',
      rowsA: [row('only-a', 'ev', 0.5)],
      rowsB: [row('only-b', 'ev', 0.5)],
      sort: 'abs-delta-desc',
      regressionThreshold: 0.05,
    });
    expect(diff.summary.byEvaluator).toEqual([]);
  });
});

describe('renderBatchDiffHuman', () => {
  test('writes table to stdout, framing + summary to stderr; piping stays clean', () => {
    const diff = buildBatchDiff({
      batchIdA: 'evb_a',
      batchIdB: 'evb_b',
      rowsA: [row('example-001', 'covenant-recall', 0.82)],
      rowsB: [row('example-001', 'covenant-recall', 0.71)],
      sort: 'abs-delta-desc',
      regressionThreshold: 0.05,
    });
    const captured = captureStdio(() => renderBatchDiffHuman(diff));

    expect(stripAnsi(captured.stdout)).toContain('example-001');
    expect(stripAnsi(captured.stdout)).toContain('covenant-recall');
    expect(stripAnsi(captured.stdout)).toContain('-0.11');

    expect(stripAnsi(captured.stderr)).toContain('A = evb_a');
    expect(stripAnsi(captured.stderr)).toContain('B = evb_b');
    expect(stripAnsi(captured.stderr)).toContain('Per-evaluator deltas');
    expect(stripAnsi(captured.stderr)).toContain('Per-row deltas:');
    expect(stripAnsi(captured.stderr)).toContain('regressions: 1');
    expect(stripAnsi(captured.stderr)).toContain('improvements: 0');
    expect(stripAnsi(captured.stderr)).toContain('examples shared: 1');
  });

  test('renders only-in-A / only-in-B blocks before the table', () => {
    const diff = buildBatchDiff({
      batchIdA: 'evb_a',
      batchIdB: 'evb_b',
      rowsA: [row('shared', 'ev', 0.5), row('a-only', 'ev', 0.9)],
      rowsB: [row('shared', 'ev', 0.5), row('b-only', 'ev', 0.4)],
      sort: 'abs-delta-desc',
      regressionThreshold: 0.05,
    });
    const captured = captureStdio(() => renderBatchDiffHuman(diff));
    expect(stripAnsi(captured.stderr)).toContain('only in A (1): a-only');
    expect(stripAnsi(captured.stderr)).toContain('only in B (1): b-only');
  });

  test('empty diff prints "no shared pairs" hint instead of an empty table', () => {
    const diff = buildBatchDiff({
      batchIdA: 'evb_a',
      batchIdB: 'evb_b',
      rowsA: [],
      rowsB: [],
      sort: 'abs-delta-desc',
      regressionThreshold: 0.05,
    });
    const captured = captureStdio(() => renderBatchDiffHuman(diff));
    expect(captured.stdout).toBe('');
    expect(stripAnsi(captured.stderr)).toContain('No shared (example, evaluator) pairs to compare');
    expect(stripAnsi(captured.stderr)).toContain('mean Δ: —');
  });
});

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

function captureStdio(fn: () => void): { stdout: string; stderr: string } {
  let stdout = '';
  let stderr = '';
  const origLog = console.log;
  const origStderrWrite = process.stderr.write.bind(process.stderr);
  console.log = (...args: unknown[]) => {
    stdout += args.map(String).join(' ') + '\n';
  };

  (process.stderr as any).write = (chunk: string | Uint8Array) => {
    stderr += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    return true;
  };
  try {
    fn();
  } finally {
    console.log = origLog;

    (process.stderr as any).write = origStderrWrite;
  }
  return { stdout, stderr };
}
