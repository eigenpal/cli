import type { ApiClient } from '../../lib/client';
import { ApiClient as Client } from '../../lib/client';
import { requireApiKey, resolveConfig } from '../../lib/config';

export type WorkflowCommandConfig = { dir?: string; baseUrl?: string };

export function buildClient(opts: WorkflowCommandConfig): ApiClient {
  const config = resolveConfig(opts);
  requireApiKey(config);
  return new Client(config);
}

export function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

export interface AutomationDetail {
  id: string;
  type?: string;
  name?: string | null;
  slug?: string | null;
}

export async function fetchAutomation(
  client: ApiClient,
  automationId: string
): Promise<AutomationDetail> {
  return (await client.get(
    `/v1/automations/${encodeURIComponent(automationId)}`
  )) as AutomationDetail;
}

/** Accept `{ deleted: true }` or HTTP 204 from DELETE /v1/automations/{id}. */
export function parseAutomationDeleteResult(result: unknown): { deleted: true } {
  if (result == null) return { deleted: true };
  if (typeof result === 'object' && result !== null && 'deleted' in result) {
    return result as { deleted: true };
  }
  return { deleted: true };
}
