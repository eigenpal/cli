import {
  decodeHumanReviewJsonPointer,
  inferAiExtractSchemaFromWorkflow,
  type WorkflowDefinition,
} from '@eigenpal/types';
import type { ValidationIssue } from './parser';

// Return undefined when a schema cannot prove whether the selector addresses a
// scalar. Runtime validation remains authoritative for unions, open objects,
// references, optional values and arrays that may be empty.
function canSelectScalar(schema: unknown, segments: string[]): boolean | undefined {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return undefined;
  const s = schema as Record<string, unknown>;
  if (s.$ref || s.anyOf || s.oneOf || s.allOf) return undefined;
  const types = Array.isArray(s.type) ? s.type : [s.type];
  if (types.length > 1) return undefined;
  if (segments.length === 0) {
    if (
      types.some((type) =>
        ['string', 'number', 'integer', 'boolean', 'null'].includes(String(type))
      )
    )
      return true;
    return types.includes('object') || types.includes('array') ? false : undefined;
  }
  const [head, ...rest] = segments;
  if (types.includes('array')) {
    if (head !== '*' && !/^(0|[1-9]\d*)$/.test(head)) return false;
    return canSelectScalar(s.items, rest);
  }
  if (types.includes('object') || s.properties) {
    const properties = (s.properties ?? {}) as Record<string, unknown>;
    if (head === '*') {
      const matches = Object.values(properties).map((value) => canSelectScalar(value, rest));
      if (matches.includes(true)) return true;
      if (matches.includes(undefined) || s.additionalProperties !== false) return undefined;
      return false;
    }
    if (Object.hasOwn(properties, head)) return canSelectScalar(properties[head], rest);
    return s.additionalProperties === false ? false : undefined;
  }
  return types.some((type) =>
    ['string', 'number', 'integer', 'boolean', 'null'].includes(String(type))
  )
    ? false
    : undefined;
}

/** Check only selectors whose shape is statically known. Never fabricate example data. */
export function validateReviewSelectors(definition: WorkflowDefinition): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  definition.steps.forEach((step, index) => {
    if (step.type !== 'control.human_review') return;
    const config = step.with as Record<string, unknown>;
    const schema =
      config.schema ??
      (config.metadataFrom === 'ai.extract'
        ? inferAiExtractSchemaFromWorkflow(config.data, definition)
        : undefined);
    const selection = config.selection as Record<string, unknown> | undefined;
    if (!schema || !selection) return;
    const selectors: Array<{ path: (string | number)[]; selector: string }> = [];
    for (const key of ['include', 'exclude']) {
      const values = selection[key];
      if (Array.isArray(values))
        values.forEach((selector, i) => {
          if (typeof selector === 'string') selectors.push({ path: [key, i], selector });
        });
    }
    if (selection.fields && typeof selection.fields === 'object') {
      for (const selector of Object.keys(selection.fields))
        selectors.push({ path: ['fields', selector], selector });
    }
    for (const { path, selector } of selectors) {
      if (selector.includes('{{') || selector.includes('{%')) continue;
      if (canSelectScalar(schema, decodeHumanReviewJsonPointer(selector)) === false)
        issues.push({
          path: ['steps', index, 'with', 'selection', ...path],
          code: 'human-review-selector-not-scalar',
          message: `Review selector "${selector}" cannot select a scalar field in the review schema. Select array items with /* or nested scalar fields; containers are not review fields.`,
        });
    }
  });
  return issues;
}
