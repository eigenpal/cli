import { type Command } from 'commander';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs, readFileSync } from 'node:fs';
import path from 'node:path';
import { ApiClient } from '../../lib/client';
import { action } from '../../lib/format-error';
import {
  addJsonFlag,
  dim,
  error,
  formatTimestamp,
  intArg,
  success,
  table,
  ui,
  warn,
  withBaseUrl,
  withPagination,
  type PaginationOpts,
} from '../../lib/ui';
import { buildAgentExecutionRunFormData } from './run-form-data';
import {
  ArtifactInventoryRow,
  BaseOpts,
  buildClient,
  collectRepeated,
  compactParams,
  confirmTyped,
  pollRun,
  printJson,
  renderGeneric,
  renderRunPayload,
  setExitCodeForFailedTerminalRun,
} from './shared';
import { parseAgentTarget } from './target';

export function registerRunCommands(agent: Command): void {
  const runs = agent
    .command('runs')
    .description('Inspect, watch, and manage agent runs.')
    .action(() => {
      process.stderr.write(
        '`eigenpal agents runs` requires a subcommand. Run `eigenpal agents runs --help`.\n'
      );
      process.exit(2);
    });

  const listRunsCmd = addJsonFlag(withPagination(withBaseUrl(runs.command('list <target>')), 50))
    .description('List runs for an agent target; unqualified targets include all source refs.')
    .option('--status <status>', 'Filter by run status')
    .option('--include <items>', 'Comma-separated include list')
    .option('--compact', 'Render compact run rows')
    .option('--sort <field>', 'Sort field')
    .option('--order <asc|desc>', 'Sort order');
  listRunsCmd.action(action(listRunsTarget));

  addJsonFlag(withBaseUrl(runs.command('get <run-id>')))
    .description('Get one agent run.')
    .option(
      '--include <parts>',
      'Comma-separated extra parts: feedback,expected,files,trace,issues',
      'feedback'
    )
    .action(action(getRun));

  addJsonFlag(withBaseUrl(runs.command('compare <reference-run-id> <run-id>')))
    .description(
      'Compare one run against another run. PDF/DOCX text comparison uses pdftotext/python3 and reports byte fallbacks.'
    )
    .option('--baseline', 'Compare actual outputs from both runs instead of expected artifacts')
    .option('--out <dir>', 'Write comparison artifacts to this directory')
    .option('--normalize-dates', 'Normalize YYYYMMDD and YYYY-MM-DD tokens in filenames/text')
    .option('--fail-on-diff', 'Exit 1 when comparison status is fail')
    .action(action(compareRun));

  const artifacts = runs
    .command('artifacts')
    .description('Inspect run artifact inventory.')
    .action(() => {
      process.stderr.write(
        '`eigenpal agents runs artifacts` requires a subcommand. Run `eigenpal agents runs artifacts --help`.\n'
      );
      process.exit(2);
    });

  addJsonFlag(withBaseUrl(artifacts.command('list <run-id>')))
    .description('List available run artifacts without downloading them.')
    .action(action(listRunArtifacts));

  withBaseUrl(artifacts.command('fetch <run-id>'))
    .description('Download run artifacts by canonical artifact path.')
    .option('--out <dir>', 'Output directory')
    .option(
      '--include <parts>',
      'Comma-separated parts: output,input,metadata,issues,trace,lockfile,expected,all',
      'all'
    )
    .option(
      '--path <path>',
      'Fetch one exact artifact path from `artifacts list`; repeatable',
      collectRepeated,
      []
    )
    .option('--json', 'Output a JSON summary of written artifacts')
    .action(action(fetchRunArtifacts));

  withBaseUrl(runs.command('trace <run-id>'))
    .description('Print raw trace.jsonl for a run, or write it with --out.')
    .option('--out <file>', 'Output file path')
    .action(action(traceRun));

  registerRunFeedbackCommands(runs);
  registerRunExpectedCommands(runs);

  addJsonFlag(withBaseUrl(runs.command('watch <run-id>')))
    .description('Watch a run until it reaches a terminal status.')
    .option('--interval <seconds>', 'Polling interval in seconds', intArg, 2)
    .option('--max-wait <seconds>', 'Maximum wait before exiting 2', intArg, 1800)
    .action(action(watchRunCommand));

  addJsonFlag(withBaseUrl(runs.command('cancel <run-id>')))
    .description('Cancel an agent run.')
    .option('--yes', 'Required in non-interactive environments')
    .action(action(cancelRun));
}

