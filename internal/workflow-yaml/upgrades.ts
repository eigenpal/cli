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
 * Upgrade: legacy AI steps used `type: ai` + `ai: parse|extract` instead of `type: ai.parse` / `ai.extract`.
 */
function upgradeLegacyAiStepFormat(workflow: WorkflowObject): WorkflowObject {
  const steps = workflow.steps;
  if (!Array.isArray(steps)) return workflow;
  return { ...workflow, steps: steps.map(upgradeStepDeep) };
}

function upgradeStepDeep(step: unknown): unknown {
  if (!step || typeof step !== 'object') return step;
  const s = step as Record<string, unknown>;
  const out: Record<string, unknown> = { ...s };

  if (out.type === 'ai' && typeof out.ai === 'string') {
    const op = out.ai as string;
    delete out.ai;
    out.type = `ai.${op}`;
  }

  // Legacy: `type: parallel` → `control.parallel`
  if (out.type === 'parallel') {
    out.type = 'control.parallel';
  }

  // Legacy: `type: transform` + `transform: set` → `transform.set` (same pattern as AI)
  if (out.type === 'transform' && typeof out.transform === 'string') {
    const op = out.transform as string;
    delete out.transform;
    out.type = `transform.${op}`;
  }

  // Legacy ai.parse put storage key in `with.ref` (+ filename/mimeType) instead of
  // `with.input` as FilePathDescriptor or { fileId }. Map to kind: 's3' for the parser.
  if (out.type === 'ai.parse' && out.with && typeof out.with === 'object') {
    const w = out.with as Record<string, unknown>;
    if (w.input === undefined && typeof w.ref === 'string') {
      const { ref, filename, mimeType, ...rest } = w;
      out.with = {
        ...rest,
        input: {
          kind: 's3',
          ref,
          filename: typeof filename === 'string' ? filename : 'document',
          mimeType: typeof mimeType === 'string' ? mimeType : 'application/octet-stream',
        },
      };
    }
  }

  if (Array.isArray(out.steps)) {
    out.steps = out.steps.map(upgradeStepDeep);
  }
  if (Array.isArray(out.then)) {
    out.then = out.then.map(upgradeStepDeep);
  }
  if (Array.isArray(out.else)) {
    out.else = out.else.map(upgradeStepDeep);
  }
  if (Array.isArray(out.branches)) {
    out.branches = out.branches.map((branch: unknown) => {
      if (!branch || typeof branch !== 'object') return branch;
      const b = branch as Record<string, unknown>;
      if (!Array.isArray(b.steps)) return branch;
      return { ...b, steps: b.steps.map(upgradeStepDeep) };
    });
  }

  return out;
}

/**
 * List of all upgrades to apply, in order.
 * Each upgrade function receives a workflow object and returns an upgraded version.
 */
const UPGRADES: Array<(workflow: WorkflowObject) => WorkflowObject> = [
  upgradeTriggerToTriggerMethods,
  upgradeLegacyAiStepFormat,
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

  if (Array.isArray(workflow.steps) && workflowHasUpgradableSteps(workflow.steps)) {
    return true;
  }

  return false;
}

function workflowHasUpgradableSteps(steps: unknown[]): boolean {
  for (const step of steps) {
    if (!step || typeof step !== 'object') continue;
    const s = step as Record<string, unknown>;
    if (s.type === 'ai' && typeof s.ai === 'string') return true;
    if (s.type === 'parallel') return true;
    if (s.type === 'transform' && typeof s.transform === 'string') return true;
    if (Array.isArray(s.steps) && workflowHasUpgradableSteps(s.steps as unknown[])) return true;
    if (Array.isArray(s.then) && workflowHasUpgradableSteps(s.then as unknown[])) return true;
    if (Array.isArray(s.else) && workflowHasUpgradableSteps(s.else as unknown[])) return true;
    if (Array.isArray(s.branches)) {
      for (const b of s.branches as unknown[]) {
        if (!b || typeof b !== 'object') continue;
        const br = b as Record<string, unknown>;
        if (Array.isArray(br.steps) && workflowHasUpgradableSteps(br.steps as unknown[]))
          return true;
      }
    }
  }
  return false;
}
