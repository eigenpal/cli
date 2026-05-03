import { WorkflowDefinitionSchema, type WorkflowDefinition } from '@eigenpal/types';
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

  return result.data;
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

  return { success: true, definition: result.data };
}
