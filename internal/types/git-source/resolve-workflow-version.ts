import {
  maxSatisfyingWorkflowVersion,
  parseWorkflowVersionSelector,
  WORKFLOW_VERSION_SELECTOR_HINT,
} from './workflow-version-selector';

/** The fields of a workflow version row the resolver reads. */
export interface WorkflowVersionRowLike {
  id: string;
  workflowId: string;
}

/**
 * Lookups the resolver needs; `createWorkflowsRepo` from `@eigenpal/db`
 * satisfies it. Kept structural so this stays pure and importable by the
 * app, the worker engine and the headless runtime alike.
 */
export interface WorkflowVersionLookup<Row extends WorkflowVersionRowLike> {
  findCurrentVersion(workflowId: string): Promise<Row | undefined>;
  findVersionByNumber(workflowId: string, version: string): Promise<Row | undefined>;
  findVersionById(id: string): Promise<Row | undefined>;
  /** Tags on the released line; see `listReleasedVersionTags` in `@eigenpal/db`. */
  listReleasedVersionTags(workflowId: string): Promise<string[]>;
}

export type WorkflowVersionResolution<Row extends WorkflowVersionRowLike = WorkflowVersionRowLike> =
  | { ok: true; version: Row }
  | {
      ok: false;
      /**
       * - `invalid`: the selector is not valid grammar (400).
       * - `no_current`: `latest` on a workflow with no current version (400).
       * - `no_match`: a valid range that no released tag satisfies (404).
       * - `not_found`: an exact tag or version id that does not exist on this
       *   workflow (404).
       */
      reason: 'invalid' | 'no_current' | 'no_match' | 'not_found';
      message: string;
    };

/**
 * The one resolver every workflow version selector goes through: API v1
 * runs, the legacy run route, reruns, the OpenAPI scope and invoke-workflow
 * steps (save-time validation and the worker). `workflowId` must already be
 * a workflow the caller passed access checks for; this only picks the row,
 * and never returns a row from another workflow.
 *
 * Rules:
 * - `latest` -> the current version (HEAD).
 * - exact `X.Y.Z` -> exactly that tag (candidates included, unchanged).
 * - range -> the highest tag on the released line
 *   (`listReleasedVersionTags`) that satisfies it. Candidates never match.
 * - `wfv_` / `wfh_` / `version_` id -> that row.
 *
 * `legacyExactFallback` keeps the old legacy-route behavior where any other
 * label (for example `v25`, from before tags were validated) is tried as an
 * exact tag and then as an id.
 */
export async function resolveWorkflowVersionSelector<Row extends WorkflowVersionRowLike>(
  repo: WorkflowVersionLookup<Row>,
  workflowId: string,
  raw: string,
  options: { legacyExactFallback?: boolean } = {}
): Promise<WorkflowVersionResolution<Row>> {
  const selector = parseWorkflowVersionSelector(raw);
  const sameWorkflow = (row: Row | undefined) =>
    row && row.workflowId === workflowId ? row : undefined;
  const notFound = {
    ok: false,
    reason: 'not_found',
    message: 'Version not found',
  } as const;

  if (!selector) {
    // A string that starts like a version or range (`1.x.3`, `^`, `>=1 <2`)
    // is a malformed selector even on the legacy route, never a label.
    if (!options.legacyExactFallback || !raw.trim() || /^[\s0-9^~<>=*xX]/.test(raw)) {
      return {
        ok: false,
        reason: 'invalid',
        message: `Invalid workflow version "${raw}". ${WORKFLOW_VERSION_SELECTOR_HINT}.`,
      };
    }
    const legacy =
      sameWorkflow(await repo.findVersionByNumber(workflowId, raw.trim())) ??
      sameWorkflow(await repo.findVersionById(raw.trim()));
    return legacy ? { ok: true, version: legacy } : notFound;
  }

  switch (selector.kind) {
    case 'latest': {
      const current = sameWorkflow(await repo.findCurrentVersion(workflowId));
      return current
        ? { ok: true, version: current }
        : { ok: false, reason: 'no_current', message: 'No current version found for workflow' };
    }
    case 'exact': {
      const row = sameWorkflow(await repo.findVersionByNumber(workflowId, selector.version));
      return row ? { ok: true, version: row } : notFound;
    }
    case 'id': {
      const row = sameWorkflow(await repo.findVersionById(selector.id));
      return row ? { ok: true, version: row } : notFound;
    }
    case 'range': {
      const tags = await repo.listReleasedVersionTags(workflowId);
      const match = maxSatisfyingWorkflowVersion(tags, selector.range);
      const row = match
        ? sameWorkflow(await repo.findVersionByNumber(workflowId, match))
        : undefined;
      return row
        ? { ok: true, version: row }
        : { ok: false, reason: 'no_match', message: `No version matches ${selector.range}` };
    }
  }
}
