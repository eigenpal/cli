import { validateInput } from '@eigenpal/types';
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { validateAgentProject, validateDatasetDir } from './validation';

// Portable HTTP fixture; the Git integration tests cover real isolated compilation.
const compilerChild = Bun.spawn(
  [process.execPath, resolve(import.meta.dir, '../git/test-fixtures/compiler-server.ts')],
  { stdout: 'pipe', stderr: 'inherit' }
);
const reader = compilerChild.stdout.getReader();
const initial = await reader.read();
const compilerBase = 'http://127.0.0.1:' + new TextDecoder().decode(initial.value).trim();
reader.releaseLock();
afterAll(async () => {
  compilerChild.kill();
  await compilerChild.exited;
});
const config = { baseUrl: compilerBase, apiKey: 'eig_test_key', dir: '.' };
const definitions = new Map<string, Record<string, unknown>>();
function writeAgentSchema(dir: string, key: 'inputSchema' | 'outputSchema', schema: unknown) {
  const definition = { ...(definitions.get(dir) ?? { name: 'Schema fixture' }), [key]: schema };
  definitions.set(dir, definition);
  writeFileSync(
    join(dir, 'agent.ts'),
    "import {createAgent} from '@eigenpal/automations'; export default createAgent(" +
      JSON.stringify(definition) +
      ');'
  );
}

