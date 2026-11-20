/**
 * Optional product modules (docs/MODULES.md). Closed list: add a module here
 * before anything checks it. The tenant list returns each organization's
 * effective modules, so the dashboard only checks membership.
 */
export const TENANT_MODULES = ['process_discovery'] as const;
export type TenantModule = (typeof TENANT_MODULES)[number];

/** Process Discovery and EigenPal Capture. */
export const PROCESS_DISCOVERY_MODULE = 'process_discovery' satisfies TenantModule;

export function isTenantModule(value: string): value is TenantModule {
  return (TENANT_MODULES as readonly string[]).includes(value);
}
