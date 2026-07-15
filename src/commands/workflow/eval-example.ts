/**
 * Run dataset examples through the SERVER's example-run path so the workflow's
 * configured evaluators score them automatically, and surface the real
 * evaluator results (weighted score + per-evaluator pass/fail).
 *
 * A dataset example is server-side data: running `--example <name>` resolves
 * the pushed example, starts it via
 * `POST /api/v1/automations/{id}/examples/{exampleId}/run` (which tags the run
 * as an eval run so the worker runs `evalConfigYaml` evaluators), then waits
 * for the evaluator results to land.
 *
 * When the workflow has no evaluators configured, there is nothing to score, so
 * we fall back to a local structural diff of the run output against the
 * example's stored `expected` (see `grade-example.ts`).
 *
 * Timing note: an execution flips to `completed` BEFORE the worker runs
 * post-execution evaluators, so the run (and its batch) can read terminal while
 * the evaluator rollup is still unwritten. We therefore wait on the run's
 * `eval.passed` becoming non-null (the rollup write), not on terminal status.
 */

import { env } from '../../env';
import type { ApiClient } from '../../lib/client';
import {
  type ExecutionArtifactPayload,
  writeExecutionArtifacts,
} from '../../lib/execution-artifacts';
import { formatCliError } from '../../lib/format-error';
import { gradeAgainstExpected } from '../../lib/grade-example';
import { resolveEvalBaseDir } from '../../lib/payload';
import { dim, info, ui, warn } from '../../lib/ui';

const RUN_POLL_INTERVAL_MS = 2000;
const RUN_MAX_WAIT_MS = 5 * 60 * 1000;
/**
 * Extra time to wait for evaluator results after the run reaches terminal.
 * `EIGENPAL_EVAL_GRACE_MS` is a test-only override so integration tests can
 * exercise the rollup-timeout path without waiting the real 90s.
 */
function resolveEvalGraceMs(): number {
  const raw = env.EIGENPAL_EVAL_GRACE_MS;
  if (raw !== undefined) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return 90 * 1000;
}
export const EVAL_GRACE_MS = resolveEvalGraceMs();
const EVAL_POLL_INTERVAL_MS = 2000;
const EXAMPLE_PAGE_SIZE = 100; // public examples list `limit` max.

export type RunOutcome = 'ok' | 'error';
export type GradeMode = 'evaluators' | 'diff' | 'none';

export interface EvaluatorScore {
  name: string;
  score: number | null;
  passed: boolean | null;
  weight: number | null;
  error: string | null;
}

export interface ExampleEvalResult {
  name: string;
  exampleId?: string;
  executionId?: string;
  run: RunOutcome;
  runError?: string;
  mode: GradeMode;
  /** evaluators mode: rollup weighted score and pass. */
  score?: number | null;
  passed?: boolean | null;
  evaluators?: EvaluatorScore[];
  /** diff mode: structural match vs the stored expected output. */
  matched?: boolean;
  diffCount?: number;
  diffs?: string[];
}

export interface EvalRunSummary {
  workflow: string;
  mode: GradeMode;
  total: number;
  ok: number;
  errored: number;
  /** Examples that produced a grade (an evaluator score, or a diff verdict). */
  graded: number;
  /** Graded examples that passed (evalPassed, or structural match). */
  passedCases: number;
  /** Graded examples that did not pass. */
  failedCases: number;
  /** Examples that ran ok but could not be graded. */
  ungraded: number;
  /** Mean of per-example evaluator scores (evaluators mode only). */
  weightedAvg: number | null;
  examples: ExampleEvalResult[];
  // Back-compat aliases: execution success/failure, NOT accuracy.
  passed: number;
  failed: number;
}

interface ExampleRow {
  id: string;
  expected: unknown;
}

interface EvalResultRow {
  evaluatorName?: string;
  score?: number | string | null;
  passed?: boolean | null;
  weight?: number | string | null;
  error?: string | null;
}

interface RunView {
  finished?: boolean;
  execution?: { status?: string };
  status?: string;
  error?: string | null;
  output?: unknown;
  result?: { output?: unknown; error?: string | null } | null;
  eval?: { score?: number | null; passed?: boolean | null } | null;
  timing?: { createdAt?: string | null; completedAt?: string | null };
}

