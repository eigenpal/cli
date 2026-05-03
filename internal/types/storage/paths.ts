/**
 * Canonical S3/R2 key constructors for workflow-scoped files.
 *
 * Every key in the system matches one of four templates, beneath the existing
 * `tenants/<t>/` prefix added by `TenantScopedStorage`. The helpers in this
 * module return the suffix only — the tenant prefix is added at the storage
 * adapter boundary.
 *
 * | Kind            | Template                                                | Owner DB row          |
 * | --------------- | ------------------------------------------------------- | --------------------- |
 * | `run-input`     | `workflows/<wf>/runs/<run>/input/<fileId>`              | `workflow_executions` |
 * | `run-output`    | `workflows/<wf>/runs/<run>/output/<stepName>/<fileId>`  | `workflow_executions` |
 * | `eval-input`    | `workflows/<wf>/evals/<exampleId>/input/<fileId>`       | `eval_examples`       |
 * | `eval-expected` | `workflows/<wf>/evals/<exampleId>/expected/<fileId>`    | `eval_examples`       |
 *
 * `<fileId>` is the row's primary key in the `files` table — opaque, no PII,
 * no human-readable filename, no timestamp. Original filenames live in
 * `files.filename` only (RLS-protected).
 *
 * Object args (not positional) prevent runId/stepName swap bugs in the
 * blob migration loop and any other key-construction site.
 *
 * Pure string functions, no I/O.
 */

const SEGMENT_RX = /^[A-Za-z0-9_.-]+$/;

function seg(name: string, value: string): string {
  if (!value || !SEGMENT_RX.test(value)) {
    throw new Error(`Invalid path segment for ${name}: ${JSON.stringify(value)}`);
  }
  return value;
}

export function runInputKey(args: { workflowId: string; runId: string; fileId: string }): string {
  return `workflows/${seg('workflowId', args.workflowId)}/runs/${seg('runId', args.runId)}/input/${seg('fileId', args.fileId)}`;
}

export function runOutputKey(args: {
  workflowId: string;
  runId: string;
  stepName: string;
  fileId: string;
}): string {
  return `workflows/${seg('workflowId', args.workflowId)}/runs/${seg('runId', args.runId)}/output/${seg('stepName', args.stepName)}/${seg('fileId', args.fileId)}`;
}

/**
 * Eval input files are NOT copied into a run's `runs/<run>/input/` prefix
 * when an eval example is executed; the worker reads directly from the
 * eval-input prefix. Eval examples are maintained datasets, not snapshots.
 */
export function evalInputKey(args: {
  workflowId: string;
  exampleId: string;
  fileId: string;
}): string {
  return `workflows/${seg('workflowId', args.workflowId)}/evals/${seg('exampleId', args.exampleId)}/input/${seg('fileId', args.fileId)}`;
}

export function evalExpectedKey(args: {
  workflowId: string;
  exampleId: string;
  fileId: string;
}): string {
  return `workflows/${seg('workflowId', args.workflowId)}/evals/${seg('exampleId', args.exampleId)}/expected/${seg('fileId', args.fileId)}`;
}

export type ParsedKey =
  | { kind: 'run-input'; workflowId: string; runId: string; fileId: string }
  | {
      kind: 'run-output';
      workflowId: string;
      runId: string;
      stepName: string;
      fileId: string;
    }
  | { kind: 'eval-input'; workflowId: string; exampleId: string; fileId: string }
  | { kind: 'eval-expected'; workflowId: string; exampleId: string; fileId: string };

const TENANT_PREFIX_RX = /^tenants\/[A-Za-z0-9_.-]+\//;

/** Strip the leading `tenants/<tenantId>/` prefix; pass-through if absent. */
export function stripTenantPrefix(key: string): string {
  return key.replace(TENANT_PREFIX_RX, '');
}

/**
 * Parse a canonical workflow-scoped key into its components. Accepts both
 * suffix-only (`files.key`) and tenant-prefixed (raw S3 enumeration) forms.
 * Throws on any input not matching one of the four templates.
 */
export function parseFileKey(key: string): ParsedKey {
  const parts = stripTenantPrefix(key).split('/');
  const fail = (): never => {
    throw new Error(`Not a canonical workflow-scoped key: ${JSON.stringify(key)}`);
  };

  if (parts.length < 5 || parts[0] !== 'workflows') fail();
  const workflowId = seg('workflowId', parts[1]);

  if (parts[2] === 'runs') {
    const runId = seg('runId', parts[3]);
    const branch = parts[4];
    if (branch === 'input' && parts.length === 6) {
      return { kind: 'run-input', workflowId, runId, fileId: seg('fileId', parts[5]) };
    }
    if (branch === 'output' && parts.length === 7) {
      return {
        kind: 'run-output',
        workflowId,
        runId,
        stepName: seg('stepName', parts[5]),
        fileId: seg('fileId', parts[6]),
      };
    }
  }

  if (parts[2] === 'evals' && parts.length === 6) {
    const exampleId = seg('exampleId', parts[3]);
    const fileId = seg('fileId', parts[5]);
    if (parts[4] === 'input') return { kind: 'eval-input', workflowId, exampleId, fileId };
    if (parts[4] === 'expected') return { kind: 'eval-expected', workflowId, exampleId, fileId };
  }

  return fail();
}
