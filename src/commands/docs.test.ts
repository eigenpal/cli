import { AGENT_REFERENCE_TOPICS, getAllStepJsonSchemas } from '@eigenpal/types';
import { describe, expect, test } from 'bun:test';
import { listDocs, resolveDoc, searchDocs } from './docs';

describe('bundled CLI documentation', () => {
  test('contains every public page and detailed agent references', () => {
    expect(listDocs(undefined, 'public').length).toBeGreaterThan(50);
    expect(resolveDoc('steps/transform/script').content).toContain('transform.script');
    expect(resolveDoc('reference/evaluators').content).toContain('Path syntax:');
    expect(resolveDoc('api-reference/openapi').content).toContain('"openapi"');
  });

  test('includes all canonical agent reference topics', () => {
    for (const topic of AGENT_REFERENCE_TOPICS) {
      expect(() => resolveDoc(topic)).not.toThrow();
    }
  });

  test('step catalog in bundle covers every step type', () => {
    const content = resolveDoc('reference/step-types').content;
    for (const step of getAllStepJsonSchemas()) {
      expect(content).toContain(`\`${step.type}\``);
    }
  });

  test('search finds exact evaluator syntax', () => {
    const results = searchDocs('matchBy unordered', 10);
    expect(results.some((result) => result.topic === 'reference/evaluators')).toBe(true);
  });

  test('search finds dataset archive schema reference', () => {
    const results = searchDocs('DatasetMetaSchema $file', 10);
    expect(results.some((result) => result.topic === 'reference/dataset-format')).toBe(true);
  });

  test('accepts canonical docs URLs and unambiguous suffixes', () => {
    expect(resolveDoc('https://docs.eigenpal.com/guides/evaluate-workflow').topic).toBe(
      'guides/evaluate-workflow'
    );
    expect(resolveDoc('evaluators').topic).toBe('reference/evaluators');
    expect(resolveDoc('dataset-format').topic).toBe('reference/dataset-format');
  });
});
