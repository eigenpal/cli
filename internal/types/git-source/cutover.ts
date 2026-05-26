import { z } from 'zod';

export const AgentSourceRuntimeModeSchema = z.enum(['legacy', 'git']);
export type AgentSourceRuntimeMode = z.infer<typeof AgentSourceRuntimeModeSchema>;

export const AgentSourceMigrationStateSchema = z.enum([
  'disabled',
  'shadow',
  'validated',
  'cutover',
  'rolled_back',
]);
export type AgentSourceMigrationState = z.infer<typeof AgentSourceMigrationStateSchema>;

export const AgentSourceCutoverSettingsSchema = z
  .object({
    gitBackedSource: z
      .object({
        agents: z
          .object({
            runtime: AgentSourceRuntimeModeSchema.optional(),
            migrationState: AgentSourceMigrationStateSchema.optional(),
            legacySourceRetained: z.boolean().optional(),
            rollbackReason: z.string().optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type AgentSourceCutoverSettings = z.infer<typeof AgentSourceCutoverSettingsSchema>;

export type AgentSourceCutoverDecision =
  | {
      mode: 'legacy';
      reason:
        | 'settings_missing'
        | 'runtime_legacy'
        | 'migration_not_cutover'
        | 'rolled_back'
        | 'invalid_settings';
    }
  | {
      mode: 'git';
      reason: 'cutover_enabled';
    };

export function resolveAgentSourceCutover(settings: unknown): AgentSourceCutoverDecision {
  const parsed = AgentSourceCutoverSettingsSchema.safeParse(settings ?? {});
  if (!parsed.success) return { mode: 'legacy', reason: 'invalid_settings' };

  const agents = parsed.data.gitBackedSource?.agents;
  if (!agents) return { mode: 'legacy', reason: 'settings_missing' };
  if (agents.migrationState === 'rolled_back') return { mode: 'legacy', reason: 'rolled_back' };
  if (agents.runtime !== 'git') return { mode: 'legacy', reason: 'runtime_legacy' };
  if (agents.migrationState !== 'cutover') {
    return { mode: 'legacy', reason: 'migration_not_cutover' };
  }
  return { mode: 'git', reason: 'cutover_enabled' };
}

export function isGitBackedAgentSourceEnabled(settings: unknown): boolean {
  return resolveAgentSourceCutover(settings).mode === 'git';
}
