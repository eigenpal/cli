import { describe, expect, test } from 'bun:test';
import { countInvokeWorkflowSteps } from './validation';

describe('countInvokeWorkflowSteps', () => {
  test('counts top-level invoke-workflow steps', () => {
    const steps = [
      { name: 'a', type: 'ai.extract' },
      { name: 'invoke', type: 'action.invoke-workflow' },
      { name: 'invoke2', type: 'action.invoke-workflow' },
    ];
    expect(countInvokeWorkflowSteps(steps)).toBe(2);
  });

  test('returns 0 when there are no invoke steps', () => {
    expect(countInvokeWorkflowSteps([{ name: 'a', type: 'ai.parse' }])).toBe(0);
  });

  test('finds invoke steps nested in control containers', () => {
    const steps = [
      {
        name: 'branch',
        type: 'control.if',
        then: [{ name: 'inner-invoke', type: 'action.invoke-workflow' }],
        else: [{ name: 'plain', type: 'ai.extract' }],
      },
      {
        name: 'fan',
        type: 'control.parallel',
        branches: [
          { steps: [{ name: 'b-invoke', type: 'action.invoke-workflow' }] },
          { steps: [{ name: 'b-plain', type: 'transform.set' }] },
        ],
      },
      {
        name: 'loop',
        type: 'control.foreach',
        steps: [{ name: 'loop-invoke', type: 'action.invoke-workflow' }],
      },
    ];
    expect(countInvokeWorkflowSteps(steps)).toBe(3);
  });

  test('is robust to non-array / malformed input', () => {
    expect(countInvokeWorkflowSteps(undefined)).toBe(0);
    expect(countInvokeWorkflowSteps(null)).toBe(0);
    expect(countInvokeWorkflowSteps('nope')).toBe(0);
    expect(countInvokeWorkflowSteps([null, 42, { type: 'action.invoke-workflow' }])).toBe(1);
  });
});
