/**
 * Non-fatal schema-quality checks. Runs after `parseWorkflow` succeeds and
 * surfaces warnings that nudge users toward sharper output schemas without
 * blocking the push.
 *
 * Two surfaces produce structured output today:
 *   - `ai.extract` — user-authored JSON Schema on `step.with.schema`.
 *   - `transform.script` — JSON Schema derived from the function's return
 *     type annotation (via `compileTypedScript`).
 *
 * Better-typed outputs mean: downstream autocomplete works, the LLM is
 * constrained to a closed value set on coded fields (category codes,
 * status flags), and `{{ steps.X.output.field }}` references don't trip
 * "field not found" warnings.
 */

import { compileTypedScript, type WorkflowDefinition } from '@eigenpal/types';

export interface SchemaQualityWarning {
  /** Stable identifier so the CLI can filter / de-duplicate. */
  code:
    | 'categorical-missing-enum'
    | 'untyped-object'
    | 'untyped-array-items'
    | 'weak-script-return'
    | 'unknown-step-reference';
  /** Dotted path into the workflow, e.g. `steps.2.with.schema.properties.category`. */
  field: string;
  /** Human-readable explanation. */
  message: string;
  /** Optional `eigenpal workflow ...` command that would resolve the warning. */
  hint?: string;
}

/**
 * Field names that almost always benefit from an `enum`. The heuristic is
 * conservative — we only warn when both the name matches AND the field is a
 * `type: string` with no enum, to keep the false-positive rate low.
 */
const CATEGORICAL_NAMES = new Set([
  'category',
  'subcategory',
  'kind',
  'status',
  'type',
  'subtype',
  'level',
  'severity',
  'priority',
  'state',
  'stage',
  'tier',
  'classification',
  // Domain-specific names that real workflows use for coded fields.
  // The Slovak loan-covenant workflow (a representative case) has
  // `monitoring` ∈ P/R/D/O, `frequency` ∈ Y/Q/M/H/W/D, `reference` ∈
  // S1/S2/A/D/M/O, plus section/code/flag/signal naming for boolean-ish
  // categoricals. Add common ones so the heuristic catches them too.
  'monitoring',
  'frequency',
  'reference',
  'sectionname',
  'code',
  'flag',
  'signal',
  'mode',
  'phase',
]);

/**
 * Heuristic regex for `description` text that smells categorical: a small
 * number of short tokens separated by `|`, `,`, or `/`. Matches free-form
 * descriptions like `"P | R | D | O"`, `"low, medium, high"`, or
 * `"draft / approved / rejected"`. Conservative — requires 2–8 tokens that
 * are each <=20 chars to keep prose like "page 1, 2, or 3" out.
 */
const SEPARATOR_LIST_RE =
  /(?:^|[\s(])((?:[A-Za-z0-9_-]{1,20})(?:\s*[|,/]\s*[A-Za-z0-9_-]{1,20}){1,7})(?:$|[\s).])/;

export function validateSchemaQuality(workflow: WorkflowDefinition): SchemaQualityWarning[] {
  const warnings: SchemaQualityWarning[] = [];
  for (let i = 0; i < workflow.steps.length; i++) {
    const step = workflow.steps[i];
    if (!step) continue;
    const basePath = `steps.${i}`;
    walkStep(step, basePath, warnings);
  }
  validateStepReferences(workflow, warnings);
  return warnings;
}

// ---------------------------------------------------------------------------
// Template step-reference validation.
//
// Catches `{{ steps.<name>.output.<field> }}` references to steps the
// template can't actually see at runtime. Mirrors the UI's scope rules
// (`packages/app/src/components/workflow-builder/utils/step-path.ts`):
//
//   - A step at position N can reference its prior siblings in the same
//     container plus all ancestors (steps preceding each parent container).
//   - Steps nested inside a sibling control container (`control.parallel`
//     branches, `control.parallel_map`/`control.foreach` bodies, `control.if`
//     branches) are NOT addressable from outside that container — their
//     outputs live in isolated or only-last-iteration-wins child scopes.
//
// Without this check, a bad reference ships at push time and renders
// `undefined` silently at runtime — same class of bug as the workflow-pull
// 0-byte file.
// ---------------------------------------------------------------------------

