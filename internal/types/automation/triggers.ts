import { workflowTriggerConfigSchema } from '../workflow/email-trigger';
import {
  getTriggerMethods,
  isManualTriggerEnabled,
  type TriggerMethod,
  type WorkflowDefinition,
} from '../workflow/workflow';

export const AUTOMATION_TRIGGER_TYPES = ['api', 'email', 'manual', 'cron'] as const;
export type AutomationTriggerType = (typeof AUTOMATION_TRIGGER_TYPES)[number];

export type AutomationTriggerProjection = {
  type: AutomationTriggerType;
  enabled: boolean;
  config?: Record<string, unknown>;
};

export type GitTriggerManifest = {
  api?: boolean;
  email?: {
    enabled?: boolean;
    aliases?: unknown[];
  };
};

function workflowMethodEnabled(methods: TriggerMethod[], type: TriggerMethod['type']): boolean {
  return methods.some((method) => method.type === type);
}

/** Project workflow definition triggerMethods → runtime trigger rows. */
export function triggersFromWorkflowDefinition(
  definition: WorkflowDefinition
): AutomationTriggerProjection[] {
  const methods = getTriggerMethods(definition);
  return [
    { type: 'api', enabled: workflowMethodEnabled(methods, 'api') },
    // Manual is ON by default and only disabled by an explicit opt-out
    // (`{ type: 'manual', enabled: false }`). An API-only triggerMethods still
    // projects manual=true, mirroring agents, while authors can turn it off.
    { type: 'manual', enabled: isManualTriggerEnabled(definition) },
    { type: 'email', enabled: workflowMethodEnabled(methods, 'email') },
    { type: 'cron', enabled: false },
  ];
}

/** Project git eigenpal.yaml triggers block → runtime trigger rows. */
export function triggersFromGitManifest(
  triggers: GitTriggerManifest | undefined
): AutomationTriggerProjection[] {
  const emailEnabled = triggers?.email?.enabled ?? (triggers?.email?.aliases?.length ?? 0) > 0;
  return [
    { type: 'api', enabled: triggers?.api ?? true },
    { type: 'email', enabled: emailEnabled },
    { type: 'manual', enabled: true },
    { type: 'cron', enabled: false },
  ];
}

/** True when the author stored `triggers.email.enabled: false` in raw config. */
export function isAgentEmailExplicitlyDisabled(config: unknown): boolean {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return false;
  const triggers = (config as Record<string, unknown>).triggers;
  if (!triggers || typeof triggers !== 'object' || Array.isArray(triggers)) return false;
  const email = (triggers as Record<string, unknown>).email;
  if (!email || typeof email !== 'object' || Array.isArray(email)) return false;
  if (!('enabled' in email)) return false;
  return (email as Record<string, unknown>).enabled === false;
}

/** Project agent workflow config + alias presence → runtime trigger rows. */
export function triggersFromAgentConfig(input: {
  config: unknown;
  hasActiveEmailAliases: boolean;
}): AutomationTriggerProjection[] {
  const triggers = workflowTriggerConfigSchema.parse(
    input.config && typeof input.config === 'object' && !Array.isArray(input.config)
      ? (input.config as Record<string, unknown>).triggers
      : undefined
  );
  const emailEnabled = input.hasActiveEmailAliases && !isAgentEmailExplicitlyDisabled(input.config);
  return [
    { type: 'api', enabled: triggers.api.enabled },
    {
      type: 'email',
      enabled: emailEnabled,
    },
    { type: 'manual', enabled: true },
    { type: 'cron', enabled: false },
  ];
}

export function isAutomationTriggerEnabled(
  rows: Array<{ type: AutomationTriggerType; enabled: boolean }>,
  type: AutomationTriggerType
): boolean {
  return rows.find((row) => row.type === type)?.enabled ?? false;
}
