import { describe, expect, it } from 'bun:test';

import { __testing, renderFrame, watchExecution, type ExecutionSnapshot } from './watch';

describe('renderFrame', () => {
  it('emits a header + one line per step', () => {
    const snap: ExecutionSnapshot = {
      id: 'exec_abc',
      status: 'running',
      durationMs: 1500,
      stepExecutions: [
        { stepName: 'parse', status: 'completed', durationMs: 300 },
        { stepName: 'extract', status: 'running' },
      ],
    };
    const frame = renderFrame(snap);
    const lines = frame.split('\n');
    expect(lines[0]).toContain('exec_abc');
    expect(lines[0]).toContain('[..]');
    expect(lines[1]).toContain('parse');
    expect(lines[1]).toContain('[ok]');
    expect(lines[2]).toContain('extract');
    expect(lines[2]).toContain('[..]');
  });

  it('shows top-level error when no step executions are present', () => {
    const snap: ExecutionSnapshot = {
      id: 'exec_x',
      status: 'failed',
      stepExecutions: [],
      error: 'planner failed: invalid yaml',
    };
    expect(renderFrame(snap)).toContain('planner failed: invalid yaml');
  });

  it('truncates long error messages to 80 chars per step', () => {
    const long = 'X'.repeat(200);
    const snap: ExecutionSnapshot = {
      id: 'exec_y',
      status: 'failed',
      stepExecutions: [{ stepName: 'extract', status: 'failed', error: long }],
    };
    const frame = renderFrame(snap);
    expect(frame).toContain('XX');
    expect(frame.includes('X'.repeat(81))).toBe(false);
  });

  it('omits duration when none is set', () => {
    const snap: ExecutionSnapshot = {
      id: 'exec_z',
      status: 'pending',
      stepExecutions: [{ stepName: 'parse', status: 'pending' }],
    };
    const frame = renderFrame(snap);
    expect(frame).not.toMatch(/\d+ms/);
    expect(frame).not.toMatch(/\d+\.\ds/);
  });
});

