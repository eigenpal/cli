/**
 * `eigenpal workflow ...` namespace — every workflow operation lives here,
 * grouped by sub-entity (dataset, experiment, execution, version, …) so the
 * help tree mirrors the data model. Top-level verbs (`list`, `push`, `pull`,
 * `clear`) operate on the workflow itself; sub-namespaces operate on its
 * owned resources.
 *
 * Descriptions still come from `WORKFLOW_TOOL_METADATA` in `@eigenpal/types`
 * so the same prose ships in every surface that documents these operations.
 */

import { WORKFLOW_TOOL_METADATA, type WorkflowToolName } from '@eigenpal/types';
import { InvalidArgumentError, type Command } from 'commander';
import { zipSync } from 'fflate';
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import type { ZodType } from 'zod';

import type { ApiClient } from '../../lib/client';
import { ApiClient as Client } from '../../lib/client';
import { requireApiKey, resolveConfig } from '../../lib/config';
import { formatEigenpalDirIfAvailable } from '../../lib/format-eigenpal';
import { action } from '../../lib/format-error';
import { resolveWorkflowId } from '../../lib/resolve-workflow';
import {
  addJsonFlag,
  error,
  formatTimestamp,
  intArg,
  renderListResult,
  success,
  ui,
  warn,
  withBaseUrl,
  withPagination,
  type PaginationOpts,
} from '../../lib/ui';
import { clearEvalOutputs } from '../clear';
import { registerWorkflowExecutionCommands } from '../execution';
import {
  printIssues,
  registerAllValidateCommand,
  registerDatasetValidateCommand,
  registerEvaluatorsValidateCommand,
} from '../validate';
import { registerEvaluatorTypeCommands } from './evaluator-type';
import {
  buildBatchDiff,
  fetchEvalResults,
  normalizeCompareSort,
  renderBatchDiffHuman,
} from './experiment-compare';
import { registerStepExecCommands } from './step-exec';

/**
 * Typed-slug-style TTY confirmation. The dashboard requires the user to
 * type the workflow id back; we ask for the same here. Returns true only
 * on an exact match. Always false for non-TTY (the caller has already
 * checked, but we double-check defensively).
 */
async function confirmReplace(workflowId: string): Promise<boolean> {
  if (!process.stdout.isTTY || !process.stdin.isTTY) return false;
  process.stderr.write(
    `\n  ${ui.warn('!')} ${ui.bold('About to REPLACE every eval example for workflow:')}\n    ${ui.bold(workflowId)}\n` +
      `  ${ui.dim('This deletes existing examples and their files. Cannot be undone.')}\n\n` +
      `  Type the workflow id to confirm, or press Enter to abort: `
  );
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = (await rl.question('')).trim();
    return answer === workflowId;
  } finally {
    rl.close();
  }
}

interface WorkflowCommandConfig {
  dir?: string;
  baseUrl?: string;
}

function buildClient(opts: WorkflowCommandConfig): ApiClient {
  const config = resolveConfig(opts);
  requireApiKey(config);
  return new Client(config);
}

/**
 * Convenience for the dozen-plus commands that take `<workflow-id>` and
 * immediately need both an authenticated client and a resolved
 * server-side id. Replaces the two-line:
 *
 *   const client = buildClient(opts);
 *   const workflowId = await resolveWorkflowId(client, workflow);
 *
 * with a single destructured call. Kept intentionally small — anything
 * fancier (e.g. wrapping the whole Commander action) would have to thread
 * Commander's positional/options shape through generics, which costs more
 * in type noise than the boilerplate it removes.
 */
async function buildClientForWorkflow(
  workflowIdOrSlug: string,
  opts: WorkflowCommandConfig
): Promise<{ client: ApiClient; workflowId: string }> {
  const client = buildClient(opts);
  const workflowId = await resolveWorkflowId(client, workflowIdOrSlug);
  return { client, workflowId };
}

