import {
  ExecutionTagsSchema,
  parseRunTarget,
  runStartJsonBody,
  runStartMultipartTarget,
  runTargetApiPath,
} from '@eigenpal/types';
import type { Command } from 'commander';
import { buildClient } from '../lib/client';
import { action, UsageError } from '../lib/format-error';
import { addJsonFlag, intArg, withBaseUrl } from '../lib/ui';
import {
  BaseOpts,
  collectRepeated,
  pollRun,
  renderRunPayload,
  setExitCodeForFailedTerminalRun,
} from './agents/shared';
import { buildPreparedRunRequest } from './run-form-data';
import { rerunRun, runExample } from './runs';
import { runSavedWorkflowExamples } from './workflow/execution';

export function registerRunCommands(program: Command): void {
  addJsonFlag(withBaseUrl(program.command('run <target>')))
    .description(
      'Start a workflow or agent run, e.g. workflows.extract-invoice or workflows.extract-invoice@^1.'
    )
    .option('--tag <tag>', 'Execution tag. Repeat for multiple tags.', collectRepeated, [])
    .option('--input-json <json>', 'JSON input object')
    .option(
      '--input-file <field=path>',
      'Input file to upload. Files exceeding EIGENPAL_MULTIPART_MAX_BYTES (default 4.5 MiB; "none" disables) are pre-uploaded; smaller files stay on multipart. Repeat for multiple files; bare paths use field "file".',
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
Versions
  Append @<version> to the target. Default is @latest, the workflow's current
  version: every save made current runs for latest callers right away.
    workflows.extract-invoice@1.2.3    exactly that tag
    workflows.extract-invoice@^1       highest released 1.x.y (also 1, 1.x)
    workflows.extract-invoice@~1.2.3   highest released 1.2.y at or above 1.2.3
    workflows.extract-invoice@1.2      highest released 1.2.y (also 1.2.x)
    workflows.extract-invoice@wfv_...  a version id
  A range only matches tags that have been made current (candidates kept off
  live traffic never match) and never a prerelease unless the range names one.
  No match is a 404 "No version matches <range>". Agent targets take a git ref
  (main, 1.2.3, 1.x, or a commit SHA).

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
      'Version for the new run: latest, original (the source run version), an exact tag (1.2.3), a workflow range (^1, 1.2.x, ~1.2.3), or a version id. Agent reruns take a git ref.',
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
    tag?: string[];
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
  const tags = opts.tag?.length ? ExecutionTagsSchema.parse(opts.tag) : undefined;
  if (opts.example) {
    if (tags)
      throw new UsageError('--tag is supported for ad-hoc runs; example runs do not accept tags');
    if (opts.inputJson || (opts.inputFile && opts.inputFile.length > 0)) {
      throw new UsageError('--example cannot be combined with --input-json or --input-file');
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
    const prepared = await buildPreparedRunRequest(client, {
      target: pathTarget,
      inputFile: opts.inputFile,
      inputJson: opts.inputJson,
      tags,
    });
    if (prepared.hasMultipartFiles) {
      payload = await client.postFormData(runPath, prepared.form);
    } else {
      // All files were pre-uploaded as `$fileId` refs — send JSON only.
      const input = JSON.parse(String(prepared.form.get('input') ?? '{}')) as Record<
        string,
        unknown
      >;
      payload = await client.post(runPath, { ...runStartJsonBody(target, input), tags });
    }
  } else {
    payload = await client.post(runPath, {
      ...runStartJsonBody(target, opts.inputJson ? JSON.parse(opts.inputJson) : {}),
      tags,
    });
  }
  const runId = String((payload as { id?: string }).id ?? '');
  let waitedForTerminalRun = false;
  if (opts.wait && !runId) {
    throw new Error('Run start response did not include an id; cannot honor --wait');
  }
  if (opts.wait && runId) {
    payload = await pollRun(client, runId, opts.interval, opts.maxWait, opts.json);
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
