/**
 * Source of truth for the long-form descriptions shown by the
 * `eigenpal workflow ...` CLI in `--help`. One entry per command; the CLI
 * imports the description directly so prose lives in one place.
 */

export type WorkflowToolName =
  | 'workflow_list'
  | 'workflow_get_definition'
  | 'workflow_set_definition'
  | 'workflow_get_evaluators'
  | 'workflow_set_evaluators'
  | 'workflow_list_examples'
  | 'workflow_get_dataset'
  | 'workflow_set_dataset'
  | 'workflow_list_executions'
  | 'workflow_run_experiment'
  | 'workflow_get_experiment_status'
  | 'workflow_get_experiment_results'
  | 'workflow_list_versions'
  | 'workflow_create_version'
  | 'workflow_promote_version'
  | 'workflow_restore_version'
  | 'workflow_list_step_types'
  | 'workflow_get_step_type';

export interface WorkflowToolDescriptor {
  /** Plain-English headline shown in CLI `--help`. */
  description: string;
}

export const WORKFLOW_TOOL_METADATA: Record<WorkflowToolName, WorkflowToolDescriptor> = {
  workflow_list: {
    description: 'List workflows the caller can read.',
  },

  workflow_get_definition: {
    description: 'Download the YAML definition of the workflow at its current version.',
  },

  workflow_set_definition: {
    description: 'Create or update a workflow from a YAML file.',
  },

  workflow_get_evaluators: {
    description: "Download the workflow's evaluators YAML.",
  },

  workflow_set_evaluators: {
    description: "Overwrite the workflow's evaluator config from a YAML file.",
  },

  workflow_list_examples: {
    description: 'List eval examples for the workflow.',
  },

  workflow_get_dataset: {
    description: "Download the workflow's dataset as a ZIP archive.",
  },

  workflow_set_dataset: {
    description: "Replace or extend the workflow's dataset from a ZIP or folder.",
  },

  workflow_list_executions: {
    description: 'List executions for the workflow, newest first.',
  },

  workflow_run_experiment: {
    description: "Start a batch eval against the workflow's dataset.",
  },

  workflow_get_experiment_status: {
    description: 'Aggregate progress for a batch by `batchId`.',
  },

  workflow_get_experiment_results: {
    description: 'Download eval results in CSV or JSON.',
  },

  workflow_list_versions: {
    description:
      'List tagged workflow versions plus the current untagged snapshot when HEAD is untagged, newest first.',
  },

  workflow_create_version: {
    description: 'Create a tagged workflow version from YAML or by copying an existing snapshot.',
  },

  workflow_promote_version: {
    description:
      'Make an existing tagged workflow version current without creating another snapshot.',
  },

  workflow_restore_version: {
    description:
      'Restore a previous snapshot as a new untagged current version. Does not retag the source.',
  },

  workflow_list_step_types: {
    description: 'List every step type the deployment supports.',
  },

  workflow_get_step_type: {
    description: 'Return the full schema and behavioral docs for one step type.',
  },
};