const STEP_NAME_RE = /\bsteps\.([a-zA-Z0-9_-]+)/g;

function validateStepReferences(workflow: WorkflowDefinition, out: SchemaQualityWarning[]): void {
  walkContainer(workflow.steps, new Set<string>(), 'steps', out);
}

function walkContainer(
  steps: WorkflowDefinition['steps'],
  ancestorsInScope: ReadonlySet<string>,
  pathPrefix: string,
  out: SchemaQualityWarning[]
): void {
  // Names addressable BEFORE each step runs. Mutates as we walk siblings.
  const available = new Set(ancestorsInScope);
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step) continue;
    const stepPath = `${pathPrefix}.${i}`;
    validateStepRefs(step, stepPath, available, out);
    // Recurse into nested containers with the scope as it was BEFORE this
    // step "ran" — the container step itself is not yet in scope inside its
    // own children, and sibling control containers are isolated runtime
    // scopes anyway.
    descendNestedContainers(step, stepPath, available, out);
    // After the step finishes, subsequent siblings can reference it.
    available.add(step.name);
  }
}

function descendNestedContainers(
  step: WorkflowDefinition['steps'][number],
  stepPath: string,
  ancestorsInScope: ReadonlySet<string>,
  out: SchemaQualityWarning[]
): void {
  if (step.type === 'control.parallel') {
    const branches = (step as unknown as { branches?: Array<{ steps?: unknown }> }).branches ?? [];
    for (let b = 0; b < branches.length; b++) {
      const branchSteps = branches[b]?.steps;
      if (Array.isArray(branchSteps)) {
        walkContainer(
          branchSteps as WorkflowDefinition['steps'],
          ancestorsInScope,
          `${stepPath}.branches.${b}.steps`,
          out
        );
      }
    }
    return;
  }
  if (step.type === 'control.foreach' || step.type === 'control.parallel_map') {
    const nested = (step as unknown as { steps?: unknown }).steps;
    if (Array.isArray(nested)) {
      walkContainer(
        nested as WorkflowDefinition['steps'],
        ancestorsInScope,
        `${stepPath}.steps`,
        out
      );
    }
    return;
  }
  if (step.type === 'control.if') {
    const ifStep = step as unknown as { then?: unknown; else?: unknown };
    if (Array.isArray(ifStep.then)) {
      walkContainer(
        ifStep.then as WorkflowDefinition['steps'],
        ancestorsInScope,
        `${stepPath}.then`,
        out
      );
    }
    if (Array.isArray(ifStep.else)) {
      walkContainer(
        ifStep.else as WorkflowDefinition['steps'],
        ancestorsInScope,
        `${stepPath}.else`,
        out
      );
    }
    return;
  }
  if (step.type === 'control.switch') {
    const switchStep = step as unknown as {
      cases?: Array<{ steps?: unknown }>;
      default?: unknown;
    };
    const cases = switchStep.cases ?? [];
    for (let c = 0; c < cases.length; c++) {
      const caseSteps = cases[c]?.steps;
      if (Array.isArray(caseSteps)) {
        walkContainer(
          caseSteps as WorkflowDefinition['steps'],
          ancestorsInScope,
          `${stepPath}.cases.${c}.steps`,
          out
        );
      }
    }
    if (Array.isArray(switchStep.default)) {
      walkContainer(
        switchStep.default as WorkflowDefinition['steps'],
        ancestorsInScope,
        `${stepPath}.default`,
        out
      );
    }
  }
}

/** Scan every Liquid-expression field on a step for `steps.<name>` references
 *  and warn when `<name>` isn't in the current scope. */
function validateStepRefs(
  step: WorkflowDefinition['steps'][number],
  stepPath: string,
  inScope: ReadonlySet<string>,
  out: SchemaQualityWarning[]
): void {
  // Fields that carry Liquid expressions per BaseStepSchema + per-type schemas.
  // `with` is the bag of step config (template strings nested arbitrarily);
  // `if` / `condition` / `items` are top-level template strings; `inputs` on
  // block steps mirrors `with`.
  const s = step as unknown as Record<string, unknown>;
  scanValue(s.if, `${stepPath}.if`, inScope, out);
  scanValue(s.condition, `${stepPath}.condition`, inScope, out);
  scanValue(s.items, `${stepPath}.items`, inScope, out);
  scanValue(s.with, `${stepPath}.with`, inScope, out);
  scanValue(s.inputs, `${stepPath}.inputs`, inScope, out);
}

