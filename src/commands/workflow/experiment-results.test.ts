import { describe, expect, test } from 'bun:test';
import {
  analyzeExperimentResults,
  experimentRowsFromDetail,
  type ExperimentResultRow,
} from './experiment-results';

const row = (
  executionId: string,
  exampleName: string,
  evaluatorName: string,
  score: number | null,
  passed: boolean | null,
  extra: Partial<ExperimentResultRow> = {}
): ExperimentResultRow => ({
  executionId,
  exampleName,
  evaluatorName,
  evaluatorType: 'exact-diff',
  score,
  passed,
  weight: 1,
  error: null,
  ...extra,
});

describe('experiment result analysis', () => {
  test('builds export-shaped rows from experiment detail without requiring an export', () => {
    expect(
      experimentRowsFromDetail({
        runs: [{ id: 'run_1', status: 'completed', exampleName: 'one' }],
        resultsByRun: {
          run_1: [
            {
              runId: 'run_1',
              evaluatorName: 'shape',
              evaluatorType: 'exact-diff',
              score: 1,
              passed: true,
              weight: null,
              error: null,
            },
          ],
        },
      })
    ).toEqual([
      expect.objectContaining({
        executionId: 'run_1',
        exampleName: 'one',
        evaluatorName: 'shape',
        weight: 1,
      }),
    ]);
  });

  test('summarizes an evaluator-free failed batch from run detail alone', () => {
    const detail = {
      runs: [{ id: 'run_1', status: 'failed', exampleName: 'one' }],
      resultsByRun: {},
    };
    const analysis = analyzeExperimentResults({
      runs: detail.runs,
      rows: experimentRowsFromDetail(detail),
    });

    expect(analysis.summary).toEqual({
      total: 1,
      passed: 0,
      failed: 0,
      errors: 1,
      averageScore: null,
      byEvaluator: [],
    });
  });

  test('uses the persisted run aggregate instead of requiring every evaluator to pass', () => {
    const analysis = analyzeExperimentResults({
      runs: [
        {
          id: 'run_1',
          status: 'completed',
          exampleName: 'one',
          evalPassed: true,
          evalScore: 0.9,
        },
      ],
      rows: [
        row('run_1', 'one', 'high-weight', 1, true, { weight: 9 }),
        row('run_1', 'one', 'low-weight', 0, false, { weight: 1 }),
      ],
    });

    expect(analysis.summary).toMatchObject({
      total: 1,
      passed: 1,
      failed: 0,
      errors: 0,
      averageScore: 0.9,
    });
  });

  test('summarizes runs and evaluators and exposes structured discrepancies', () => {
    const analysis = analyzeExperimentResults({
      runs: [
        { id: 'run_1', status: 'completed', exampleName: 'one' },
        { id: 'run_2', status: 'completed', exampleName: 'two' },
        { id: 'run_3', status: 'failed', exampleName: 'three' },
      ],
      rows: [
        row('run_1', 'one', 'shape', 1, true),
        row('run_1', 'one', 'quality', 0.8, true),
        row('run_2', 'two', 'shape', 0, false, {
          details: { mismatches: [{ path: 'subjects[0].name', expected: 'A', actual: 'B' }] },
        }),
      ],
    });

    expect(analysis.summary).toMatchObject({
      total: 3,
      passed: 1,
      failed: 1,
      errors: 1,
      averageScore: 0.45,
    });
    expect(analysis.summary.byEvaluator).toEqual([
      {
        evaluator: 'quality',
        total: 1,
        passed: 1,
        failed: 0,
        errors: 0,
        averageScore: 0.8,
      },
      {
        evaluator: 'shape',
        total: 2,
        passed: 1,
        failed: 1,
        errors: 0,
        averageScore: 0.5,
      },
    ]);
    expect(analysis.discrepancies).toEqual([
      {
        example: 'two',
        executionId: 'run_2',
        evaluator: 'shape',
        path: 'subjects[0].name',
        expected: 'A',
        actual: 'B',
      },
    ]);
  });

  test('filters to one evaluator and failing rows', () => {
    const analysis = analyzeExperimentResults({
      runs: [
        { id: 'run_1', status: 'completed', exampleName: 'one' },
        { id: 'run_2', status: 'completed', exampleName: 'two' },
      ],
      rows: [
        row('run_1', 'one', 'shape', 1, true),
        row('run_2', 'two', 'shape', 0, false),
        row('run_2', 'two', 'quality', 0.2, false),
      ],
      evaluator: 'shape',
      failedOnly: true,
    });
    expect(analysis.results).toHaveLength(1);
    expect(analysis.summary).toMatchObject({ total: 1, passed: 0, failed: 1, errors: 0 });
  });
});
