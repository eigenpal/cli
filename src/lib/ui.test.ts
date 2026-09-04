import { describe, expect, test } from 'bun:test';
import { formatDuration, intArg, renderListResult, table } from './ui';

describe('table', () => {
  test('renders header, separator, and rows aligned to widest cell', () => {
    const rendered = table(
      [
        { id: 'wf_a', name: 'short', updatedAt: '2026-04-01' },
        { id: 'wf_bbbbb', name: 'a much longer name', updatedAt: '2026-04-30' },
      ],
      [
        { key: 'id', header: 'id' },
        { key: 'name', header: 'name' },
        { key: 'updatedAt', header: 'updatedAt' },
      ]
    );
    const lines = stripAnsi(rendered).split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe('id        name                updatedAt ');
    expect(lines[1]).toBe('────────  ──────────────────  ──────────');
    expect(lines[2]).toBe('wf_a      short               2026-04-01');
    expect(lines[3]).toBe('wf_bbbbb  a much longer name  2026-04-30');
  });

  test('right-aligns columns marked as right', () => {
    const rendered = table(
      [
        { name: 'foo', count: 5 },
        { name: 'bar', count: 100 },
      ],
      [
        { key: 'name', header: 'name' },
        { key: 'count', header: 'n', align: 'right' },
      ]
    );
    const lines = stripAnsi(rendered).split('\n');
    expect(lines[2]).toBe('foo     5');
    expect(lines[3]).toBe('bar   100');
  });

  test('uses a custom format function when provided', () => {
    const rendered = table(
      [{ ms: 1500 }, { ms: 250 }],
      [{ key: 'ms', header: 'duration', format: (v) => formatDuration(v as number) }]
    );
    const lines = stripAnsi(rendered).split('\n');
    expect(lines[2]).toBe('1.5s    ');
    expect(lines[3]).toBe('250ms   ');
  });

  test('renders "(no rows)" for empty input', () => {
    const rendered = table([], [{ key: 'foo', header: 'foo' }]);
    expect(stripAnsi(rendered)).toBe('(no rows)');
  });
});

describe('renderListResult', () => {
  test('json mode emits the raw {data,total} envelope unchanged on stdout', () => {
    const payload = {
      data: [
        { id: 'a', name: 'foo', secret: 'preserved' },
        { id: 'b', name: 'bar', secret: 'also-preserved' },
      ],
      total: 2,
    };
    const captured = captureStdio(() => {
      renderListResult(
        payload,
        [
          { key: 'id', header: 'id' },
          { key: 'name', header: 'name' },
        ],
        { json: true }
      );
    });
    // Matches the gh/kubectl convention: `--json` returns the full server
    // payload (envelope + every field), no projection. Pipe through
    // `jq '.data'` to unwrap the array.
    expect(JSON.parse(captured.stdout)).toEqual(payload);
    // stderr still shows the count hint so the user sees pagination state
    expect(stripAnsi(captured.stderr)).toContain('2 records');
    expect(stripAnsi(captured.stderr)).not.toContain('use --json');
  });

  test('human mode renders table to stdout and hint to stderr', () => {
    const captured = captureStdio(() => {
      renderListResult(
        {
          data: [
            { id: 'a', name: 'foo' },
            { id: 'b', name: 'bar' },
          ],
          total: 2,
        },
        [
          { key: 'id', header: 'id' },
          { key: 'name', header: 'name' },
        ]
      );
    });
    const stdoutLines = stripAnsi(captured.stdout).split('\n');
    expect(stdoutLines[0]).toBe('id  name');
    expect(stdoutLines[2]).toBe('a   foo ');
    expect(stdoutLines[3]).toBe('b   bar ');
    expect(stripAnsi(captured.stderr)).toContain('2 records');
    expect(stripAnsi(captured.stderr)).toContain('--json for machine-readable output');
  });

  test('shows "of N" hint when only a page of total is returned', () => {
    const captured = captureStdio(() => {
      renderListResult({ data: [{ id: 'a' }], total: 42 }, [{ key: 'id', header: 'id' }]);
    });
    expect(stripAnsi(captured.stderr)).toContain('1 of 42 records');
  });

  test('uses entityLabel when provided for nicer pluralization', () => {
    const captured = captureStdio(() => {
      renderListResult({ data: [{ id: 'a' }], total: 1 }, [{ key: 'id', header: 'id' }], {
        entityLabel: 'execution',
      });
    });
    expect(stripAnsi(captured.stderr)).toContain('1 execution');
  });

  test('renders "(no rows)" when payload has no data array', () => {
    // All server list endpoints return `{ data, total }`; a payload missing
    // `data` is treated as empty rather than a bare array.
    const captured = captureStdio(() => {
      renderListResult({}, [{ key: 'id', header: 'id' }]);
    });
    expect(stripAnsi(captured.stdout).trim()).toBe('(no rows)');
    expect(captured.stderr).toBe('');
  });

  test('renders "(no rows)" with no stderr hint for empty results', () => {
    const captured = captureStdio(() => {
      renderListResult({ data: [], total: 0 }, [{ key: 'id', header: 'id' }]);
    });
    expect(stripAnsi(captured.stdout).trim()).toBe('(no rows)');
    expect(captured.stderr).toBe('');
  });
});

describe('intArg', () => {
  test('accepts whole numbers and rejects partial or non-numeric values', () => {
    expect(intArg('42')).toBe(42);
    expect(intArg('-1')).toBe(-1);
    expect(() => intArg('5min')).toThrow('Expected a whole number');
    expect(() => intArg('abc')).toThrow('Expected a whole number');
  });
});

describe('formatDuration', () => {
  test.each([
    [null, ''],
    [undefined, ''],
    [42, '42ms'],
    [1500, '1.5s'],
    [123_000, '2m3s'],
  ])('formatDuration(%p) === %p', (input, expected) => {
    expect(formatDuration(input as number | null | undefined)).toBe(expected);
  });
});

function stripAnsi(s: string): string {
  // ESLint warns about control-char regex literals; the strip is intentional here.
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
