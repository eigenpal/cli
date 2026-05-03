/**
 * @eigenpal/workflow-yaml
 *
 * YAML parsing and validation for workflow definitions.
 */

export {
  WorkflowValidationError,
  YamlParseError,
  parseWorkflow,
  tryParseWorkflow,
  validateWorkflow,
  type ParseResult,
  type ValidationIssue,
} from './parser';

export { needsUpgrade, upgradeWorkflow } from './upgrades';

// Re-export workflow types for convenience
export type { Step, TriggerMethod, TriggerType, WorkflowDefinition } from '@eigenpal/types';
