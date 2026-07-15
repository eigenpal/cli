import {
  parseRunTarget,
  runStartJsonBody,
  runStartMultipartTarget,
  runTargetApiPath,
} from '@eigenpal/types';
import type { Command } from 'commander';
import { action } from '../lib/format-error';
import { addJsonFlag, intArg, withBaseUrl } from '../lib/ui';
import {
  BaseOpts,
  buildClient,
  collectRepeated,
  pollRun,
  renderRunPayload,
  setExitCodeForFailedTerminalRun,
} from './agents/shared';
import { buildRunFormData } from './run-form-data';
import { rerunRun, runExample } from './runs';
import { runSavedWorkflowExamples } from './workflow/execution';

export function registerRunCommands(program: Command): void {
  addJsonFlag(withBaseUrl(program.command('run <target>')))
    .description('Start a workflow or agent run, e.g. workflows.extract-invoice.')
    .option('--input-json <json>', 'JSON input object')
    .option(
      '--input-file <field=path>',
      'Input file to upload as multipart form-data. Repeat for multiple files; bare paths use field "file".',
      collectRepeated,
      []
    )
    .option('--example <name>', 'Run one persisted example by name')
    .option('--dir <dir>', 'Local eigenpal directory for workflow examples', undefined)
    .option(
      '--fail-on-mismatch',
      'For --example runs, exit non-zero when a graded example fails (evaluator fail, or output mismatch)'
    )
    .option('--wait', 'Poll until the run reaches a terminal status')
    .option('--interval <seconds>', 'Polling interval in seconds', intArg, 2)
    .option('--max-wait <seconds>', 'Maximum wait before exit code 2', intArg, 1800)
    .action(action(runTarget))
    .addHelpText(
      'after',
      `
Grading --example runs
  --example runs the SERVER's stored dataset example for the target — workflows
  (workflows.<slug>) and agents (agents.<slug>) alike — so push your latest
  dataset/evaluators first (eigenpal {workflow|agent} dataset push /
  evaluators push).

  If the target has evaluators configured, they run automatically after the
  execution completes and the CLI shows the real weighted score and PASS/FAIL
  verdict (agent runs need --wait to observe it). Workflow targets without
  evaluators are graded by a structural diff against the example's stored
  expected output (every expected field must be present and equal; extra output
  fields are ignored, arrays match by index); agent targets without evaluators
  print a warning and are not graded.

Exit codes
  1  a run errored (or, with --fail-on-mismatch, a graded example failed)
  2  with --fail-on-mismatch on an agent target: evaluators are configured but
     no verdict landed inside the grace window — the command refuses to report
     success without a verdict (re-run, or check evaluator health)
  By default a grading failure is informational and does not change the exit code.
`
    );

  addJsonFlag(withBaseUrl(program.command('rerun <run-id>')))
    .description("Create a new run from a previous run's stored input snapshot.")
    .option(
      '--version <version>',
      'Version/source ref for the new run: latest, original, or an explicit ref',
      'latest'
    )
    .option('--wait', 'Poll until the rerun reaches a terminal status')
    .option('--interval <seconds>', 'Polling interval in seconds', intArg, 2)
    .option('--max-wait <seconds>', 'Maximum wait before exit code 2', intArg, 1800)
    .action(action(rerunTarget));
}

async function runTarget(
  target: string,
  opts: BaseOpts & {
    inputJson?: string;
    inputFile?: string[];
    example?: string;
    dir?: string;
    failOnMismatch?: boolean;
    wait?: boolean;
    interval: number;
    maxWait: number;
  }
) {
  const parsed = parseRunTarget(target);
  if (opts.example) {
    if (opts.inputJson || (opts.inputFile && opts.inputFile.length > 0)) {
      throw new Error('--example cannot be combined with --input-json or --input-file');
    }
    if (parsed.type === 'agent') {
      return runExample(parsed.slug, {
        ...opts,
        sourceRef: parsed.requestedVersion,
        example: opts.example,
      });
    }
    return runSavedWorkflowExamples(parsed.idOrSlug, [opts.example], {
      ...opts,
      version: String(parsed.requestedVersion),
      failOnMismatch: opts.failOnMismatch,
    });
  }

  const client = buildClient(opts);
  let payload: unknown;
  const runPath = runTargetApiPath(target);
  const pathTarget = runStartMultipartTarget(target);
  if (opts.inputFile && opts.inputFile.length > 0) {
    const form = await buildRunFormData({
      target: pathTarget,
      inputFile: opts.inputFile,
      inputJson: opts.inputJson,
    });
    payload = await client.postFormData(runPath, form);
  } else {
    payload = await client.post(
      runPath,
      runStartJsonBody(target, opts.inputJson ? JSON.parse(opts.inputJson) : {})
    );
  }
  const runId = String((payload as { id?: string }).id ?? '');
  let waitedForTerminalRun = false;
  if (opts.wait && runId) {
    payload = await pollRun(client, runId, opts.interval, opts.maxWait);
    waitedForTerminalRun = true;
  }
  renderRunPayload(payload, opts);
  if (waitedForTerminalRun) setExitCodeForFailedTerminalRun(payload);
}

async function rerunTarget(
  runId: string,
  opts: BaseOpts & { version?: string; wait?: boolean; interval: number; maxWait: number }
) {
  await rerunRun(runId, { ...opts, version: opts.version });
}
