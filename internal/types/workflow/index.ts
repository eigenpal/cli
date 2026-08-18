/**
 * Workflow Types
 *
 * YAML-based workflow definitions with sequential execution and control flow.
 */

// Step config schemas (single source of truth for step configurations)
export {
  // Action step schemas
  ActionHttpConfigSchema,
  ActionHttpOutputSchema,
  ActionInvokeWorkflowConfigSchema,
  ActionInvokeWorkflowOutputSchema,
  // AI step schemas
  AiExtractConfigSchema,
  AiExtractOutputSchema,
  AiParseConfigSchema,
  AiParseOutputSchema,
  // Control step schemas
  ControlFailConfigSchema,
  ControlFailOutputSchema,
  ControlForeachConfigSchema,
  ControlForeachOutputSchema,
  ControlIfConfigSchema,
  ControlIfOutputSchema,
  ControlParallelConfigSchema,
  ControlParallelMapConfigSchema,
  ControlParallelMapOutputSchema,
  ControlParallelOutputSchema,
  ControlWaitConfigSchema,
  ControlWaitOutputSchema,
  // Registry and utilities
  STEP_RETRY_CAPABILITIES,
  STEP_SCHEMAS,
  // Transform step schemas
  TransformCombineConfigSchema,
  TransformCombineOutputSchema,
  TransformMergeConfigSchema,
  TransformMergeOutputSchema,
  TransformRegexExtractConfigSchema,
  TransformRegexExtractOutputSchema,
  TransformRemoveConfigSchema,
  TransformRemoveOutputSchema,
  TransformScriptConfigSchema,
  TransformScriptOutputSchema,
  TransformSetConfigSchema,
  TransformSetOutputSchema,
  TransformSplitConfigSchema,
  TransformSplitOutputSchema,
  TransformTemplateConfigSchema,
  TransformTemplateOutputSchema,
  TransformTextChunkerConfigSchema,
  TransformTextChunkerOutputSchema,
  getAllStepJsonSchemas,
  getRequiredOutputKeys,
  getStepConfigSchema,
  getStepOutputSchema,
  getStepRetryCapability,
  getStepSchema,
  isOutputSchemaUnknown,
  listStepTypes,
  listStepTypesByCategory,
  validateStepConfig,
  type ActionHttpConfig,
  type ActionInvokeWorkflowConfig,
  // Types
  type AiExtractConfig,
  type AiExtractOutput,
  type AiParseConfig,
  type AiParseOutput,
  type ControlFailConfig,
  type ControlForeachConfig,
  type ControlIfConfig,
  type ControlParallelConfig,
  type ControlParallelMapConfig,
  type ControlWaitConfig,
  type StepCategory,
  type StepSchemaDefinition,
  type TransformCombineConfig,
  type TransformMergeConfig,
  type TransformRegexExtractConfig,
  type TransformRegexExtractOutput,
  type TransformRemoveConfig,
  type TransformScriptConfig,
  type TransformSetConfig,
  type TransformSplitConfig,
  type TransformTemplateConfig,
  type TransformTextChunkerConfig,
  type TransformTextChunkerOutput,
} from './step-configs';

// Action types
export { ACTION_TYPES, ActionTypeSchema, ActionTypeValue, type ActionType } from './actions';

// Step types
export {
  AIStepSchema,
  ActionStepSchema,
  FailStepSchema,
  ForeachStepSchema,
  HttpMethodSchema,
  IfStepSchema,
  LegacyBlockStepSchema,
  ParallelBranchSchema,
  ParallelMapStepSchema,
  ParallelStepSchema,
  STEP_TYPES,
  StepSchema,
  StepTypeSchema,
  StepTypeValue,
  SwitchStepSchema,
  TransformStepSchema,
  WaitStepSchema,
  isStepCategory,
  parseStepType,
  type AIStep,
  type ActionStep,
  type FailStep,
  type ForeachStep,
  type HttpMethod,
  type IfStep,
  type LegacyBlockStep,
  type ParallelBranch,
  type ParallelMapStep,
  type ParallelStep,
  type Step,
  type StepType,
  type SwitchCase,
  type SwitchStep,
  type TransformStep,
  type WaitStep,
} from './steps';

// Retry policies and structured failures
export {
  ExecutionFailureSchema,
  ResolvedRetryPolicySchema,
  RetryCategorySchema,
  RetryDecisionSchema,
  RetryPolicySourceSchema,
  RetryTerminalReasonSchema,
  StepRetryCapabilitySchema,
  StepRetryPolicySchema,
  WorkflowRetryPolicySchema,
  resolveRetryPolicy,
  type ExecutionFailure,
  type ResolvedRetryPolicy,
  type ResolvedRetryPolicyWithSource,
  type RetryCategory,
  type RetryDecision,
  type RetryPolicyCeilings,
  type RetryPolicySource,
  type RetryTerminalReason,
  type StepRetryCapability,
  type StepRetryPolicy,
  type WorkflowRetryPolicy,
} from './retry';

