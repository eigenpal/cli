/**
 * Static detection of `env.NAME` references in a workflow definition.
 *
 * One scanner serves the editor, the Variables page, promotion and the worker,
 * so they always agree on what a workflow needs. It matches Liquid paths
 * `env.NAME`, `env['NAME']` and `env["NAME"]` in every string of the
 * definition. A path that only ends in `env` (`steps.env.output`,
 * `input.env`) is not a reference. Runs load only the names found here, so a
 * name built at run time (`env[name]`) is not supported: write it out.
 */

/** The workflow-level part of a definition, when a reference sits outside any step. */
export const WORKFLOW_LEVEL = '(workflow)';

export interface EnvReference {
  name: string;
  /** Names of the steps that use it, or `WORKFLOW_LEVEL`, in definition order. */
  steps: string[];
}

const REFERENCE =
  /(?<![\w.\]$])env\s*(?:\.\s*([A-Z][A-Z0-9_]*)\b|\[\s*(['"])([A-Z][A-Z0-9_]*)\2\s*\])/g;

/** Variable names referenced in one string, in order of first use. */
export function envNamesIn(text: string): string[] {
  if (!text.includes('env')) return [];
  const names: string[] = [];
  for (const match of text.matchAll(REFERENCE)) {
    const name = match[1] ?? match[3];
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

/** Workflow and step fields that are prose, not templates. */
const SKIPPED_KEYS = new Set(['description']);

/**
 * Every variable a definition references, sorted by name, with the steps that
 * use it. `transform.script` function bodies are skipped: scripts receive
 * variables through their `inputs`, which are scanned.
 */
export function collectEnvReferences(definition: unknown): EnvReference[] {
  return collect(definition, envNamesIn);
}

const LOWERCASE_REFERENCE = /(?<![\w.\]$])env\s*\.\s*([a-z_][A-Za-z0-9_]*)\b/g;

/**
 * `env.name` paths that are not uppercase. Variable names are, so these never
 * resolve; the editor points them out rather than letting them render empty.
 * Not a run failure: `env` can also be a loop variable (`{% for env in envs %}`).
 */
export function collectLowercaseEnvReferences(definition: unknown): EnvReference[] {
  return collect(definition, (text) =>
    text.includes('env')
      ? [...new Set([...text.matchAll(LOWERCASE_REFERENCE)].map((m) => m[1]!))]
      : []
  );
}

/** Keys whose arrays hold steps (`then`/`else`, loop bodies, defaults). */
const STEP_LIST_KEYS = new Set(['steps', 'then', 'else', 'default']);
/** Keys whose arrays hold containers of steps (`control.parallel`, `control.switch`). */
const BRANCH_LIST_KEYS = new Set(['branches', 'cases']);

function collect(definition: unknown, namesIn: (text: string) => string[]): EnvReference[] {
  const found = new Map<string, string[]>();
  const note = (name: string, step: string) => {
    const steps = found.get(name) ?? [];
    if (!steps.includes(step)) steps.push(step);
    found.set(name, steps);
  };

  /** Any value inside a step's configuration (or the workflow's own fields). */
  const visit = (value: unknown, owner: string): void => {
    if (typeof value === 'string') {
      for (const name of namesIn(value)) note(name, owner);
    } else if (Array.isArray(value)) {
      for (const item of value) visit(item, owner);
    } else if (value && typeof value === 'object') {
      for (const child of Object.values(value)) visit(child, owner);
    }
  };

  /** A step: its fields belong to it; nested step lists get their own owners. */
  const visitStep = (step: unknown): void => {
    if (!step || typeof step !== 'object' || Array.isArray(step)) return;
    const record = step as Record<string, unknown>;
    const name = typeof record.name === 'string' ? record.name : WORKFLOW_LEVEL;
    for (const [key, value] of Object.entries(record)) {
      if (key === 'name' || SKIPPED_KEYS.has(key)) continue;
      if (STEP_LIST_KEYS.has(key) && Array.isArray(value)) {
        value.forEach(visitStep);
      } else if (BRANCH_LIST_KEYS.has(key) && Array.isArray(value)) {
        for (const branch of value) visitContainer(branch, name);
      } else if (key === 'with' && record.type === 'transform.script' && isRecord(value)) {
        // Scripts get variables through their inputs; the function body is code.
        const { function: _code, ...config } = value;
        visit(config, name);
      } else {
        visit(value, name);
      }
    }
  };

  /** A parallel branch or switch case: its `steps` are steps, the rest belongs to the parent. */
  const visitContainer = (container: unknown, owner: string): void => {
    if (!isRecord(container)) return;
    for (const [key, value] of Object.entries(container)) {
      if (key === 'steps' && Array.isArray(value)) value.forEach(visitStep);
      else if (!SKIPPED_KEYS.has(key) && key !== 'name') visit(value, owner);
    }
  };

  if (isRecord(definition)) {
    for (const [key, value] of Object.entries(definition)) {
      if (key === 'name' || SKIPPED_KEYS.has(key)) continue;
      if (key === 'steps' && Array.isArray(value)) value.forEach(visitStep);
      else visit(value, WORKFLOW_LEVEL);
    }
  }
  return [...found.entries()]
    .map(([name, steps]) => ({ name, steps }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Just the names, sorted. */
export function referencedEnvNames(definition: unknown): string[] {
  return collectEnvReferences(definition).map((reference) => reference.name);
}