describe('agent local project validation', () => {
  test('accepts a TypeScript agent package', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eigenpal-agent-'));
    try {
      mkdirSync(join(dir, 'dataset', 'example-1'), { recursive: true });
      writeFileSync(
        join(dir, 'agent.ts'),
        "import {createAgent} from '@eigenpal/automations'; export default createAgent({name:'Test Agent'});"
      );
      writeFileSync(join(dir, 'AGENT.md'), 'Extract invoices.\n');

      await expect(validateAgentProject(dir)).resolves.toMatchObject({ valid: true });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('requires agent.ts even when a YAML manifest exists', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eigenpal-agent-yaml-'));
    try {
      writeFileSync(join(dir, 'eigenpal.yaml'), 'schemaVersion: 1\nname: Old agent\n');
      expect((await validateAgentProject(dir)).errors).toContain('Missing agent.ts');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('rejects legacy workflow and eval layout names', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eigenpal-agent-old-'));
    try {
      mkdirSync(join(dir, 'workflow'));
      mkdirSync(join(dir, 'eval'));
      const result = await validateAgentProject(dir);
      expect(result.valid).toBe(false);
      expect(result.errors.join('\n')).toContain('Legacy layout workflow/');
      expect(result.errors.join('\n')).toContain('Legacy layout eval/');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('dataset validator rejects old eval directory name', async () => {
    const root = mkdtempSync(join(tmpdir(), 'eigenpal-agent-dataset-'));
    const dir = join(root, 'eval');
    mkdirSync(dir);
    try {
      const result = await validateDatasetDir(dir);
      expect(result.valid).toBe(false);
      expect(result.errors.join('\n')).toContain('Use dataset/ instead of legacy eval/');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('agent dataset validation (canonical examples/ layout)', () => {
  function makeDataset(prefix: string): { root: string; datasetDir: string } {
    const root = mkdtempSync(join(tmpdir(), prefix));
    const datasetDir = join(root, 'dataset');
    mkdirSync(datasetDir, { recursive: true });
    writeFileSync(
      join(root, 'agent.ts'),
      `import {createAgent} from '@eigenpal/automations'; export default createAgent(${JSON.stringify({ name: 'Dataset fixture' })});`
    );
    return { root, datasetDir };
  }

  test('accepts a canonical dataset with $file refs and no expected.json', async () => {
    const { root, datasetDir } = makeDataset('eigenpal-ds-valid-');
    try {
      const example = join(datasetDir, 'examples', 'invoice-foo');
      mkdirSync(join(example, 'input'), { recursive: true });
      writeFileSync(
        join(example, 'input.json'),
        JSON.stringify({
          language: 'en',
          contract: [{ $file: 'input/Contract_2026.pdf' }, { $file: 'input/Appendix.pdf' }],
        })
      );
      writeFileSync(join(example, 'input', 'Contract_2026.pdf'), 'pdf');
      writeFileSync(join(example, 'input', 'Appendix.pdf'), 'pdf');

      await expect(validateDatasetDir(datasetDir, { agentDir: root, config })).resolves.toEqual({
        valid: true,
        errors: [],
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('accepts expected.json with expected/ $file refs and meta.json', async () => {
    const { root, datasetDir } = makeDataset('eigenpal-ds-expected-');
    try {
      const withFiles = join(datasetDir, 'examples', 'with-files');
      mkdirSync(join(withFiles, 'expected'), { recursive: true });
      writeFileSync(join(withFiles, 'input.json'), '{}');
      writeFileSync(
        join(withFiles, 'expected.json'),
        JSON.stringify({ invoiceNumber: 'INV-001', report: { $file: 'expected/Invoice.docx' } })
      );
      writeFileSync(join(withFiles, 'expected', 'Invoice.docx'), 'docx');
      writeFileSync(join(withFiles, 'meta.json'), JSON.stringify({ rowOrder: 1 }));

      await expect(validateDatasetDir(datasetDir, { agentDir: root, config })).resolves.toEqual({
        valid: true,
        errors: [],
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('rejects failure-expected ($error) examples — agent runs are only evaluated when completed', async () => {
    const { root, datasetDir } = makeDataset('eigenpal-ds-error-');
    try {
      const failure = join(datasetDir, 'examples', 'unsupported-format');
      mkdirSync(failure, { recursive: true });
      writeFileSync(join(failure, 'input.json'), '{}');
      writeFileSync(join(failure, 'expected.json'), JSON.stringify({ $error: { code: 422 } }));

      const result = await validateDatasetDir(datasetDir, { agentDir: root, config });
      expect(result.valid).toBe(false);
      const errors = result.errors.join('\n');
      expect(errors).toContain(
        'examples/unsupported-format/expected.json: failure-expected examples ({ "$error": ... }) are not supported for agent datasets'
      );
      expect(errors).toContain('evaluated only when they complete');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('rejects flat layout (example folders at the dataset root) with an examples/ hint', async () => {
    const { root, datasetDir } = makeDataset('eigenpal-ds-flat-');
    try {
      mkdirSync(join(datasetDir, 'invoice-foo'), { recursive: true });
      writeFileSync(join(datasetDir, 'invoice-foo', 'input.json'), '{}');

      const result = await validateDatasetDir(datasetDir, { agentDir: root, config });
      expect(result.valid).toBe(false);
      const errors = result.errors.join('\n');
      expect(errors).toContain('missing examples/ directory');
      expect(errors).toContain('invoice-foo');
      expect(errors).toContain('move them under examples/');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('rejects an unreferenced file under input/', async () => {
    const { root, datasetDir } = makeDataset('eigenpal-ds-unref-');
    try {
      const example = join(datasetDir, 'examples', 'foo');
      mkdirSync(join(example, 'input'), { recursive: true });
      writeFileSync(join(example, 'input.json'), '{}');
      writeFileSync(join(example, 'input', 'stray.pdf'), 'pdf');

      const result = await validateDatasetDir(datasetDir, { agentDir: root, config });
      expect(result.valid).toBe(false);
      expect(result.errors.join('\n')).toContain(
        'examples/foo/input/stray.pdf: file is not referenced from input.json'
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('rejects a $file ref to a missing file and path traversal refs', async () => {
    const { root, datasetDir } = makeDataset('eigenpal-ds-missing-');
    try {
      const example = join(datasetDir, 'examples', 'foo');
      mkdirSync(example, { recursive: true });
      writeFileSync(
        join(example, 'input.json'),
        JSON.stringify({
          contract: { $file: 'input/missing.pdf' },
          sneaky: { $file: 'input/../../etc/passwd' },
          outside: { $file: 'other/file.pdf' },
        })
      );

      const result = await validateDatasetDir(datasetDir, { agentDir: root, config });
      expect(result.valid).toBe(false);
      const errors = result.errors.join('\n');
      expect(errors).toContain(
        'examples/foo/input.json:contract: referenced file does not exist: input/missing.pdf'
      );
      expect(errors).toContain('examples/foo/input.json:sneaky: file reference must point inside');
      expect(errors).toContain('examples/foo/input.json:outside: file reference must point inside');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('rejects expected/ files without expected.json', async () => {
    const { root, datasetDir } = makeDataset('eigenpal-ds-orphan-');
    try {
      const example = join(datasetDir, 'examples', 'foo');
      mkdirSync(join(example, 'expected'), { recursive: true });
      writeFileSync(join(example, 'input.json'), '{}');
      writeFileSync(join(example, 'expected', 'orphan.pdf'), 'pdf');

      const result = await validateDatasetDir(datasetDir, { agentDir: root, config });
      expect(result.valid).toBe(false);
      expect(result.errors.join('\n')).toContain(
        'examples/foo/expected/orphan.pdf: file is not referenced from expected.json'
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('rejects a top-level manifest.json as the legacy dataset format', async () => {
    const { root, datasetDir } = makeDataset('eigenpal-ds-legacy-');
    try {
      writeFileSync(join(datasetDir, 'manifest.json'), '{}');
      mkdirSync(join(datasetDir, 'examples', 'foo'), { recursive: true });
      writeFileSync(join(datasetDir, 'examples', 'foo', 'input.json'), '{}');

      const result = await validateDatasetDir(datasetDir, { agentDir: root, config });
      expect(result.valid).toBe(false);
      expect(result.errors.join('\n')).toContain('legacy dataset format');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('rejects old workflow archive paths', async () => {
    const { root, datasetDir } = makeDataset('eigenpal-ds-old-paths-');
    try {
      const example = join(datasetDir, 'examples', 'foo');
      mkdirSync(join(example, 'input'), { recursive: true });
      mkdirSync(join(example, 'expected'), { recursive: true });
      writeFileSync(join(example, 'input.json'), '{}');
      writeFileSync(join(example, 'input', 'arguments.json'), '{}');
      writeFileSync(join(example, 'expected.json'), '{}');
      writeFileSync(join(example, 'expected', 'output.json'), '{}');
      writeFileSync(join(example, 'expected', 'error.json'), '{}');

      const result = await validateDatasetDir(datasetDir, { agentDir: root, config });
      expect(result.valid).toBe(false);
      const errors = result.errors.join('\n');
      expect(errors).toContain('examples/foo/input/arguments.json: legacy workflow archive path');
      expect(errors).toContain('examples/foo/expected/output.json: legacy workflow archive path');
      expect(errors).toContain('examples/foo/expected/error.json: legacy workflow archive path');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('rejects bad example folder names', async () => {
    const { root, datasetDir } = makeDataset('eigenpal-ds-badname-');
    try {
      mkdirSync(join(datasetDir, 'examples', 'Invoice-Foo'), { recursive: true });
      writeFileSync(join(datasetDir, 'examples', 'Invoice-Foo', 'input.json'), '{}');

      const result = await validateDatasetDir(datasetDir, { agentDir: root, config });
      expect(result.valid).toBe(false);
      expect(result.errors.join('\n')).toContain(
        'examples/Invoice-Foo: example folder name must be lowercase kebab/snake-case'
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('requires input.json to exist and be a JSON object', async () => {
    const { root, datasetDir } = makeDataset('eigenpal-ds-input-');
    try {
      mkdirSync(join(datasetDir, 'examples', 'missing'), { recursive: true });
      mkdirSync(join(datasetDir, 'examples', 'not-object'), { recursive: true });
      writeFileSync(join(datasetDir, 'examples', 'not-object', 'input.json'), '[1,2]');

      const result = await validateDatasetDir(datasetDir, { agentDir: root, config });
      expect(result.valid).toBe(false);
      const errors = result.errors.join('\n');
      expect(errors).toContain('examples/missing/input.json: input.json is required');
      expect(errors).toContain('examples/not-object/input.json: must be a JSON object');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('rejects $error examples alongside invalid meta.json', async () => {
    const { root, datasetDir } = makeDataset('eigenpal-ds-conflict-');
    try {
      const example = join(datasetDir, 'examples', 'foo');
      mkdirSync(join(example, 'expected'), { recursive: true });
      writeFileSync(join(example, 'input.json'), '{}');
      writeFileSync(join(example, 'expected.json'), JSON.stringify({ $error: { code: 422 } }));
      writeFileSync(join(example, 'expected', 'golden.pdf'), 'pdf');
      writeFileSync(join(example, 'meta.json'), JSON.stringify({ rowOrder: -1 }));

      const result = await validateDatasetDir(datasetDir, { agentDir: root, config });
      expect(result.valid).toBe(false);
      const errors = result.errors.join('\n');
      expect(errors).toContain('not supported for agent datasets');
      expect(errors).toContain('examples/foo/meta.json:rowOrder');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('schema-conformance check accepts $file values for file fields', async () => {
    const { root, datasetDir } = makeDataset('eigenpal-ds-schema-ok-');
    const agentDir = join(root, 'agent');
    try {
      mkdirSync(agentDir);
      writeAgentSchema(agentDir, 'inputSchema', {
        type: 'object',
        properties: {
          document: { type: 'string', 'x-eigenpal-type': 'file' },
          topic: { type: 'string' },
        },
        required: ['document', 'topic'],
      });
      const example = join(datasetDir, 'examples', 'foo');
      mkdirSync(join(example, 'input'), { recursive: true });
      writeFileSync(
        join(example, 'input.json'),
        JSON.stringify({ document: { $file: 'input/doc.pdf' }, topic: 'cats' })
      );
      writeFileSync(join(example, 'input', 'doc.pdf'), 'pdf');

      await expect(validateDatasetDir(datasetDir, { agentDir, config })).resolves.toEqual({
        valid: true,
        errors: [],
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('schema-conformance check flags mistyped non-file values but allows partial expected output', async () => {
    const { root, datasetDir } = makeDataset('eigenpal-ds-schema-bad-');
    const agentDir = join(root, 'agent');
    try {
      mkdirSync(agentDir);
      writeAgentSchema(agentDir, 'inputSchema', {
        type: 'object',
        properties: { topic: { type: 'string' } },
        required: ['topic'],
      });
      writeAgentSchema(agentDir, 'outputSchema', {
        type: 'object',
        properties: {
          topic: { type: 'string' },
          jokes: { type: 'array', items: { type: 'string' } },
        },
        required: ['topic', 'jokes'],
      });
      const example = join(datasetDir, 'examples', 'foo');
      mkdirSync(example, { recursive: true });
      writeFileSync(join(example, 'input.json'), '{"topic":123}');
      writeFileSync(join(example, 'expected.json'), '{"topic":"cats"}');

      const result = await validateDatasetDir(datasetDir, { agentDir, config });
      expect(result.valid).toBe(false);
      expect(result.errors.join('\n')).toContain('examples/foo/input.json/topic: must be string');
      expect(result.errors.join('\n')).not.toContain('expected.json');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('input schema check validates the full input object: required fields enforced, unknown keys allowed by default', async () => {
    const { root, datasetDir } = makeDataset('eigenpal-ds-schema-full-');
    const agentDir = join(root, 'agent');
    try {
      mkdirSync(agentDir);
      writeAgentSchema(agentDir, 'inputSchema', {
        type: 'object',
        properties: {
          document: { type: 'string', 'x-eigenpal-type': 'file' },
          topic: { type: 'string' },
        },
        required: ['document', 'topic'],
      });

      const empty = join(datasetDir, 'examples', 'empty-input');
      mkdirSync(empty, { recursive: true });
      writeFileSync(join(empty, 'input.json'), '{}');

      const misspelled = join(datasetDir, 'examples', 'misspelled-key');
      mkdirSync(join(misspelled, 'input'), { recursive: true });
      writeFileSync(
        join(misspelled, 'input.json'),
        JSON.stringify({ document: { $file: 'input/doc.pdf' }, topik: 'cats' })
      );
      writeFileSync(join(misspelled, 'input', 'doc.pdf'), 'pdf');

      const result = await validateDatasetDir(datasetDir, { agentDir, config });
      expect(result.valid).toBe(false);
      const errors = result.errors.join('\n');
      expect(errors).toContain(
        "examples/empty-input/input.json: must have required property 'document'"
      );
      expect(errors).toContain(
        "examples/empty-input/input.json: must have required property 'topic'"
      );
      // The schema does not set `additionalProperties: false`, so the extra
      // `topik` key is allowed — matching run-start validation, which compiles
      // the authored schema unchanged. Only the missing required field errors.
      expect(errors).not.toContain('extra field not in schema');
      expect(errors).toContain(
        "examples/misspelled-key/input.json: must have required property 'topic'"
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // Parity: the CLI dataset validator must agree with run-start validation
  // (`validateInput` in @eigenpal/types, which compiles the authored schema
  // unchanged) on whether an input carrying an extra key is accepted, for
  // every `additionalProperties` authoring choice.
  const additionalPropertiesParityCases: Array<{
    label: string;
    additionalProperties: boolean | undefined;
    accepted: boolean;
  }> = [
    { label: 'omitted', additionalProperties: undefined, accepted: true },
    { label: 'true', additionalProperties: true, accepted: true },
    { label: 'false', additionalProperties: false, accepted: false },
  ];

  for (const { label, additionalProperties, accepted } of additionalPropertiesParityCases) {
    test(`additionalProperties ${label}: CLI validator matches runtime validation for an extra key`, async () => {
      const schema: Record<string, unknown> = {
        type: 'object',
        properties: { topic: { type: 'string' } },
        required: ['topic'],
        ...(additionalProperties === undefined ? {} : { additionalProperties }),
      };
      const input = { topic: 'cats', extra: 1 };

      // Runtime run-start semantics: authored schema compiled unchanged.
      const runtime = validateInput(input, schema);
      expect(runtime.ok).toBe(accepted);

      // CLI dataset validation of the same input against the same schema.
      const { root, datasetDir } = makeDataset(`eigenpal-ds-parity-${label}-`);
      const agentDir = join(root, 'agent');
      try {
        mkdirSync(agentDir);
        writeAgentSchema(agentDir, 'inputSchema', schema);
        const example = join(datasetDir, 'examples', 'foo');
        mkdirSync(example, { recursive: true });
        writeFileSync(join(example, 'input.json'), JSON.stringify(input));

        const result = await validateDatasetDir(datasetDir, { agentDir, config });
        expect(result.valid).toBe(accepted);
        if (!accepted) {
          expect(result.errors.join('\n')).toContain(
            'examples/foo/input.json/extra: extra field not in schema'
          );
        }
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }

  test('input schema check flags a $file ref placed in a non-file field', async () => {
    const { root, datasetDir } = makeDataset('eigenpal-ds-schema-fileref-');
    const agentDir = join(root, 'agent');
    try {
      mkdirSync(agentDir);
      writeAgentSchema(agentDir, 'inputSchema', {
        type: 'object',
        properties: { topic: { type: 'string' } },
        required: ['topic'],
      });
      const example = join(datasetDir, 'examples', 'foo');
      mkdirSync(join(example, 'input'), { recursive: true });
      writeFileSync(
        join(example, 'input.json'),
        JSON.stringify({ topic: { $file: 'input/doc.pdf' } })
      );
      writeFileSync(join(example, 'input', 'doc.pdf'), 'pdf');

      const result = await validateDatasetDir(datasetDir, { agentDir, config });
      expect(result.valid).toBe(false);
      expect(result.errors.join('\n')).toContain('examples/foo/input.json/topic: must be string');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('input schema check accepts arrays of $file refs for array file fields', async () => {
    const { root, datasetDir } = makeDataset('eigenpal-ds-schema-filearr-');
    const agentDir = join(root, 'agent');
    try {
      mkdirSync(agentDir);
      writeAgentSchema(agentDir, 'inputSchema', {
        type: 'object',
        properties: {
          contracts: { type: 'array', items: { type: 'string', 'x-eigenpal-type': 'file' } },
        },
        required: ['contracts'],
      });
      const example = join(datasetDir, 'examples', 'foo');
      mkdirSync(join(example, 'input'), { recursive: true });
      writeFileSync(
        join(example, 'input.json'),
        JSON.stringify({ contracts: [{ $file: 'input/a.pdf' }, { $file: 'input/b.pdf' }] })
      );
      writeFileSync(join(example, 'input', 'a.pdf'), 'pdf');
      writeFileSync(join(example, 'input', 'b.pdf'), 'pdf');

      await expect(validateDatasetDir(datasetDir, { agentDir, config })).resolves.toEqual({
        valid: true,
        errors: [],
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
