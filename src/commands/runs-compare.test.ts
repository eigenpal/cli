import { describe, expect, test } from 'bun:test';
import { compareWorkflowRuns } from './runs';

function iteration(stepName: string, index: number, outputData: unknown, durationMs: number) {
  return {
    stepName,
    status: 'completed',
    durationMs,
    outputData,
    scopeStack: [
      { type: 'root', stepName: 'root' },
      { type: 'parallel-map-iteration', stepName: 'documents', iterationIndex: index },
    ],
  };
}

describe('workflow run comparison', () => {
  test('compares repeated parallel-map steps by stable iteration path', () => {
    const report = compareWorkflowRuns(
      'run_a',
      {
        type: 'workflow',
        output: { count: 2 },
        stepExecutions: [
          iteration('parse-document', 0, { text: 'a' }, 10),
          iteration('parse-document', 1, { text: 'b' }, 20),
        ],
      },
      'run_b',
      {
        type: 'workflow',
        output: { count: 2 },
        stepExecutions: [
          iteration('parse-document', 0, { text: 'a' }, 12),
          iteration('parse-document', 1, { text: 'changed' }, 30),
        ],
      },
      undefined
    );

    expect(report.steps.map((step) => step.stepPath)).toEqual([
      'documents[0].parse-document',
      'documents[1].parse-document',
    ]);
    expect(report.steps[0]).toMatchObject({
      durationDeltaMs: 2,
      outputState: 'identical',
    });
    expect(report.steps[1]).toMatchObject({
      durationDeltaMs: 10,
      outputState: expect.stringContaining('differs'),
    });
  });

  test('step-name filters include every iteration', () => {
    const steps = [
      iteration('parse-document', 0, { text: 'a' }, 10),
      iteration('parse-document', 1, { text: 'b' }, 20),
      iteration('classify-document', 0, { label: 'a' }, 5),
    ];
    const report = compareWorkflowRuns(
      'run_a',
      { type: 'workflow', output: {}, stepExecutions: steps },
      'run_b',
      { type: 'workflow', output: {}, stepExecutions: steps },
      'parse-document'
    );

    expect(report.steps).toHaveLength(2);
  });
});
