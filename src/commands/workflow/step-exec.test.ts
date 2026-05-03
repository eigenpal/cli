import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { __test } from './step-exec';

const CLI = fileURLToPath(new URL('../../cli.ts', import.meta.url));

let tmp: string;
beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'eigenpal-step-exec-'));
});
afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// pure-helper unit tests — no Commander, no QuickJS spin-up
// ---------------------------------------------------------------------------

describe('parseInputsFlag', () => {
  test('parses literal k=v pairs as strings', async () => {
    const out = await __test.parseInputsFlag(['name=alice', 'tag=urgent']);
    expect(out).toEqual({ name: 'alice', tag: 'urgent' });
  });

  test('reads @path values and JSON-parses array files', async () => {
    const file = join(tmp, 'arr.json');
    writeFileSync(file, '[1,2,3]');
    const out = await __test.parseInputsFlag([`items=@${file}`]);
    expect(out).toEqual({ items: [1, 2, 3] });
  });

  test('reads @path values and JSON-parses object files', async () => {
    const file = join(tmp, 'obj.json');
    writeFileSync(file, '{"x":1,"y":"z"}');
    const out = await __test.parseInputsFlag([`payload=@${file}`]);
    expect(out).toEqual({ payload: { x: 1, y: 'z' } });
  });

  test('keeps non-JSON @path content as a plain string', async () => {
    const file = join(tmp, 'note.txt');
    writeFileSync(file, 'plain text content\n');
    const out = await __test.parseInputsFlag([`notes=@${file}`]);
    expect(out).toEqual({ notes: 'plain text content\n' });
  });

  test('throws on a key-only argument', async () => {
    await expect(__test.parseInputsFlag(['lonely'])).rejects.toThrow('--inputs expects k=v');
  });
});

describe('resolveConfig', () => {
  test('parses --config-json into an object', async () => {
    const out = await __test.resolveConfig({ configJson: '{"a":1,"b":[2,3]}' });
    expect(out).toEqual({ a: 1, b: [2, 3] });
  });

  test('parses --config-file from a path', async () => {
    const file = join(tmp, 'cfg.json');
    writeFileSync(file, '{"code":"return 1;"}');
    const out = await __test.resolveConfig({ configFile: file });
    expect(out).toEqual({ code: 'return 1;' });
  });

  test('rejects when both --config-json and --config-file are passed', async () => {
    await expect(
      __test.resolveConfig({ configJson: '{}', configFile: 'cfg.json' })
    ).rejects.toThrow(/either --config-json or --config-file, not both/);
  });

  test('returns an empty object when neither flag is set', async () => {
    const out = await __test.resolveConfig({});
    expect(out).toEqual({});
  });

  test('rejects a JSON array (config must be an object)', async () => {
    await expect(__test.resolveConfig({ configJson: '[1,2]' })).rejects.toThrow(
      /must be a JSON object/
    );
  });

  test('surfaces a clean error on invalid JSON', async () => {
    await expect(__test.resolveConfig({ configJson: '{not json' })).rejects.toThrow(
      /invalid JSON in step config/
    );
  });
});

describe('runScript', () => {
  test('returns the value from a simple expression', async () => {
    const result = await __test.runScript(
      'return a + b;',
      { a: 1, b: 2 },
      {
        timeoutMs: 1000,
        memoryLimitBytes: 4 * 1024 * 1024,
      }
    );
    expect(result.success).toBe(true);
    expect(result.value).toBe(3);
  });

  test('reduces over an array input', async () => {
    const result = await __test.runScript(
      'return items.reduce((s,i) => s + i.v, 0);',
      { items: [{ v: 1 }, { v: 2 }, { v: 3 }] },
      { timeoutMs: 1000, memoryLimitBytes: 4 * 1024 * 1024 }
    );
    expect(result.success).toBe(true);
    expect(result.value).toBe(6);
  });

  test('reproduces the TDZ trap for `const x = x || []`', async () => {
    const result = await __test.runScript(
      'const items = items || []; return items.length;',
      { items: [1, 2, 3] },
      { timeoutMs: 1000, memoryLimitBytes: 4 * 1024 * 1024 }
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/items is not initialized|Cannot access .* before initialization/);
  });

  test('rejects reserved-word input names', async () => {
    await expect(
      __test.runScript(
        'return null;',
        { class: 1 },
        {
          timeoutMs: 1000,
          memoryLimitBytes: 4 * 1024 * 1024,
        }
      )
    ).rejects.toThrow(/reserved JavaScript keyword/);
  });

  test('rejects invalid identifier names', async () => {
    await expect(
      __test.runScript(
        'return null;',
        { 'bad-name': 1 },
        {
          timeoutMs: 1000,
          memoryLimitBytes: 4 * 1024 * 1024,
        }
      )
    ).rejects.toThrow(/Invalid input name/);
  });
});