function descriptionFor(tool: WorkflowToolName): string {
  return WORKFLOW_TOOL_METADATA[tool].description;
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

/** Loose row shapes — list endpoints aren't strongly typed in the CLI. */
interface WorkflowListRow {
  id: string;
  currentVersion?: { version?: string; definition?: { name?: string } } | null;
  updatedAt?: string | null;
  [k: string]: unknown;
}

interface DatasetExampleRow {
  id: string;
  name?: string | null;
  rowOrder?: number | null;
  triggerInput?: Record<string, unknown> | null;
  updatedAt?: string | null;
  [k: string]: unknown;
}

interface ExperimentRow {
  batchId?: string | null;
  status?: string | null;
  total?: number | null;
  passRate?: number | null;
  evalScore?: number | null;
  [k: string]: unknown;
}

interface VersionRow {
  id: string;
  version?: string | null;
  isCurrent?: boolean | null;
  createdAt?: string | null;
  [k: string]: unknown;
}

/**
 * Best-effort extract of a top-level `version: X.Y.Z` from workflow YAML
 * without parsing the whole document. Returns null when missing or malformed.
 * The server validates with a real semver regex; this is just to forward the
 * value the user already wrote.
 */
function extractWorkflowVersion(yaml: string): string | null {
  // Match a top-level `version: 1.2.3` line (no leading indent, optional quotes).
  const match = yaml.match(/^version:\s*['"]?(\d+\.\d+\.\d+)['"]?\s*$/m);
  return match ? match[1] : null;
}

async function writeOrPrint(out: string | undefined, content: string | Buffer): Promise<void> {
  if (out) {
    await fs.writeFile(out, content);
    // Status line goes to stderr so stdout stays clean for piping.
    process.stderr.write(`${ui.ok('✓')} Wrote ${ui.bold(out)}\n`);
    return;
  }
  process.stdout.write(content);
}

/** Walk `dir` recursively and return entries keyed by POSIX-style relative
 *  path. Skips dotfiles (`.DS_Store`, `.git/`) and any node_modules/. Used
 *  by `dataset push` to zip a folder on the fly so the user doesn't have to
 *  pre-zip when the skill recipes show `--file dataset/`. */
async function readDirAsZip(dir: string): Promise<Uint8Array> {
  const tree: Record<string, Uint8Array> = {};
  async function walk(current: string, relPrefix: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const full = path.join(current, e.name);
      const rel = relPrefix ? `${relPrefix}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(full, rel);
      else if (e.isFile()) tree[rel] = new Uint8Array(await fs.readFile(full));
    }
  }
  await walk(dir, '');
  if (Object.keys(tree).length === 0) {
    throw new Error(`directory is empty: ${dir}`);
  }
  return zipSync(tree);
}

/**
 * Stream a binary export route to a file on disk and log the byte count.
 * Used by `dataset pull` and `experiment results`.
 */
async function downloadStreamToFile(
  client: ApiClient,
  path: string,
  outFile: string | undefined
): Promise<void> {
  const res = await client.getStream(path);
  const buf = Buffer.from(await res.arrayBuffer());
  if (outFile) {
    await fs.writeFile(outFile, buf);
    // Status line on stderr so stdout stays clean for piping.
    process.stderr.write(
      `${ui.ok('✓')} Wrote ${ui.bold(outFile)} ${ui.dim(`(${buf.byteLength} bytes)`)}\n`
    );
    return;
  }
  // No --out → pipe to stdout. Caller can `| jq`, `> file.csv`, etc.
  process.stdout.write(buf);
}

/**
 * POST a multipart form to a streaming route. Thin wrapper over
 * `client.postFormDataStream` that converts a non-OK response into the
 * `{ status, body }` shape `printApiError` understands, so dataset push
 * surfaces structured validation issues + hint instead of a raw HTTP code.
 */
async function postMultipart(
  client: ApiClient,
  path: string,
  formData: FormData
): Promise<Response> {
  const res = await client.postFormDataStream(path, formData);
  if (res.ok) return res;
  // Pre-stream failures (auth, payload too large, validation of the wrapper
  // request) come back through the standard error envelope — surface as
  // `{ status, body }` so printApiError renders issues + hint.
  const body = await res.text();
  try {
    throw { status: res.status, body: JSON.parse(body) };
  } catch (e) {
    if (e && typeof e === 'object' && 'body' in e) throw e;
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
}

/** Parse an NDJSON response body into a list of objects. Unparseable lines
 *  fall through as `{ phase: 'unparseable', raw }` so the terminal-frame
 *  inspection still works on partial responses. */
function parseNdjsonEvents(text: string): Array<Record<string, unknown>> {
  return text
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line): Record<string, unknown> => {
      try {
        return JSON.parse(line);
      } catch {
        return { phase: 'unparseable', raw: line };
      }
    });
}

// ---------------------------------------------------------------------------
// register
// ---------------------------------------------------------------------------

export function registerWorkflowCommands(program: Command): void {
  const workflow = program
    .command('workflow')
    .description('Manage workflows: push, pull, run, evaluate.')
    .addHelpText(
      'after',
      `
<workflow-id> accepts a wf_… id (preferred for scripts) or the slug (the
YAML's \`name:\` field). Both:

  $ eigenpal workflow pull wf_abc123
  $ eigenpal workflow pull my-extraction
`
    );

  // The "core" verbs operating on the workflow itself live directly on
  // `workflow` (list / push / pull) so the most-used commands have one less
  // hop. Everything else groups under its data-model noun (evaluators,
  // dataset, experiment, execution, versions, step-type) so the help tree
  // mirrors the model. When `eigenpal agent` gets built, mirror this exactly.
  registerWorkflowCoreCommands(workflow);
  registerEvaluatorsCommands(workflow);
  registerDatasetCommands(workflow);
  registerExperimentCommands(workflow);
  registerWorkflowExecutionCommands(workflow);
  registerVersionsCommands(workflow);
  registerStepTypeCommands(workflow);
  // Sibling to `step-type` — evaluators have their own schema shape (no
  // input/output flow, no `with`-key convention) so they live in a parallel
  // namespace rather than confusing the step-type registry.
  registerEvaluatorTypeCommands(workflow);

  // Project-root convenience: `workflow validate` (no subcommand) runs all
  // three local checks against ./workflow.yaml + ./evaluators.yaml + ./dataset/
  // — the templated layout `init workflow` produces. For targeted validation
  // use `workflow evaluators validate` or `workflow dataset validate`.
  registerAllValidateCommand(workflow);

  // Local-only artifact cleanup. Lives under workflow because artifacts are
  // written under ./dataset/examples/<example>/executions/.
  registerClearLocalCommand(workflow);

  // Single-step execution. The previous local-runner implementation was
  // removed (it diverged from production worker behavior and assumed shell
  // env state real CLI users don't have). Currently a placeholder that
  // exits 2 with a redirect to `workflow run` / `experiment run`. EIG-104
  // tracks the server-side redesign that will restore single-step execution
  // through a thin POST → /api/v1/workflows/step-exec.
  registerStepExecCommands(workflow);
}

// ---------------------------------------------------------------------------
// workflow core verbs (list / push / pull) — directly on `workflow` so the
// most-used operations have one less hop.
// ---------------------------------------------------------------------------

function registerWorkflowCoreCommands(parent: Command): void {
  const listCmd = parent
    .command('list')
    .description(descriptionFor('workflow_list'))
    .option('--search <q>', 'Filter by name');
  addJsonFlag(withBaseUrl(withPagination(listCmd))).action(
    action(
      async (
        opts: WorkflowCommandConfig &
          PaginationOpts & {
            search?: string;
            json?: boolean;
          }
      ) => {
        const client = buildClient(opts);
        const params: Record<string, string> = {
          limit: String(opts.limit),
          offset: String(opts.offset),
        };
        if (opts.search) params.search = opts.search;
        const raw = await client.get('/api/v1/workflows', params);
        renderListResult<WorkflowListRow>(
          raw,
          [
            { key: 'id', header: 'id' },
            {
              key: 'currentVersion',
              header: 'name',
              format: (_v, row) => row.currentVersion?.definition?.name ?? '-',
            },
            {
              key: 'currentVersion',
              header: 'version',
              format: (_v, row) => row.currentVersion?.version ?? '-',
            },
            { key: 'updatedAt', header: 'updatedAt', format: formatTimestamp },
          ],
          { ...opts, entityLabel: 'workflow' }
        );
      }
    )
  );

  const pullCmd = parent
    .command('pull <workflow-id>')
    .description(descriptionFor('workflow_get_definition'))
    .option('--out <path>', 'Write YAML to file instead of stdout');
  withBaseUrl(pullCmd).action(
    action(async (workflow: string, opts: WorkflowCommandConfig & { out?: string }) => {
      const { client, workflowId } = await buildClientForWorkflow(workflow, opts);
      const result = (await client.get(`/api/v1/workflows/${workflowId}`)) as {
        currentVersion?: { yamlContent?: string };
      };
      const yaml = result?.currentVersion?.yamlContent ?? '';
      await writeOrPrint(opts.out, yaml);
    })
  );

  const pushCmd = parent
    .command('push')
    .description(descriptionFor('workflow_set_definition'))
    // `--file` is no longer `requiredOption` so the TTY prompt can fill it
    // in interactively (CI without `--file` still errors fast — the prompt
    // is gated on `process.stdout.isTTY`).
    .option('--file <yaml>', 'Path to YAML file')
    .option('--workflow-id <id>', 'Update existing workflow (default: create new)')
    .option(
      '--bump <level>',
      "Auto-bump from the server's current version: patch | minor | major. Mutually exclusive with `--version` and with a top-level `version:` in the YAML."
    )
    .option(
      '--set-version <semver>',
      'Push at this exact semver (e.g. 1.4.0). Mutually exclusive with `--bump` and with a top-level `version:` in the YAML. (Named `--set-version` to avoid the global `-v, --version` flag.)'
    )
    .addHelpText(
      'after',
      `
Examples:
  $ eigenpal workflow push --file workflow.yaml
  $ eigenpal workflow push --file workflow.yaml --workflow-id wf_abc123
  $ eigenpal workflow push --file workflow.yaml --workflow-id wf_abc123 --bump patch
  $ eigenpal workflow push --file workflow.yaml --workflow-id wf_abc123 --set-version 2.0.0
  $ eigenpal workflow push --file workflow.yaml --json | jq '.id'

Update path requires the YAML to carry a top-level \`version: X.Y.Z\`, OR for
\`--bump\` / \`--set-version\` to be passed (they splice the resolved semver
into the YAML before sending so the file-on-disk doesn't have to be edited
per push). Passing both an explicit \`version:\` in the YAML and
\`--bump\` / \`--set-version\` on the command line is rejected.
\`--set-version\` is the long form because the global \`-v, --version\`
flag would otherwise shadow it. Validation failures come back as
\`{ issues: [{ field, message, code }], hint }\`; follow the hint and re-run
\`workflow step-type get <type>\` to see the authoritative config schema.
`
    );
  addJsonFlag(withBaseUrl(pushCmd)).action(
    action(
      async (
        opts: WorkflowCommandConfig & {
          file?: string;
          workflowId?: string;
          bump?: string;
          setVersion?: string;
          json?: boolean;
        }
      ) => {
        if (opts.bump && opts.setVersion) {
          throw new Error('Pass either --bump or --set-version, not both.');
        }
        if (opts.bump && !isBumpLevel(opts.bump)) {
          throw new Error(`--bump must be one of: patch, minor, major (got "${opts.bump}").`);
        }
        if (opts.setVersion && !SEMVER_RE.test(opts.setVersion)) {
          throw new Error(`--set-version must be bare semver X.Y.Z (got "${opts.setVersion}").`);
        }

        // TTY-only convenience prompt for --file. Gating on stdout.isTTY (and
        // requiring stdin too, to avoid eating piped data) keeps CI behavior
        // unchanged: scripts without --file still get the existing
        // "required option" error from Commander's manual check below.
        let filePath = opts.file;
        if (!filePath) {
          if (process.stdout.isTTY && process.stdin.isTTY) {
            const { text, isCancel, cancel } = await import('@clack/prompts');
            const answer = await text({
              message: 'Path to workflow YAML',
              placeholder: 'workflow.yaml',
              defaultValue: 'workflow.yaml',
              validate: (value) => {
                const p = value || 'workflow.yaml';
                if (!existsSync(p)) return `Not found: ${p}`;
                return undefined;
              },
            });
            if (isCancel(answer)) {
              cancel('Cancelled.');
              process.exit(1);
            }
            filePath = (answer as string) || 'workflow.yaml';
          } else {
            throw new Error('Missing --file <yaml>.');
          }
        }

        const yamlOnDisk = await fs.readFile(filePath, 'utf8');
        const client = buildClient(opts);

        if (opts.workflowId) {
          // Resolve `--workflow-id <wf_… or slug>` to a concrete id before
          // any API call so error messages, splice logic and PATCH URLs all
          // see the same value.
          const workflowId = await resolveWorkflowId(client, opts.workflowId);
          // Update path: the server's POST /api/v1/workflows/:id/versions
          // requires a `version` body param. Resolve it from one of three
          // mutually-exclusive sources:
          //   1) `--version X.Y.Z` — explicit override
          //   2) `--bump patch|minor|major` — read server's current, compute next
          //   3) top-level `version:` in the YAML (legacy hand-edit flow)
          const yamlVersion = extractWorkflowVersion(yamlOnDisk);
          const cliWantsRewrite = Boolean(opts.bump || opts.setVersion);
          if (cliWantsRewrite && yamlVersion) {
            throw new Error(
              `--${opts.bump ? 'bump' : 'set-version'} conflicts with the top-level \`version: ${yamlVersion}\` in ${filePath}. Remove the YAML field, or omit the flag.`
            );
          }

          let nextVersion: string | undefined;
          if (opts.setVersion) {
            nextVersion = opts.setVersion;
          } else if (opts.bump) {
            // Need the server's current version to compute the next one.
            const wf = (await client.get(`/api/v1/workflows/${workflowId}`)) as {
              currentVersion?: { version?: string } | null;
            };
            const current = wf?.currentVersion?.version;
            if (!current) {
              throw new Error(
                `Cannot --bump ${opts.bump} on ${workflowId}: server has no current version. Push an initial version (with \`--set-version 1.0.0\` or a YAML \`version:\` field) first.`
              );
            }
            if (!SEMVER_RE.test(current)) {
              throw new Error(
                `Cannot --bump ${opts.bump} on ${workflowId}: server's current version "${current}" is not bare semver X.Y.Z.`
              );
            }
            nextVersion = bumpSemver(current, opts.bump as BumpLevel);
          } else {
            nextVersion = yamlVersion ?? undefined;
          }

          if (!nextVersion) {
            error(
              `Cannot update workflow ${ui.bold(workflowId)} — pass --bump <patch|minor|major> or --set-version <X.Y.Z>, or add a top-level \`version: X.Y.Z\` to ${filePath}.`
            );
            process.exit(1);
          }

          // If the CLI computed the version, splice it into the YAML so the
          // server sees a single source of truth for `version` (matches the
          // shape the YAML legacy flow already produces).
          const yamlToSend = cliWantsRewrite
            ? spliceWorkflowVersion(yamlOnDisk, nextVersion)
            : yamlOnDisk;

          const result = (await client.post(`/api/v1/workflows/${workflowId}/versions`, {
            yaml: yamlToSend,
            version: nextVersion,
          })) as { id?: string; version?: string; [k: string]: unknown };
          if (opts.json) {
            printJson(result);
            return;
          }
          success(`Pushed ${ui.bold(workflowId)} (v${result.version ?? nextVersion})`);
        } else {
          // Create path: server defaults to 1.0.0 if no version is sent.
          // `--bump` is meaningless when there's no current version to bump
          // from; reject it loudly rather than silently defaulting.
          if (opts.bump) {
            throw new Error(
              '--bump requires --workflow-id (need a current version to bump from). For a new workflow, use --set-version <X.Y.Z> or omit both.'
            );
          }
          const yamlToSend =
            opts.setVersion && !extractWorkflowVersion(yamlOnDisk)
              ? spliceWorkflowVersion(yamlOnDisk, opts.setVersion)
              : yamlOnDisk;
          const createVersion = opts.setVersion ?? extractWorkflowVersion(yamlToSend) ?? undefined;
          // Server returns { workflow, version, history } from createWorkflowWithVersion.
          // The earlier shape (result.id / result.version as a string) was never live
          // here — `[object Object]` slips through if you read result.version directly.
          const result = (await client.post('/api/v1/workflows', {
            yaml: yamlToSend,
            ...(createVersion ? { version: createVersion } : {}),
          })) as {
            workflow?: { id?: string; currentVersion?: { version?: string } };
            version?: { version?: string };
            history?: { id?: string };
            // Older shapes — kept as defensive fallbacks.
            id?: string;
            currentVersion?: { version?: string };
            [k: string]: unknown;
          };
          if (opts.json) {
            printJson(result);
            return;
          }
          const id = result.workflow?.id ?? result.id ?? '?';
          const ver =
            result.version?.version ??
            result.workflow?.currentVersion?.version ??
            result.currentVersion?.version ??
            '?';
          success(`Created ${ui.bold(id)} (v${ver})`);
        }
      }
    )
  );

  const moveCmd = parent
    .command('move <workflow-id>')
    .description('Move a workflow to a folder path, creating folders as needed')
    .requiredOption('--folder <path>', 'Target folder path (`/` for root)');
  addJsonFlag(withBaseUrl(moveCmd)).action(
    action(
      async (
        workflow: string,
        opts: WorkflowCommandConfig & {
          folder: string;
          json?: boolean;
        }
      ) => {
        const { client, workflowId } = await buildClientForWorkflow(workflow, opts);
        const result = await client.patch(`/api/v1/workflows/${workflowId}`, {
          folderPath: opts.folder,
        });
        if (opts.json) {
          printJson(result);
          return;
        }
        const target = opts.folder.trim() === '/' ? 'root' : opts.folder;
        success(`Moved ${ui.bold(workflowId)} to ${ui.bold(target)}`);
      }
    )
  );
}

// ---------------------------------------------------------------------------
// semver helpers — bare X.Y.Z only (matches server validation). Keeping these
// inline rather than pulling in a `semver` dep: the surface is small and
// adding npm deps to the bundled CLI raises the install size for everyone.
// ---------------------------------------------------------------------------

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;
type BumpLevel = 'patch' | 'minor' | 'major';

function isBumpLevel(value: string): value is BumpLevel {
  return value === 'patch' || value === 'minor' || value === 'major';
}

export function bumpSemver(current: string, level: BumpLevel): string {
  const m = current.match(SEMVER_RE);
  if (!m) throw new Error(`bumpSemver: "${current}" is not bare semver`);
  const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (level === 'major') return `${major + 1}.0.0`;
  if (level === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/**
 * Replace the top-level `version:` in workflow YAML with `next`, or insert
 * a `version: <next>` line near the top if none exists. Best-effort string
 * surgery: keeps comments / formatting intact (ya parse-then-stringify would
 * round-trip the whole file, which is hostile to humans reading the diff).
 */
export function spliceWorkflowVersion(yaml: string, next: string): string {
  if (/^version:\s*['"]?(\d+\.\d+\.\d+)['"]?\s*$/m.test(yaml)) {
    return yaml.replace(/^version:.*$/m, `version: ${next}`);
  }
  // No version field — splice one in directly after a top-level `name:` if
  // present (idiomatic placement), otherwise prepend.
  if (/^name:\s*\S.*$/m.test(yaml)) {
    return yaml.replace(/^(name:\s*\S.*)$/m, `$1\nversion: ${next}`);
  }
  return `version: ${next}\n${yaml}`;
}

function registerClearLocalCommand(parent: Command): void {
  parent
    .command('clear-local [examples...]')
    .description(
      'Delete local execution artifacts under ./dataset/examples/. Keeps the latest run per example by default.'
    )
    .option('--dir <dir>', 'Local eigenpal directory', undefined)
    .option('--all', 'Remove all artifacts, including the latest kept by default', false)
    .action(async (examples: string[], opts: { dir?: string; all?: boolean }) => {
      const config = resolveConfig(opts);
      try {
        await clearEvalOutputs(config.dir, examples, { removeAll: opts.all });
      } finally {
        formatEigenpalDirIfAvailable(config.dir);
      }
    });
}

// ---------------------------------------------------------------------------
// workflow evaluators
// ---------------------------------------------------------------------------

function registerEvaluatorsCommands(parent: Command): void {
  const evaluators = parent
    .command('evaluators')
    .description('Manage evaluator config (push / pull / validate).');

  const pullCmd = evaluators
    .command('pull <workflow-id>')
    .description(descriptionFor('workflow_get_evaluators'))
    .option('--out <path>', 'Write YAML to file instead of stdout');
  withBaseUrl(pullCmd).action(
    action(async (workflow: string, opts: WorkflowCommandConfig & { out?: string }) => {
      const { client, workflowId } = await buildClientForWorkflow(workflow, opts);
      const res = await client.getStream(`/api/v1/workflows/${workflowId}/evaluators/export`);
      await writeOrPrint(opts.out, await res.text());
    })
  );

  const pushCmd = evaluators
    .command('push <workflow-id>')
    .description(descriptionFor('workflow_set_evaluators'))
    .requiredOption('--file <yaml>', 'Path to evaluators YAML file');
  addJsonFlag(withBaseUrl(pushCmd)).action(
    action(
      async (workflow: string, opts: WorkflowCommandConfig & { file: string; json?: boolean }) => {
        const yaml = await fs.readFile(opts.file, 'utf8');
        const { client, workflowId } = await buildClientForWorkflow(workflow, opts);
        const result = (await client.post(`/api/v1/workflows/${workflowId}/evaluators/import`, {
          yaml,
        })) as { count?: number; evaluators?: unknown[]; [k: string]: unknown };
        if (opts.json) {
          printJson(result);
          return;
        }
        // Server may report `count` directly OR return the evaluators array
        // (older route shape). Prefer the explicit count, fall back to the
        // array length, then to a generic label when neither is available.
        let count: number | null = null;
        if (typeof result.count === 'number') count = result.count;
        else if (Array.isArray(result.evaluators)) count = result.evaluators.length;
        const counted =
          count == null ? 'evaluators' : `${count} evaluator${count === 1 ? '' : 's'}`;
        success(`Set ${counted} on ${ui.bold(workflowId)}`);
      }
    )
  );

  registerEvaluatorsValidateCommand(evaluators);
}

// ---------------------------------------------------------------------------
// workflow dataset
// ---------------------------------------------------------------------------

function registerDatasetCommands(parent: Command): void {
  const dataset = parent
    .command('dataset')
    .description('Manage eval dataset (push / pull / list / validate).');

  const listCmd = dataset
    .command('list <workflow-id>')
    .description(descriptionFor('workflow_list_examples'));
  addJsonFlag(withBaseUrl(withPagination(listCmd, 100))).action(
    action(
      async (
        workflow: string,
        opts: WorkflowCommandConfig & PaginationOpts & { json?: boolean }
      ) => {
        const { client, workflowId } = await buildClientForWorkflow(workflow, opts);
        const raw = await client.get(`/api/v1/workflows/${workflowId}/eval-examples`, {
          limit: String(opts.limit),
          offset: String(opts.offset),
        });
        renderListResult<DatasetExampleRow>(
          raw,
          [
            { key: 'name', header: 'name' },
            { key: 'rowOrder', header: 'rowOrder', align: 'right' },
            {
              key: 'triggerInput',
              header: 'inputs',
              format: (v) => {
                if (v == null) return '-';
                const keys = Object.keys(v as Record<string, unknown>);
                return keys.length === 0 ? '-' : keys.join(',');
              },
            },
            { key: 'updatedAt', header: 'updatedAt', format: formatTimestamp },
          ],
          { ...opts, entityLabel: 'example' }
        );
      }
    )
  );

  const pullCmd = dataset
    .command('pull <workflow-id>')
    .description(descriptionFor('workflow_get_dataset'))
    .option(
      '--out <zip>',
      'Write the dataset ZIP to this path. When omitted, the binary streams to stdout.'
    );
  withBaseUrl(pullCmd).action(
    action(async (workflow: string, opts: WorkflowCommandConfig & { out: string }) => {
      const { client, workflowId } = await buildClientForWorkflow(workflow, opts);
      await downloadStreamToFile(
        client,
        `/api/v1/workflows/${workflowId}/dataset/export`,
        opts.out
      );
    })
  );

  const pushCmd = dataset
    .command('push <workflow-id>')
    .description(descriptionFor('workflow_set_dataset'))
    .requiredOption(
      '--file <path>',
      'Path to a dataset ZIP file or a dataset/ folder (folder is zipped in memory before upload)'
    )
    .option('--mode <append|replace>', 'Import mode (default: append)', 'append')
    .option(
      '--yes',
      'Skip the destructive confirmation prompt for --mode replace (use in CI)',
      false
    )
    .addHelpText(
      'after',
      `
Examples:
  $ eigenpal workflow dataset push wf_abc123 --file ./dataset
  $ eigenpal workflow dataset push wf_abc123 --file dataset.zip --mode replace --yes
  $ eigenpal workflow dataset push wf_abc123 --file ./dataset --json | jq '.created'

\`--mode append\` is the default; \`--mode replace\` deletes every existing example
+ its files first and prompts a typed-slug confirmation in TTY (use \`--yes\` to
skip in CI). Folder layout reference: \`packages/cli/src/skill/reference/dataset-format.md\`.
`
    );
  addJsonFlag(withBaseUrl(pushCmd)).action(
    action(
      async (
        workflow: string,
        opts: WorkflowCommandConfig & {
          file: string;
          mode: 'append' | 'replace';
          yes: boolean;
          json?: boolean;
        }
      ) => {
        if (opts.mode !== 'append' && opts.mode !== 'replace') {
          throw new Error('--mode must be "append" or "replace"');
        }
        const { client, workflowId } = await buildClientForWorkflow(workflow, opts);
        // Replace deletes every existing eval_examples row for the
        // workflow + cascades through `files`. Mirror the dashboard's
        // typed-slug confirmation gate at TTY level. `--yes` bypasses
        // for CI / scripted use.
        if (opts.mode === 'replace' && !opts.yes) {
          if (!process.stdout.isTTY) {
            throw new Error(
              '--mode=replace is destructive and requires --yes when run non-interactively'
            );
          }
          const ok = await confirmReplace(workflowId);
          if (!ok) {
            process.stderr.write(`${ui.dim('Aborted.')}\n`);
            process.exit(1);
          }
        }
        // `--file` accepts either a pre-zipped archive OR a folder. Skill
        // recipes (and the dataset format reference) show `--file ./dataset/`,
        // so handle both.
        const stat = await fs.stat(opts.file);
        // Coerce both branches to a Uint8Array — `Buffer` (from fs.readFile)
        // is `ArrayBufferLike` which TS rejects as a Blob source under
        // strict project-wide typecheck.
        const data: Uint8Array = stat.isDirectory()
          ? await readDirAsZip(opts.file)
          : new Uint8Array(await fs.readFile(opts.file));
        const filename = stat.isDirectory() ? `${path.basename(opts.file)}.zip` : opts.file;
        const formData = new FormData();
        // TS's `BlobPart` doesn't accept `ArrayBufferLike`-backed views
        // since the SharedArrayBuffer split, and `BlobPart` itself is a
        // DOM-only name. Casting via `unknown` keeps both packages building —
        // the runtime accepts the Uint8Array directly.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formData.append('file', new Blob([data as unknown as any]), filename);
        formData.append('mode', opts.mode);

        // Result is NDJSON-streamed from the import route; surface the
        // terminal frame to the user.
        const res = await postMultipart(
          client,
          `/api/v1/workflows/${workflowId}/dataset/import`,
          formData
        );
        const text = await res.text();
        const events = parseNdjsonEvents(text);
        const terminal = events[events.length - 1];
        if (!terminal || typeof terminal.phase !== 'string') {
          error('Import response had no terminal event.');
          process.stdout.write(text);
          process.exit(1);
        }

        if (terminal.phase === 'aborted') {
          const errPayload = (terminal.error ?? {}) as {
            issues?: Array<{ field: string; message: string; code?: string }>;
            limitMb?: number;
            actualMb?: number;
          };
          const issues = (errPayload.issues ?? []).map((i) => ({
            field: i.field,
            message: i.message,
            ...(i.code ? { code: i.code } : {}),
          }));
          if (issues.length === 0) {
            error('Import aborted with no structured issues — server-side bug.');
            printJson(terminal);
          } else {
            printIssues('dataset', opts.file, issues);
            if (errPayload.limitMb != null && errPayload.actualMb != null) {
              process.stderr.write(
                `  ${ui.dim(`size cap: ${errPayload.limitMb} MB, archive: ${errPayload.actualMb} MB`)}\n`
              );
            }
            const codes = new Set(issues.map((i) => i.code).filter(Boolean));
            if (codes.has('invalid_expected_output')) {
              process.stderr.write(
                `\n  ${ui.dim('hint:')} ${ui.bold('expected/output.json')} must be a JSON object mirroring your workflow ${ui.bold('output:')} shape.\n` +
                  `         For expected file outputs, drop binaries under ${ui.bold('expected/<docKey>/<file>')}.\n` +
                  `         See ${ui.bold('reference/dataset-format.md')} or run ${ui.bold('eigenpal workflow dataset validate ./dataset')}.\n\n`
              );
            }
            if (codes.has('argument_name_collision')) {
              process.stderr.write(
                `\n  ${ui.dim('hint:')} an arg cannot live in both ${ui.bold('arguments.json')} AND ${ui.bold('input/<arg>/')}; pick one.\n\n`
              );
            }
          }
          process.exit(1);
        }

        if (terminal.phase === 'done') {
          const done = terminal as {
            mode?: string;
            created?: number;
            expectedSet?: number;
            skipped?: number;
            deleted?: number;
            filesDeleted?: number;
            issues?: Array<{ field: string; message: string; code?: string }>;
          };
          if (opts.json) {
            printJson(done);
            return;
          }
          const created = done.created ?? 0;
          const expectedSet = done.expectedSet ?? 0;
          success(
            `Imported ${created} example${created === 1 ? '' : 's'}` +
              (done.mode === 'replace' && done.deleted != null
                ? ` ${ui.dim(`(replaced ${done.deleted}, freed ${done.filesDeleted ?? 0} files)`)}`
                : '')
          );
          if (created > 0 && expectedSet < created) {
            warn(
              `${expectedSet}/${created} examples have expected/output.json — the rest will run un-graded.`
            );
          } else if (expectedSet > 0) {
            process.stderr.write(`  ${ui.dim(`${expectedSet} with expected output`)}\n`);
          }
          if (done.skipped && done.skipped > 0 && done.issues && done.issues.length > 0) {
            warn(`Skipped ${done.skipped} example${done.skipped === 1 ? '' : 's'}:`);
            printIssues('dataset', opts.file, done.issues);
          }
        } else {
          // Unknown terminal phase — server-side bug or truncated stream.
          // Dump for debugging and exit non-zero so callers don't treat
          // "I didn't recognize this" as success.
          error(`Import response had unexpected terminal phase: ${terminal.phase}`);
          printJson(terminal);
          process.exit(1);
        }
      }
    )
  );

  registerDatasetCrudCommands(dataset);
  registerDatasetValidateCommand(dataset);
}

// ---------------------------------------------------------------------------
// workflow dataset example {create,update,delete,get} — single-row CRUD that
// avoids the round-trip of `dataset push --mode replace` when you just want
// to flip one example's GT, drop a bad row, or add a new one. Verbs live
// UNDER the `example` noun (matches `gh issue create`, `vercel project add`).
// ---------------------------------------------------------------------------

/**
 * Resolve a JSON value from one of two mutually-exclusive flags: `--foo-json`
 * (inline JSON literal) or `--foo-file` (path, or `-` for stdin). Returns
 * `undefined` when neither was supplied; the caller treats that as "field
 * not specified" (PATCH-friendly).
 */
export async function readJsonInput(
  literal: string | undefined,
  filePath: string | undefined,
  flagName: string
): Promise<unknown> {
  if (literal !== undefined && filePath !== undefined) {
    throw new Error(`pass either --${flagName}-json or --${flagName}-file, not both`);
  }
  if (literal !== undefined) {
    try {
      return JSON.parse(literal);
    } catch (err) {
      throw new Error(`invalid JSON in --${flagName}-json: ${(err as Error).message}`);
    }
  }
  if (filePath !== undefined) {
    const raw =
      filePath === '-'
        ? await new Promise<string>((resolve, reject) => {
            let buf = '';
            // `data` stays `.on(...)` because stdin emits multiple chunks; the
            // terminal `end` and `error` events fire exactly once and would
            // otherwise leak listeners across repeated invocations.
            process.stdin.setEncoding('utf8');
            process.stdin.on('data', (chunk) => (buf += chunk));
            process.stdin.once('end', () => resolve(buf));
            process.stdin.once('error', reject);
          })
        : await fs.readFile(filePath, 'utf8');
    try {
      return JSON.parse(raw);
    } catch (err) {
      throw new Error(`invalid JSON in --${flagName}-file ${filePath}: ${(err as Error).message}`);
    }
  }
  return undefined;
}

interface ExampleRow {
  id: string;
  name?: string | null;
  workflowId?: string;
  [k: string]: unknown;
}

/** Full eval_examples row — server returns this from GET, POST (create), and
 *  PATCH (update). Loose-typed because the route doesn't currently expose a
 *  Zod schema; we surface the fields the CLI cares about and pass the rest
 *  through to `--json`. */
interface FullExampleRow extends ExampleRow {
  triggerInput?: Record<string, unknown> | null;
  expectedOutput?: Record<string, unknown> | null;
  annotation?: string | null;
  rowOrder?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

function registerDatasetCrudCommands(dataset: Command): void {
  // Verbs live UNDER the `example` noun. The shape mirrors `gh issue create` /
  // `vercel project add` — once you learn one verb, the rest read for free.
  const example = dataset
    .command('example')
    .description('Per-row eval example CRUD (create / update / delete / get).');

  // ----------------------------- example create ----------------------------
  const createCmd = example
    .command('create <workflow-id>')
    .description('Create one eval example without re-uploading the dataset.')
    .requiredOption('--name <name>', 'Example name (1–64 chars)')
    .option('--input-json <json>', 'Trigger input as a JSON literal')
    .option('--input-file <path>', 'Trigger input from a JSON file (or `-` for stdin)')
    .option('--expected-json <json>', 'Expected output as a JSON literal')
    .option('--expected-file <path>', 'Expected output from a JSON file (or `-` for stdin)')
    .option('--annotation <text>', 'Free-form annotation')
    .addHelpText(
      'after',
      `
Examples:
  $ eigenpal workflow dataset example create wf_abc123 --name missing-field --input-json '{"language":"en"}'
  $ eigenpal workflow dataset example create wf_abc123 --name customer-foo --input-file in.json --expected-file expected.json
  $ cat expected.json | eigenpal workflow dataset example create wf_abc123 --name piped --input-json '{}' --expected-file -

\`--input-json\` and \`--input-file\` (same for \`--expected-*\`) are mutually
exclusive. File-arg uploads still require a full \`dataset push\`; CRUD only
handles scalar args + \`expected/output.json\`-style outputs.
`
    );
  addJsonFlag(withBaseUrl(createCmd)).action(
    action(
      async (
        workflow: string,
        opts: WorkflowCommandConfig & {
          name: string;
          inputJson?: string;
          inputFile?: string;
          expectedJson?: string;
          expectedFile?: string;
          annotation?: string;
          json?: boolean;
        }
      ) => {
        const triggerInput = await readJsonInput(opts.inputJson, opts.inputFile, 'input');
        const expectedOutput = await readJsonInput(
          opts.expectedJson,
          opts.expectedFile,
          'expected'
        );
        const body: Record<string, unknown> = { name: opts.name };
        if (triggerInput !== undefined) body.triggerInput = triggerInput;
        if (expectedOutput !== undefined) body.expectedOutput = expectedOutput;
        if (opts.annotation !== undefined) body.annotation = opts.annotation;

        const { client, workflowId } = await buildClientForWorkflow(workflow, opts);
        const result = (await client.post(
          `/api/v1/workflows/${workflowId}/eval-examples`,
          body
        )) as ExampleRow;
        if (opts.json) {
          printJson(result);
          return;
        }
        success(`Created example ${ui.bold(opts.name)} (${result.id}) in ${ui.bold(workflowId)}`);
      }
    )
  );

  // ----------------------------- example update ----------------------------
  const updateCmd = example
    .command('update <workflow-id> <exampleId>')
    .description('Patch one eval example. Omitted flags are left alone.')
    .option('--name <name>', 'Rename the example (1–64 chars)')
    .option('--input-json <json>', 'Replace trigger input with this JSON literal')
    .option('--input-file <path>', 'Replace trigger input from a JSON file (or `-` for stdin)')
    .option('--expected-json <json>', 'Replace expected output with this JSON literal')
    .option('--expected-file <path>', 'Replace expected output from a JSON file (or `-` for stdin)')
    .option('--annotation <text>', 'Replace annotation; pass empty string to clear')
    .option('--row-order <n>', 'Reorder the row (0-based)', intArg);
  addJsonFlag(withBaseUrl(updateCmd)).action(
    action(
      // _workflow is unused on the server (PATCH route is by example id) but
      // we keep it as the first positional so the command stays consistent
      // with `create` and `delete`.
      async (
        _workflow: string,
        exampleId: string,
        opts: WorkflowCommandConfig & {
          name?: string;
          inputJson?: string;
          inputFile?: string;
          expectedJson?: string;
          expectedFile?: string;
          annotation?: string;
          rowOrder?: number;
          json?: boolean;
        }
      ) => {
        const triggerInput = await readJsonInput(opts.inputJson, opts.inputFile, 'input');
        const expectedOutput = await readJsonInput(
          opts.expectedJson,
          opts.expectedFile,
          'expected'
        );
        const body: Record<string, unknown> = {};
        if (opts.name !== undefined) body.name = opts.name;
        if (triggerInput !== undefined) body.triggerInput = triggerInput;
        if (expectedOutput !== undefined) body.expectedOutput = expectedOutput;
        if (opts.annotation !== undefined) body.annotation = opts.annotation;
        if (opts.rowOrder !== undefined) body.rowOrder = opts.rowOrder;
        if (Object.keys(body).length === 0) {
          throw new Error('example update: pass at least one field to update');
        }

        const client = buildClient(opts);
        const result = (await client.patch(
          `/api/v1/eval-examples/${exampleId}`,
          body
        )) as ExampleRow;
        if (opts.json) {
          printJson(result);
          return;
        }
        const fields = Object.keys(body).join(', ');
        success(
          `Updated example ${ui.bold(result.name ?? exampleId)} ${ui.dim(`(${exampleId})`)}: ${fields}`
        );
      }
    )
  );

  // ----------------------------- example delete ----------------------------
  const deleteCmd = example
    .command('delete <workflow-id> <exampleId>')
    .description('Delete one eval example by id. Non-TTY shells require --yes.')
    .option(
      '--yes',
      'Required for non-TTY shells; explicit acknowledgment that this is destructive',
      false
    );
  addJsonFlag(withBaseUrl(deleteCmd)).action(
    action(
      async (
        workflow: string,
        exampleId: string,
        opts: WorkflowCommandConfig & { yes: boolean; json?: boolean }
      ) => {
        if (!opts.yes && !process.stdout.isTTY) {
          throw new Error(
            'example delete is destructive and requires --yes when run non-interactively'
          );
        }
        // The server's DELETE returns the deleted row so the success line
        // can echo a human-readable name without a pre-flight GET.
        const { client, workflowId } = await buildClientForWorkflow(workflow, opts);
        const deleted = (await client.delete(`/api/v1/eval-examples/${exampleId}`)) as ExampleRow;
        if (opts.json) {
          printJson(deleted);
          return;
        }
        success(
          `Deleted example ${ui.bold(deleted.name ?? exampleId)} ${ui.dim(`(${exampleId})`)} from ${ui.bold(workflowId)}`
        );
      }
    )
  );

  // ------------------------------ example get ------------------------------
  // Single-row read for inspecting one example's full payload (triggerInput,
  // expectedOutput, annotation, rowOrder). `dataset list` only renders the
  // table subset; this is the "describe" verb.
  const getCmd = example
    .command('get <workflow-id> <exampleId>')
    .description('Fetch one eval example with full triggerInput, expectedOutput, and metadata.');
  addJsonFlag(withBaseUrl(getCmd)).action(
    action(
      // _workflow mirrors create/update/delete so the positional shape stays
      // consistent — the GET endpoint is keyed by example id only.
      async (
        _workflow: string,
        exampleId: string,
        opts: WorkflowCommandConfig & { json?: boolean }
      ) => {
        const client = buildClient(opts);
        const row = (await client.get(`/api/v1/eval-examples/${exampleId}`)) as FullExampleRow;
        if (opts.json) {
          printJson(row);
          return;
        }
        renderExampleHuman(row);
      }
    )
  );
}

/**
 * Pretty-print an eval example for human consumption. Three labelled
 * sections (Inputs / Expected / Metadata); each JSON blob is formatted
 * with two-space indent so it stays scannable. Stdout for the data
 * sections, stderr for the framing — keeps `… get … | jq` viable in JSON
 * mode (the human renderer doesn't run when --json is set).
 */
function renderExampleHuman(row: FullExampleRow): void {
  const name = row.name ?? row.id;
  console.log(`${ui.bold(name)}  ${ui.dim(`(${row.id})`)}`);
  console.log('');
  console.log(ui.bold('Inputs'));
  console.log(JSON.stringify(row.triggerInput ?? null, null, 2));
  console.log('');
  console.log(ui.bold('Expected'));
  console.log(JSON.stringify(row.expectedOutput ?? null, null, 2));
  console.log('');
  console.log(ui.bold('Metadata'));
  const meta: Record<string, unknown> = {
    annotation: row.annotation ?? null,
    rowOrder: row.rowOrder ?? null,
  };
  if (row.updatedAt) meta.updatedAt = row.updatedAt;
  if (row.createdAt) meta.createdAt = row.createdAt;
  console.log(JSON.stringify(meta, null, 2));
  process.stderr.write(`${ui.dim(`use --json for the full payload`)}\n`);
}

// ---------------------------------------------------------------------------
// workflow experiment
// ---------------------------------------------------------------------------

/**
 * Resolve `--example-id <id>` values to canonical `evx_…` ids. Accepts either
 * the id directly or a human slug (e.g. `ex-01-koifer-97zf`); only fetches the
 * dataset list when at least one value isn't already an id. Exits 2 with a
 * pointer to `dataset list` if any slug fails to resolve.
 */
async function resolveExampleIds(
  client: ApiClient,
  workflowId: string,
  raw: string[]
): Promise<string[]> {
  if (raw.every((v) => v.startsWith('evx_'))) return raw;
  // Paginate through every example. Server defaults to limit=50; without
  // explicit pagination a workflow with >50 examples would silently miss
  // slugs beyond the first page and we'd exit 2 with a "no example with
  // name X" error even though the example exists.
  const PAGE_SIZE = 200;
  const bySlug = new Map<string, string>();
  let offset = 0;
  while (true) {
    const list = (await client.get(`/api/v1/workflows/${workflowId}/eval-examples`, {
      limit: String(PAGE_SIZE),
      offset: String(offset),
    })) as { data?: Array<{ id: string; name?: string | null }> };
    const rows = list.data ?? [];
    for (const row of rows) {
      if (row.name) bySlug.set(row.name, row.id);
    }
    if (rows.length < PAGE_SIZE) break;
    offset += rows.length;
  }
  const unresolved: string[] = [];
  const resolved = raw.map((v) => {
    if (v.startsWith('evx_')) return v;
    const id = bySlug.get(v);
    if (!id) unresolved.push(v);
    return id ?? v;
  });
  if (unresolved.length > 0) {
    error(
      `--example-id: no example with name "${unresolved.join('", "')}" in workflow ${workflowId}.\n` +
        `   Run \`eigenpal workflow dataset list ${workflowId}\` to see available names.`
    );
    process.exit(2);
  }
  return resolved;
}

function registerExperimentCommands(parent: Command): void {
  const experiment = parent
    .command('experiment')
    .description('Run, monitor, and export batch experiments.');

  const listCmd = experiment
    .command('list <workflow-id>')
    .description(descriptionFor('workflow_list_executions'))
    .option('--batch-id <id>', 'Filter by batch');
  addJsonFlag(withBaseUrl(withPagination(listCmd))).action(
    action(
      async (
        workflow: string,
        opts: WorkflowCommandConfig &
          PaginationOpts & {
            batchId?: string;
            json?: boolean;
          }
      ) => {
        const { client, workflowId } = await buildClientForWorkflow(workflow, opts);
        const params: Record<string, string> = {
          limit: String(opts.limit),
          offset: String(opts.offset),
        };
        if (opts.batchId) params.batchId = opts.batchId;
        const raw = await client.get(`/api/v1/workflows/${workflowId}/experiments`, params);
        renderListResult<ExperimentRow>(
          raw,
          [
            { key: 'batchId', header: 'batchId' },
            { key: 'status', header: 'status' },
            { key: 'total', header: 'total', align: 'right' },
            {
              key: 'passRate',
              header: 'passRate',
              align: 'right',
              format: (v) => (typeof v === 'number' ? `${(v * 100).toFixed(1)}%` : '-'),
            },
            {
              key: 'evalScore',
              header: 'evalScore',
              align: 'right',
              format: (v) => (typeof v === 'number' ? v.toFixed(2) : '-'),
            },
          ],
          { ...opts, entityLabel: 'experiment' }
        );
      }
    )
  );

  const runCmd = experiment
    .command('run <workflow-id>')
    .description(descriptionFor('workflow_run_experiment'))
    .option(
      '--example-id <id>',
      'Run only this example (repeatable)',
      (val: string, prev: string[]) => [...prev, val],
      [] as string[]
    )
    .option('--wait', 'Poll until terminal; non-zero exit on passRate < 1.0', false)
    .option('--interval <n>', 'Polling interval in seconds (default 10)', intArg, 10)
    .addHelpText(
      'after',
      `
Examples:
  $ eigenpal workflow experiment run wf_abc123
  $ eigenpal workflow experiment run my-extraction --example-id evx_111
  $ eigenpal workflow experiment run "Parse Invoices" --wait --interval 5
  $ eigenpal workflow experiment run wf_abc123 --json | jq '.batchId'

\`--wait\` blocks until the batch reaches a terminal state and exits non-zero
when any graded example fails (\`passRate < 1.0\`). Without \`--wait\` the call
returns immediately with \`{ batchId, total }\`; poll
\`workflow experiment status\` to follow progress.
`
    );
  addJsonFlag(withBaseUrl(runCmd)).action(
    action(
      async (
        workflow: string,
        opts: WorkflowCommandConfig & {
          exampleId: string[];
          wait: boolean;
          interval: number;
          json?: boolean;
        }
      ) => {
        const { client, workflowId } = await buildClientForWorkflow(workflow, opts);
        const examples =
          opts.exampleId.length > 0
            ? await resolveExampleIds(client, workflowId, opts.exampleId)
            : undefined;
        const start = (await client.post(`/api/v1/workflows/${workflowId}/evals/run`, {
          examples,
        })) as { batchId: string; total: number };
        if (!opts.wait) {
          if (opts.json) {
            printJson(start);
            return;
          }
          success(
            `Started experiment ${ui.bold(start.batchId)} ${ui.dim(`(${start.total} execution${start.total === 1 ? '' : 's'} queued)`)}`
          );
          process.stderr.write(
            `   ${ui.dim(`Watch + auto-pull: eigenpal workflow experiment watch ${workflowId} ${start.batchId}`)}\n`
          );
          return;
        }
        const intervalMs = Math.max(1, opts.interval) * 1000;
        while (true) {
          const status = (await client.get(
            `/api/v1/workflows/${workflowId}/experiments/${start.batchId}`
          )) as {
            status: string;
            passRate?: number;
            evalScore?: number | null;
            completed: number;
            total: number;
          };
          if (status.status === 'completed') {
            printJson(status);
            // Only fail-exit when the server reported a numeric passRate. A
            // workflow with no graded examples returns `passRate: undefined`,
            // which is not the same as 0 — treat it as "nothing to grade,
            // success" rather than "everyone failed".
            if (typeof status.passRate === 'number' && status.passRate < 1.0) process.exit(1);
            return;
          }
          console.error(
            `${ui.dim(`[${start.batchId}]`)} ${status.completed}/${status.total} ${ui.dim(`(status=${status.status})`)}`
          );
          await new Promise((r) => setTimeout(r, intervalMs));
        }
      }
    )
  );

  const statusCmd = experiment
    .command('status <workflow-id> <batchId>')
    .description(descriptionFor('workflow_get_experiment_status'))
    .option(
      '--watch',
      'Poll until every execution reaches a terminal state (completed/failed/cancelled/rejected), then exit',
      false
    )
    .option(
      '--short',
      'Single-line plain-text summary on stdout (e.g. `6/6 done failed=0 cancelled=0 rejected=0`). Pipe-friendly for monitoring loops; mutually exclusive with --watch.',
      false
    )
    .option(
      '--interval <seconds>',
      'Poll interval in seconds when --watch is set (default 5)',
      intArg,
      5
    )
    .option(
      '--max-wait <seconds>',
      'Hard ceiling for --watch in seconds (default 1800 = 30 min)',
      intArg,
      30 * 60
    )
    .option(
      '--include <kinds>',
      'Comma-separated extras to attach when --watch terminates: payload (full per-execution snapshot, can be hundreds of KB)',
      ''
    );
  addJsonFlag(withBaseUrl(statusCmd)).action(
    action(
      async (
        workflow: string,
        batchId: string,
        opts: WorkflowCommandConfig & {
          watch: boolean;
          short: boolean;
          interval: number;
          maxWait: number;
          include?: string;
          json?: boolean;
        }
      ) => {
        if (opts.short && opts.watch) {
          error('--short and --watch are mutually exclusive (short is for spot-check polling).');
          process.exit(2);
        }
        const includes = new Set(
          (opts.include ?? '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        );
        const includePayload = includes.has('payload');
        const { client, workflowId } = await buildClientForWorkflow(workflow, opts);
        const url = `/api/v1/workflows/${workflowId}/experiments/${batchId}`;

        if (!opts.watch) {
          const result = (await client.get(url)) as {
            executions?: Array<{ status?: string }>;
            [k: string]: unknown;
          };
          const execs = result.executions ?? [];
          const summary = summarizeExperimentExecutions(execs);
          if (opts.json) {
            printJson({ ...result, summary: rollupForJson(summary) });
            return;
          }
          if (opts.short) {
            // Single line on stdout — `awk '{print $1}'` → "N/N", grep for "done", etc.
            console.log(formatShortStatus(summary));
            const failed = summary.counts.failed ?? 0;
            const cancelled = summary.counts.cancelled ?? 0;
            if (summary.done && failed + cancelled > 0) process.exit(1);
            return;
          }
          const counts = Object.entries(summary.counts)
            .map(([k, v]) => `${k}=${v}`)
            .sort()
            .join(' ');
          console.log(
            `${ui.bold(batchId)}  ${summary.terminal}/${summary.total} terminal  ${ui.dim(`(${counts || 'no executions'})`)}`
          );
          const failed = summary.counts.failed ?? 0;
          const cancelled = summary.counts.cancelled ?? 0;
          if (failed + cancelled > 0) {
            renderExperimentFailures(execs, summary.total);
          }
          process.stderr.write(
            `${ui.dim(`use --json for raw payload, --watch to follow until terminal`)}\n`
          );
          // Mirror the --watch path: any failed/cancelled execution in a
          // terminal batch makes the command itself fail. CI scripts checking
          // a finished batch's exit code expect this.
          if (summary.done && failed + cancelled > 0) process.exit(1);
          return;
        }

        // Watch mode: poll until terminal, exit non-zero on any failures.
        // Default: terse one-line summary printed by the watch loop. Full
        // per-execution payload (which can be hundreds of KB including
        // parsed contract text — privacy concern in screen-share pipelines)
        // only on --include payload OR --json.
        const wantPayload = opts.json || includePayload;
        await pollExperimentUntilTerminal({
          client,
          url,
          interval: opts.interval,
          maxWait: opts.maxWait,
          onTerminal: (result, summary) => {
            if (wantPayload) {
              printJson({ ...result, summary: rollupForJson(summary) });
            } else {
              process.stderr.write(
                `${ui.dim(`use --include payload (or --json) for the full per-execution snapshot`)}\n`
              );
            }
          },
          onDeadline: (result, summary) => {
            if (wantPayload) printJson({ ...result, summary: rollupForJson(summary) });
          },
        });
      }
    )
  );

  // Aggregate batch cancel — fans out one cancel request per execution in
  // the batch. Idempotent. Mirrors the per-execution cancel semantics
  // (created/pending → cancelled, running/waiting → cancellation-requested,
  // terminal → no-op). Saves the workaround of `dataset list --json | xargs
  // execution cancel` for stuck experiments.
  const cancelCmd = experiment
    .command('cancel <workflow-id> <batchId>')
    .description('Cancel every execution in a batch. Idempotent.')
    .option('--yes', 'Required for non-TTY shells (CI, pipes). Acts immediately, no prompt.')
    .addHelpText(
      'after',
      `
Examples:
  $ eigenpal workflow experiment cancel wf_abc123 evb_xyz789
  $ eigenpal workflow experiment cancel wf_abc123 evb_xyz789 --yes      # required in CI
  $ eigenpal workflow experiment cancel wf_abc123 evb_xyz789 --json     # raw server payload

Behavior:
  - created/pending  → cancelled (worker never picked it up).
  - running/waiting  → cancellation-requested (worker observes between steps).
  - already terminal → no-op (kept in the outcomes list with status='already-terminal').
  - Returns aggregate counts + per-execution outcomes.
`
    );
  addJsonFlag(withBaseUrl(cancelCmd)).action(
    action(
      async (
        workflow: string,
        batchId: string,
        opts: WorkflowCommandConfig & { yes?: boolean; json?: boolean }
      ) => {
        if (!opts.yes && !process.stdout.isTTY) {
          error(
            'experiment cancel is destructive (touches every execution in the batch) and requires --yes when run non-interactively'
          );
          process.exit(2);
        }
        const { client, workflowId } = await buildClientForWorkflow(workflow, opts);
        const result = (await client.post(
          `/api/v1/workflows/${workflowId}/experiments/${batchId}/cancel`
        )) as {
          batchId: string;
          total: number;
          counts: {
            cancelled: number;
            cancellationRequested: number;
            alreadyTerminal: number;
          };
          outcomes: Array<{ executionId: string; status: string; wasStatus: string }>;
        };
        if (opts.json) {
          printJson(result);
          return;
        }
        const c = result.counts;
        const parts: string[] = [];
        if (c.cancelled > 0) parts.push(`${c.cancelled} cancelled`);
        if (c.cancellationRequested > 0) parts.push(`${c.cancellationRequested} requested`);
        if (c.alreadyTerminal > 0) parts.push(`${c.alreadyTerminal} already terminal`);
        const summary = parts.length > 0 ? parts.join(', ') : 'no-op';
        const plural = result.total === 1 ? '' : 's';
        success(
          `${ui.bold(batchId)}  ${result.total} execution${plural} ${ui.dim(`(${summary})`)}`
        );
      }
    )
  );

  // `results` covers single-batch and whole-workflow exports — pass a
  // batchId to scope to one experiment, omit to export every eval result
  // for the workflow. `--format` is a parser-fn so a typo like
  // `--format yaml` fails locally via Commander's standard option-error
  // message instead of round-tripping a generic 400 from the server.
  const parseExportFormat = (value: string): 'csv' | 'json' => {
    if (value !== 'csv' && value !== 'json') {
      throw new InvalidArgumentError("must be 'csv' or 'json'");
    }
    return value;
  };
  const resultsCmd = experiment
    .command('results <workflow-id> [batchId]')
    .description(descriptionFor('workflow_get_experiment_results'))
    .requiredOption('--format <csv|json>', 'Output format', parseExportFormat)
    .option('--out <path>', 'Output file. When omitted, the binary streams to stdout.');
  withBaseUrl(resultsCmd).action(
    action(
      async (
        workflow: string,
        batchId: string | undefined,
        opts: WorkflowCommandConfig & {
          format: 'csv' | 'json';
          out?: string;
        }
      ) => {
        const { client, workflowId } = await buildClientForWorkflow(workflow, opts);
        const params = new URLSearchParams({ format: opts.format });
        if (batchId) params.set('batchId', batchId);
        await downloadStreamToFile(
          client,
          `/api/v1/workflows/${workflowId}/eval-results/export?${params.toString()}`,
          opts.out
        );
      }
    )
  );

  // Side-by-side eval-score diff between two batches. Each row is one
  // (example, evaluator) pair shared by both batches; non-overlapping examples
  // are listed before the table. The owning workflow is inferred server-side
  // from each batch id, so callers don't have to re-type something they already
  // implied — two batch ids uniquely identify the experiments.
  const compareCmd = experiment
    .command('compare <batchIdA> <batchIdB>')
    .description('Diff eval scores between two experiment batches.')
    .option(
      '--sort <abs-delta-desc|delta-asc|delta-desc|name>',
      'Row sort order (default: biggest movers first)',
      'abs-delta-desc'
    )
    .option(
      '--regression-threshold <n>',
      'Δ below this is flagged as a regression (default 0.05)',
      Number.parseFloat,
      0.05
    )
    .addHelpText(
      'after',
      `
Examples:
  $ eigenpal workflow experiment compare evb_old evb_new
  $ eigenpal workflow experiment compare evb_old evb_new --regression-threshold 0.10
  $ eigenpal workflow experiment compare evb_old evb_new --json | jq '.summary.regressions'

\`--sort\` accepts \`abs-delta-desc\` (default — biggest movers in either
direction first), \`delta-asc\` (regressions first), \`delta-desc\`
(improvements first), or \`name\` (alphabetical by example, then evaluator).

The owning workflow is resolved server-side from each batch id; both
batches must belong to the same workflow within the caller's tenant.
`
    );
  addJsonFlag(withBaseUrl(compareCmd)).action(
    action(
      async (
        batchIdA: string,
        batchIdB: string,
        opts: WorkflowCommandConfig & {
          sort: string;
          regressionThreshold: number;
          json?: boolean;
        }
      ) => {
        const sort = normalizeCompareSort(opts.sort);
        const threshold = opts.regressionThreshold;
        if (!Number.isFinite(threshold) || threshold < 0) {
          throw new Error('--regression-threshold must be a non-negative number');
        }
        const client = buildClient(opts);
        const [bodyA, bodyB] = await Promise.all([
          fetchEvalResults(client, batchIdA),
          fetchEvalResults(client, batchIdB),
        ]);
        const diff = buildBatchDiff({
          batchIdA,
          batchIdB,
          rowsA: bodyA.results,
          rowsB: bodyB.results,
          sort,
          regressionThreshold: threshold,
        });

        if (opts.json) {
          printJson(diff);
          return;
        }
        renderBatchDiffHuman(diff);
      }
    )
  );

  // `experiment watch` — kick-and-leave wrapper. Polls the same endpoint as
  // `status --watch`, then on terminal auto-pulls the eval-results export so
  // a script never has to chain `status --watch` + `results --out`. Default
  // destination is `./results-<batchId>.<format>` so a bare invocation works
  // out of the box; `--pull-on-complete <path>` overrides, `--no-pull` opts
  // out for users who only want the watch UI.
  const watchCmd = experiment
    .command('watch <workflow-id> <batchId>')
    .description(
      'Poll until terminal, then auto-pull results — replaces `status --watch` + `results --out`.'
    )
    .option('--interval <seconds>', 'Poll interval in seconds (default 5)', intArg, 5)
    .option(
      '--max-wait <seconds>',
      'Hard ceiling in seconds (default 1800 = 30 min)',
      intArg,
      30 * 60
    )
    .option(
      '--pull-on-complete <path>',
      'Destination for the results file. Default: ./results-<batchId>.<format>'
    )
    .option(
      '--format <csv|json>',
      'Results export format (default json)',
      parseExportFormat,
      'json'
    )
    .option('--no-pull', 'Skip auto-pulling results on terminal (just watch)')
    .addHelpText(
      'after',
      `
Examples:
  $ eigenpal workflow experiment watch wf_abc123 evb_xyz789
  $ eigenpal workflow experiment watch wf_abc123 evb_xyz789 --format csv
  $ eigenpal workflow experiment watch wf_abc123 evb_xyz789 --pull-on-complete ./out/r.json
  $ eigenpal workflow experiment watch wf_abc123 evb_xyz789 --no-pull

Behavior:
  - Polls every --interval seconds; redraws a one-line tick on a TTY,
    appends a new line per tick when piped.
  - On terminal: renders the failed-execution detail block (if any), then
    downloads results to ./results-<batchId>.<format> unless --no-pull
    or --pull-on-complete <path> says otherwise.
  - 4xx errors (e.g. unknown batch id) abort immediately rather than spin.
  - Pre-flight check: the destination directory must exist before the
    poll loop starts, so a typo doesn't waste a 30-min wait.
  - Exit codes (matching \`experiment status --watch\`):
      0  every execution succeeded (or pull skipped via --no-pull on a clean batch)
      1  at least one execution ended in failed/cancelled/rejected,
         OR the export download failed after a clean batch
      2  --max-wait deadline reached — re-run to keep watching;
         OR misuse (e.g. --no-pull combined with --pull-on-complete)
`
    );
  withBaseUrl(watchCmd).action(
    action(
      async (
        workflow: string,
        batchId: string,
        opts: WorkflowCommandConfig & {
          interval: number;
          maxWait: number;
          pullOnComplete?: string;
          format: 'csv' | 'json';
          pull: boolean;
        }
      ) => {
        // Reject a contradictory invocation up front — silently dropping one
        // flag is the kind of bug that surfaces 30 minutes later as a missing
        // file. Match the --short/--watch mutex on `status` for consistency.
        if (!opts.pull && opts.pullOnComplete) {
          error('--no-pull and --pull-on-complete are mutually exclusive — pass one or the other.');
          process.exit(2);
        }
        const { client, workflowId } = await buildClientForWorkflow(workflow, opts);
        const url = `/api/v1/workflows/${workflowId}/experiments/${batchId}`;
        const dest = opts.pull
          ? (opts.pullOnComplete ?? `./results-${batchId}.${opts.format}`)
          : null;
        // Pre-flight: fail before the poll loop if the destination dir is
        // missing. fs.writeFile would throw at the end of a long wait;
        // catching it here keeps the ENOENT close to the typo.
        if (dest) {
          const dir = path.dirname(dest);
          if (!existsSync(dir)) {
            error(
              `Destination directory does not exist: ${dir}. Create it first or pass a path under an existing directory.`
            );
            process.exit(2);
          }
        }
        await pollExperimentUntilTerminal({
          client,
          url,
          interval: opts.interval,
          maxWait: opts.maxWait,
          onTerminal: async () => {
            if (!dest) return;
            const params = new URLSearchParams({ format: opts.format, batchId });
            try {
              await downloadStreamToFile(
                client,
                `/api/v1/workflows/${workflowId}/eval-results/export?${params.toString()}`,
                dest
              );
            } catch (err) {
              // The batch finished cleanly but the export endpoint failed —
              // propagate as a runtime error (exit 1) instead of silently
              // succeeding. Without this, a 5xx on the export would mask
              // the real failure under a successful-looking exit 0.
              error(
                `Watch finished but pulling results failed: ${err instanceof Error ? err.message : String(err)}. Re-run \`experiment results <wf> <batch>\` to retry.`
              );
              process.exit(1);
            }
          },
        });
      }
    )
  );
}

/**
 * Render the per-example failure block. Shared by the watch and non-watch
 * `experiment status` paths. Writes to stderr so JSON / table output on
 * stdout stays clean.
 */
export function renderExperimentFailures(
  execs: Array<{ status?: string }>,
  totalCount: number
): void {
  const failedExecs = execs.filter(
    (e) => e.status === 'failed' || e.status === 'cancelled' || e.status === 'rejected'
  ) as Array<{
    id: string;
    status: string;
    exampleName?: string | null;
    error?: string | null;
  }>;
  if (failedExecs.length === 0) return;

  process.stderr.write(`\n${ui.bold(`✗ ${failedExecs.length}/${totalCount} did not pass`)}\n\n`);
  const labelWidth = Math.max(...failedExecs.map((e) => (e.exampleName ?? e.id).length));
  for (const e of failedExecs) {
    const label = (e.exampleName ?? e.id).padEnd(labelWidth);
    const reason = (e.error ?? '(no error message — fetch full execution)')
      .replace(/\s+/g, ' ')
      .slice(0, 200);
    process.stderr.write(`  ${ui.bold(label)}  ${ui.dim(`[${e.status}]`)} ${reason}\n`);
    process.stderr.write(`    ${ui.dim(`eigenpal workflow execution get ${e.id}`)}\n`);
  }
  process.stderr.write(
    `\n${ui.info('ℹ')} step-level errors live on \`stepExecutions[].error\` — see ${ui.bold('reference/debugging.md')}.\n\n`
  );
}

const TERMINAL_EXEC_STATES = new Set(['completed', 'failed', 'cancelled', 'rejected']);

export function summarizeExperimentExecutions(execs: Array<{ status?: string }>): {
  total: number;
  terminal: number;
  counts: Record<string, number>;
  done: boolean;
} {
  const counts: Record<string, number> = {};
  for (const e of execs) {
    const s = e.status ?? 'unknown';
    counts[s] = (counts[s] ?? 0) + 1;
  }
  const terminal = execs.filter((e) => TERMINAL_EXEC_STATES.has(e.status ?? '')).length;
  // `done` requires at least one execution — a 0/0 result on the first poll
  // means the server hasn't enqueued the batch yet (race), not that the
  // experiment finished. Fall through and keep watching.
  return {
    total: execs.length,
    terminal,
    counts,
    done: execs.length > 0 && terminal === execs.length,
  };
}

/**
 * Rolled-up shape attached as `summary` on `experiment status --json`.
 * Lets polling scripts read `.summary.complete` / `.summary.failedCount`
 * directly instead of folding `executions[].status` themselves.
 */
export function rollupForJson(summary: ReturnType<typeof summarizeExperimentExecutions>): {
  total: number;
  terminal: number;
  complete: boolean;
  completedCount: number;
  failedCount: number;
  cancelledCount: number;
  rejectedCount: number;
  runningCount: number;
  pendingCount: number;
} {
  return {
    total: summary.total,
    terminal: summary.terminal,
    complete: summary.done,
    completedCount: summary.counts.completed ?? 0,
    failedCount: summary.counts.failed ?? 0,
    cancelledCount: summary.counts.cancelled ?? 0,
    rejectedCount: summary.counts.rejected ?? 0,
    runningCount: summary.counts.running ?? 0,
    pendingCount: summary.counts.pending ?? 0,
  };
}

/**
 * `experiment status --short` formatter — single line, no ANSI, awk-friendly.
 * Format: `<terminal>/<total> done|in-progress failed=N cancelled=N rejected=N`.
 * "done" iff every execution reached a terminal state; "in-progress" otherwise.
 */
export function formatShortStatus(
  summary: ReturnType<typeof summarizeExperimentExecutions>
): string {
  const state = summary.done ? 'done' : 'in-progress';
  return [
    `${summary.terminal}/${summary.total}`,
    state,
    `failed=${summary.counts.failed ?? 0}`,
    `cancelled=${summary.counts.cancelled ?? 0}`,
    `rejected=${summary.counts.rejected ?? 0}`,
  ].join(' ');
}

/**
 * Tick-line shown by the watch loops on every poll: terminal/total plus a
 * sorted `key=N` count breakdown. Pure formatter — no I/O — so it can be
 * unit-tested and reused by both `experiment status --watch` and
 * `experiment watch`.
 */
export function renderTickLine(summary: ReturnType<typeof summarizeExperimentExecutions>): string {
  const counts = Object.entries(summary.counts)
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join(' ');
  return `${summary.terminal}/${summary.total} terminal  ${ui.dim(`(${counts || 'no executions'})`)}`;
}

/**
 * Shared poll loop for `experiment status --watch` and `experiment watch`.
 * Owns the GET cadence, tick rendering (`\r\x1b[K` on TTY, newline-separated
 * when piped), dedup, and deadline. Action-specific behavior on terminal /
 * deadline lives in the callbacks; the helper runs them, then exits with
 * the canonical code (1 if any failed/cancelled/rejected, 2 on deadline).
 */
async function pollExperimentUntilTerminal({
  client,
  url,
  interval,
  maxWait,
  onTerminal,
  onDeadline,
}: {
  client: ApiClient;
  url: string;
  interval: number;
  maxWait: number;
  onTerminal: (
    result: { executions?: Array<{ status?: string }>; [k: string]: unknown },
    summary: ReturnType<typeof summarizeExperimentExecutions>
  ) => Promise<void> | void;
  onDeadline?: (
    result: { executions?: Array<{ status?: string }>; [k: string]: unknown },
    summary: ReturnType<typeof summarizeExperimentExecutions>
  ) => void;
}): Promise<void> {
  const deadline = Date.now() + maxWait * 1000;
  let lastSummary = '';

  while (true) {
    const result = (await client.get(url)) as {
      executions?: Array<{ status?: string }>;
      [k: string]: unknown;
    };
    const execs = result.executions ?? [];
    const summary = summarizeExperimentExecutions(execs);
    const line = renderTickLine(summary);
    if (line !== lastSummary) {
      if (process.stderr.isTTY) {
        process.stderr.write(`\r\x1b[K${line}`);
      } else {
        process.stderr.write(`${line}\n`);
      }
      lastSummary = line;
    }
    if (summary.done) {
      if (process.stderr.isTTY) process.stderr.write('\n');
      const failed = summary.counts.failed ?? 0;
      const cancelled = summary.counts.cancelled ?? 0;
      const rejected = summary.counts.rejected ?? 0;
      const badCount = failed + cancelled + rejected;
      if (badCount > 0) renderExperimentFailures(execs, summary.total);
      await onTerminal(result, summary);
      if (badCount > 0) process.exit(1);
      return;
    }
    if (Date.now() >= deadline) {
      if (process.stderr.isTTY) process.stderr.write('\n');
      error(
        `Timed out after ${maxWait}s with ${summary.total - summary.terminal} non-terminal execution(s). Re-run to keep watching.`
      );
      onDeadline?.(result, summary);
      process.exit(2);
    }
    await new Promise((r) => setTimeout(r, interval * 1000));
  }
}

// ---------------------------------------------------------------------------
// workflow versions
// ---------------------------------------------------------------------------

function registerVersionsCommands(parent: Command): void {
  const versions = parent
    .command('versions')
    .description('Inspect and restore historical workflow versions.');

  const listCmd = versions
    .command('list <workflow-id>')
    .description(descriptionFor('workflow_list_versions'));
  addJsonFlag(withBaseUrl(withPagination(listCmd))).action(
    action(
      async (
        workflow: string,
        opts: WorkflowCommandConfig & PaginationOpts & { json?: boolean }
      ) => {
        const { client, workflowId } = await buildClientForWorkflow(workflow, opts);
        const raw = await client.get(`/api/v1/workflows/${workflowId}/versions`, {
          limit: String(opts.limit),
          offset: String(opts.offset),
        });
        renderListResult<VersionRow>(
          raw,
          [
            { key: 'version', header: 'version' },
            { key: 'id', header: 'versionId' },
            { key: 'isCurrent', header: 'current', format: (v) => (v ? 'yes' : '-') },
            { key: 'createdAt', header: 'createdAt', format: formatTimestamp },
          ],
          { ...opts, entityLabel: 'version' }
        );
      }
    )
  );

  const restoreCmd = versions
    .command('restore <workflow-id> <versionId>')
    .description(descriptionFor('workflow_restore_version'));
  addJsonFlag(withBaseUrl(restoreCmd)).action(
    action(
      async (
        workflow: string,
        versionId: string,
        opts: WorkflowCommandConfig & { json?: boolean }
      ) => {
        const { client, workflowId } = await buildClientForWorkflow(workflow, opts);
        const result = (await client.post(
          `/api/v1/workflows/${workflowId}/history/${versionId}/restore`,
          {}
        )) as { version?: string; id?: string; [k: string]: unknown };
        if (opts.json) {
          printJson(result);
          return;
        }
        const newVersion = result.version ?? '?';
        success(
          `Restored ${ui.bold(workflowId)} to v${newVersion} ${ui.dim(`(history ${versionId})`)}`
        );
      }
    )
  );
}

// ---------------------------------------------------------------------------
// workflow step-type
// ---------------------------------------------------------------------------

function registerStepTypeCommands(parent: Command): void {
  const stepType = parent
    .command('step-type')
    .description('Catalog of workflow step types — list and inspect their schemas.');

  const listCmd = stepType
    .command('list')
    .description(descriptionFor('workflow_list_step_types'))
    .option('--search <q>', 'Filter');
  addJsonFlag(withBaseUrl(withPagination(listCmd))).action(
    async (
      opts: WorkflowCommandConfig &
        PaginationOpts & {
          search?: string;
          json?: boolean;
        }
    ) => {
      // Catalog is environment-independent — read straight from @eigenpal/types,
      // filter, then paginate. Total reflects the full filtered set so callers
      // know whether `--limit`/`--offset` is hiding rows.
      const { STEP_SCHEMAS, listStepTypes } = await import('@eigenpal/types');
      const filtered = listStepTypes()
        .map((type) => {
          const def = STEP_SCHEMAS[type];
          return {
            type: def.type,
            category: def.category,
            name: def.name,
            description: def.description,
            configInWith: def.configInWith,
          };
        })
        .filter((entry) => {
          if (!opts.search) return true;
          const needle = opts.search.toLowerCase();
          return (
            entry.type.toLowerCase().includes(needle) ||
            entry.name.toLowerCase().includes(needle) ||
            entry.description.toLowerCase().includes(needle)
          );
        });
      const items = filtered.slice(opts.offset, opts.offset + opts.limit);
      renderListResult(
        { data: items, total: filtered.length },
        [
          { key: 'type', header: 'type' },
          { key: 'category', header: 'category' },
          { key: 'name', header: 'name' },
        ],
        { json: opts.json, entityLabel: 'step type' }
      );
    }
  );

  stepType
    .command('get <type>')
    .description(descriptionFor('workflow_get_step_type'))
    .option('--out <path>', 'Write to file', undefined)
    .action(async (type: string, opts: { out?: string }) => {
      const { getStepSchema } = await import('@eigenpal/types');
      const { z } = await import('zod');
      const def = getStepSchema(type as Parameters<typeof getStepSchema>[0]);
      if (!def) {
        error(`Step type not found: ${ui.bold(type)}`);
        process.exit(1);
      }
      const toJson = (s: ZodType) => z.toJSONSchema(s, { target: 'draft-7' });
      const result = {
        type: def.type,
        category: def.category,
        name: def.name,
        description: def.description,
        configInWith: def.configInWith,
        configSchema: toJson(def.configSchema),
        outputSchema: toJson(def.outputSchema),
      };
      const text = JSON.stringify(result, null, 2);
      await writeOrPrint(opts.out, text);
    });
}
