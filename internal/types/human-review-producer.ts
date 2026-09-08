import type { HumanReviewFieldMetadata, HumanReviewResolvedRequest } from './human-review';
import {
  dottedPathToJsonPointer,
  stripGroundingMetadata,
  type FieldGrounding,
  type GroundingConfidence,
} from './processor/grounding';

export const HUMAN_REVIEW_METADATA_FROM = ['ai.extract'] as const;
export type HumanReviewMetadataFrom = (typeof HUMAN_REVIEW_METADATA_FROM)[number];

const GROUNDING_RESERVED_KEYS = new Set(['_degraded', '_reason']);
const WHOLE_STEP_OUTPUT_RE = /^\{\{\s*steps\.([A-Za-z0-9_-]+)\.output\s*\}\}$/;
const CATEGORICAL_CONFIDENCE = new Set<GroundingConfidence>(['low', 'medium', 'high']);

interface StepLike {
  name?: unknown;
  type?: unknown;
  with?: unknown;
  [key: string]: unknown;
}

function* iterateSteps(steps: unknown): Iterable<StepLike> {
  if (!Array.isArray(steps)) return;
  for (const raw of steps) {
    if (!raw || typeof raw !== 'object') continue;
    const step = raw as StepLike;
    yield step;
    for (const value of Object.values(step)) {
      if (!Array.isArray(value)) continue;
      for (const item of value) {
        if (!item || typeof item !== 'object') continue;
        const obj = item as Record<string, unknown>;
        if ('type' in obj) yield* iterateSteps([obj]);
        else if (Array.isArray(obj.steps)) yield* iterateSteps(obj.steps);
      }
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isFieldGrounding(value: unknown): value is FieldGrounding {
  const record = asRecord(value);
  if (!record) return false;
  return (
    typeof record.confidence === 'string' &&
    CATEGORICAL_CONFIDENCE.has(record.confidence as GroundingConfidence)
  );
}

function mergeFieldMetadata(
  derived: Record<string, HumanReviewFieldMetadata>,
  authored: Record<string, HumanReviewFieldMetadata>
): Record<string, HumanReviewFieldMetadata> {
  const merged: Record<string, HumanReviewFieldMetadata> = { ...derived };
  for (const [path, meta] of Object.entries(authored)) {
    merged[path] = { ...merged[path], ...meta };
  }
  return merged;
}

/**
 * Strip `_grounding` from a JSON Schema object when it was copied from an
 * extract output schema. Extract *config* schemas never include `_grounding`;
 * authoring-time output schemas do.
 */
export function stripGroundingFromJsonSchema(schema: unknown): unknown {
  const record = asRecord(schema);
  if (!record) return schema;
  const properties = asRecord(record.properties);
  if (!properties || !('_grounding' in properties)) return schema;
  const rest = { ...properties };
  delete rest._grounding;
  const required = Array.isArray(record.required)
    ? record.required.filter((item) => item !== '_grounding')
    : record.required;
  return { ...record, properties: rest, ...(required !== undefined ? { required } : {}) };
}

export function fieldMetadataFromAiExtractGrounding(
  data: Record<string, unknown> | unknown[]
): Record<string, HumanReviewFieldMetadata> {
  const root = asRecord(data);
  const grounding = asRecord(root?._grounding);
  if (!grounding) return {};

  const derived: Record<string, HumanReviewFieldMetadata> = {};
  for (const [key, entry] of Object.entries(grounding)) {
    if (GROUNDING_RESERVED_KEYS.has(key) || key.startsWith('_')) continue;
    if (!isFieldGrounding(entry)) continue;
    const path = dottedPathToJsonPointer(key);
    const display: Record<string, unknown> = {};
    if (entry.source_span) display.source_span = entry.source_span;
    if (entry.citations?.length) display.citations = entry.citations;
    if (entry.quote) display.quote = entry.quote;
    derived[path] = {
      confidence: entry.confidence,
      ...(Object.keys(display).length > 0 ? { display } : {}),
    };
  }
  return derived;
}

/**
 * Producer adapter for `metadataFrom: ai.extract`.
 *
 * Strips reserved `_grounding` from review data, derives categorical field
 * confidence (never numeric scores), and leaves authored fieldMetadata on top.
 * Does nothing unless the caller opted in.
 */
export function applyAiExtractReviewAdapter(input: {
  data: Record<string, unknown> | unknown[];
  fieldMetadata?: Record<string, HumanReviewFieldMetadata>;
  schema?: unknown;
}): {
  data: Record<string, unknown> | unknown[];
  fieldMetadata: Record<string, HumanReviewFieldMetadata>;
  schema?: unknown;
} {
  const derived = fieldMetadataFromAiExtractGrounding(input.data);
  const stripped = stripGroundingMetadata(input.data) as Record<string, unknown> | unknown[];
  return {
    data: stripped,
    fieldMetadata: mergeFieldMetadata(derived, input.fieldMetadata ?? {}),
    schema: input.schema !== undefined ? stripGroundingFromJsonSchema(input.schema) : undefined,
  };
}

/**
 * Direct `{{ steps.<name>.output }}` only — filters, interpolations, and nested
 * paths are not "safe" schema reuse.
 */
export function wholeStepOutputRef(dataTemplate: unknown): string | undefined {
  if (typeof dataTemplate !== 'string') return undefined;
  const match = dataTemplate.trim().match(WHOLE_STEP_OUTPUT_RE);
  return match?.[1];
}

export function inferAiExtractSchemaFromWorkflow(
  dataTemplate: unknown,
  workflow: { steps?: unknown[] } | undefined
): unknown | undefined {
  const stepName = wholeStepOutputRef(dataTemplate);
  if (!stepName || !workflow) return undefined;
  for (const step of iterateSteps(workflow.steps)) {
    if (step.name !== stepName) continue;
    if (step.type !== 'ai.extract') return undefined;
    const schema = asRecord(step.with)?.schema;
    return schema && typeof schema === 'object' ? schema : undefined;
  }
  return undefined;
}

export function applyHumanReviewProducerAdapter(
  request: HumanReviewResolvedRequest,
  options: {
    dataTemplate?: unknown;
    workflow?: { steps?: unknown[] };
  } = {}
): HumanReviewResolvedRequest {
  if (request.metadataFrom !== 'ai.extract') return request;

  const adapted = applyAiExtractReviewAdapter({
    data: request.data,
    fieldMetadata: request.fieldMetadata,
    schema:
      request.schema ?? inferAiExtractSchemaFromWorkflow(options.dataTemplate, options.workflow),
  });

  return {
    ...request,
    data: adapted.data,
    fieldMetadata: adapted.fieldMetadata,
    ...(adapted.schema !== undefined
      ? { schema: adapted.schema as HumanReviewResolvedRequest['schema'] }
      : {}),
  };
}
