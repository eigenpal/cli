import { ApiClient } from '../../lib/client';
import { requireApiKey, resolveConfig } from '../../lib/config';
import { formatEigenpalDirIfAvailable } from '../../lib/format-eigenpal';
import { resolveWorkflowId } from '../../lib/resolve-workflow';
import { runWorkflowExamplesWithEval } from './eval-example';

export async function runSavedWorkflowExamples(
  workflow: string,
  examples: string[],
  opts: {
    dir?: string;
    baseUrl?: string;
    json?: boolean;
    /** Workflow version ref from `workflows.x@<version>`. */
    version?: string;
    /** Exit non-zero when a graded example fails (evaluator fail, or output mismatch). */
    failOnMismatch?: boolean;
    interval?: number;
    maxWait?: number;
  }
): Promise<void> {
  const config = resolveConfig(opts);
  try {
    requireApiKey(config);
    const client = new ApiClient(config);
    const workflowId = await resolveWorkflowId(client, workflow);

    // Example runs always use the workflow's current published version (the
    // server runs the stored example through that version's evaluators).
    if (opts.version && !['latest', 'current', 'undefined'].includes(opts.version)) {
      throw new Error(
        `--example cannot run workflow version @${opts.version}; publish or activate that version first, then use @latest`
      );
    }

    const summary = await runWorkflowExamplesWithEval(
      client,
      config.dir,
      workflow,
      workflowId,
      examples,
      {
        quiet: opts.json,
        intervalMs: Math.max(0, opts.interval ?? 2) * 1000,
        maxWaitMs: Math.max(1, opts.maxWait ?? 1800) * 1000,
      }
    );
    if (opts.json) console.log(JSON.stringify(summary, null, 2));
    if (summary.errored > 0) process.exit(1);
    if (opts.failOnMismatch && summary.failedCases > 0) process.exit(1);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(msg);
    process.exit(1);
  } finally {
    formatEigenpalDirIfAvailable(config.dir);
  }
}
