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

  const deprecatedIssues = collectDeprecatedBlockIssues(upgraded);
  if (deprecatedIssues.length > 0) {
    const errorMessages = deprecatedIssues
      .map((e) => `${e.path.join('.')}: ${e.message}`)
      .join('; ');
    throw new WorkflowValidationError(
      `Invalid workflow definition: ${errorMessages}`,
      deprecatedIssues
    );
  }

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
function collectDeprecatedBlockIssues(definition: Record<string, unknown>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (definition.kind === 'block') {
    issues.push({
      path: ['kind'],
      message:
        'kind: block was removed. Define a regular workflow and invoke it with action.invoke-workflow (execution: inline).',
      code: 'deprecated_kind_block',
    });
  }

  function walkSteps(steps: unknown, pathPrefix: (string | number)[]) {
    if (!Array.isArray(steps)) return;
    for (let i = 0; i < steps.length; i++) {
      const raw = steps[i];
      if (!raw || typeof raw !== 'object') continue;
      const step = raw as Record<string, unknown>;
      const stepPath: (string | number)[] = [...pathPrefix, i];
      if (step.type === 'control.block') {
        issues.push({
          path: [...stepPath, 'type'],
          message:
            'control.block was removed. Use action.invoke-workflow with execution: inline and workflow set to the target name or wf_ id.',
          code: 'deprecated_control_block',
        });
      }
      for (const [key, value] of Object.entries(step)) {
        if (!Array.isArray(value)) continue;
        for (let j = 0; j < value.length; j++) {
          const item = value[j];
          if (!item || typeof item !== 'object') continue;
          const obj = item as Record<string, unknown>;
          if ('type' in obj) {
            walkSteps([obj], [...stepPath, key]);
          } else if (Array.isArray(obj.steps)) {
            walkSteps(obj.steps, [...stepPath, key, j, 'steps']);
          }
        }
      }
      if (Array.isArray(step.then)) walkSteps(step.then, [...stepPath, 'then']);
      if (Array.isArray(step.else)) walkSteps(step.else, [...stepPath, 'else']);
      if (Array.isArray(step.steps)) walkSteps(step.steps, [...stepPath, 'steps']);
      if (Array.isArray(step.default)) walkSteps(step.default, [...stepPath, 'default']);
      if (Array.isArray(step.cases)) {
        for (let j = 0; j < step.cases.length; j++) {
          const c = step.cases[j] as { steps?: unknown };
          if (Array.isArray(c?.steps)) {
            walkSteps(c.steps, [...stepPath, 'cases', j, 'steps']);
          }
        }
      }
      if (Array.isArray(step.branches)) {
        for (let j = 0; j < step.branches.length; j++) {
          const b = step.branches[j] as { steps?: unknown };
          if (Array.isArray(b?.steps)) {
            walkSteps(b.steps, [...stepPath, 'branches', j, 'steps']);
          }
        }
      }
    }
  }

  walkSteps(definition.steps, ['steps']);
  return issues;
}

function validateStepConfigsRecursive(
  steps: Step[],
  pathPrefix: (string | number)[]
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const stepPath: (string | number)[] = [...pathPrefix, i];

    if (step.type === 'control.block') {
      continue;
    }

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

  const deprecatedIssues = collectDeprecatedBlockIssues(upgraded);
  if (deprecatedIssues.length > 0) {
    const errorMessages = deprecatedIssues
      .map((e) => `${e.path.join('.')}: ${e.message}`)
      .join('; ');
    return {
      success: false,
      error: `Invalid workflow definition: ${errorMessages}`,
      validationErrors: deprecatedIssues,
    };
  }

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
