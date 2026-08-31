import { isLocalTemplatePath } from '@eigenpal/types';
import { collectLocalTemplateRefs, type LocalTemplateRef } from '@eigenpal/workflow-yaml';
import { existsSync, promises as fs, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

import { ApiError, type ApiClient } from './client';
import { inspectOfficeTemplateBytes, sha256Hex, templateNameFromFilename } from './office-template';
import {
  applyStagedTemplateAction,
  listAllPublicTemplates,
  uploadWorkspaceTemplate,
  type PublicTemplate,
} from './templates-api';

export type LocalTemplateAction = 'created' | 'reused';

export type ResolvedLocalTemplate = {
  path: string;
  absolutePath: string;
  templateId: string;
  templateRevisionId: string;
  sha256: string;
  format: 'docx' | 'xlsx';
  filename: string;
  action: LocalTemplateAction;
  checksumMatched: boolean;
};

export type ResolveTemplatePathOptions = {
  /** Permit a real path outside the workflow project root. */
  allowExternal?: boolean;
};

export type LoadedLocalTemplate = {
  path: string;
  fieldPath: string;
  absolutePath: string;
  filename: string;
  bytes: Buffer;
  sha256: string;
};

function walkTemplateSteps(
  steps: unknown,
  visit: (withBlock: Record<string, unknown>) => void
): void {
  if (!Array.isArray(steps)) return;
  for (const entry of steps) {
    if (!entry || typeof entry !== 'object') continue;
    const step = entry as Record<string, unknown>;
    if (step.type === 'transform.template' && step.with && typeof step.with === 'object') {
      visit(step.with as Record<string, unknown>);
    }
    walkTemplateSteps(step.steps, visit);
    walkTemplateSteps(step.then, visit);
    walkTemplateSteps(step.else, visit);
    walkTemplateSteps(step.default, visit);
    if (Array.isArray(step.branches)) {
      for (const branch of step.branches) {
        if (branch && typeof branch === 'object') {
          walkTemplateSteps((branch as { steps?: unknown }).steps, visit);
        }
      }
    }
    if (Array.isArray(step.cases)) {
      for (const branch of step.cases) {
        if (branch && typeof branch === 'object') {
          walkTemplateSteps((branch as { steps?: unknown }).steps, visit);
        }
      }
    }
  }
}

/**
 * Real directory that contains the workflow YAML. Local `template:` paths must
 * resolve inside this tree unless `--allow-external-templates` is set.
 */
export function resolveWorkflowProjectRoot(workflowFile: string): string {
  const abs = resolve(workflowFile);
  if (!existsSync(abs)) {
    throw new Error(`Workflow file not found: ${abs}`);
  }
  return dirname(realpathSync(abs));
}

/** True when `target` is a real path strictly inside `root` (not `root` itself). */
export function isPathInsideRoot(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel.length > 0 && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function assertInsideProject(projectRoot: string, templatePath: string, resolved: string): void {
  if (isPathInsideRoot(projectRoot, resolved)) return;
  throw new Error(
    `Local template "${templatePath}" resolves outside the workflow project (${projectRoot}). ` +
      `Keep Office files under that directory, or pass --allow-external-templates.`
  );
}

/**
 * Resolve a source-controlled `template:` path against the workflow project.
 * Follows symlinks via realpath. Rejects `../` and symlink escapes unless
 * `allowExternal` is set.
 */
export function resolveWorkflowTemplatePath(
  workflowFile: string,
  templatePath: string,
  opts: ResolveTemplatePathOptions = {}
): string {
  if (!isLocalTemplatePath(templatePath)) {
    throw new Error(
      `Invalid local template path "${templatePath}". Use a relative .docx or .xlsx path such as ./templates/foo.xlsx.`
    );
  }
  const projectRoot = resolveWorkflowProjectRoot(workflowFile);
  const candidate = resolve(projectRoot, templatePath);

  if (!opts.allowExternal) {
    assertInsideProject(projectRoot, templatePath, candidate);
  }

  if (!existsSync(candidate)) {
    throw new Error(`Local template not found: ${candidate}`);
  }

  const real = realpathSync(candidate);
  if (!statSync(real).isFile()) {
    throw new Error(`Local template is not a file: ${real}`);
  }
  if (!opts.allowExternal) {
    assertInsideProject(projectRoot, templatePath, real);
  }
  return real;
}

export function currentTemplateChecksum(template: PublicTemplate): string | null {
  return template.currentRevision?.sha256 ?? template.sha256 ?? null;
}

function namesMatch(template: PublicTemplate, filename: string): boolean {
  const want = templateNameFromFilename(filename).toLowerCase();
  return (
    templateNameFromFilename(template.filename).toLowerCase() === want ||
    template.name.trim().toLowerCase() === want
  );
}

export type WorkspaceTemplateMatch =
  | { action: 'reused'; template: PublicTemplate }
  | { action: 'created' };

/**
 * Repeat-push matching (no I/O):
 * 1. Same current-revision checksum → reuse tmpl_ + tmpr_ (no upload).
 * 2. Else create a new tmpl_ resource.
 *
 * Name matches with a different checksum used to replace the shared tmpl_
 * pointer. Push must not do that: other workflows may pin the same id, and a
 * failed publish must not move the current revision. Explicit
 * `workflow templates replace` still updates a pointer on purpose.
 */
export function matchWorkspaceTemplate(
  existing: PublicTemplate[],
  sha256: string,
  filename: string
): WorkspaceTemplateMatch {
  const checksumHits = existing.filter((row) => currentTemplateChecksum(row) === sha256);
  const checksumHit = checksumHits.find((row) => namesMatch(row, filename)) ?? checksumHits[0];
  if (checksumHit?.currentRevision?.id) {
    return { action: 'reused', template: checksumHit };
  }
  return { action: 'created' };
}

/**
 * Read and inspect local Office files. No network. Fails loudly on missing
 * files, escapes, and corrupt workbooks.
 */
export async function loadLocalTemplatesForPush(
  workflowFile: string,
  parsedSteps: unknown,
  opts: ResolveTemplatePathOptions = {}
): Promise<LoadedLocalTemplate[]> {
  const refs = collectLocalTemplateRefs(parsedSteps);
  const byPath = new Map<string, LoadedLocalTemplate>();
  const loaded: LoadedLocalTemplate[] = [];

  for (const ref of refs) {
    const cached = byPath.get(ref.templatePath);
    if (cached) {
      loaded.push(cached);
      continue;
    }
    const absolutePath = resolveWorkflowTemplatePath(workflowFile, ref.templatePath, opts);
    const bytes = await fs.readFile(absolutePath);
    inspectOfficeTemplateBytes(bytes, basename(absolutePath));
    const row: LoadedLocalTemplate = {
      path: ref.templatePath,
      fieldPath: ref.fieldPath,
      absolutePath,
      filename: basename(absolutePath),
      bytes,
      sha256: sha256Hex(bytes),
    };
    byPath.set(ref.templatePath, row);
    loaded.push(row);
  }

  return [...byPath.values()];
}

export type StagedWorkspaceTemplate = {
  id: string;
  cleanupProof: string;
};

export async function cleanupCreatedWorkspaceTemplates(
  client: ApiClient,
  staged: readonly StagedWorkspaceTemplate[]
): Promise<{ deleted: string[]; failed: Array<{ id: string; error: string }> }> {
  const deleted: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];
  for (const row of staged) {
    try {
      await applyStagedTemplateAction(client, row.id, {
        proof: row.cleanupProof,
        action: 'cleanup',
      });
      deleted.push(row.id);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        deleted.push(row.id);
        continue;
      }
      failed.push({ id: row.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { deleted, failed };
}

export async function finalizeCreatedWorkspaceTemplates(
  client: ApiClient,
  staged: readonly StagedWorkspaceTemplate[]
): Promise<{ finalized: string[]; failed: Array<{ id: string; error: string }> }> {
  const finalized: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];
  for (const row of staged) {
    try {
      await applyStagedTemplateAction(client, row.id, {
        proof: row.cleanupProof,
        action: 'finalize',
      });
      finalized.push(row.id);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 409)) {
        finalized.push(row.id);
        continue;
      }
      failed.push({ id: row.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { finalized, failed };
}

function formatCleanupFailure(
  created: readonly StagedWorkspaceTemplate[],
  failed: Array<{ id: string; error: string }>
): string {
  const leftover = failed.map((row) => `${row.id} (${row.error})`).join(', ');
  return (
    `Also failed to hard-clean staged template${failed.length === 1 ? '' : 's'} ${leftover}. ` +
    `Created during this push: ${created.map((row) => row.id).join(', ')}.`
  );
}

/**
 * Upload unmatched local files as new tmpl_ resources. Never PUTs an existing
 * template (no shared pointer advance). On a partial create failure, deletes
 * what this call created.
 */
export async function stageWorkspaceTemplatesForPush(
  client: ApiClient,
  loaded: readonly LoadedLocalTemplate[]
): Promise<{ resolved: ResolvedLocalTemplate[]; created: StagedWorkspaceTemplate[] }> {
  if (loaded.length === 0) return { resolved: [], created: [] };

  const existing = await listAllPublicTemplates(client);
  const resolved: ResolvedLocalTemplate[] = [];
  const created: StagedWorkspaceTemplate[] = [];

  try {
    for (const item of loaded) {
      const match = matchWorkspaceTemplate(existing, item.sha256, item.filename);
      if (match.action === 'reused') {
        const revisionId = match.template.currentRevision?.id;
        if (!revisionId) {
          throw new Error(`Template ${match.template.id} is missing a current revision id`);
        }
        resolved.push({
          path: item.path,
          absolutePath: item.absolutePath,
          templateId: match.template.id,
          templateRevisionId: revisionId,
          sha256: currentTemplateChecksum(match.template) ?? item.sha256,
          format: match.template.format,
          filename: item.filename,
          action: 'reused',
          checksumMatched: true,
        });
        continue;
      }

      const uploaded = await uploadWorkspaceTemplate(client, {
        bytes: item.bytes,
        filename: item.filename,
        name: templateNameFromFilename(item.filename),
        staged: true,
      });
      const revisionId = uploaded.currentRevision?.id;
      const cleanupProof = uploaded.cleanupProof;
      if (!cleanupProof) {
        throw new Error(
          `Uploaded template ${uploaded.id} did not return a staging cleanup proof; refusing to continue without a hard-clean path`
        );
      }
      created.push({ id: uploaded.id, cleanupProof });
      if (!revisionId) {
        throw new Error(`Uploaded template ${uploaded.id} is missing a current revision id`);
      }
      existing.unshift(uploaded);
      resolved.push({
        path: item.path,
        absolutePath: item.absolutePath,
        templateId: uploaded.id,
        templateRevisionId: revisionId,
        sha256: currentTemplateChecksum(uploaded) ?? item.sha256,
        format: uploaded.format,
        filename: item.filename,
        action: 'created',
        checksumMatched: false,
      });
    }
  } catch (err) {
    const cleanup = await cleanupCreatedWorkspaceTemplates(client, created);
    if (cleanup.failed.length > 0) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`${reason}. ${formatCleanupFailure(created, cleanup.failed)}`);
    }
    throw err;
  }

  return { resolved, created };
}

/**
 * Repeat-push behavior uses {@link matchWorkspaceTemplate}. Source YAML is
 * never rewritten. Only the payload sent to the server is. Callers must run
 * workflow validation before this mutates tenant templates.
 */
export async function ensureWorkspaceTemplate(
  client: ApiClient,
  input: {
    bytes: Buffer;
    filename: string;
    existing: PublicTemplate[];
  }
): Promise<{ template: PublicTemplate; action: LocalTemplateAction; checksumMatched: boolean }> {
  inspectOfficeTemplateBytes(input.bytes, input.filename);
  const match = matchWorkspaceTemplate(input.existing, sha256Hex(input.bytes), input.filename);

  if (match.action === 'reused') {
    return { template: match.template, action: 'reused', checksumMatched: true };
  }

  const created = await uploadWorkspaceTemplate(client, {
    bytes: input.bytes,
    filename: input.filename,
    name: templateNameFromFilename(input.filename),
  });
  input.existing.unshift(created);
  return { template: created, action: 'created', checksumMatched: false };
}

export async function resolveLocalTemplatesForPush(
  client: ApiClient,
  workflowFile: string,
  yamlText: string,
  parsedSteps: unknown,
  opts: ResolveTemplatePathOptions = {}
): Promise<{
  yaml: string;
  resolved: ResolvedLocalTemplate[];
  created: StagedWorkspaceTemplate[];
}> {
  const loaded = await loadLocalTemplatesForPush(workflowFile, parsedSteps, opts);
  if (loaded.length === 0) return { yaml: yamlText, resolved: [], created: [] };
  const staged = await stageWorkspaceTemplatesForPush(client, loaded);
  return {
    yaml: rewriteLocalTemplateYaml(yamlText, staged.resolved),
    resolved: staged.resolved,
    created: staged.created,
  };
}

export function rewriteLocalTemplateYaml(
  yamlText: string,
  resolved: ReadonlyArray<Pick<ResolvedLocalTemplate, 'path' | 'templateId' | 'templateRevisionId'>>
): string {
  const byPath = new Map(resolved.map((row) => [row.path, row]));
  const doc = parseYaml(yamlText) as Record<string, unknown> | null;
  if (!doc || typeof doc !== 'object') return yamlText;
  walkTemplateSteps(doc.steps, (withBlock) => {
    const path = withBlock.template;
    if (typeof path !== 'string') return;
    const match = byPath.get(path);
    if (!match) return;
    delete withBlock.template;
    withBlock.templateId = match.templateId;
    withBlock.templateRevisionId = match.templateRevisionId;
  });
  return stringifyYaml(doc, { lineWidth: 0 });
}

export function collectLocalTemplateRefsFromYaml(steps: unknown): LocalTemplateRef[] {
  return collectLocalTemplateRefs(steps);
}
