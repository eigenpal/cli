import {
  WorkflowDefinitionSchema,
  getStepSchema,
  type Step,
  type WorkflowDefinition,
} from '@eigenpal/types';
import { parse as parseYaml } from 'yaml';
import { upgradeWorkflow } from './upgrades';

/** Validation error details */
export interface ValidationIssue {
  path: (string | number)[];
  message: string;
  code?: string;
}

/**
 * Error thrown when YAML parsing fails
 */
export class YamlParseError extends Error {
  constructor(
    message: string,
    public readonly line?: number,
    public readonly column?: number
  ) {
    super(message);
    this.name = 'YamlParseError';
  }
}

/**
 * Error thrown when workflow validation fails
 */
export class WorkflowValidationError extends Error {
  constructor(
    message: string,
    public readonly errors: ValidationIssue[]
  ) {
    super(message);
    this.name = 'WorkflowValidationError';
  }
}

/**
 * Result of parsing a workflow YAML
 */
export interface ParseResult {
  /** Whether parsing succeeded */
  success: boolean;
  /** Parsed workflow definition (if success) */
  definition?: WorkflowDefinition;
  /** Error message (if failed) */
  error?: string;
  /** Detailed validation errors (if validation failed) */
  validationErrors?: ValidationIssue[];
}

/**
 * Parse YAML string into a WorkflowDefinition
 *
 * @param yaml - YAML string to parse
 * @returns Parsed and validated WorkflowDefinition
 * @throws YamlParseError if YAML syntax is invalid
 * @throws WorkflowValidationError if workflow structure is invalid
 */
export function parseWorkflow(yaml: string): WorkflowDefinition {
  // Parse YAML
  let parsed: unknown;
  try {
    parsed = parseYaml(yaml);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new YamlParseError(`Invalid YAML: ${message}`);
  }

  // Apply upgrades to convert legacy formats
  const upgraded = upgradeWorkflow(parsed as Record<string, unknown>);

  // Validate against schema
  const result = WorkflowDefinitionSchema.safeParse(upgraded);

  if (!result.success) {
    const validationIssues: ValidationIssue[] = result.error.issues.map((e) => ({
      path: e.path.filter((p): p is string | number => typeof p !== 'symbol'),
      message: e.message,
      code: e.code,
    }));
    const errorMessages = validationIssues
      .map((e) => `${e.path.join('.')}: ${e.message}`)
      .join('; ');
    throw new WorkflowValidationError(
      `Invalid workflow definition: ${errorMessages}`,
      validationIssues
    );
  }

  // Per-step config validation: the base WorkflowDefinitionSchema only
  // validates the step envelope (`name`, `type`, `with: Record`). For step
  // types with `configInWith: true` (ai.*, transform.*, action.*) the
  // per-type config schema (e.g. AiClassifyConfigSchema.labels.min(2)) is
  // never enforced at push time — only at runtime by the worker, which
  // means a malformed workflow can be pushed and only fails when invoked.
  // Run the per-step schemas here so push-time catches what runtime would.
  const configIssues = validateStepConfigsRecursive(result.data.steps, ['steps']);
  if (configIssues.length > 0) {
    const errorMessages = configIssues.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
    throw new WorkflowValidationError(
      `Invalid workflow definition: ${errorMessages}`,
      configIssues
    );
  }

  return result.data;
}

/**
 * Walk every step (and nested step) in the workflow and validate its
 * config against the registered per-type schema.
 *
 * `configInWith: true` steps store their config under `step.with`, so we
 * safeParse `step.with` against the type's `configSchema`. `configInWith:
 * false` steps put their fields at the step root and are already validated
 * by the discriminated-union step schema (`FailStepSchema`, `IfStepSchema`,
 * etc.) — we skip them here to avoid double-validating BaseStep fields.
 */
