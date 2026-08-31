/**
 * Shared override handling for workflow table rows.
 *
 * - If override has ALL required output fields and passes schema validation → use as full output (skip step).
 * - If override has only some fields or fails validation → run step, then deep-merge override onto step output.
 *
 * Used by: worker (executor), app (overrides edit sheet UI).
 */

import type { Step, StepType } from '@eigenpal/types';
import {
  ActionHttpOutputSchema,
  getRequiredOutputKeys,
  getStepOutputSchema,
  isOutputSchemaUnknown,
} from '@eigenpal/types';

/**
 * Deep-merge override into base. Only keys present in override are written; nested objects are merged recursively.
 * Safe: only plain objects are merged; arrays and primitives are replaced by override value.
 */
export function deepMerge(
  base: unknown,
  override: Record<string, unknown>
): Record<string, unknown> {
  if (base === null || base === undefined) {
    return { ...override };
  }
  if (typeof base !== 'object' || Array.isArray(base)) {
    return { ...override };
  }
  const baseObj = base as Record<string, unknown>;
  const result = { ...baseObj };
  for (const key of Object.keys(override)) {
    const ov = override[key];
    if (ov !== null && typeof ov === 'object' && !Array.isArray(ov)) {
      const baseVal = result[key];
      if (baseVal !== null && typeof baseVal === 'object' && !Array.isArray(baseVal)) {
        result[key] = deepMerge(baseVal, ov as Record<string, unknown>) as unknown;
      } else {
        result[key] = ov;
      }
    } else {
      result[key] = ov;
    }
  }
  return result;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

export interface ResolveStepOverrideResult {
  /** If true, skip the step and use validatedOutput as the step result */
  useAsFull: boolean;
  /** When useAsFull is true, the validated and parsed output to use */
  validatedOutput?: unknown;
}

/**
 * Resolve an override for a step: decide whether it is complete (skip step) or partial (run step + merge).
 * Uses Zod output schema when available; if schema is unknown (e.g. transform.script), always partial.
 *
 * @param expectedOutputKeys - When provided (e.g. block output keys from definition), use this as the
 *   required keys list instead of getRequiredOutputKeys(stepType). Use for control.block or when the
 *   caller knows the full set of output fields.
 */
export function resolveStepOverride(
  step: Step,
  override: unknown,
  expectedOutputKeys?: string[]
): ResolveStepOverrideResult {
  if (!isPlainObject(override)) {
    return { useAsFull: false };
  }

  const stepType = step.type as StepType;
  const schema = getStepOutputSchema(stepType);

  if ((!schema || isOutputSchemaUnknown(stepType)) && !expectedOutputKeys?.length) {
    return { useAsFull: false };
  }

  let parsedData: unknown = override;

  // action.http: allow minimal stub (e.g. { body: "" }) by filling default keys so we can skip the step
  if (stepType === 'action.http' && 'body' in override) {
    const normalized = {
      status: 200,
      statusText: 'OK',
      headers: (override.headers as Record<string, string>) ?? {},
      responseCharset: (override.responseCharset as string) ?? 'utf-8',
      ...override,
    };
    const parsed = ActionHttpOutputSchema.safeParse(normalized);
    if (parsed.success) {
      return { useAsFull: true, validatedOutput: parsed.data };
    }
  }

  if (schema) {
    const parseResult = schema.safeParse(override);
    if (parseResult.success) {
      parsedData = parseResult.data;
    } else if (!expectedOutputKeys?.length) {
      return { useAsFull: false };
    } else {
      parsedData = override as Record<string, unknown>;
    }
    // When expectedOutputKeys are provided, schema validation failure is non-fatal:
    // the data came from a real execution, so trust the caller's key list instead.
  }

  const requiredKeys =
    expectedOutputKeys && expectedOutputKeys.length > 0
      ? expectedOutputKeys
      : getRequiredOutputKeys(stepType);
  if (requiredKeys === null) {
    return { useAsFull: false };
  }

  // For ZodRecord schemas (e.g. control.block), getRequiredOutputKeys returns [] because any object
  // shape is valid. Without explicit expectedOutputKeys, we treat this as partial override since we
  // can't know what keys the step will actually produce at runtime.
  if (requiredKeys.length === 0 && !expectedOutputKeys?.length) {
    return { useAsFull: false };
  }

  const overrideKeys = new Set(Object.keys(override));
  const hasAllRequired = requiredKeys.every((k) => overrideKeys.has(k));
  if (!hasAllRequired) {
    return { useAsFull: false };
  }

  return {
    useAsFull: true,
    validatedOutput: parsedData,
  };
}

/**
 * Compute the override mode for UI display: will this step be skipped, partially overridden, or not overridden?
 * Uses the same logic as the worker (resolveStepOverride).
 *
 * @param expectedOutputKeys - When provided (e.g. known output fields for this step from schema/block def),
 *   use this to decide "all specified" so that full override shows as skipped.
 */
export function getStepOverrideMode(
  step: Step,
  override: unknown,
  expectedOutputKeys?: string[]
): 'skipped' | 'partial' | null {
  if (override === null || override === undefined) return null;
  if (!isPlainObject(override)) return null;
  if (Object.keys(override).length === 0) return null;

  const resolved = resolveStepOverride(step, override, expectedOutputKeys);
  return resolved.useAsFull ? 'skipped' : 'partial';
}
