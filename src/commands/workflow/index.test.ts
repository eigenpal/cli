import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  bumpSemver,
  datasetExportPath,
  formatShortStatus,
  readJsonInput,
  renderExperimentFailures,
  rollupForJson,
  spliceWorkflowVersion,
  summarizeExperimentExecutions,
} from './index';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'cli.ts');

describe('command aliases', () => {
  test('applies global list and compare aliases across the CLI', () => {
    for (const args of [
      ['auth', 'ls', '--help'],
      ['skill', 'ls', '--help'],
      ['workflow', 'ls', '--help'],
      ['workflow', 'dataset', 'ls', '--help'],
      ['workflow', 'versions', 'ls', '--help'],
      ['workflow', 'step-type', 'ls', '--help'],
      ['workflow', 'experiment', 'ls', '--help'],
      ['workflow', 'experiment', 'diff', '--help'],
    ]) {
      const result = spawnSync('bun', [CLI, ...args], { encoding: 'utf8' });
      expect(result.status).toBe(0);
    }
  });

  test('keeps explicit high-value workflow aliases', () => {
    const workflow = spawnSync('bun', [CLI, 'workflow', '--help'], { encoding: 'utf8' });
    expect(workflow.status).toBe(0);
    expect(workflow.stdout).toContain('experiment');

    // `workflow run` was removed by the unified run surface — starting runs
    // is `eigenpal run <target>` now (unified-run-cli spec, task 6.8).
    const run = spawnSync('bun', [CLI, 'workflow', 'run', 'workflows.extract-invoice'], {
      encoding: 'utf8',
    });
    expect(run.status).not.toBe(0);

    const execution = spawnSync('bun', [CLI, 'workflow', 'execution', 'run', 'wf_abc123'], {
      encoding: 'utf8',
    });
    expect(execution.status).not.toBe(0);

    const experiment = spawnSync('bun', [CLI, 'workflow', 'exp', '--help'], { encoding: 'utf8' });
    expect(experiment.status).toBe(0);
    expect(
      spawnSync('bun', [CLI, 'workflow', 'exp', 'ls', '--help'], { encoding: 'utf8' }).status
    ).toBe(0);
    expect(
      spawnSync('bun', [CLI, 'workflow', 'exp', 'diff', '--help'], { encoding: 'utf8' }).status
    ).toBe(0);
  });
});

describe('datasetExportPath', () => {
  const base = '/api/v1/workflows/wf_abc123/dataset/export';

  test('returns the bare export path when no examples are requested', () => {
    expect(datasetExportPath('wf_abc123')).toBe(base);
    expect(datasetExportPath('wf_abc123', [])).toBe(base);
  });

  test('appends a single example id', () => {
    expect(datasetExportPath('wf_abc123', ['evx_111'])).toBe(`${base}?exampleIds=evx_111`);
  });

  test('joins multiple example ids with a comma', () => {
    expect(datasetExportPath('wf_abc123', ['evx_111', 'evx_222'])).toBe(
      `${base}?exampleIds=evx_111,evx_222`
    );
  });

  test('URL-encodes each id', () => {
    expect(datasetExportPath('wf_abc123', ['a b', 'c&d'])).toBe(`${base}?exampleIds=a%20b,c%26d`);
  });
});