// Workflow types
export {
  // Trigger method schemas
  ApiTriggerMethodSchema,
  CreateWorkflowDefinitionSchema,
  EmailTriggerMethodSchema,
  ManualTriggerMethodSchema,
  StoredWorkflowDefinitionSchema,
  TriggerMethodSchema,
  TriggerMethodsSchema,
  TriggerTypeSchema,
  TriggerTypeValue,
  WORKFLOW_NAME_PATTERN,
  WorkflowDefinitionSchema,
  WorkflowInputDefSchema,
  WorkflowInputPropertySchema,
  WorkflowNameSchema,
  WorkflowSettingsSchema,
  // Trigger method helper functions
  getTriggerMethods,
  hasTriggerMethod,
  isManualTriggerEnabled,
  suggestWorkflowName,
  // Trigger method types
  type ApiTriggerMethod,
  type CreateWorkflowDefinition,
  type EmailTriggerMethod,
  type ManualTriggerMethod,
  type StoredWorkflowDefinition,
  type TriggerMethod,
  type TriggerMethods,
  type TriggerType,
  type WorkflowDefinition,
  type WorkflowInputDef,
  type WorkflowInputProperty,
  type WorkflowSettings,
} from './workflow';

// Expected output (per-example: data + expectedDocuments; optional expectedOutputFiles for inline docs)
export {
  ExpectedDocumentRefSchema,
  ExpectedDocumentsValueSchema,
  ExpectedOutputFilesSchema,
  ExpectedOutputSchema,
  type ExpectedDocumentRef,
  type ExpectedDocumentsValue,
  type ExpectedDocumentsValueArray,
  type ExpectedDocumentsValueRecord,
  type ExpectedOutput,
  type ExpectedOutputFiles,
} from './expected-output';

// Local meta.json and overrides schemas (workflows/<slug>/meta.json, eval/<example>/overrides.json, etc.)
export {
  EvalExampleMetaSchema,
  EvalOverridesSchema,
  TemplateMetaSchema,
  WorkflowMetaSchema,
  type EvalExampleMeta,
  type EvalOverrides,
  type TemplateMeta,
  type WorkflowMeta,
} from './local-meta';

// Workflow trigger config + per-alias reply config (shared between server and client)
export {
  aliasReplyConfigSchema,
  workflowTriggerConfigSchema,
  type AliasReplyConfig,
  type WorkflowTriggerConfig,
} from './email-trigger';

// transform.script function-shape helpers
export {
  SCRIPT_FN_MAX_BYTES,
  defaultScriptFunction,
  scriptParamTypeAlias,
} from './script-function';

// Execution types
export {
  ConnectorSchema,
  ExecutionContextSchema,
  ScopeEntrySchema,
  ScopeEntryTypeSchema,
  ScopeStackSchema,
  StepExecutionAttemptSchema,
  StepExecutionSchema,
  StepExecutionStatusSchema,
  StepExecutionStatusValue,
  StepInputReferenceSchema,
  StepResultSchema,
  WorkflowExecutionSchema,
  WorkflowExecutionStatusSchema,
  WorkflowExecutionStatusValue,
  WorkflowFileOutputSchema,
  WorkflowResultSchema,
  // Type guard utilities
  isFileOutput,
  isWorkflowResult,
  type Connector,
  type ExecutionContext,
  type ScopeEntry,
  type ScopeEntryType,
  type ScopeStack,
  type StepExecution,
  type StepExecutionAttempt,
  type StepExecutionStatus,
  type StepInputReference,
  type StepResult,
  type WorkflowExecution,
  type WorkflowExecutionStatus,
  type WorkflowFileOutput,
  type WorkflowResult,
} from './execution';

// Invoke-workflow typed contract helpers (shared by app publish + worker runtime)
export {
  buildWorkflowInputsJsonSchema,
  buildWorkflowOutputContractSchema,
  collectInvokeWorkflowTargetIds,
  collectInvokeWorkflowTargetNames,
  collectInvokeWorkflowTargets,
  getInvokeExecutionMode,
  getInvokeWorkflowRef,
  hasDeclaredOutput,
  isWorkflowIdRef,
  workflowInputAcceptsType,
  type InvokeExecutionMode,
  type InvokeWorkflowTargetRef,
} from './invoke-workflow-contract';