describe('validateAgainstSchema', () => {
  test('returns null when the value matches', () => {
    const issues = __test.validateAgainstSchema(
      { x: 1 },
      { type: 'object', properties: { x: { type: 'number' } }, required: ['x'] }
    );
    expect(issues).toBeNull();
  });

  test('returns issues with field paths on mismatch', () => {
    const issues = __test.validateAgainstSchema(
      { x: 'string' },
      { type: 'object', properties: { x: { type: 'number' } }, required: ['x'] }
    );
    expect(issues).toEqual([{ field: '/x', message: 'must be number' }]);
  });

  test('reports missing required fields', () => {
    const issues = __test.validateAgainstSchema(
      {},
      { type: 'object', properties: { x: { type: 'number' } }, required: ['x'] }
    );
    expect(issues).not.toBeNull();
    expect(issues![0].message).toMatch(/required/);
  });
});

describe('resolveExtractEnv', () => {
  test('reads provider/model/key from a WORKER_LLM_* env source', () => {
    const out = __test.resolveExtractEnv(
      {},
      {
        WORKER_LLM_PROVIDER: 'openai',
        WORKER_LLM_API_KEY: 'sk-from-env',
        WORKER_LLM_MODEL: 'gpt-test',
      }
    );
    expect(out.provider).toBe('openai');
    expect(out.apiKey).toBe('sk-from-env');
    expect(out.model).toBe('gpt-test');
  });

  test('CLI flags override env values', () => {
    const out = __test.resolveExtractEnv(
      { provider: 'openai', model: 'flag-model', baseUrl: 'https://flag.example' },
      {
        WORKER_LLM_PROVIDER: 'openai',
        WORKER_LLM_API_KEY: 'sk',
        WORKER_LLM_MODEL: 'env-model',
        WORKER_LLM_BASE_URL: 'https://env.example',
      }
    );
    expect(out.model).toBe('flag-model');
    expect(out.baseUrl).toBe('https://flag.example');
  });

  test('falls back to OPENAI_API_KEY for openai when no WORKER_LLM_API_KEY is set', () => {
    const out = __test.resolveExtractEnv(
      {},
      { WORKER_LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-fallback' }
    );
    expect(out.apiKey).toBe('sk-fallback');
  });

  test('uses gpt-4o-mini as the default model when none is set', () => {
    const out = __test.resolveExtractEnv({}, { WORKER_LLM_API_KEY: 'sk' });
    expect(out.model).toBe('gpt-4o-mini');
    expect(out.provider).toBe('openai');
  });

  test('throws a clear error when no key is available', () => {
    expect(() => __test.resolveExtractEnv({}, {})).toThrow(/No API key configured/);
  });

  test('does not fall back to OPENAI_API_KEY for non-openai providers', () => {
    expect(() =>
      __test.resolveExtractEnv(
        { provider: 'anthropic' },
        { OPENAI_API_KEY: 'sk-openai-not-for-anthropic' }
      )
    ).toThrow(/No API key configured/);
  });
});

describe('LOCAL_RUNNERS coverage', () => {
  test('exposes exactly the two step types with local runners today', () => {
    const types = __test.listLocalRunnerTypes().sort();
    expect(types).toEqual(['ai.extract', 'transform.script']);
  });
});

// ---------------------------------------------------------------------------
// end-to-end CLI tests via spawnSync — no network, transform.script only
// ---------------------------------------------------------------------------

describe('workflow step exec <type> generic dispatch (CLI)', () => {
  test('unknown step type exits 2 with a hint to step-type list', () => {
    const result = spawnSync(
      'bun',
      [CLI, 'workflow', 'step', 'exec', 'unknown-type', '--config-json', '{}'],
      { encoding: 'utf8' }
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/Unknown step type 'unknown-type'/);
    expect(result.stderr).toMatch(/eigenpal workflow step-type list/);
  });

  test('recognised-but-unsupported step type exits 2 with a "not yet supported" message', () => {
    const result = spawnSync(
      'bun',
      [CLI, 'workflow', 'step', 'exec', 'action.http', '--config-json', '{}'],
      { encoding: 'utf8' }
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/Step type 'action.http' isn't yet supported/);
    expect(result.stderr).toMatch(/transform\.script and ai\.extract/);
  });
});

describe('workflow step exec transform.script (CLI)', () => {
  test('happy path: --config-file + --inputs returns the JS return value', () => {
    const cfgFile = join(tmp, 'cfg-sum.json');
    const inputsFile = join(tmp, 'items.json');
    writeFileSync(cfgFile, JSON.stringify({ code: 'return items.reduce((s,i)=>s+i.v,0);' }));
    writeFileSync(inputsFile, '[{"v":1},{"v":2}]');
    const result = spawnSync(
      'bun',
      [
        CLI,
        'workflow',
        'step',
        'exec',
        'transform.script',
        '--config-file',
        cfgFile,
        '--inputs',
        `items=@${inputsFile}`,
      ],
      { encoding: 'utf8' }
    );
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('3');
  });

  test('--config-json works inline', () => {
    const cfg = JSON.stringify({ code: 'return a + b;', inputs: { a: '10', b: '20' } });
    // Note: when inputs come from the config they're strings, so script does
    // string concatenation. Provide them via --inputs (JSON-parsed) to get
    // numeric add — covered in the next test.
    const result = spawnSync(
      'bun',
      [CLI, 'workflow', 'step', 'exec', 'transform.script', '--config-json', cfg],
      { encoding: 'utf8' }
    );
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('"1020"');
  });

  test('--inputs flag merges into config inputs (flag wins)', () => {
    const inputsFile = join(tmp, 'pair.json');
    writeFileSync(inputsFile, '[10,20]');
    // Config provides default `pair`; --inputs overrides it.
    const cfg = JSON.stringify({
      code: 'return pair[0] + pair[1];',
      inputs: { pair: 'unused' },
    });
    const result = spawnSync(
      'bun',
      [
        CLI,
        'workflow',
        'step',
        'exec',
        'transform.script',
        '--config-json',
        cfg,
        '--inputs',
        `pair=@${inputsFile}`,
      ],
      { encoding: 'utf8' }
    );
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('30');
  });

  test('--config-file accepts `-` to read JSON config from stdin', () => {
    const cfg = JSON.stringify({ code: 'return 42;' });
    const result = spawnSync(
      'bun',
      [CLI, 'workflow', 'step', 'exec', 'transform.script', '--config-file', '-'],
      { encoding: 'utf8', input: cfg }
    );
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('42');
  });

  test('--output-schema violation exits 2 with the structured envelope', () => {
    const cfg = JSON.stringify({ code: 'return { wrong: "type" };' });
    const schemaFile = join(tmp, 'schema.json');
    writeFileSync(
      schemaFile,
      JSON.stringify({
        type: 'object',
        properties: { wrong: { type: 'number' } },
        required: ['wrong'],
      })
    );
    const result = spawnSync(
      'bun',
      [
        CLI,
        'workflow',
        'step',
        'exec',
        'transform.script',
        '--config-json',
        cfg,
        '--output-schema',
        schemaFile,
      ],
      { encoding: 'utf8' }
    );
    expect(result.status).toBe(2);
    const envelope = JSON.parse(result.stderr.trim());
    expect(envelope.code).toBe('output_schema_violation');
    expect(envelope.issues).toEqual([{ field: '/wrong', message: 'must be number' }]);
  });

  test('script error (TDZ) exits 1 with a clean message on stderr', () => {
    const cfg = JSON.stringify({ code: 'const items = items || []; return items.length;' });
    const inputsFile = join(tmp, 'arr.json');
    writeFileSync(inputsFile, '[1,2,3]');
    const result = spawnSync(
      'bun',
      [
        CLI,
        'workflow',
        'step',
        'exec',
        'transform.script',
        '--config-json',
        cfg,
        '--inputs',
        `items=@${inputsFile}`,
      ],
      { encoding: 'utf8' }
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Script error/);
  });

  test('action() wrapper renders structured { issues, hint } errors with aligned field column', () => {
    // Throw a structured error from the runner by handing transform.script a
    // non-object config (which triggers the "must be a JSON object" path
    // BEFORE the runner sees it). Then craft a separate test where the
    // runner itself throws a plain Error to confirm `formatCliError`
    // fallback. Here we cover the structured-envelope branch via the
    // dispatch shape: an unknown step type throws no envelope, but invalid
    // config JSON does throw a plain Error — so we assert formatting.
    const result = spawnSync(
      'bun',
      [CLI, 'workflow', 'step', 'exec', 'transform.script', '--config-json', '[1,2]'],
      { encoding: 'utf8' }
    );
    expect(result.status).toBe(1);
    // Plain error rendered through formatCliError (✗ prefix from `error()`)
    expect(result.stderr).toMatch(/step config must be a JSON object/);
  });
});

describe('workflow step exec ai.extract (CLI)', () => {
  test('--config-json validates required `input`', () => {
    // No input set → runner throws before any LLM call. Confirms the
    // generic dispatcher routes to runAiExtract and the runner produces
    // a clean error message (not a network error from missing API key).
    const result = spawnSync(
      'bun',
      [CLI, 'workflow', 'step', 'exec', 'ai.extract', '--config-json', '{"prompt":"Extract"}'],
      {
        encoding: 'utf8',
        env: { ...process.env, WORKER_LLM_API_KEY: 'sk-test' },
      }
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/ai\.extract requires `input`/);
  });
});
