import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { ApiError } from '../../lib/client';
import { cancelExecution } from './execution';

// ---------------------------------------------------------------------------
// cancelExecution — single-row destructive op (TTY silent / non-TTY --yes)
// ---------------------------------------------------------------------------

interface PostCall {
  path: string;
  body: unknown;
}

function makeStubClient(response: unknown | (() => unknown)): {
  client: { post: (path: string, body?: unknown) => Promise<unknown> };
  calls: PostCall[];
} {
  const calls: PostCall[] = [];
  const client = {
    post: async (path: string, body?: unknown): Promise<unknown> => {
      calls.push({ path, body });
      const value = typeof response === 'function' ? (response as () => unknown)() : response;
      if (value instanceof Error) throw value;
      return value;
    },
  };
  return { client, calls };
}

/**
 * Capture writes to stdout (console.log) and stderr (process.stderr.write) so
 * we can assert the human-mode "✓ cancellation requested" / "ℹ already
 * terminal" lines without spinning up a child CLI process.
 */
function captureStdio(): {
  restore: () => void;
  stdout: () => string;
  stderr: () => string;
} {
  let stdout = '';
  let stderr = '';
  const origLog = console.log;
  const origStderrWrite = process.stderr.write.bind(process.stderr);
  console.log = (...args: unknown[]) => {
    stdout += args.map(String).join(' ') + '\n';
  };
  (process.stderr as { write: unknown }).write = (chunk: string | Uint8Array): boolean => {
    stderr += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    return true;
  };
  return {
    restore: () => {
      console.log = origLog;
      (process.stderr as { write: unknown }).write = origStderrWrite;
    },
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

describe('cancelExecution', () => {
  let originalIsTTY: boolean | undefined;

  beforeEach(() => {
    // Default to TTY=true so the destructive guard doesn't trip unless a test
    // explicitly opts into non-TTY by setting `isTTY = false`.
    originalIsTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true });
  });

  afterEach(() => {
    Object.defineProperty(process.stdout, 'isTTY', {
      configurable: true,
      value: originalIsTTY,
    });
  });

  it('happy path — running execution: prints success line, exits 0', async () => {
    const { client, calls } = makeStubClient({
      executionId: 'exec_abc',
      status: 'cancelled',
      wasStatus: 'created',
    });
    const cap = captureStdio();
    try {
      await cancelExecution(client, 'exec_abc', { yes: true });
    } finally {
      cap.restore();
    }
    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe('/api/v1/workflows/executions/exec_abc/cancel');
    expect(stripAnsi(cap.stderr())).toContain('✓ cancellation requested');
    expect(cap.stdout()).toBe(''); // human mode — nothing on stdout
  });

  it('happy path — running execution: cancellation-requested also reads as success', async () => {
    const { client } = makeStubClient({
      executionId: 'exec_abc',
      status: 'cancellation-requested',
      wasStatus: 'running',
    });
    const cap = captureStdio();
    try {
      await cancelExecution(client, 'exec_abc', { yes: true });
    } finally {
      cap.restore();
    }
    expect(stripAnsi(cap.stderr())).toContain('✓ cancellation requested');
  });

  it('already-terminal: prints info line, exits 0 (NOT an error)', async () => {
    const { client } = makeStubClient({
      executionId: 'exec_abc',
      status: 'already-terminal',
      wasStatus: 'completed',
    });
    const cap = captureStdio();
    try {
      await cancelExecution(client, 'exec_abc', { yes: true });
    } finally {
      cap.restore();
    }
    expect(stripAnsi(cap.stderr())).toContain('ℹ already terminal: completed');
    expect(cap.stdout()).toBe('');
  });

  it('--json: emits the raw server payload to stdout, no human chrome', async () => {
    const payload = {
      executionId: 'exec_abc',
      status: 'cancelled',
      wasStatus: 'created',
    };
    const { client } = makeStubClient(payload);
    const cap = captureStdio();
    try {
      await cancelExecution(client, 'exec_abc', { yes: true, json: true });
    } finally {
      cap.restore();
    }
    expect(JSON.parse(cap.stdout())).toEqual(payload);
    expect(cap.stderr()).toBe(''); // no success line under --json
  });

  it('404 from server: rethrows so the action handler can exit 1', async () => {
    const { client } = makeStubClient(new ApiError(404, { error: 'Execution not found' }));
    await expect(cancelExecution(client, 'exec_missing', { yes: true })).rejects.toThrow(
      'Execution not found'
    );
  });

  it('non-TTY without --yes: throws the destructive-op guard', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: false });
    const { client, calls } = makeStubClient({});
    await expect(cancelExecution(client, 'exec_abc', {})).rejects.toThrow(
      'cancel is destructive and requires --yes when run non-interactively'
    );
    // Guard fires before the network call — important so a CI script that
    // forgot --yes never accidentally cancels anything.
    expect(calls).toHaveLength(0);
  });

  it('non-TTY WITH --yes: proceeds normally', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: false });
    const { client, calls } = makeStubClient({
      executionId: 'exec_abc',
      status: 'cancelled',
      wasStatus: 'created',
    });
    const cap = captureStdio();
    try {
      await cancelExecution(client, 'exec_abc', { yes: true });
    } finally {
      cap.restore();
    }
    expect(calls).toHaveLength(1);
    expect(stripAnsi(cap.stderr())).toContain('✓ cancellation requested');
  });
});
