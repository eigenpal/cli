import { ApiClient } from '../../lib/client';
import { requireApiKey, resolveConfig } from '../../lib/config';
import { formatEigenpalDirIfAvailable } from '../../lib/format-eigenpal';
import { runExec } from './exec';

export async function runSavedWorkflowExamples(
  workflow: string,
  examples: string[],
  opts: {
    dir?: string;
    baseUrl?: string;
    concurrency?: number;
    json?: boolean;
    /** Workflow version ref from `workflows.x@<version>`. */
    version?: string;
  }
): Promise<void> {
  const config = resolveConfig(opts);
  try {
    requireApiKey(config);
    const client = new ApiClient(config);
    const summary = await runExec(client, config.dir, workflow, examples, {
      concurrencyOverride: opts.concurrency,
      version: opts.version,
    });
    if (opts.json) console.log(JSON.stringify(summary, null, 2));
    if (summary.failed > 0) process.exit(1);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(msg);
    process.exit(1);
  } finally {
    formatEigenpalDirIfAvailable(config.dir);
  }
}
