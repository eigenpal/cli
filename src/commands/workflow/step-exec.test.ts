/**
 * step-exec is a placeholder pending the server-side redesign (EIG-104).
 * The local-runner test suite (~440 LOC, ~110 tests) was deleted with the
 * runners. When the server endpoint lands, restore tests against the API
 * client mock — the local QuickJS / OpenAI mocks should not return.
 */

import { describe, expect, test } from 'bun:test';
import { Command } from 'commander';

import { registerStepExecCommands } from './step-exec';

describe('workflow step exec', () => {
  test('registers `step exec <type>` under workflow', () => {
    const workflow = new Command('workflow');
    registerStepExecCommands(workflow);
    const step = workflow.commands.find((c) => c.name() === 'step');
    expect(step).toBeDefined();
    const exec = step!.commands.find((c) => c.name() === 'exec');
    expect(exec).toBeDefined();
    // Description must mention the disabled state and EIG-104 redirect so
    // anyone running --help finds the path forward immediately.
    expect(exec!.description()).toMatch(/disabled|EIG-104/i);
  });
});