function scanValue(
  value: unknown,
  path: string,
  inScope: ReadonlySet<string>,
  out: SchemaQualityWarning[]
): void {
  if (typeof value === 'string') {
    // Only scan strings that contain a Liquid expression delimiter. Stops
    // descriptions / JSON-schema prose / free-form `with.*` strings that
    // mention "steps.foo" in passing from tripping false-positive warnings.
    if (!value.includes('{{') && !value.includes('{%')) return;
    for (const match of value.matchAll(STEP_NAME_RE)) {
      const name = match[1];
      if (!inScope.has(name)) {
        out.push({
          code: 'unknown-step-reference',
          field: path,
          message: `references \`steps.${name}\` but no step named "${name}" is in scope here. Steps nested inside control.parallel branches, control.parallel_map/control.foreach bodies, and control.if branches are not addressable from outside the container — reach inner outputs through the container's aggregate output instead.`,
          hint: `Use the container step's aggregate output, e.g. \`steps.<parallel>.output.<branch>.${name}.<field>\` or \`steps.<foreach>.output.items[i].${name}.<field>\`. See the "Control containers" section of \`step-types.md\`.`,
        });
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      scanValue(value[i], `${path}.${i}`, inScope, out);
    }
    return;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      scanValue(v, `${path}.${k}`, inScope, out);
    }
  }
}

function walkStep(
  step: WorkflowDefinition['steps'][number],
  basePath: string,
  out: SchemaQualityWarning[]
): void {
  // ai.extract — user-authored JSON Schema on with.schema
  if (step.type === 'ai.extract') {
    const schema = (step.with as { schema?: unknown } | undefined)?.schema;
    if (schema && typeof schema === 'object') {
      walkSchema(schema as Record<string, unknown>, `${basePath}.with.schema`, out);
    }
    return;
  }

  // transform.script — re-run compile to harvest weak-type warnings.
  if (step.type === 'transform.script') {
    const cfg = step.with as { function?: unknown; inputs?: unknown } | undefined;
    const source = typeof cfg?.function === 'string' ? cfg.function : null;
    if (!source) return;
    const paramNames =
      cfg?.inputs && typeof cfg.inputs === 'object' && !Array.isArray(cfg.inputs)
        ? Object.keys(cfg.inputs as Record<string, unknown>)
        : [];
    const compiled = compileTypedScript({ kind: 'transform', source, paramNames });
    if (!compiled.ok) return; // compile errors are surfaced by Zod; not our job here
    for (const w of compiled.warnings) {
      if (w.code === 'weak-return-type') {
        out.push({
          code: 'weak-script-return',
          field: `${basePath}.with.function`,
          message: `transform.script return type is too loose: ${w.message}`,
          hint: 'Replace `unknown`/`any` with a concrete shape, or use a TS literal union (e.g. `"low" | "medium" | "high"`) when the value belongs to a closed set.',
        });
      }
    }
    // The compiled schema can also be a permissive `{ type: object, additionalProperties: true }`
    // (e.g. user wrote `Record<string, unknown>`). The TS converter doesn't emit a warning for
    // that today, so check the schema shape directly.
    const schema = compiled.result.returnSchema as Record<string, unknown>;
    if (
      schema.type === 'object' &&
      (!schema.properties || Object.keys(schema.properties as object).length === 0) &&
      schema.additionalProperties !== false
    ) {
      out.push({
        code: 'untyped-object',
        field: `${basePath}.with.function`,
        message:
          'transform.script returns an untyped object. Downstream steps cannot autocomplete its fields.',
        hint: 'Describe the actual shape in the return annotation: `function script(...): { name: string; total: number }`.',
      });
    }
    return;
  }

  // Recurse into compound steps (parallel branches, control.foreach, etc.).
  // The exact key varies by step kind; we walk anything that looks like a
  // nested step list. Conservative — only steps we recognise count.
  const withAny = step.with as Record<string, unknown> | undefined;
  const nestedSteps = (withAny as { steps?: unknown } | undefined)?.steps;
  if (Array.isArray(nestedSteps)) {
    for (let i = 0; i < nestedSteps.length; i++) {
      const s = nestedSteps[i] as WorkflowDefinition['steps'][number] | undefined;
      if (s) walkStep(s, `${basePath}.with.steps.${i}`, out);
    }
  }
  const nestedBranches = (withAny as { branches?: unknown } | undefined)?.branches;
  if (Array.isArray(nestedBranches)) {
    for (let b = 0; b < nestedBranches.length; b++) {
      const branch = nestedBranches[b] as { steps?: unknown } | undefined;
      if (branch && Array.isArray(branch.steps)) {
        for (let i = 0; i < branch.steps.length; i++) {
          const s = branch.steps[i] as WorkflowDefinition['steps'][number] | undefined;
          if (s) walkStep(s, `${basePath}.with.branches.${b}.steps.${i}`, out);
        }
      }
    }
  }
}