function validateStepConfigsRecursive(
  steps: Step[],
  pathPrefix: (string | number)[]
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const stepPath: (string | number)[] = [...pathPrefix, i];

    const schemaDef = getStepSchema(step.type);
    if (schemaDef?.configInWith) {
      const cfg = (step as { with?: unknown }).with ?? {};
      const cfgResult = schemaDef.configSchema.safeParse(cfg);
      if (!cfgResult.success) {
        for (const err of cfgResult.error.issues) {
          issues.push({
            path: [
              ...stepPath,
              'with',
              ...err.path.filter((p): p is string | number => typeof p !== 'symbol'),
            ],
            message: err.message,
            code: err.code,
          });
        }
      }
    }

    // Recurse into nested steps for control-flow types. The discriminated
    // union exposes these as direct properties on the step; we widen with
    // a structural check to avoid coupling this helper to every future
    // control-flow variant.
    const anyStep = step as Step & {
      then?: Step[];
      else?: Step[];
      steps?: Step[];
      default?: Step[];
      branches?: Array<{ name: string; steps: Step[] }>;
      cases?: Array<{ steps: Step[] }>;
    };
    if (Array.isArray(anyStep.then)) {
      issues.push(...validateStepConfigsRecursive(anyStep.then, [...stepPath, 'then']));
    }
    if (Array.isArray(anyStep.else)) {
      issues.push(...validateStepConfigsRecursive(anyStep.else, [...stepPath, 'else']));
    }
    if (Array.isArray(anyStep.steps)) {
      issues.push(...validateStepConfigsRecursive(anyStep.steps, [...stepPath, 'steps']));
    }
    if (Array.isArray(anyStep.default)) {
      issues.push(...validateStepConfigsRecursive(anyStep.default, [...stepPath, 'default']));
    }
    if (Array.isArray(anyStep.cases)) {
      for (let j = 0; j < anyStep.cases.length; j++) {
        issues.push(
          ...validateStepConfigsRecursive(anyStep.cases[j].steps, [
            ...stepPath,
            'cases',
            j,
            'steps',
          ])
        );
      }
    }
    if (Array.isArray(anyStep.branches)) {
      for (let j = 0; j < anyStep.branches.length; j++) {
        issues.push(
          ...validateStepConfigsRecursive(anyStep.branches[j].steps, [
            ...stepPath,
            'branches',
            j,
            'steps',
          ])
        );
      }
    }
  }

  return issues;
}

/**
 * Try to parse YAML string, returning a result object instead of throwing
 *
 * @param yaml - YAML string to parse
 * @returns ParseResult with success status and either definition or error
 */
export function tryParseWorkflow(yaml: string): ParseResult {
  try {
    const definition = parseWorkflow(yaml);
    return { success: true, definition };
  } catch (err) {
    if (err instanceof YamlParseError) {
      return { success: false, error: err.message };
    }
    if (err instanceof WorkflowValidationError) {
      return {
        success: false,
        error: err.message,
        validationErrors: err.errors,
      };
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Validate a parsed object against the workflow schema
 *
 * @param obj - Object to validate
 * @returns Validation result
 */
export function validateWorkflow(obj: unknown): ParseResult {
  // Apply upgrades to convert legacy formats
  const upgraded = upgradeWorkflow(obj as Record<string, unknown>);

  const result = WorkflowDefinitionSchema.safeParse(upgraded);

  if (!result.success) {
    const validationIssues: ValidationIssue[] = result.error.issues.map((e) => ({
      path: e.path.filter((p): p is string | number => typeof p !== 'symbol'),
      message: e.message,
      code: e.code,
    }));
    const errorMessages = validationIssues
      .map((e) => `${e.path.join('.')}: ${e.message}`)
      .join('; ');
    return {
      success: false,
      error: `Invalid workflow definition: ${errorMessages}`,
      validationErrors: validationIssues,
    };
  }

  const configIssues = validateStepConfigsRecursive(result.data.steps, ['steps']);
  if (configIssues.length > 0) {
    const errorMessages = configIssues.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
    return {
      success: false,
      error: `Invalid workflow definition: ${errorMessages}`,
      validationErrors: configIssues,
    };
  }

  return { success: true, definition: result.data };
}