function registerRunFeedbackCommands(runs: Command): void {
  const feedback = runs
    .command('feedback')
    .description('Update or clear feedback attached to an agent run.')
    .action(() => {
      process.stderr.write(
        '`eigenpal agents runs feedback` requires a subcommand. Run `eigenpal agents runs feedback --help`.\n'
      );
      process.exit(2);
    });

  addJsonFlag(withBaseUrl(feedback.command('update <run-id>')))
    .description('Edit feedback state, rating, message, or expected JSON for a run.')
    .option('--status <open|resolved|ignored>', 'Set feedback status')
    .option('--rating <pass|fail|partial|none>', 'Set feedback rating')
    .option('--message <text>', 'Set feedback message body')
    .option('--message-file <path>', 'Read feedback message body from a file')
    .option('--expected-json <json>', 'Set structured expected JSON')
    .option('--expected-json-file <path>', 'Read structured expected JSON from a file')
    .option('--clear-message', 'Clear the feedback message body')
    .option('--clear-rating', 'Clear feedback rating')
    .option('--clear-expected-json', 'Delete structured expected JSON')
    .action(action(updateRunFeedback));

  addJsonFlag(withBaseUrl(feedback.command('resolve <run-id>')))
    .description('Mark run feedback as resolved.')
    .option('--message <text>', 'Set feedback message body')
    .option('--message-file <path>', 'Read feedback message body from a file')
    .action(
      action((runId: string, opts: BaseOpts & { message?: string; messageFile?: string }) =>
        updateRunFeedback(runId, { ...opts, status: 'resolved' })
      )
    );

  addJsonFlag(withBaseUrl(feedback.command('clear <run-id>')))
    .description('Delete feedback, expected.json, and expected files for a run.')
    .option('--yes', 'Required in non-interactive environments')
    .action(action(clearRunFeedback));
}

function registerRunExpectedCommands(runs: Command): void {
  const expected = runs
    .command('expected')
    .description('Manage expected artifacts attached to an agent run.')
    .action(() => {
      process.stderr.write(
        '`eigenpal agents runs expected` requires a subcommand. Run `eigenpal agents runs expected --help`.\n'
      );
      process.exit(2);
    });

  addJsonFlag(withBaseUrl(expected.command('list <run-id>')))
    .description('List expected JSON and files attached to a run.')
    .action(action(listRunExpected));

  withBaseUrl(expected.command('pull <run-id>'))
    .description('Download expected JSON and files attached to a run.')
    .option('--out <dir>', 'Output directory')
    .action(action(pullRunExpected));

  addJsonFlag(withBaseUrl(expected.command('upload <run-id> <file>')))
    .description('Upload a local file as an expected artifact.')
    .option('--name <name>', 'Expected artifact name')
    .action(action(uploadRunExpected));

  addJsonFlag(withBaseUrl(expected.command('copy-output <run-id> <output-file>')))
    .description('Copy a generated output file into expected artifacts.')
    .option('--name <name>', 'Expected artifact name')
    .action(action(copyOutputToExpected));

  addJsonFlag(withBaseUrl(expected.command('rename <run-id> <old-name> <new-name>')))
    .description('Rename an expected artifact.')
    .action(action(renameRunExpected));

  addJsonFlag(withBaseUrl(expected.command('delete <run-id> <name>')))
    .description('Delete an expected artifact.')
    .option('--yes', 'Required in non-interactive environments')
    .action(action(deleteRunExpected));
}

async function listRunsTarget(target: string, opts: Parameters<typeof listRuns>[1]) {
  const parsed = parseAgentTarget(target);
  return listRuns(parsed.slug, { ...opts, sourceRef: parsed.sourceRef });
}

export async function runExecution(
  agentId: string,
  opts: BaseOpts & {
    inputJson?: string;
    inputFile?: string[];
    wait?: boolean;
    sourceRef?: string;
    interval?: number;
    maxWait?: number;
  }
) {
  const client = buildClient(opts);
  const runPath = `/api/v1/agents/${encodeURIComponent(agentId)}/run${
    opts.sourceRef ? `?sourceRef=${encodeURIComponent(opts.sourceRef)}` : ''
  }`;
  let payload: unknown;
  if (opts.inputFile && opts.inputFile.length > 0) {
    const form = await buildAgentExecutionRunFormData(opts.inputFile, opts.inputJson);
    payload = await client.postFormData(runPath, form);
  } else {
    payload = await client.post(runPath, {
      input: opts.inputJson ? JSON.parse(opts.inputJson) : {},
      ...(opts.sourceRef ? { sourceRef: opts.sourceRef } : {}),
    });
  }
  const runId = String((payload as { runId?: string }).runId ?? '');
  let waitedForTerminalRun = false;
  if (opts.wait && runId) {
    payload = await pollRun(client, runId, opts.interval ?? 2, opts.maxWait ?? 1800);
    waitedForTerminalRun = true;
  }
  renderRunPayload(payload, opts);
  if (waitedForTerminalRun) setExitCodeForFailedTerminalRun(payload);
}

export async function runExample(
  agentId: string,
  opts: BaseOpts & {
    example: string;
    sourceRef?: string;
    wait?: boolean;
    interval: number;
    maxWait: number;
  }
) {
  const client = buildClient(opts);
  const started = (await client.post(`/api/v1/agents/${encodeURIComponent(agentId)}/experiments`, {
    exampleId: opts.example,
    ...(opts.sourceRef ? { sourceRef: opts.sourceRef } : {}),
  })) as { batchId?: string; runs?: Array<{ runId?: string; exampleId?: string }> };
  const runId = started.runs?.[0]?.runId;
  if (opts.wait && runId) {
    const payload = await pollRun(client, runId, opts.interval, opts.maxWait);
    renderRunPayload(payload, opts);
    setExitCodeForFailedTerminalRun(payload);
    return;
  }
  const payload = {
    runId,
    exampleId: opts.example,
    batchId: started.batchId,
    status: 'pending',
  };
  if (opts.json) return printJson(payload);
  success(`Run ${runId ?? ''} queued for example ${opts.example}`);
}

