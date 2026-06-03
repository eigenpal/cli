import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateAgentProject, validateDatasetDir } from './validation';

describe('agent local project validation', () => {
  test('accepts Git-backed eigenpal.yaml package layout', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eigenpal-agent-'));
    try {
      mkdirSync(join(dir, 'dataset', 'example-1'), { recursive: true });
      writeFileSync(join(dir, 'eigenpal.yaml'), 'schemaVersion: 1\nname: Test Agent\n');
      writeFileSync(join(dir, 'AGENT.md'), 'Extract invoices.\n');

      await expect(validateAgentProject(dir)).resolves.toMatchObject({ valid: true });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('accepts valid input and output schema files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eigenpal-agent-schema-'));
    try {
      mkdirSync(join(dir, 'dataset', 'example-1'), { recursive: true });
      writeFileSync(join(dir, 'eigenpal.yaml'), 'schemaVersion: 1\nname: Test Agent\n');
      writeFileSync(join(dir, 'AGENT.md'), 'Extract invoices.\n');
      writeFileSync(
        join(dir, 'input-schema.json'),
        JSON.stringify({
          type: 'object',
          properties: {
            document: { type: 'string', 'x-eigenpal-type': 'file' },
            language: { type: 'string' },
          },
          required: ['document'],
        })
      );
      writeFileSync(
        join(dir, 'output-schema.json'),
        JSON.stringify({
          type: 'object',
          properties: {
            total: { type: 'number' },
            vendor: { type: ['string', 'null'] },
          },
          required: ['total', 'vendor'],
        })
      );

      await expect(validateAgentProject(dir)).resolves.toMatchObject({ valid: true });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('rejects invalid input and output schema files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eigenpal-agent-bad-schema-'));
    try {
      mkdirSync(join(dir, 'dataset', 'example-1'), { recursive: true });
      writeFileSync(join(dir, 'eigenpal.yaml'), 'schemaVersion: 1\nname: Test Agent\n');
      writeFileSync(join(dir, 'AGENT.md'), 'Extract invoices.\n');
      writeFileSync(join(dir, 'input-schema.json'), '{"type":"array"}');
      writeFileSync(
        join(dir, 'output-schema.json'),
        JSON.stringify({
          type: 'object',
          properties: {
            document: { type: 'string', 'x-eigenpal-type': 'image' },
          },
        })
      );

      const result = await validateAgentProject(dir);
      expect(result.valid).toBe(false);
      expect(result.errors.join('\n')).toContain('input-schema.json: Root "type" must be "object"');
      expect(result.errors.join('\n')).toContain(
        'output-schema.json: /properties/document: x-eigenpal-type must be "file" if present'
      );
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

  test('dataset validator accepts partial expected output against agent schemas', async () => {
    const root = mkdtempSync(join(tmpdir(), 'eigenpal-agent-dataset-valid-'));
    const agentDir = join(root, 'agent');
    const datasetDir = join(root, 'dataset');
    try {
      mkdirSync(join(datasetDir, 'cats-jokes'), { recursive: true });
      mkdirSync(agentDir);
      writeFileSync(
        join(agentDir, 'input-schema.json'),
        JSON.stringify({
          type: 'object',
          properties: {
            topic: { type: 'string' },
            count: { type: 'number' },
          },
          required: ['topic'],
        })
      );
      writeFileSync(
        join(agentDir, 'output-schema.json'),
        JSON.stringify({
          type: 'object',
          properties: {
            topic: { type: 'string' },
            jokes: { type: 'array', items: { type: 'string' } },
          },
          required: ['topic', 'jokes'],
        })
      );
      writeFileSync(join(datasetDir, 'cats-jokes', 'input.json'), '{"topic":"cats","count":3}');
      writeFileSync(join(datasetDir, 'cats-jokes', 'expected.json'), '{"topic":"cats"}');

      await expect(validateDatasetDir(datasetDir, { agentDir })).resolves.toMatchObject({
        valid: true,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('dataset validator rejects malformed inputs, expected fields, and goldens', async () => {
    const root = mkdtempSync(join(tmpdir(), 'eigenpal-agent-dataset-invalid-'));
    const agentDir = join(root, 'agent');
    const datasetDir = join(root, 'dataset');
    try {
      mkdirSync(join(datasetDir, 'bad-example', 'input'), { recursive: true });
      mkdirSync(join(datasetDir, 'bad-example', 'expected'), { recursive: true });
      mkdirSync(agentDir);
      writeFileSync(
        join(agentDir, 'input-schema.json'),
        JSON.stringify({
          type: 'object',
          properties: {
            document: { type: 'string', 'x-eigenpal-type': 'file' },
            topic: { type: 'string' },
          },
          required: ['document', 'topic'],
        })
      );
      writeFileSync(
        join(agentDir, 'output-schema.json'),
        JSON.stringify({
          type: 'object',
          properties: {
            topic: { type: 'string' },
            report: { type: 'string', 'x-eigenpal-type': 'file' },
          },
          required: ['topic', 'report'],
        })
      );
      writeFileSync(join(datasetDir, 'bad-example', 'input.json'), '{"topic":123,"extra":true}');
      writeFileSync(join(datasetDir, 'bad-example', 'input', 'other.pdf'), 'pdf');
      writeFileSync(join(datasetDir, 'bad-example', 'expected.json'), '{"unknown":true}');
      writeFileSync(join(datasetDir, 'bad-example', 'expected', 'orphan.pdf'), 'pdf');

      const result = await validateDatasetDir(datasetDir, { agentDir });
      expect(result.valid).toBe(false);
      const errors = result.errors.join('\n');
      expect(errors).toContain('missing file for "document"');
      expect(errors).toContain('input.json/topic: must be string');
      expect(errors).toContain('extra field "extra"');
      expect(errors).toContain('extra field "unknown"');
      expect(errors).toContain('extra golden file "orphan.pdf"');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
