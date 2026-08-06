import { describe, expect, it } from 'bun:test';
import type { ApiClient } from '../../lib/client';
import {
  type ExampleEvalResult,
  formatEvalSummary,
  formatExampleLines,
  runWorkflowExamplesWithEval,
  summarize,
} from './eval-example';

// picocolors emits plain text in non-TTY test runs; strip color codes defensively.
const ANSI = /\[[0-9;]*m/g;
const plain = (value: string): string => value.replace(ANSI, '');

describe('formatExampleLines', () => {
  it('renders evaluator score, verdict, and per-evaluator detail', () => {
    const result: ExampleEvalResult = {
      name: 'calc-totals',
      run: 'ok',
      mode: 'evaluators',
      score: 0.94,
      passed: true,
      evaluators: [
        { name: 'field-match', score: 1, passed: true, weight: 1, error: null },
        { name: 'numeric', score: 0.9, passed: true, weight: 1, error: null },
      ],
    };
    const out = plain(formatExampleLines(result));
    expect(out).toContain('calc-totals  ok  score 0.94  PASS');
    expect(out).toContain('field-match  1.00  pass');
    expect(out).toContain('numeric  0.90  pass');
  });

  it('renders FAIL when the rollup did not pass', () => {
    const result: ExampleEvalResult = {
      name: 'invoice-002',
      run: 'ok',
      mode: 'evaluators',
      score: 0.62,
      passed: false,
      evaluators: [{ name: 'numeric', score: 0.2, passed: false, weight: 1, error: null }],
    };
    const out = plain(formatExampleLines(result));
    expect(out).toContain('invoice-002  ok  score 0.62  FAIL');
    expect(out).toContain('numeric  0.20  fail');
  });

  it('marks an errored evaluator distinctly and tolerates null scores', () => {
    const result: ExampleEvalResult = {
      name: 'x',
      run: 'ok',
      mode: 'evaluators',
      score: null,
      passed: null,
      evaluators: [{ name: 'judge', score: null, passed: null, weight: null, error: 'boom' }],
    };
    const out = plain(formatExampleLines(result));
    expect(out).toContain('score n/a');
    expect(out).toContain('judge  n/a  error');
  });

  it('does not render unknown evaluator verdicts as passing', () => {
    const result: ExampleEvalResult = {
      name: 'x',
      run: 'ok',
      mode: 'evaluators',
      score: null,
      passed: null,
      evaluators: [{ name: 'judge', score: null, passed: null, weight: null, error: null }],
    };
    const out = plain(formatExampleLines(result));
    expect(out).toContain('x  ok  score n/a  FAIL');
    expect(out).toContain('judge  n/a  n/a');
    expect(out).not.toContain('judge  n/a  pass');
  });

  it('renders structural diff verdicts in diff mode', () => {
    expect(
      plain(formatExampleLines({ name: 'a', run: 'ok', mode: 'diff', matched: true, diffCount: 0 }))
    ).toBe('a  ok  PASS');
    expect(
      plain(
        formatExampleLines({ name: 'b', run: 'ok', mode: 'diff', matched: false, diffCount: 3 })
      )
    ).toBe('b  ok  FAIL (3 diff)');
  });

  it('renders a dash for ungraded and err for failed runs', () => {
    expect(plain(formatExampleLines({ name: 'c', run: 'ok', mode: 'none' }))).toBe('c  ok  -');
    expect(
      plain(formatExampleLines({ name: 'd', run: 'error', runError: 'timeout', mode: 'none' }))
    ).toBe('d  err timeout');
  });
});

describe('summarize + formatEvalSummary', () => {
  it('aggregates evaluator runs into weighted average and case pass count', () => {
    const examples: ExampleEvalResult[] = [
      { name: 'a', run: 'ok', mode: 'evaluators', score: 1.0, passed: true },
      { name: 'b', run: 'ok', mode: 'evaluators', score: 0.8, passed: true },
      { name: 'c', run: 'ok', mode: 'evaluators', score: 0.4, passed: false },
    ];
    const summary = summarize('wf', 'evaluators', examples);
    expect(summary.graded).toBe(3);
    expect(summary.passedCases).toBe(2);
    expect(summary.failedCases).toBe(1);
    expect(summary.weightedAvg).toBeCloseTo(0.733, 2);

    const out = plain(formatEvalSummary(summary));
    expect(out).toContain('Ran 3: 3 ok');
    expect(out).toContain('weighted 0.73');
    expect(out).toContain('2/3 cases pass');
  });

  it('reports structural accuracy in diff mode and counts errored separately', () => {
    const examples: ExampleEvalResult[] = [
      { name: 'a', run: 'ok', mode: 'diff', matched: true, diffCount: 0 },
      { name: 'b', run: 'ok', mode: 'diff', matched: false, diffCount: 2 },
      { name: 'c', run: 'error', runError: 'boom', mode: 'none' },
    ];
    const summary = summarize('wf', 'diff', examples);
    expect(summary.ok).toBe(2);
    expect(summary.errored).toBe(1);
    expect(summary.graded).toBe(2);
    expect(summary.passedCases).toBe(1);

    const out = plain(formatEvalSummary(summary));
    expect(out).toContain('Ran 3: 2 ok');
    expect(out).toContain('1 errored');
    expect(out).toContain('accuracy 1/2 matched');
    expect(out).not.toContain('weighted');
  });

  it('counts ran-but-ungraded examples separately', () => {
    const examples: ExampleEvalResult[] = [
      { name: 'a', run: 'ok', mode: 'evaluators', score: 1, passed: true },
      { name: 'b', run: 'ok', mode: 'none' },
    ];
    const summary = summarize('wf', 'evaluators', examples);
    expect(summary.ungraded).toBe(1);
    expect(plain(formatEvalSummary(summary))).toContain('1 ungraded');
  });

  it('preserves back-compat passed/failed = execution success/failure', () => {
    const summary = summarize('wf', 'evaluators', [
      { name: 'a', run: 'ok', mode: 'evaluators', score: 0.4, passed: false },
      { name: 'b', run: 'error', mode: 'none' },
    ]);
    expect(summary.passed).toBe(1); // ran ok, despite failing its evaluator
    expect(summary.failed).toBe(1); // errored
  });
});

/**
 * Minimal in-memory ApiClient stub. `get` dispatches on path; the `/runs/<id>`
 * base path is matched in declaration order so the first call (terminal poll)
 * and the rollup poll can return different shapes.
 */
function fakeClient(routes: {
  get: (path: string) => unknown;
  post?: (path: string, body: unknown) => unknown;
}): ApiClient {
  return {
    get: async (path: string) => routes.get(path),
    post: async (path: string, body: unknown) => routes.post?.(path, body),
  } as unknown as ApiClient;
}

const NO_DIR = '/tmp/eigenpal-eval-test-nonexistent';

describe('runWorkflowExamplesWithEval (orchestration)', () => {
  it('surfaces real evaluator score + per-evaluator rows', async () => {
    let runBaseHits = 0;
    const posts: Array<{ path: string; body: unknown }> = [];
    const gets: string[] = [];
    const client = fakeClient({
      get: (path) => {
        gets.push(path);
        if (path.endsWith('/evaluators')) return { config: { evaluators: [{ name: 'x' }] } };
        if (path.includes('/examples?') || path.includes('/examples'))
          return { data: [{ id: 'evx_1', name: 'foo', expected: { a: 1 } }], total: 1 };
        if (path.includes('/experiments/'))
          return {
            resultsByRun: {
              run_1: [{ evaluatorName: 'x', score: '0.9', passed: true, weight: '1', error: null }],
            },
          };
        if (path === '/v1/runs/run_1') {
          runBaseHits += 1;
          // 1st: terminal poll. 2nd: rollup poll (eval present).
          return runBaseHits === 1
            ? { finished: true, execution: { status: 'completed' } }
            : { execution: { status: 'completed' }, eval: { score: 0.9, passed: true } };
        }
        if (path.startsWith('/v1/runs/run_1?'))
          return { execution: { status: 'completed' }, output: { a: 1 } };
        throw new Error(`unexpected GET ${path}`);
      },
      post: (path, body) => {
        posts.push({ path, body });
        return { id: 'run_1', batchId: 'batch_1' };
      },
    });

    const summary = await runWorkflowExamplesWithEval(client, NO_DIR, 'foo', 'wf_1', ['foo']);
    expect(summary.mode).toBe('evaluators');
    expect(summary.graded).toBe(1);
    expect(summary.passedCases).toBe(1);
    expect(summary.weightedAvg).toBeCloseTo(0.9, 5);
    expect(summary.examples[0].score).toBe(0.9);
    expect(summary.examples[0].passed).toBe(true);
    expect(summary.examples[0].evaluators?.[0]).toMatchObject({
      name: 'x',
      score: 0.9,
      weight: 1,
    });
    expect(posts).toEqual([{ path: '/v1/automations/wf_1/examples/evx_1/run', body: {} }]);
    expect(gets).toContain('/v1/automations/wf_1/experiments/batch_1');
  });

  it('falls back to a structural diff when no evaluators are configured', async () => {
    const client = fakeClient({
      get: (path) => {
        if (path.endsWith('/evaluators')) return { config: { evaluators: [] } };
        if (path.includes('/examples'))
          return { data: [{ id: 'evx_1', name: 'foo', expected: { a: 1 } }], total: 1 };
        if (path === '/v1/runs/run_1')
          return { finished: true, execution: { status: 'completed' } };
        if (path.startsWith('/v1/runs/run_1?'))
          return { execution: { status: 'completed' }, output: { a: 2 } };
        throw new Error(`unexpected GET ${path}`);
      },
      post: () => ({ id: 'run_1', batchId: 'batch_1' }),
    });

    const summary = await runWorkflowExamplesWithEval(client, NO_DIR, 'foo', 'wf_1', ['foo']);
    expect(summary.mode).toBe('diff');
    expect(summary.examples[0].mode).toBe('diff');
    expect(summary.examples[0].matched).toBe(false);
    expect(summary.examples[0].diffCount).toBe(1);
    expect(summary.failedCases).toBe(1);
  });

  it('reports a clear error when the example is not in the server dataset', async () => {
    const client = fakeClient({
      get: (path) => {
        if (path.endsWith('/evaluators')) return { config: { evaluators: [] } };
        if (path.includes('/examples')) return { data: [], total: 0 };
        throw new Error(`unexpected GET ${path}`);
      },
    });

    const summary = await runWorkflowExamplesWithEval(client, NO_DIR, 'foo', 'wf_1', ['missing']);
    expect(summary.errored).toBe(1);
    expect(summary.examples[0].run).toBe('error');
    expect(summary.examples[0].runError).toContain('not found');
    expect(summary.examples[0].runError).toContain('dataset push');
  });
});