async function getRun(executionId: string, opts: BaseOpts & { include?: string }) {
  const client = buildClient(opts);
  const payload = await client.get(`/api/v1/agents/runs/${encodeURIComponent(executionId)}`, {
    ...(opts.include ? { include: opts.include } : {}),
  });
  renderRunPayload(payload, opts);
}

export async function rerunRun(
  executionId: string,
  opts: BaseOpts & { wait?: boolean; interval: number; maxWait: number; sourceRef?: string }
) {
  const client = buildClient(opts);
  const sourceRef = await resolveRerunSourceRef(client, executionId, opts.sourceRef);
  let payload: unknown = await client.post(
    `/api/v1/agents/runs/${encodeURIComponent(executionId)}/rerun`,
    sourceRef ? { sourceRef } : {}
  );
  const rerunId = String((payload as { runId?: string }).runId ?? '');
  if (opts.wait && rerunId) {
    payload = await pollRun(client, rerunId, opts.interval, opts.maxWait);
    renderRunPayload(payload, opts);
    setExitCodeForFailedTerminalRun(payload);
    return;
  }
  if (opts.json) return printJson(payload);
  success(`Started rerun ${ui.bold(rerunId)} from ${executionId}`);
}

async function resolveRerunSourceRef(
  client: ApiClient,
  executionId: string,
  requested: string | undefined
): Promise<string | undefined> {
  if (!requested) return undefined;
  if (requested !== 'original') return requested;
  const payload = (await client.get(`/api/v1/agents/runs/${encodeURIComponent(executionId)}`)) as {
    run?: Record<string, unknown>;
  };
  const run = payload.run;
  if (!run) throw new Error(`Run ${executionId} not found`);
  const resolved = stringOrNull(run.resolvedGitRef);
  const requestedSource = stringOrNull(run.requestedSourceRef);
  const original = resolved ?? requestedSource;
  if (!original) {
    throw new Error(`Run ${executionId} does not have an original source ref to reuse`);
  }
  return original;
}

async function fetchRunArtifacts(
  executionId: string,
  opts: BaseOpts & { include: string; out?: string; path?: string[] }
) {
  const client = buildClient(opts);
  const payload = (await client.get(`/api/v1/agents/runs/${encodeURIComponent(executionId)}`, {
    include: 'expected,files,input,output,issues,trace,lockfile,metadata',
  })) as { run?: Record<string, unknown> };
  const run = payload.run;
  if (!run) throw new Error(`Run ${executionId} not found`);
  const out = path.resolve(opts.out ?? path.join('.eigenpal', 'artifacts', 'runs', executionId));
  await fs.mkdir(out, { recursive: true });
  const written: string[] = [];
  const skipped: string[] = [];

  const selectedPaths =
    opts.path && opts.path.length > 0
      ? opts.path
      : runArtifactInventory(run)
          .filter((artifact) => artifactIncluded(artifact, opts.include))
          .map((artifact) => artifact.path);

  for (const artifactPath of selectedPaths) {
    const normalized = normalizeArtifactPath(artifactPath);
    if (!normalized) {
      skipped.push(artifactPath);
      continue;
    }
    const result = await writeRunArtifact(client, executionId, out, normalized, run);
    if (result) written.push(result);
    else skipped.push(normalized);
  }
  const summary = {
    runId: executionId,
    out,
    written,
    skipped,
    counts: {
      written: written.length,
      skipped: skipped.length,
    },
  };
  if (opts.json) return printJson(summary);
  success(`Fetched run artifacts for ${executionId} to ${out}`);
  dim(
    `Wrote ${written.length} artifact${written.length === 1 ? '' : 's'}${
      skipped.length ? `; skipped missing ${skipped.join(', ')}` : ''
    }`
  );
}

async function listRunArtifacts(executionId: string, opts: BaseOpts) {
  const client = buildClient(opts);
  const payload = (await client.get(`/api/v1/agents/runs/${encodeURIComponent(executionId)}`, {
    include: 'expected,files,input,output,issues,trace,lockfile,metadata',
  })) as { run?: Record<string, unknown> };
  const run = payload.run;
  if (!run) throw new Error(`Run ${executionId} not found`);
  const artifacts = runArtifactInventory(run);
  if (opts.json) return printJson({ runId: executionId, artifacts });
  console.log(
    table(artifacts, [
      { key: 'kind', header: 'KIND' },
      { key: 'name', header: 'NAME' },
      { key: 'path', header: 'PATH' },
      { key: 'present', header: 'PRESENT' },
    ])
  );
}

function artifactIncluded(artifact: ArtifactInventoryRow, include: string): boolean {
  const parts = new Set(
    include
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
  );
  if (parts.has('all')) return true;
  if (parts.has(artifact.kind)) return true;
  if (parts.has('files') && (artifact.kind === 'input' || artifact.kind === 'output')) return true;
  if (parts.has('metadata') && artifact.path === 'run.json') return true;
  return false;
}

function normalizeArtifactPath(artifactPath: string): string | null {
  const parts = artifactPath.split('/');
  if (
    artifactPath.startsWith('/') ||
    parts.some((part) => part === '' || part === '.' || part === '..')
  ) {
    return null;
  }
  return artifactPath;
}

