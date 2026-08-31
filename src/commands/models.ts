/**
 * `eigenpal models list` — inventory text, vision, and OCR models configured
 * for the authenticated tenant's environment. JSON is the agent-friendly path.
 */

import { Command } from 'commander';
import { ApiClient } from '../lib/client';
import { requireApiKey, resolveConfig } from '../lib/config';
import { action } from '../lib/format-error';
import { addJsonFlag, renderListResult, withBaseUrl, type TableColumn } from '../lib/ui';

interface ModelsListOpts {
  json?: boolean;
  baseUrl?: string;
  capability?: string;
}

interface PublicModelRow extends Record<string, unknown> {
  id: string;
  kind?: string;
  provider?: string;
  capabilities?: string[];
  configured?: boolean;
  available?: boolean;
  health?: string;
  defaultFor?: string[];
  location?: string;
}

const COLUMNS: TableColumn<PublicModelRow>[] = [
  { key: 'id', header: 'id' },
  { key: 'kind', header: 'kind' },
  {
    key: 'capabilities',
    header: 'capabilities',
    format: (value) => (Array.isArray(value) ? value.join(',') : String(value ?? '-')),
  },
  { key: 'health', header: 'health' },
  { key: 'location', header: 'location' },
  {
    key: 'defaultFor',
    header: 'default',
    format: (value) => (Array.isArray(value) && value.length > 0 ? value.join(',') : '-'),
  },
];

export function registerModelsCommands(program: Command): void {
  const models = program
    .command('models')
    .description(
      'Inspect models and providers configured for the current tenant environment (text, vision, OCR).'
    );

  addJsonFlag(
    withBaseUrl(
      models
        .command('list')
        .description(
          'List configured text, vision, and OCR models. This is a catalog inventory from the server, not a live provider health probe. `health` is `configured` or `unconfigured` from local credentials. Pair with `--json` for scripting.'
        )
        .option(
          '--capability <kind>',
          'Filter to `text`, `vision`, or `ocr` (matches the API `capability` query).'
        )
        .addHelpText(
          'after',
          `
Health
  configured     Credentials for this model are present in the environment.
  unconfigured   The model is listed but credentials/env interpolations are missing.
  unknown        Reserved; this command does not probe live providers.

Examples:
  $ eigenpal models list
  $ eigenpal models list --capability ocr --json
  $ eigenpal models list --json | jq '.data[] | {id, capabilities, health, location}'
`
        )
    )
  ).action(
    action(async (opts: ModelsListOpts) => {
      const config = resolveConfig(opts);
      requireApiKey(config);
      const client = new ApiClient(config);
      const params: Record<string, string> = {};
      if (opts.capability) params.capability = opts.capability;
      const raw = await client.get(
        '/api/v1/models',
        Object.keys(params).length > 0 ? params : undefined
      );
      renderListResult<PublicModelRow>(raw, COLUMNS, {
        json: opts.json,
        entityLabel: 'model',
      });
    })
  );
}
