/**
 * Canonical agent-reference topics bundled with `eigenpal docs read`.
 * Keep in sync with files under `packages/cli/src/skill/reference/`.
 */
export const AGENT_REFERENCE_TOPICS = [
  'reference/dataset-format',
  'reference/debugging',
  'reference/evaluators',
  'reference/step-exec',
  'reference/step-types',
  'reference/workflow-yaml',
] as const;

export type AgentReferenceTopic = (typeof AGENT_REFERENCE_TOPICS)[number];

/** GENERATED fence names in skill reference markdown files. */
export const SKILL_REFERENCE_GENERATIONS = {
  'step-types.md': ['STEP_CATALOG'],
  'evaluators.md': ['EVALUATOR_CATALOG'],
  'workflow-yaml.md': ['RETRY_REFERENCE', 'WORKFLOW_REFERENCE'],
  'dataset-format.md': ['DATASET_REFERENCE'],
} as const;

export type SkillReferenceFile = keyof typeof SKILL_REFERENCE_GENERATIONS;