async function writeJsonRunArtifact(out: string, artifactPath: string, value: unknown) {
  await fs.mkdir(path.dirname(path.join(out, artifactPath)), { recursive: true });
  await fs.writeFile(path.join(out, artifactPath), JSON.stringify(value, null, 2));
}

async function writeDownloadedRunArtifact(
  client: ApiClient,
  executionId: string,
  out: string,
  artifactPath: string,
  routePrefix: 'files' | 'expected'
) {
  const routePath = routePrefix === 'files' ? artifactPath : artifactPath.slice('expected/'.length);
  const response = await client.getStream(
    `/api/v1/agents/runs/${encodeURIComponent(executionId)}/${routePrefix}/${encodeRunArtifactPath(
      routePath
    )}`
  );
  const outPath = path.join(out, artifactPath);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, Buffer.from(await response.arrayBuffer()));
}

async function writeRunArtifact(
  client: ApiClient,
  executionId: string,
  out: string,
  artifactPath: string,
  run: Record<string, unknown>
): Promise<string | null> {
  if (artifactPath === 'run.json') {
    await writeJsonRunArtifact(out, artifactPath, run);
    return artifactPath;
  }
  if (artifactPath === 'input.json') {
    if (run.inputJson == null) return null;
    await writeJsonRunArtifact(out, artifactPath, run.inputJson);
    return artifactPath;
  }
  if (artifactPath === 'metadata.json') {
    if (run.metadata == null) return null;
    await writeJsonRunArtifact(out, artifactPath, run.metadata);
    return artifactPath;
  }
  if (artifactPath === 'expected.json') {
    if (run.expected == null) return null;
    await writeJsonRunArtifact(out, artifactPath, run.expected);
    return artifactPath;
  }
  if (artifactPath.startsWith('expected/')) {
    await writeDownloadedRunArtifact(client, executionId, out, artifactPath, 'expected');
    return artifactPath;
  }
  await writeDownloadedRunArtifact(client, executionId, out, artifactPath, 'files');
  return artifactPath;
}

async function traceRun(executionId: string, opts: BaseOpts & { out?: string }) {
  const client = buildClient(opts);
  const text = await downloadTraceText(client, executionId);
  if (!opts.out) {
    process.stdout.write(text);
    return;
  }
  const out = path.resolve(opts.out);
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, text);
  success(`Downloaded trace for ${executionId} to ${ui.bold(out)}`);
}

async function compareRun(
  referenceId: string,
  executionId: string,
  opts: BaseOpts & {
    baseline?: boolean;
    out?: string;
    normalizeDates?: boolean;
    failOnDiff?: boolean;
  }
) {
  const client = buildClient(opts);
  const targetPayload = (await client.get(
    `/api/v1/agents/runs/${encodeURIComponent(executionId)}`,
    { include: 'files,output' }
  )) as { run?: Record<string, unknown> };
  const target = targetPayload.run;
  if (!target) throw new Error(`Run ${executionId} not found`);

  const mode = opts.baseline ? 'baseline' : 'expected';
  const reference = (
    (await client.get(`/api/v1/agents/runs/${encodeURIComponent(referenceId)}`, {
      include: mode === 'baseline' ? 'files,output' : 'expected',
    })) as { run?: Record<string, unknown> }
  ).run;
  if (!reference) throw new Error(`Reference run ${referenceId} not found`);

  const out = path.resolve(
    opts.out ?? path.join('.eigenpal', 'artifacts', 'comparisons', `${referenceId}..${executionId}`)
  );
  await fs.mkdir(out, { recursive: true });

  const warnings: string[] = [];
  if (
    mode === 'expected' &&
    reference.expected == null &&
    fileNames(reference.expectedFiles).length === 0
  ) {
    warnings.push(
      `Reference run ${referenceId} has no expected JSON or expected files; comparison has no baseline artifacts. Use --baseline to compare actual outputs.`
    );
  }
  const jsonDiffs = diffJson(
    mode === 'baseline' ? reference.output : reference.expected,
    target.output
  );
  const expectedFiles =
    mode === 'baseline'
      ? fileNames(reference.resultFiles).filter(
          (name) => name !== 'issues.md' && name !== 'trace.jsonl'
        )
      : fileNames(reference.expectedFiles);
  const outputFiles = fileNames(target.resultFiles).filter(
    (name) => name !== 'issues.md' && name !== 'trace.jsonl'
  );
  const inventory = compareFileInventory(expectedFiles, outputFiles, Boolean(opts.normalizeDates));
  const textDifferences = await compareMatchedFileText(
    client,
    { runId: referenceId, kind: mode === 'baseline' ? 'output' : 'expected' },
    { runId: executionId, kind: 'output' },
    out,
    inventory.matched,
    Boolean(opts.normalizeDates)
  );
  const report = {
    status:
      jsonDiffs.length === 0 &&
      inventory.missing.length === 0 &&
      inventory.extra.length === 0 &&
      textDifferences.every((diff) => diff.status === 'match' || diff.status === 'binary-match')
        ? 'pass'
        : 'fail',
    runId: executionId,
    comparedWithRunId: referenceId,
    mode,
    warnings,
    jsonDifferences: jsonDiffs,
    matchedFiles: inventory.matched,
    missingFiles: inventory.missing,
    extraFiles: inventory.extra,
    textDifferences,
  };
  await fs.writeFile(path.join(out, 'comparison.json'), JSON.stringify(report, null, 2));
  if (opts.json) {
    printJson(report);
  } else {
    renderComparisonReport(report);
  }
  dim(`Comparison artifacts written to ${ui.bold(out)}`);
  if (opts.failOnDiff && report.status === 'fail') process.exit(1);
}