describe('dataset pull --help', () => {
  test('documents the --example-id flag', () => {
    const result = spawnSync('bun', [CLI, 'workflow', 'dataset', 'pull', '--help'], {
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('--example-id');
  });
});

describe('readJsonInput', () => {
  test('returns undefined when neither flag is set (PATCH semantics: leave alone)', async () => {
    expect(await readJsonInput(undefined, undefined, 'input')).toBeUndefined();
  });

  test('parses an inline JSON literal', async () => {
    expect(await readJsonInput('{"language":"en"}', undefined, 'input')).toEqual({
      language: 'en',
    });
    expect(await readJsonInput('[1,2,3]', undefined, 'input')).toEqual([1, 2, 3]);
    expect(await readJsonInput('"plain string"', undefined, 'input')).toBe('plain string');
  });

  test('reads JSON from a file path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eigenpal-readjson-'));
    try {
      const file = join(dir, 'expected.json');
      writeFileSync(file, '{"data":{"foo":"bar"}}');
      expect(await readJsonInput(undefined, file, 'expected')).toEqual({
        data: { foo: 'bar' },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('rejects when both flags are set', async () => {
    await expect(readJsonInput('{}', '/some/path', 'input')).rejects.toThrow(
      'pass either --input-json or --input-file, not both'
    );
  });

  test('surfaces a clear error on invalid inline JSON', async () => {
    await expect(readJsonInput('{not json', undefined, 'expected')).rejects.toThrow(
      /invalid JSON in --expected-json/
    );
  });

  test('surfaces a clear error on invalid file JSON', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eigenpal-readjson-'));
    try {
      const file = join(dir, 'broken.json');
      writeFileSync(file, '{not json');
      await expect(readJsonInput(undefined, file, 'input')).rejects.toThrow(
        /invalid JSON in --input-file/
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('summarizeExperimentExecutions', () => {
  test('counts statuses and reports done when every execution is terminal', () => {
    const result = summarizeExperimentExecutions([
      { status: 'completed' },
      { status: 'completed' },
      { status: 'failed' },
    ]);
    expect(result.total).toBe(3);
    expect(result.terminal).toBe(3);
    expect(result.counts).toEqual({ completed: 2, failed: 1 });
    expect(result.done).toBe(true);
  });

  test('done=false when any execution is still running', () => {
    const result = summarizeExperimentExecutions([{ status: 'completed' }, { status: 'running' }]);
    expect(result.terminal).toBe(1);
    expect(result.done).toBe(false);
  });

  test('done=false on an empty result (race: server enqueueing)', () => {
    const result = summarizeExperimentExecutions([]);
    expect(result.total).toBe(0);
    expect(result.done).toBe(false);
  });
});

describe('rollupForJson', () => {
  test('lifts every status counter to a top-level field — no missing keys', () => {
    const summary = summarizeExperimentExecutions([
      { status: 'completed' },
      { status: 'completed' },
      { status: 'failed' },
      { status: 'cancelled' },
      { status: 'rejected' },
      { status: 'running' },
      { status: 'pending' },
    ]);
    expect(rollupForJson(summary)).toEqual({
      total: 7,
      terminal: 5,
      complete: false,
      completedCount: 2,
      failedCount: 1,
      cancelledCount: 1,
      rejectedCount: 1,
      runningCount: 1,
      pendingCount: 1,
    });
  });

  test('zero-fills counters for statuses that do not appear', () => {
    const summary = summarizeExperimentExecutions([
      { status: 'completed' },
      { status: 'completed' },
    ]);
    const rollup = rollupForJson(summary);
    expect(rollup.complete).toBe(true);
    expect(rollup.failedCount).toBe(0);
    expect(rollup.cancelledCount).toBe(0);
    expect(rollup.rejectedCount).toBe(0);
    expect(rollup.runningCount).toBe(0);
    expect(rollup.pendingCount).toBe(0);
  });

  test('complete=false on an empty result so polling does not stop on a race', () => {
    expect(rollupForJson(summarizeExperimentExecutions([])).complete).toBe(false);
  });
});

describe('formatShortStatus', () => {
  test('renders done state when every execution is terminal', () => {
    const summary = summarizeExperimentExecutions([
      { status: 'completed' },
      { status: 'completed' },
      { status: 'failed' },
    ]);
    expect(formatShortStatus(summary)).toBe('3/3 done failed=1 cancelled=0 rejected=0');
  });

  test('renders in-progress when any execution is non-terminal', () => {
    const summary = summarizeExperimentExecutions([{ status: 'completed' }, { status: 'running' }]);
    expect(formatShortStatus(summary)).toBe('1/2 in-progress failed=0 cancelled=0 rejected=0');
  });

  test('parseable with awk: first token is N/N, second is the state', () => {
    const summary = summarizeExperimentExecutions([
      { status: 'completed' },
      { status: 'cancelled' },
    ]);
    const parts = formatShortStatus(summary).split(' ');
    expect(parts[0]).toBe('2/2');
    expect(parts[1]).toBe('done');
    expect(parts.slice(2)).toEqual(['failed=0', 'cancelled=1', 'rejected=0']);
  });
});

describe('renderExperimentFailures', () => {
  test('emits one block per failed execution with stderr-only output', () => {
    const captured = captureStdio(() => {
      renderExperimentFailures(
        [
          { status: 'completed' },
          { status: 'failed', exampleName: 'ex-1', error: 'boom\nstack', id: 'exec_1' },
          { status: 'cancelled', error: null, id: 'exec_2' },
        ] as Parameters<typeof renderExperimentFailures>[0],
        3
      );
    });
    expect(captured.stdout).toBe('');
    expect(stripAnsi(captured.stderr)).toContain('✗ 2/3 did not pass');
    expect(stripAnsi(captured.stderr)).toContain('ex-1');
    expect(stripAnsi(captured.stderr)).toContain('boom stack');
    expect(stripAnsi(captured.stderr)).toContain('exec_2');
    expect(stripAnsi(captured.stderr)).toContain('eigenpal runs get exec_1');
  });

  test('no-op when there are no failures', () => {
    const captured = captureStdio(() => {
      renderExperimentFailures([{ status: 'completed' }], 1);
    });
    expect(captured.stdout).toBe('');
    expect(captured.stderr).toBe('');
  });
});

describe('bumpSemver', () => {
  test('bumps the patch component', () => {
    expect(bumpSemver('1.2.3', 'patch')).toBe('1.2.4');
    expect(bumpSemver('0.0.0', 'patch')).toBe('0.0.1');
  });

  test('bumps minor and zeros patch', () => {
    expect(bumpSemver('1.2.3', 'minor')).toBe('1.3.0');
  });

  test('bumps major and zeros minor + patch', () => {
    expect(bumpSemver('1.2.3', 'major')).toBe('2.0.0');
  });

  test('rejects non-bare-semver inputs', () => {
    // Only X.Y.Z is supported — pre-release / build metadata not handled.
    expect(() => bumpSemver('1.2.3-rc.1', 'patch')).toThrow(/not bare semver/);
    expect(() => bumpSemver('v1.2.3', 'patch')).toThrow(/not bare semver/);
    expect(() => bumpSemver('1.2', 'patch')).toThrow(/not bare semver/);
  });
});

describe('spliceWorkflowVersion', () => {
  test('replaces an existing top-level version line in place', () => {
    const yaml = 'name: foo\nversion: 1.2.3\nsteps: []\n';
    expect(spliceWorkflowVersion(yaml, '1.2.4')).toBe('name: foo\nversion: 1.2.4\nsteps: []\n');
  });

  test('handles quoted versions', () => {
    const yaml = 'name: foo\nversion: "1.2.3"\nsteps: []\n';
    expect(spliceWorkflowVersion(yaml, '2.0.0')).toContain('version: 2.0.0');
  });

  test('inserts after `name:` when version is missing', () => {
    const yaml = 'name: foo\ndescription: x\nsteps: []\n';
    const out = spliceWorkflowVersion(yaml, '1.0.0');
    expect(out).toContain('name: foo\nversion: 1.0.0\n');
  });

  test('prepends version line when name is missing', () => {
    const yaml = 'description: lone\nsteps: []\n';
    const out = spliceWorkflowVersion(yaml, '0.1.0');
    expect(out.startsWith('version: 0.1.0\n')).toBe(true);
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
