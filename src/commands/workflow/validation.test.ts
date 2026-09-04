import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { countInvokeWorkflowSteps, discoverWorkflowProjectRoots } from './validation';

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
      {
        name: 'switch',
        type: 'control.switch',
        cases: [{ when: 'a', steps: [{ name: 'case-invoke', type: 'action.invoke-workflow' }] }],
        default: [{ name: 'default-invoke', type: 'action.invoke-workflow' }],
      },
    ];
    expect(countInvokeWorkflowSteps(steps)).toBe(5);
  });

  test('is robust to non-array / malformed input', () => {
    expect(countInvokeWorkflowSteps(undefined)).toBe(0);
    expect(countInvokeWorkflowSteps(null)).toBe(0);
    expect(countInvokeWorkflowSteps('nope')).toBe(0);
    expect(countInvokeWorkflowSteps([null, 42, { type: 'action.invoke-workflow' }])).toBe(1);
  });
});

describe('discoverWorkflowProjectRoots', () => {
  test('accepts a repository containing nested workflow projects', () => {
    const root = mkdtempSync(join(tmpdir(), 'eigenpal-validate-layout-'));
    try {
      for (const name of ['invoice', 'summary']) {
        const project = join(root, 'eigenpal', 'workflows', name);
        mkdirSync(project, { recursive: true });
        writeFileSync(join(project, 'workflow.yaml'), `name: ${name}\n`);
      }
      expect(discoverWorkflowProjectRoots(root)).toEqual([
        join(root, 'eigenpal', 'workflows', 'invoice'),
        join(root, 'eigenpal', 'workflows', 'summary'),
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('prefers a flat project at the requested path', () => {
    const root = mkdtempSync(join(tmpdir(), 'eigenpal-validate-flat-'));
    try {
      writeFileSync(join(root, 'workflow.yaml'), 'name: flat\n');
      expect(discoverWorkflowProjectRoots(root)).toEqual([root]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
