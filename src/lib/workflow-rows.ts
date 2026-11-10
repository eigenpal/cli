/**
 * Read the display fields of a workflow row from the `/api/workflows`
 * endpoints.
 *
 * The workflow table carries no name or version: the YAML is the source of
 * truth, so the server returns them nested under `currentVersion`
 * (`currentVersion.definition.name`, `currentVersion.version`). Lean
 * summary rows (`view=summary`) do lift them to the top level, so both
 * spellings are read here and every command shows the same values.
 */

interface WorkflowRowLike {
  name?: unknown;
  description?: unknown;
  version?: unknown;
  workflowVersion?: unknown;
  currentVersion?: {
    version?: unknown;
    definition?: { name?: unknown; description?: unknown } | null;
  } | null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asRow(row: unknown): WorkflowRowLike {
  return row && typeof row === 'object' ? (row as WorkflowRowLike) : {};
}

/** The workflow slug (`name:` in the YAML), or null when there is no version yet. */
export function workflowRowName(row: unknown): string | null {
  const r = asRow(row);
  return nonEmptyString(r.name) ?? nonEmptyString(r.currentVersion?.definition?.name);
}

export function workflowRowDescription(row: unknown): string | null {
  const r = asRow(row);
  return nonEmptyString(r.description) ?? nonEmptyString(r.currentVersion?.definition?.description);
}

/**
 * The current version tag. Falls back to `workflowVersion` (the nearest
 * tagged ancestor, which `GET /api/workflows/:id` resolves) when the current
 * save is an untagged draft.
 */
export function workflowRowVersion(row: unknown): string | null {
  const r = asRow(row);
  return (
    nonEmptyString(r.version) ??
    nonEmptyString(r.currentVersion?.version) ??
    nonEmptyString(r.workflowVersion)
  );
}

/** The row with `name`, `description` and `version` lifted to the top level. */
export function withWorkflowRowFields<T extends object>(
  row: T
): T & { name: string | null; description: string | null; version: string | null } {
  return {
    ...row,
    name: workflowRowName(row),
    description: workflowRowDescription(row),
    version: workflowRowVersion(row),
  };
}