async function listRuns(
  agentId: string,
  opts: BaseOpts &
    PaginationOpts & {
      status?: string;
      batchId?: string;
      exampleName?: string;
      exampleNameContains?: string;
      createdAfter?: string;
      createdBefore?: string;
      completedAfter?: string;
      completedBefore?: string;
      feedbackStatus?: string;
      feedbackRating?: string;
      feedbackBodyContains?: string;
      feedbackCreatedAfter?: string;
      feedbackCreatedBefore?: string;
      feedbackUpdatedAfter?: string;
      feedbackUpdatedBefore?: string;
      feedbackResolvedAfter?: string;
      feedbackResolvedBefore?: string;
      hasFeedback?: boolean;
      noFeedback?: boolean;
      feedback?: boolean;
      hasExpected?: boolean;
      hasExpectedJson?: boolean;
      hasExpectedFiles?: boolean;
      promotedToExample?: boolean;
      promotedExampleName?: string;
      sinceLastResolved?: boolean;
      include?: string;
      compact?: boolean;
      sort?: string;
      order?: string;
      scanLimit?: number;
      sourceRef?: string;
    }
) {
  const client = buildClient(opts);
  const params = buildRunListParams(opts);
  const payload = (await client.get(
    `/api/v1/agents/${encodeURIComponent(agentId)}/runs`,
    params
  )) as {
    runs: Record<string, unknown>[];
    total: number;
    scanLimited?: boolean;
    noResolvedAnchor?: boolean;
  };
  const rows = opts.compact ? payload.runs.map(compactRunRow) : payload.runs;
  if (opts.json) return printJson({ ...payload, runs: rows });
  if (payload.scanLimited) {
    warn(
      'Feedback/expected filters scanned only the first matching window. Increase --scan-limit or narrow DB filters for a fuller result.'
    );
  }
  if (payload.noResolvedAnchor) {
    warn(
      'No resolved feedback anchor was found in the scan window; --since-last-resolved returned no rows.'
    );
  }
  console.log(
    table(rows, [
      { key: 'id', header: 'ID' },
      { key: 'status', header: 'STATUS' },
      { key: 'exampleId', header: 'EXAMPLE' },
      {
        key: 'feedback',
        header: 'FEEDBACK',
        format: (value) =>
          value && typeof value === 'object'
            ? `${String((value as { rating?: unknown }).rating ?? '')}/${String((value as { status?: unknown }).status ?? '')}`
            : '',
      },
      { key: 'createdAt', header: 'CREATED', format: formatTimestamp },
    ])
  );
}

export function buildRunListParams<T extends object>(
  opts: T & {
    noFeedback?: boolean;
    feedback?: boolean;
    json?: boolean;
    baseUrl?: string;
    yes?: boolean;
  }
): Record<string, string> {
  return compactParams({
    ...opts,
    feedback: undefined,
    noFeedback: opts.noFeedback ?? (opts.feedback === false ? true : undefined),
  });
}

async function updateRunFeedback(
  executionId: string,
  opts: BaseOpts & {
    status?: string;
    rating?: string;
    message?: string;
    messageFile?: string;
    expectedJson?: string;
    expectedJsonFile?: string;
    clearMessage?: boolean;
    clearRating?: boolean;
    clearExpectedJson?: boolean;
  }
) {
  const client = buildClient(opts);
  const body: Record<string, unknown> = {};
  if (opts.status) body.status = opts.status;
  if (opts.rating) body.rating = opts.rating === 'none' ? null : opts.rating;
  if (opts.clearRating) body.rating = null;
  if (opts.messageFile) body.body = await fs.readFile(opts.messageFile, 'utf-8');
  if (opts.message !== undefined) body.body = opts.message;
  if (opts.clearMessage) body.body = '';
  if (opts.expectedJsonFile)
    body.expected = JSON.parse(await fs.readFile(opts.expectedJsonFile, 'utf-8'));
  if (opts.expectedJson !== undefined) body.expected = JSON.parse(opts.expectedJson);
  if (opts.clearExpectedJson) body.expected = null;
  const payload = await client.patch(
    `/api/v1/agents/runs/${encodeURIComponent(executionId)}/feedback`,
    body
  );
  renderGeneric(payload, opts, `Updated feedback for ${executionId}`);
}

function compactRunRow(run: Record<string, unknown>) {
  const feedback =
    run.feedback && typeof run.feedback === 'object'
      ? (run.feedback as Record<string, unknown>)
      : null;
  return {
    id: run.id,
    status: run.status,
    exampleId: run.exampleId,
    feedback: feedback
      ? {
          rating: feedback.rating ?? null,
          status: feedback.status ?? null,
          updatedAt: feedback.updatedAt ?? null,
        }
      : null,
    hasExpectedJson: run.expected != null,
    expectedFileCount: Array.isArray(run.expectedFiles) ? run.expectedFiles.length : undefined,
    createdAt: run.createdAt,
    completedAt: run.completedAt,
  };
}