describe('watchExecution', () => {
  function makeFetcher(sequence: ExecutionSnapshot[]): {
    fetch: () => Promise<ExecutionSnapshot>;
    calls: number;
  } {
    let i = 0;
    return {
      get calls() {
        return i;
      },
      async fetch() {
        const snap = sequence[Math.min(i, sequence.length - 1)];
        i += 1;
        return snap;
      },
    };
  }

  it('terminates as soon as the execution reaches `completed`', async () => {
    const sequence: ExecutionSnapshot[] = [
      { id: 'e', status: 'running', stepExecutions: [{ stepName: 's', status: 'running' }] },
      { id: 'e', status: 'completed', stepExecutions: [{ stepName: 's', status: 'completed' }] },
    ];
    const fetcher = makeFetcher(sequence);
    const renders: string[] = [];

    const result = await watchExecution({
      fetch: fetcher.fetch,
      render: (f) => renders.push(f),
      sleep: async () => undefined,
    });

    expect(result.detached).toBe(false);
    expect(result.final.status).toBe('completed');
    expect(renders.length).toBe(2);
  });

  it('terminates on `failed` and surfaces the snapshot', async () => {
    const sequence: ExecutionSnapshot[] = [{ id: 'e', status: 'failed', error: 'boom' }];
    const fetcher = makeFetcher(sequence);

    const result = await watchExecution({
      fetch: fetcher.fetch,
      render: () => undefined,
      sleep: async () => undefined,
    });

    expect(result.detached).toBe(false);
    expect(result.final.error).toBe('boom');
  });

  it('uses transitionIntervalMs while steps are advancing', async () => {
    const sequence: ExecutionSnapshot[] = [
      { id: 'e', status: 'running', stepExecutions: [{ stepName: 's1', status: 'running' }] },
      { id: 'e', status: 'running', stepExecutions: [{ stepName: 's1', status: 'completed' }] },
      { id: 'e', status: 'completed', stepExecutions: [{ stepName: 's1', status: 'completed' }] },
    ];
    const fetcher = makeFetcher(sequence);
    const sleeps: number[] = [];

    await watchExecution({
      fetch: fetcher.fetch,
      render: () => undefined,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      transitionIntervalMs: 200,
      steadyIntervalMs: 5000,
    });

    // First sleep: previous is undefined → counts as transition (200ms).
    // Second sleep: status diffed → 200ms. Third snapshot is terminal → no further sleep.
    expect(sleeps[0]).toBe(200);
    expect(sleeps[1]).toBe(200);
  });

  it('switches to steadyIntervalMs when nothing changes', async () => {
    const stable: ExecutionSnapshot = {
      id: 'e',
      status: 'running',
      stepExecutions: [{ stepName: 's', status: 'running' }],
    };
    const terminal: ExecutionSnapshot = {
      id: 'e',
      status: 'completed',
      stepExecutions: [{ stepName: 's', status: 'completed' }],
    };
    const sequence: ExecutionSnapshot[] = [stable, stable, terminal];
    const fetcher = makeFetcher(sequence);
    const sleeps: number[] = [];

    await watchExecution({
      fetch: fetcher.fetch,
      render: () => undefined,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      transitionIntervalMs: 200,
      steadyIntervalMs: 4000,
    });

    // First sleep: previous undefined → transition (200ms).
    // Second sleep: identical to previous → steady (4000ms).
    expect(sleeps[0]).toBe(200);
    expect(sleeps[1]).toBe(4000);
  });

  it('auto-detaches after maxMs and reports detached=true', async () => {
    const sequence: ExecutionSnapshot[] = [
      { id: 'e', status: 'running', stepExecutions: [{ stepName: 's', status: 'running' }] },
    ];
    const fetcher = makeFetcher(sequence);

    let virtualNow = 0;
    const result = await watchExecution({
      fetch: fetcher.fetch,
      render: () => undefined,
      sleep: async () => {
        virtualNow += 1000;
      },
      now: () => virtualNow,
      maxMs: 5000,
      transitionIntervalMs: 1000,
      steadyIntervalMs: 1000,
    });

    expect(result.detached).toBe(true);
  });

  it('survives transient fetch errors and keeps polling', async () => {
    let i = 0;
    const failOnce = async (): Promise<ExecutionSnapshot> => {
      i += 1;
      if (i === 1) throw new Error('ECONNREFUSED 127.0.0.1:3000');
      return {
        id: 'e',
        status: 'completed',
        stepExecutions: [{ stepName: 's', status: 'completed' }],
      };
    };
    const renders: string[] = [];

    const result = await watchExecution({
      fetch: failOnce,
      render: (f) => renders.push(f),
      sleep: async () => undefined,
    });

    expect(result.final.status).toBe('completed');
    expect(renders.some((f) => f.includes('(network)'))).toBe(true);
    expect(renders.some((f) => f.includes('[ok]'))).toBe(true);
  });
});

describe('snapshotsDiffer', () => {
  const { snapshotsDiffer } = __testing;

  it('treats top-level status changes as different', () => {
    const a: ExecutionSnapshot = { id: 'e', status: 'running' };
    const b: ExecutionSnapshot = { id: 'e', status: 'completed' };
    expect(snapshotsDiffer(a, b)).toBe(true);
  });

  it('treats step status changes as different', () => {
    const a: ExecutionSnapshot = {
      id: 'e',
      status: 'running',
      stepExecutions: [{ stepName: 's', status: 'running' }],
    };
    const b: ExecutionSnapshot = {
      id: 'e',
      status: 'running',
      stepExecutions: [{ stepName: 's', status: 'completed' }],
    };
    expect(snapshotsDiffer(a, b)).toBe(true);
  });

  it("returns false when nothing material changed (durations alone don't count)", () => {
    const a: ExecutionSnapshot = {
      id: 'e',
      status: 'running',
      stepExecutions: [{ stepName: 's', status: 'running', durationMs: 100 }],
    };
    const b: ExecutionSnapshot = {
      id: 'e',
      status: 'running',
      stepExecutions: [{ stepName: 's', status: 'running', durationMs: 200 }],
    };
    expect(snapshotsDiffer(a, b)).toBe(false);
  });
});
