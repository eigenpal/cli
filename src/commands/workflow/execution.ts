/**
 * `eigenpal workflow run` creates workflow runs from local dataset examples.
 * Inspecting and managing runs lives under the unified top-level `eigenpal runs`
 * namespace.
 */

import type { Command } from 'commander';
import { ApiClient } from '../../lib/client';
import { requireApiKey, resolveConfig } from '../../lib/config';
import { formatEigenpalDirIfAvailable } from '../../lib/format-eigenpal';
import { addJsonFlag, intArg, withBaseUrl } from '../../lib/ui';
import { runExec } from './exec';

export function registerWorkflowRunCommand(parent: Command): void {
  const runCmd = parent
    .command('run <workflow-id> [examples...]')
    .description('Run a saved workflow against local dataset examples.')
    .option('--dir <dir>', 'Local eigenpal directory', undefined)
    .option('--concurrency <n>', 'Max examples to run in parallel (default: 3)', intArg)
    .addHelpText(
      'after',
      `
Examples:
  $ eigenpal workflow run wf_abc123                  # all examples
  $ eigenpal workflow run wf_abc123 sample-1 sample-2
  $ eigenpal workflow run wf_abc123 --concurrency 5
  $ eigenpal workflow run wf_abc123 sample --json | jq '.passed'

Reads examples from ./dataset/examples/<example>/ and writes per-run
artifacts to ./dataset/examples/<example>/executions/<timestamp>/.
Exits 1 when any example fails.
`
    );
  addJsonFlag(withBaseUrl(runCmd)).action(
    async (
      workflow: string,
      examples: string[],
      opts: {
        dir?: string;
        baseUrl?: string;
        concurrency?: number;
        json?: boolean;
      }
    ) => {
      const config = resolveConfig(opts);
      try {
        requireApiKey(config);
        const client = new ApiClient(config);
        const summary = await runExec(client, config.dir, workflow, examples, {
          concurrencyOverride: opts.concurrency,
        });
        if (opts.json) {
          // Single-summary JSON for scripting. The human-mode `runExec`
          // already wrote progress lines + the "Results:" footer; under
          // --json the caller wants a parseable shape on stdout.
          console.log(JSON.stringify(summary, null, 2));
        }
        if (summary.failed > 0) process.exit(1);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(msg);
        process.exit(1);
      } finally {
        formatEigenpalDirIfAvailable(config.dir);
      }
    }
  );
}