async function clearRunFeedback(executionId: string, opts: BaseOpts & { yes?: boolean }) {
  if (!(opts.yes || (await confirmTyped(executionId, 'clear feedback artifacts')))) {
    throw new Error('Clear cancelled');
  }
  const client = buildClient(opts);
  const payload = await client.delete(
    `/api/v1/agents/runs/${encodeURIComponent(executionId)}/feedback`
  );
  renderGeneric(payload, opts, `Cleared feedback for ${executionId}`);
}

async function listRunExpected(executionId: string, opts: BaseOpts) {
  const client = buildClient(opts);
  const payload = (await client.get(
    `/api/v1/agents/runs/${encodeURIComponent(executionId)}/expected`
  )) as { expected?: unknown; files?: Record<string, unknown>[] };
  if (opts.json) return printJson(payload);
  console.log(table(payload.files ?? [], [{ key: 'name', header: 'NAME' }]));
  if (payload.expected != null) dim('expected.json present');
}

async function pullRunExpected(executionId: string, opts: BaseOpts & { out?: string }) {
  const client = buildClient(opts);
  const payload = (await client.get(
    `/api/v1/agents/runs/${encodeURIComponent(executionId)}/expected`
  )) as { expected?: unknown; files?: Record<string, unknown>[] };
  const out = path.resolve(opts.out ?? path.join(executionId, 'expected'));
  await fs.mkdir(out, { recursive: true });
  if (payload.expected != null) {
    await fs.writeFile(path.join(out, 'expected.json'), JSON.stringify(payload.expected, null, 2));
  }
  await downloadExpectedFiles(client, executionId, out, payload.files);
  success(`Pulled expected artifacts for ${executionId} to ${out}`);
}

async function downloadExpectedFiles(
  client: ApiClient,
  executionId: string,
  out: string,
  files: unknown
): Promise<string[]> {
  const rows = Array.isArray(files) ? files : [];
  const written = await Promise.all(
    rows.map(async (file) => {
      const name = String((file as { name?: unknown }).name ?? '');
      if (!name || name.includes('/') || name.includes('..')) return null;
      const response = await client.getStream(
        `/api/v1/agents/runs/${encodeURIComponent(executionId)}/expected/${encodeURIComponent(name)}`
      );
      await fs.mkdir(out, { recursive: true });
      await fs.writeFile(path.join(out, name), Buffer.from(await response.arrayBuffer()));
      return name;
    })
  );
  return written.filter((name): name is string => Boolean(name));
}

async function uploadRunExpected(
  executionId: string,
  file: string,
  opts: BaseOpts & { name?: string }
) {
  const client = buildClient(opts);
  const form = new FormData();
  const data = await fs.readFile(file);
  form.append('file', new Blob([data]), path.basename(file));
  if (opts.name) form.append('name', opts.name);
  const payload = await client.postFormData(
    `/api/v1/agents/runs/${encodeURIComponent(executionId)}/expected`,
    form
  );
  renderGeneric(payload, opts, `Uploaded expected file for ${executionId}`);
}

async function copyOutputToExpected(
  executionId: string,
  outputFile: string,
  opts: BaseOpts & { name?: string }
) {
  const client = buildClient(opts);
  const payload = await client.post(
    `/api/v1/agents/runs/${encodeURIComponent(executionId)}/expected`,
    { outputFileName: outputFile, ...(opts.name ? { expectedName: opts.name } : {}) }
  );
  renderGeneric(payload, opts, `Copied output file to expected for ${executionId}`);
}

async function renameRunExpected(
  executionId: string,
  oldName: string,
  newName: string,
  opts: BaseOpts
) {
  const client = buildClient(opts);
  const payload = await client.patch(
    `/api/v1/agents/runs/${encodeURIComponent(executionId)}/expected/${encodeURIComponent(oldName)}`,
    { name: newName }
  );
  renderGeneric(payload, opts, `Renamed expected file for ${executionId}`);
}

async function deleteRunExpected(
  executionId: string,
  name: string,
  opts: BaseOpts & { yes?: boolean }
) {
  if (!(opts.yes || (await confirmTyped(name, 'delete expected file')))) {
    throw new Error('Delete cancelled');
  }
  const client = buildClient(opts);
  await client.delete(
    `/api/v1/agents/runs/${encodeURIComponent(executionId)}/expected/${encodeURIComponent(name)}`
  );
  renderGeneric({ ok: true }, opts, `Deleted expected file ${name}`);
}

async function watchRunCommand(
  executionId: string,
  opts: BaseOpts & { interval: number; maxWait: number; json?: boolean }
) {
  const client = buildClient(opts);
  const payload = await pollRun(client, executionId, opts.interval, opts.maxWait);
  renderRunPayload(payload, opts);
  setExitCodeForFailedTerminalRun(payload);
}

async function cancelRun(executionId: string, opts: BaseOpts & { yes?: boolean }) {
  if (!(opts.yes || process.stdin.isTTY))
    throw new Error('Pass --yes to cancel in non-interactive mode');
  const client = buildClient(opts);
  const payload = await client.post(
    `/api/v1/agents/runs/${encodeURIComponent(executionId)}/cancel`,
    {}
  );
  renderRunPayload(payload, opts);
}

