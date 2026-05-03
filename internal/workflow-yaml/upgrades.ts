/**
 * Workflow Definition Upgrades
 *
 * This module contains upgrade functions that transform old workflow formats
 * to the current format. Each upgrade is applied sequentially.
 *
 * When adding a new upgrade:
 * 1. Create a new upgrade function
 * 2. Add it to the UPGRADES array
 * 3. The upgrade should be idempotent (safe to run multiple times)
 */

type WorkflowObject = Record<string, unknown>;

/**
 * Upgrade: Convert legacy `trigger` field to `triggerMethods` array
 *
 * Before: { trigger: { type: 'manual' } }
 * After:  { triggerMethods: [{ type: 'manual' }] }
 */
function upgradeTriggerToTriggerMethods(workflow: WorkflowObject): WorkflowObject {
  // Skip if already has triggerMethods
  if (workflow.triggerMethods) {
    // Remove legacy trigger field if both exist
    if (workflow.trigger) {
      const { trigger: _removed, ...rest } = workflow;
      return rest;
    }
    return workflow;
  }

  // Convert trigger to triggerMethods
  if (workflow.trigger && typeof workflow.trigger === 'object') {
    const trigger = workflow.trigger as { type?: string; inputSchema?: unknown };
    const { trigger: _removed, ...rest } = workflow;

    // Webhook is not supported in new system, default to manual
    if (trigger.type === 'webhook') {
      return { ...rest, triggerMethods: [{ type: 'manual' }] };
    }

    // Map manual and api trigger types (they support inputSchema)
    if (trigger.type === 'manual' || trigger.type === 'api') {
      const method: Record<string, unknown> = { type: trigger.type };
      if (trigger.inputSchema) method.inputSchema = trigger.inputSchema;
      return { ...rest, triggerMethods: [method] };
    }
  }

  return workflow;
}

/**
 * List of all upgrades to apply, in order.
 * Each upgrade function receives a workflow object and returns an upgraded version.
 */
const UPGRADES: Array<(workflow: WorkflowObject) => WorkflowObject> = [
  upgradeTriggerToTriggerMethods,
  // Add future upgrades here:
  // upgradeStepConfigFormat,
  // upgradeOutputFormat,
  // etc.
];

/**
 * Apply all upgrades to a workflow object.
 * This is safe to call on already-upgraded workflows (idempotent).
 *
 * @param workflow - Raw workflow object (parsed from YAML or JSON)
 * @returns Upgraded workflow object
 */
export function upgradeWorkflow(workflow: WorkflowObject): WorkflowObject {
  return UPGRADES.reduce((w, upgrade) => upgrade(w), workflow);
}

/**
 * Check if a workflow needs upgrading.
 * Useful for showing migration warnings or tracking upgrade status.
 *
 * @param workflow - Raw workflow object
 * @returns true if the workflow has any legacy fields that will be upgraded
 */
export function needsUpgrade(workflow: WorkflowObject): boolean {
  // Check for legacy trigger field
  if (workflow.trigger && !workflow.triggerMethods) {
    return true;
  }

  // Add checks for future upgrades here

  return false;
}
