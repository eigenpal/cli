import { isEmailServerId } from '../email-servers';

export interface ActionEmailServerRef {
  /** Stable `ems_…` id authored on the step. */
  serverId: string;
  stepName?: string;
}

interface StepLike {
  name?: unknown;
  type?: unknown;
  with?: { server?: unknown } | undefined;
  [key: string]: unknown;
}

/** Yields every step in a definition, descending into nested control containers. */
function* iterateSteps(steps: unknown): Iterable<StepLike> {
  if (!Array.isArray(steps)) return;
  for (const raw of steps) {
    if (!raw || typeof raw !== 'object') continue;
    const step = raw as StepLike;
    yield step;
    for (const value of Object.values(step)) {
      if (!Array.isArray(value)) continue;
      for (const item of value) {
        if (!item || typeof item !== 'object') continue;
        const obj = item as Record<string, unknown>;
        if ('type' in obj) {
          yield* iterateSteps([obj]);
        } else if (Array.isArray(obj.steps)) {
          yield* iterateSteps(obj.steps);
        }
      }
    }
  }
}

/**
 * Every `action.email` step that persists a literal `ems_…` server id.
 * Template expressions and other non-ids are skipped — they cannot be
 * resolved at publish time, and the config schema already rejects them.
 */
export function collectActionEmailServerRefs(
  definition: { steps?: unknown[] } | undefined
): ActionEmailServerRef[] {
  const refs: ActionEmailServerRef[] = [];
  for (const step of iterateSteps(definition?.steps)) {
    if (step.type !== 'action.email') continue;
    const server = step.with?.server;
    if (typeof server !== 'string' || !isEmailServerId(server)) continue;
    refs.push({
      serverId: server,
      stepName: typeof step.name === 'string' ? step.name : undefined,
    });
  }
  return refs;
}

/** Unique `ems_…` ids referenced by action.email steps (publish gate batch lookup). */
export function collectActionEmailServerIds(
  definition: { steps?: unknown[] } | undefined
): string[] {
  return [...new Set(collectActionEmailServerRefs(definition).map((ref) => ref.serverId))];
}