async function downloadTraceText(client: ApiClient, executionId: string): Promise<string> {
  const response = await client.getStream(
    `/api/v1/agents/runs/${encodeURIComponent(executionId)}/files/trace.jsonl`
  );
  return Buffer.from(await response.arrayBuffer()).toString('utf-8');
}

export function diffJson(
  expected: unknown,
  actual: unknown,
  basePath = '$'
): Array<Record<string, string>> {
  if (expected === undefined || expected === null) return [];
  if (Object.is(expected, actual)) return [];
  if (
    expected &&
    actual &&
    typeof expected === 'object' &&
    typeof actual === 'object' &&
    !Array.isArray(expected) &&
    !Array.isArray(actual)
  ) {
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    return [...keys].flatMap((key) => {
      const next = `${basePath}.${key}`;
      if (!(key in (actual as Record<string, unknown>))) return [{ path: next, type: 'missing' }];
      if (!(key in (expected as Record<string, unknown>))) return [{ path: next, type: 'extra' }];
      return diffJson(
        (expected as Record<string, unknown>)[key],
        (actual as Record<string, unknown>)[key],
        next
      );
    });
  }
  if (Array.isArray(expected) && Array.isArray(actual)) {
    const diffs: Array<Record<string, string>> = [];
    const max = Math.max(expected.length, actual.length);
    for (let index = 0; index < max; index += 1) {
      const next = `${basePath}[${index}]`;
      if (index >= actual.length) diffs.push({ path: next, type: 'missing' });
      else if (index >= expected.length) diffs.push({ path: next, type: 'extra' });
      else diffs.push(...diffJson(expected[index], actual[index], next));
    }
    return diffs;
  }
  return [
    {
      path: basePath,
      type: 'changed',
      expected: JSON.stringify(expected),
      actual: JSON.stringify(actual),
    },
  ];
}

function fileNames(files: unknown): string[] {
  return (Array.isArray(files) ? files : [])
    .map((file) => String((file as { name?: unknown }).name ?? ''))
    .filter(Boolean)
    .sort();
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function runArtifactInventory(run: Record<string, unknown>): ArtifactInventoryRow[] {
  const rows: ArtifactInventoryRow[] = [
    { kind: 'metadata', name: 'run.json', path: 'run.json', present: 'yes' },
  ];
  if (run.inputJson != null) {
    rows.push({ kind: 'input', name: 'input.json', path: 'input.json', present: 'yes' });
  }
  if (run.metadata != null) {
    rows.push({ kind: 'metadata', name: 'metadata.json', path: 'metadata.json', present: 'yes' });
  }
  if (run.expected != null) {
    rows.push({ kind: 'expected', name: 'expected.json', path: 'expected.json', present: 'yes' });
  }
  for (const name of fileNames(run.inputFiles)) {
    rows.push({ kind: 'input', name, path: `input/${name}`, present: 'yes' });
  }
  for (const name of fileNames(run.resultFiles).filter(
    (name) => name !== 'issues.md' && name !== 'trace.jsonl'
  )) {
    rows.push({ kind: 'output', name, path: `output/${name}`, present: 'yes' });
  }
  for (const name of fileNames(run.expectedFiles)) {
    rows.push({ kind: 'expected', name, path: `expected/${name}`, present: 'yes' });
  }
  for (const name of fileNames(run.issueFiles)) {
    rows.push({ kind: 'issues', name, path: name, present: 'yes' });
  }
  for (const name of fileNames(run.traceFiles)) {
    rows.push({ kind: 'trace', name, path: name, present: 'yes' });
  }
  for (const name of fileNames(run.lockfileFiles)) {
    rows.push({ kind: 'lockfile', name, path: name, present: 'yes' });
  }
  return rows.sort((a, b) => a.path.localeCompare(b.path));
}

function normalizeGeneratedTokens(value: string): string {
  return value.replace(/\d{4}-\d{2}-\d{2}/g, '<date>').replace(/\d{8}/g, '<date>');
}

export function compareFileInventory(
  expected: string[],
  output: string[],
  normalizeDates: boolean
) {
  const normalize = (value: string) => (normalizeDates ? normalizeGeneratedTokens(value) : value);
  const outputByNormalized = new Map(output.map((name) => [normalize(name), name]));
  const expectedByNormalized = new Map(expected.map((name) => [normalize(name), name]));
  const matched = expected
    .map((expectedName) => {
      const outputName = outputByNormalized.get(normalize(expectedName));
      return outputName ? { expected: expectedName, output: outputName } : null;
    })
    .filter((match): match is { expected: string; output: string } => Boolean(match));
  return {
    matched,
    missing: expected.filter((name) => !outputByNormalized.has(normalize(name))),
    extra: output.filter((name) => !expectedByNormalized.has(normalize(name))),
  };
}

async function compareMatchedFileText(
  client: ApiClient,
  left: { runId: string; kind: 'expected' | 'output' },
  right: { runId: string; kind: 'output' },
  out: string,
  matched: Array<{ expected: string; output: string }>,
  normalizeDates: boolean
): Promise<Array<Record<string, unknown>>> {
  const expectedDir = path.join(out, 'expected');
  const outputDir = path.join(out, 'output');
  await fs.mkdir(expectedDir, { recursive: true });
  await fs.mkdir(outputDir, { recursive: true });
  const diffs: Array<Record<string, unknown>> = [];
  for (const pair of matched) {
    const expectedPath = path.join(expectedDir, pair.expected);
    const outputPath = path.join(outputDir, pair.output);
    await downloadStreamToFile(client, runFileUrl(left, pair.expected), expectedPath);
    await downloadStreamToFile(client, runFileUrl(right, pair.output), outputPath);
    const expectedText = extractComparableText(expectedPath);
    const outputText = extractComparableText(outputPath);
    if (expectedText.text == null || outputText.text == null) {
      const [expectedBuffer, outputBuffer] = await Promise.all([
        fs.readFile(expectedPath),
        fs.readFile(outputPath),
      ]);
      const expectedHash = createHash('sha256').update(expectedBuffer).digest('hex');
      const outputHash = createHash('sha256').update(outputBuffer).digest('hex');
      diffs.push({
        ...pair,
        status:
          expectedBuffer.length === outputBuffer.length && expectedHash === outputHash
            ? 'binary-match'
            : 'binary-different',
        expectedBytes: expectedBuffer.length,
        outputBytes: outputBuffer.length,
        expectedSha256: expectedHash,
        outputSha256: outputHash,
        textExtraction: {
          expected: expectedText.reason ?? null,
          output: outputText.reason ?? null,
        },
      });
      continue;
    }
    const normalize = (value: string) =>
      normalizeDates ? normalizeGeneratedTokens(value).trim() : value.trim();
    diffs.push({
      ...pair,
      status:
        normalize(expectedText.text) === normalize(outputText.text) ? 'match' : 'text-different',
    });
  }
  return diffs;
}

function runFileUrl(side: { runId: string; kind: 'expected' | 'output' }, name: string): string {
  const runId = encodeURIComponent(side.runId);
  const filename = encodeURIComponent(name);
  return side.kind === 'expected'
    ? `/api/v1/agents/runs/${runId}/expected/${filename}`
    : `/api/v1/agents/runs/${runId}/files/output/${filename}`;
}

function encodeRunArtifactPath(artifactPath: string): string {
  return artifactPath.split('/').map(encodeURIComponent).join('/');
}

async function downloadStreamToFile(client: ApiClient, url: string, target: string): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const response = await client.getStream(url);
  await fs.writeFile(target, Buffer.from(await response.arrayBuffer()));
}

