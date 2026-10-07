import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';
const cli = resolve(import.meta.dir, '../../cli.ts');
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
test('CLI migration preserves source, writes nested v2 settings, refuses overwrite', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'parser-migration-'));
  dirs.push(dir);
  const input = join(dir, 'source.yaml');
  const output = join(dir, 'new.yaml');
  const source =
    'name: invoice\nsteps:\n  - name: parse\n    type: ai.parse\n    with:\n      input: "{{input.file}}"\n      parseMode: native-or-ocr\n      outputFormat: layout\n';
  writeFileSync(input, source);
  const args = [
    process.execPath,
    cli,
    'workflow',
    'migrate-parser',
    input,
    '--policy',
    'preserve',
    '--out',
    output,
    '--json',
  ];
  const proc = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe' });
  const summary = JSON.parse(await new Response(proc.stdout).text());
  expect(await proc.exited).toBe(0);
  expect(summary.migratedSteps).toEqual(['parse']);
  expect(readFileSync(input, 'utf8')).toBe(source);
  const step = parse(readFileSync(output, 'utf8')).steps[0];
  expect(step.type).toBe('ai.parse-v2');
  expect(step.with.policy.imageReading.order).toEqual(['ocr']);
  expect(step.with.output).toEqual({
    textFormat: 'plain',
    nativeWhitespace: 'spatial',
    require: [],
  });
  const contents = readFileSync(output, 'utf8');
  const again = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe' });
  await new Response(again.stderr).text();
  expect(await again.exited).not.toBe(0);
  expect(readFileSync(output, 'utf8')).toBe(contents);
});
test('CLI readiness reaches authenticated endpoint and preserves live-probe caveat', async () => {
  const captured: { auth: string | null; path: string }[] = [];
  const body = {
    imageReading: 'configured',
    providers: { ocr: null, vision: 'fixture' },
    liveProbe: false,
    warnings: [],
  };
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      captured.push({
        auth: request.headers.get('authorization'),
        path: new URL(request.url).pathname,
      });
      return Response.json(body);
    },
  });
  try {
    const proc = Bun.spawn([process.execPath, cli, 'models', 'parser-readiness', '--json'], {
      env: {
        ...process.env,
        EIGENPAL_API_KEY: 'eg_test',
        EIGENPAL_BASE_URL: `http://127.0.0.1:${server.port}`,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(JSON.parse(await new Response(proc.stdout).text())).toEqual(body);
    expect(await proc.exited).toBe(0);
    expect(captured[0]?.path).toBe('/v1/parsing/readiness');
    expect(captured[0]?.auth).toBe('Bearer eg_test');
  } finally {
    await server.stop(true);
  }
});
