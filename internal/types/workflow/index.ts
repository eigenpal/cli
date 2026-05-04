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
  ControlApprovalConfigSchema,
  ControlApprovalOutputSchema,
  ControlBlockConfigSchema,
  ControlBlockOutputSchema,
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
  STEP_SCHEMAS,
  // Transform step schemas
  TransformCombineConfigSchema,
  TransformCombineOutputSchema,
  TransformMergeConfigSchema,
  TransformMergeOutputSchema,
  TransformRemoveConfigSchema,
  TransformRemoveOutputSchema,
  TransformSetConfigSchema,
  TransformSetOutputSchema,
  TransformSplitConfigSchema,
  TransformSplitOutputSchema,
  TransformTemplateConfigSchema,
  TransformTemplateOutputSchema,
  getAllStepJsonSchemas,
  getRequiredOutputKeys,
  getStepConfigSchema,
  getStepOutputSchema,
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
  type ControlApprovalConfig,
  type ControlBlockConfig,
  type ControlForeachConfig,
  type ControlIfConfig,
  type ControlParallelConfig,
  type ControlParallelMapConfig,
  type ControlWaitConfig,
  type StepCategory,
  type StepSchemaDefinition,
  type TransformCombineConfig,
  type TransformMergeConfig,
  type TransformRemoveConfig,
  type TransformSetConfig,
  type TransformSplitConfig,
  type TransformTemplateConfig,
} from './step-configs';

// Action types
export { ACTION_TYPES, ActionTypeSchema, ActionTypeValue, type ActionType } from './actions';

// Step types
export {
  AIStepSchema,
  ActionStepSchema,
  ApprovalStepSchema,
  BlockStepSchema,
  ForeachStepSchema,
  HttpMethodSchema,
  IfStepSchema,
  ParallelBranchSchema,
  ParallelMapStepSchema,
  ParallelStepSchema,
  STEP_TYPES,
  StepSchema,
  StepTypeSchema,
  StepTypeValue,
  TransformStepSchema,
  WaitStepSchema,
  isStepCategory,
  parseStepType,
  type AIStep,
  type ActionStep,
  type ApprovalStep,
  type BlockStep,
  type ForeachStep,
  type HttpMethod,
  type IfStep,
  type ParallelBranch,
  type ParallelMapStep,
  type ParallelStep,
  type Step,
  type StepType,
  type TransformStep,
  type WaitStep,
} from './steps';

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
  WorkflowNameSchema,
  WorkflowSettingsSchema,
  // Trigger method helper functions
  getTriggerMethods,
  hasTriggerMethod,
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
  type WorkflowSettings,
} from './workflow';

// Eval config (workflow-level eval/index.yaml)
export {
  DEFAULT_CONCURRENCY,
  EVAL_CONFIG_FIELD_DEFINITIONS,
  EVAL_CONFIG_FORM_KEYS,
  EvalConfigSchema,
  JUDGE_MODEL_IDS,
  JudgeModelSchema,
  isValidJudgeModel,
  parseEvalConfig,
  parseEvalConfigForForm,
  resolveConcurrency,
  type ConcurrencyResolved,
  type EvalConfig,
  type EvalConfigForm,
  type JudgeModelId,
} from './eval-config';

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

// Execution types
export {
  ConnectorSchema,
  ExecutionContextSchema,
  ScopeEntrySchema,
  ScopeEntryTypeSchema,
  ScopeStackSchema,
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
  type StepExecutionStatus,
  type StepInputReference,
  type StepResult,
  type WorkflowExecution,
  type WorkflowExecutionStatus,
  type WorkflowFileOutput,
  type WorkflowResult,
} from './execution';