function extractComparableText(file: string): { text: string | null; reason?: string } {
  const ext = path.extname(file).toLowerCase();
  if (['.txt', '.md', '.json', '.csv', '.xml'].includes(ext)) {
    return { text: readFileSync(file, 'utf8') };
  }
  if (ext === '.pdf') {
    const result = spawnSync('pdftotext', [file, '-'], { encoding: 'utf8' });
    return result.status === 0
      ? { text: result.stdout }
      : { text: null, reason: textExtractionFallbackReason('pdftotext', result) };
  }
  if (ext === '.docx') {
    const script =
      "import re,sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); x=z.read('word/document.xml').decode('utf-8','ignore'); print(re.sub('<[^>]+>',' ',x))";
    const result = spawnSync('python3', ['-c', script, file], { encoding: 'utf8' });
    return result.status === 0
      ? { text: result.stdout }
      : { text: null, reason: textExtractionFallbackReason('python3', result) };
  }
  return { text: null, reason: `No text extractor for ${ext || 'extensionless'} files` };
}

function textExtractionFallbackReason(tool: string, result: ReturnType<typeof spawnSync>): string {
  if (result.error) return `${tool} unavailable; compared bytes instead`;
  return `${tool} could not extract text; compared bytes instead`;
}

function renderComparisonReport(report: {
  status: string;
  warnings?: string[];
  jsonDifferences: unknown[];
  missingFiles: string[];
  extraFiles: string[];
  matchedFiles: unknown[];
  textDifferences: Array<Record<string, unknown>>;
}) {
  const header = `Comparison ${report.status}`;
  if (report.status === 'pass') {
    success(header);
  } else {
    error(header);
  }
  for (const warning of report.warnings ?? []) {
    dim(`warning: ${warning}`);
  }
  console.log(
    table(
      [
        { item: 'JSON differences', count: report.jsonDifferences.length },
        { item: 'Matched files', count: report.matchedFiles.length },
        { item: 'Missing files', count: report.missingFiles.length },
        { item: 'Extra files', count: report.extraFiles.length },
        {
          item: 'Text differences',
          count: report.textDifferences.filter((diff) => diff.status === 'text-different').length,
        },
      ],
      [
        { key: 'item', header: 'ITEM' },
        { key: 'count', header: 'COUNT' },
      ]
    )
  );
  for (const diff of report.textDifferences) {
    const textExtraction = diff.textExtraction as
      | { expected?: unknown; output?: unknown }
      | undefined;
    const reasons = [textExtraction?.expected, textExtraction?.output]
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .filter((value, index, values) => values.indexOf(value) === index);
    for (const reason of reasons) {
      dim(`warning: ${String(diff.expected)} vs ${String(diff.output)}: ${reason}`);
    }
  }
}