/**
 * Walk a JSON Schema object and emit quality warnings. Recurses into
 * `properties.*` and `items` so nested fields (e.g. `covenants[].category`)
 * are covered without callers needing to traverse manually.
 */
function walkSchema(
  schema: Record<string, unknown>,
  basePath: string,
  out: SchemaQualityWarning[]
): void {
  const type = schema.type;

  // Untyped object: `{ type: 'object' }` with no properties and no explicit
  // additionalProperties:false is a permissive blob the LLM has no guidance on.
  if (
    type === 'object' &&
    (!schema.properties || Object.keys(schema.properties as object).length === 0) &&
    schema.additionalProperties !== false
  ) {
    out.push({
      code: 'untyped-object',
      field: basePath,
      message:
        'Object schema has no properties. The LLM has no guidance on what fields to emit and downstream autocomplete is empty.',
      hint: 'Add concrete fields under `properties`, or set `additionalProperties: false` if the object is intentionally open.',
    });
  }

  // Untyped array items: `{ type: 'array' }` without `items` declared.
  if (type === 'array' && (schema.items === undefined || isEmptyObject(schema.items))) {
    out.push({
      code: 'untyped-array-items',
      field: basePath,
      message:
        'Array items are untyped. The LLM does not know what shape each element should take.',
      hint: 'Add an `items:` block describing the element type, e.g. `items: { type: object, properties: { ... } }`.',
    });
  }

  // Categorical name without enum: this is the high-signal nudge for the
  // user's case (category / status / kind codes).
  if (schema.properties && typeof schema.properties === 'object') {
    for (const [name, raw] of Object.entries(schema.properties as Record<string, unknown>)) {
      if (!raw || typeof raw !== 'object') continue;
      const prop = raw as Record<string, unknown>;
      const propType = prop.type;
      const propEnum = Array.isArray(prop.enum) && prop.enum.length > 0;
      const lower = name.toLowerCase();
      const description = typeof prop.description === 'string' ? prop.description : '';
      const looksCategoricalByName = CATEGORICAL_NAMES.has(lower);
      const looksCategoricalByDescription =
        description.length > 0 && SEPARATOR_LIST_RE.test(description);
      if (
        propType === 'string' &&
        !propEnum &&
        (looksCategoricalByName || looksCategoricalByDescription) &&
        !looksLikeFreeform(prop)
      ) {
        out.push({
          code: 'categorical-missing-enum',
          field: `${basePath}.properties.${name}`,
          message: `Field \`${name}\` looks categorical but has no \`enum\`. Coded values extract more reliably when the LLM is constrained to a closed set.`,
          hint: "In the workflow builder, switch the field type to `Enum` and list the allowed values. In raw YAML, add `enum: ['value1', 'value2', ...]` to the field, and write the per-value meanings into the field's `description`.",
        });
      }
      walkSchema(prop, `${basePath}.properties.${name}`, out);
    }
  }

  // Recurse into array items.
  if (schema.items && typeof schema.items === 'object' && !Array.isArray(schema.items)) {
    walkSchema(schema.items as Record<string, unknown>, `${basePath}.items`, out);
  }
}

function isEmptyObject(v: unknown): boolean {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).length === 0;
}

function looksLikeFreeform(prop: Record<string, unknown>): boolean {
  // If the user explicitly set a pattern or format, they've thought about it;
  // skip the enum nudge.
  return prop.pattern !== undefined || prop.format !== undefined;
}