const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'rejected', 'timeout']);

function fmtScore(score: number | null | undefined): string {
  return typeof score === 'number' ? score.toFixed(2) : 'n/a';
}

function toNumberOrNull(value: number | string | null | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function runOutput(run: RunView): unknown {
  return run.output !== undefined ? run.output : run.result?.output;
}

/** Whether the workflow has any evaluator configured. */
export async function fetchHasEvaluators(client: ApiClient, workflowId: string): Promise<boolean> {
  const cfg = (await client.get(`/api/v1/automations/${workflowId}/evaluators`)) as {
    config?: { evaluators?: unknown[] };
  };
  return Array.isArray(cfg.config?.evaluators) && cfg.config.evaluators.length > 0;
}

/** Resolve an example NAME to its server id + stored expected output. */
async function resolveExample(
  client: ApiClient,
  workflowId: string,
  name: string
): Promise<ExampleRow | null> {
  let offset = 0;
  for (;;) {
    const page = (await client.get(`/api/v1/automations/${workflowId}/examples`, {
      limit: String(EXAMPLE_PAGE_SIZE),
      offset: String(offset),
    })) as { data?: Array<{ id: string; name?: string | null; expected?: unknown }> };
    const rows = page.data ?? [];
    const hit = rows.find((r) => r.name === name);
    if (hit) return { id: hit.id, expected: hit.expected };
    if (rows.length < EXAMPLE_PAGE_SIZE) return null;
    offset += rows.length;
  }
}

async function pollRunTerminal(client: ApiClient, runId: string): Promise<RunView> {
  const start = Date.now();
  const base = `/api/v1/runs/${encodeURIComponent(runId)}`;
  for (;;) {
    const run = (await client.get(base)) as RunView;
    const status = run.execution?.status ?? run.status;
    if (run.finished || (status && TERMINAL.has(status))) {
      return (await client.get(`${base}?expand=execution`)) as RunView;
    }
    if (Date.now() - start > RUN_MAX_WAIT_MS) {
      return { ...run, status: 'timeout', execution: { status: 'timeout' } };
    }
    await new Promise((r) => setTimeout(r, RUN_POLL_INTERVAL_MS));
  }
}

/**
 * Wait for the evaluator rollup to be written. The worker sets the execution to
 * `completed` BEFORE running evaluators, then writes per-evaluator rows and the
 * rollup (`evalScore`/`evalPassed`) together. `evalPassed` is non-null exactly
 * once that rollup write lands (even when the weighted score is null, e.g. all
 * evaluators are zero-weight), so it is the authoritative "evaluators finished"
 * signal and avoids reading a half-written rollup. Returns the rollup, or null
 * if nothing landed within the grace window (no evaluators actually scored).
 *
 * Shared with the agent example-run path (`runs.ts:runExample`) — agent runs
 * write the same rollup shape onto `agent_executions`.
 */
export async function pollEvalRollup(
  client: ApiClient,
  runId: string
): Promise<{ score: number | null; passed: boolean | null } | null> {
  const start = Date.now();
  for (;;) {
    const run = (await client.get(`/api/v1/runs/${encodeURIComponent(runId)}`)) as RunView;
    if (run.eval && run.eval.passed != null) {
      return { score: run.eval.score ?? null, passed: run.eval.passed };
    }
    if (Date.now() - start > EVAL_GRACE_MS) return null;
    await new Promise((r) => setTimeout(r, EVAL_POLL_INTERVAL_MS));
  }
}

/** Fetch the per-evaluator result rows for one run from its experiment batch. */
async function fetchEvalRows(
  client: ApiClient,
  workflowId: string,
  batchId: string,
  runId: string
): Promise<EvalResultRow[]> {
  const detail = (await client.get(`/api/v1/automations/${workflowId}/experiments/${batchId}`)) as {
    resultsByRun?: Record<string, EvalResultRow[]>;
  };
  return detail.resultsByRun?.[runId] ?? [];
}

function toArtifactPayload(run: RunView, runId: string): ExecutionArtifactPayload {
  return {
    executionId: runId,
    status: run.execution?.status ?? run.status ?? 'unknown',
    createdAt: run.timing?.createdAt ?? new Date().toISOString(),
    completedAt: run.timing?.completedAt ?? null,
    error: run.error !== undefined ? run.error : (run.result?.error ?? null),
    output: runOutput(run),
    stepExecutions: [],
  };
}

/**
 * Run each named example through the server eval path and grade it. `dir` is the
 * local project root used only for best-effort artifact writing.
 */
export async function runWorkflowExamplesWithEval(
  client: ApiClient,
  dir: string,
  workflowIdOrSlug: string,
  workflowId: string,
  exampleNames: string[]
): Promise<EvalRunSummary> {
  const hasEvaluators = await fetchHasEvaluators(client, workflowId);
  const mode: GradeMode = hasEvaluators ? 'evaluators' : 'diff';

  info(
    `Running ${ui.bold(`"${workflowIdOrSlug}"`)} ${ui.dim(`(${workflowId}, ${exampleNames.length} example(s))`)}`
  );
  dim(
    hasEvaluators
      ? 'Server example run; grading with configured evaluators.'
      : 'Server example run; no evaluators configured, grading by structural diff vs expected.'
  );

  const evalBaseDir = resolveEvalBaseDir(dir);
  const results: ExampleEvalResult[] = [];

  for (const name of exampleNames) {
    process.stderr.write(`${ui.dim('→')} ${name}\n`);
    try {
      const example = await resolveExample(client, workflowId, name);
      if (!example) {
        throw new Error(
          `example "${name}" not found in the server dataset for ${workflowId}. ` +
            `Push it first: eigenpal workflow dataset push ${workflowId}`
        );
      }

      const started = (await client.post(
        `/api/v1/automations/${workflowId}/examples/${example.id}/run`,
        {}
      )) as { id?: string; batchId?: string | null };
      const runId = started.id;
      if (typeof runId !== 'string') throw new Error('Example run did not return a run id');
      process.stderr.write(`  ${ui.dim(`run: ${runId}`)}\n`);

      const run = await pollRunTerminal(client, runId);
      const status = run.execution?.status ?? run.status;
      const runOk = status === 'completed';

      const result: ExampleEvalResult = {
        name,
        exampleId: example.id,
        executionId: runId,
        run: runOk ? 'ok' : 'error',
        runError: runOk ? undefined : (run.error ?? status ?? 'unknown'),
        mode: 'none',
      };

      if (runOk && hasEvaluators && started.batchId) {
        const rollup = await pollEvalRollup(client, runId);
        if (rollup) {
          const rows = await fetchEvalRows(client, workflowId, started.batchId, runId);
          result.mode = 'evaluators';
          result.score = rollup.score;
          result.passed = rollup.passed;
          result.evaluators = rows.map((r) => ({
            name: r.evaluatorName ?? 'evaluator',
            score: toNumberOrNull(r.score),
            passed: r.passed ?? null,
            weight: toNumberOrNull(r.weight),
            error: r.error ?? null,
          }));
        } else {
          // No rollup landed (e.g. the config dispatched no scoring evaluator).
          // Fall back to a structural diff so the example still gets a verdict.
          warn(`  ${name}: no evaluator score after ${EVAL_GRACE_MS / 1000}s; grading by diff.`);
          gradeByDiff(result, example.expected, runOutput(run));
        }
      } else if (runOk) {
        gradeByDiff(result, example.expected, runOutput(run));
      }

      results.push(result);
      reportLine(result);

      // Best-effort local artifact write when run from a project dir.
      if (evalBaseDir) {
        try {
          await writeExecutionArtifacts(
            client,
            `${evalBaseDir}/${name}`,
            toArtifactPayload(run, runId)
          );
        } catch {
          // Artifact write is non-essential; never fail the run on it.
        }
      }
    } catch (err) {
      const result: ExampleEvalResult = {
        name,
        run: 'error',
        runError: formatCliError(err),
        mode: 'none',
      };
      results.push(result);
      reportLine(result);
    }
  }

  const summary = summarize(workflowIdOrSlug, mode, results);
  process.stderr.write(`\n${formatEvalSummary(summary)}\n`);
  return summary;
}

function gradeByDiff(result: ExampleEvalResult, expected: unknown, output: unknown): void {
  if (expected === undefined || expected === null) {
    result.mode = 'none';
    return;
  }
  const graded = gradeAgainstExpected(expected, output);
  result.mode = 'diff';
  result.matched = graded.matched;
  result.diffCount = graded.diffs.length;
  result.diffs = graded.diffs.length ? graded.diffs : undefined;
}

// --- Pure rendering + summary (exported for tests) ---

/** Render the lines for one example: a status line plus per-evaluator detail. */
export function formatExampleLines(result: ExampleEvalResult): string {
  if (result.run === 'error') {
    return `${result.name}  ${ui.err(`err ${result.runError ?? ''}`.trimEnd())}`;
  }
  if (result.mode === 'evaluators') {
    const verdict = result.passed === true ? ui.ok('PASS') : ui.err('FAIL');
    const head = `${result.name}  ${ui.ok('ok')}  score ${fmtScore(result.score)}  ${verdict}`;
    const detail = (result.evaluators ?? []).map((e) => {
      const mark = e.error
        ? ui.warn('error')
        : e.passed === true
          ? ui.ok('pass')
          : e.passed === false
            ? ui.err('fail')
            : ui.dim('n/a');
      return `    ${e.name}  ${fmtScore(e.score)}  ${mark}`;
    });
    return [head, ...detail].join('\n');
  }
  if (result.mode === 'diff') {
    const verdict = result.matched ? ui.ok('PASS') : ui.err(`FAIL (${result.diffCount} diff)`);
    return `${result.name}  ${ui.ok('ok')}  ${verdict}`;
  }
  return `${result.name}  ${ui.ok('ok')}  ${ui.dim('-')}`;
}

function reportLine(result: ExampleEvalResult): void {
  // Human output goes to stderr so stdout stays clean for `--json` payloads.
  process.stderr.write(`${formatExampleLines(result)}\n`);
}

export function summarize(
  workflow: string,
  mode: GradeMode,
  examples: ExampleEvalResult[]
): EvalRunSummary {
  const ok = examples.filter((r) => r.run === 'ok').length;
  const errored = examples.length - ok;
  const gradedResults = examples.filter((r) => r.mode === 'evaluators' || r.mode === 'diff');
  // A graded case passes only on an explicit positive verdict: `passed === true`
  // for evaluators, `matched === true` for the structural diff. Anything else
  // (false, or an unexpected null) counts as a failure so `--fail-on-mismatch`
  // never lets an ungraded-but-claimed-evaluators row slip through.
  const passedCases = gradedResults.filter((r) =>
    r.mode === 'evaluators' ? r.passed === true : r.matched === true
  ).length;
  const scores = gradedResults
    .filter((r) => r.mode === 'evaluators' && typeof r.score === 'number')
    .map((r) => r.score as number);
  return {
    workflow,
    mode,
    total: examples.length,
    ok,
    errored,
    graded: gradedResults.length,
    passedCases,
    failedCases: gradedResults.length - passedCases,
    ungraded: ok - gradedResults.length,
    weightedAvg: scores.length ? scores.reduce((s, n) => s + n, 0) / scores.length : null,
    examples,
    passed: ok,
    failed: errored,
  };
}

/** Two-signal summary: execution health and accuracy (evaluator or structural). */
export function formatEvalSummary(summary: EvalRunSummary): string {
  const lines: string[] = [];
  let line = `${ui.bold('Ran')} ${summary.total}: ${ui.ok(`${summary.ok} ok`)}`;
  if (summary.errored > 0) line += `, ${ui.err(`${summary.errored} errored`)}`;
  if (summary.graded > 0) {
    const allPass = summary.failedCases === 0;
    if (summary.mode === 'evaluators') {
      const cases = `${summary.passedCases}/${summary.graded} cases pass`;
      const weighted =
        summary.weightedAvg != null ? `weighted ${summary.weightedAvg.toFixed(2)}, ` : '';
      line += `  ${ui.dim('/')}  ${weighted}${allPass ? ui.ok(cases) : ui.err(cases)}`;
    } else {
      const acc = `${summary.passedCases}/${summary.graded} matched`;
      line += `  ${ui.dim('/')}  accuracy ${allPass ? ui.ok(acc) : ui.err(acc)}`;
    }
  }
  lines.push(line);
  if (summary.ungraded > 0) {
    lines.push(ui.dim(`  ${summary.ungraded} ungraded (no stored expected output)`));
  }
  return lines.join('\n');
}
