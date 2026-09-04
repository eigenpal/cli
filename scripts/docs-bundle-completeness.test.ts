/**
 * Completeness gate for `eigenpal docs` bundled agent references.
 *
 * Ensures the committed docs bundle contains every authoritative reference
 * topic, generated schema fences, and step/evaluator coverage agents rely on.
 */

import { getAllStepJsonSchemas } from '@eigenpal/types';
import {
  AGENT_REFERENCE_TOPICS,
  SKILL_REFERENCE_GENERATIONS,
  renderDatasetArchiveReference,
  renderEvaluatorCatalog,
  renderStepCatalog,
} from '@eigenpal/types/docs';
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDocs, resolveDoc } from '../src/commands/docs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const cliDir = join(scriptDir, '..');
const referenceDir = join(cliDir, 'src', 'skill', 'reference');
const cliDocsDir = join(cliDir, 'docs');

describe('docs bundle completeness', () => {
  test('includes every canonical agent reference topic', () => {
    for (const topic of AGENT_REFERENCE_TOPICS) {
      expect(resolveDoc(topic).source).toBe('agent-reference');
    }
  });

  test('includes OpenAPI and representative public docs', () => {
    expect(resolveDoc('api-reference/openapi').source).toBe('api');
    expect(resolveDoc('steps/transform/script').source).toBe('public');
  });

  test('mirrors every CLI top-level command reference', () => {
    const cliDocs = readdirSync(cliDocsDir).filter((f) => f.endsWith('.md') && f !== 'surface.md');
    for (const file of cliDocs) {
      const topic = `reference/cli/${file.replace(/\.md$/, '')}`;
      expect(resolveDoc(topic).content.length).toBeGreaterThan(100);
    }
  });

  test('agent references carry generated schema fences', () => {
    for (const [file, blocks] of Object.entries(SKILL_REFERENCE_GENERATIONS)) {
      const path = join(referenceDir, file);
      expect(existsSync(path), `${file} must exist`).toBe(true);
      const body = readFileSync(path, 'utf8');
      for (const block of blocks) {
        expect(body).toContain(`<!-- GENERATED:${block} START -->`);
        expect(body).toContain(`<!-- GENERATED:${block} END -->`);
      }
    }
  });

  test('step-types reference matches live step catalog output', () => {
    const doc = resolveDoc('reference/step-types').content;
    const live = renderStepCatalog();
    expect(doc).toContain(live.trim().slice(0, 120));
    for (const step of getAllStepJsonSchemas()) {
      expect(doc).toContain(`\`${step.type}\``);
      expect(resolveDoc(`steps/${step.type.replace('.', '/')}`).source).toBe('public');
    }
    expect(doc).toContain('Complete machine-readable schemas');
  });

  test('evaluators reference documents exact-diff comparison knobs', () => {
    const doc = resolveDoc('reference/evaluators').content;
    const live = renderEvaluatorCatalog();
    expect(doc).toContain(live.trim().slice(0, 120));
    for (const field of ['order', 'items', 'matchBy', 'ignore']) {
      expect(doc).toContain(`\`${field}\``);
    }
    expect(doc).toContain('Complete machine-readable `evaluators.yaml` schema');
  });

  test('dataset-format reference is schema-generated', () => {
    const doc = resolveDoc('reference/dataset-format').content;
    expect(doc).toContain(renderDatasetArchiveReference().trim().slice(0, 80));
    expect(doc).toContain('DatasetMetaSchema');
    expect(doc).toContain('`$file`');
    expect(doc).toContain('Complete machine-readable component schemas');
  });

  test('workflow reference contains nested syntax and the complete schema', () => {
    const doc = resolveDoc('reference/workflow-yaml').content;
    expect(doc).toContain('Nested input property fields');
    expect(doc).toContain('Trigger method variants');
    expect(doc).toContain('Complete machine-readable workflow schema');
  });

  test('listDocs agent-reference filter returns core topics', () => {
    const refs = listDocs('reference/', 'agent-reference');
    for (const topic of AGENT_REFERENCE_TOPICS) {
      expect(refs.some((doc) => doc.topic === topic)).toBe(true);
    }
  });
});
