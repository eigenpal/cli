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

export {
  collectLocalTemplateRefs,
  collectPinnedTemplateRevisionIds,
  collectPublishLocalTemplateIssues,
  type LocalTemplateRef,
} from './local-templates';

export { needsUpgrade, upgradeWorkflow } from './upgrades';

export { spliceWorkflowVersion, stripWorkflowVersion } from './version-field';

export { validateSchemaQuality, type SchemaQualityWarning } from './validate-quality';

// Re-export workflow types for convenience
export type { Step, TriggerMethod, TriggerType, WorkflowDefinition } from '@eigenpal/types';
