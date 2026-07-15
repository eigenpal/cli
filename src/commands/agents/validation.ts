import {
  DATASET_NAME_PATTERN,
  DatasetMetaSchema,
  SourcePackageManifestSchema,
  eigenpalAjv,
  isScopedFileRef,
  validateScopedArtifactPath,
  validateWorkspaceSchema,
} from '@eigenpal/types';
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import {
  AGENT_EXAMPLE_EXPECTED_JSON,
  AGENT_EXAMPLE_INPUT_JSON,
  DATASET_DIR,
  LEGACY_LAYOUTS,
  PACKAGE_MANIFEST,
  SCHEMA_FILENAMES,
} from './shared';

export async function validateAgentProject(
  root: string
): Promise<{ valid: boolean; errors: string[]; warnings: string[] }> {
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const [oldName] of LEGACY_LAYOUTS) {
    if (existsSync(path.join(root, oldName))) {
      errors.push(`Legacy layout ${oldName}/ is removed; use Git source under agents/<slug>/`);
    }
  }
  if (existsSync(path.join(root, 'agent.yaml'))) {
    errors.push('Legacy agent.yaml layout is removed; use eigenpal.yaml in a Git-backed package');
  }
  if (existsSync(path.join(root, 'agent'))) {
    errors.push('Legacy agent/ directory is removed; use Git source (eigenpal agents clone)');
  }
  const manifestPath = path.join(root, PACKAGE_MANIFEST);
  if (!existsSync(manifestPath)) {
    errors.push(`Missing ${PACKAGE_MANIFEST}`);
  } else {
    try {
      SourcePackageManifestSchema.parse(YAML.parse(await fs.readFile(manifestPath, 'utf8')));
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  if (!existsSync(path.join(root, 'AGENT.md'))) warnings.push('Missing AGENT.md');
  if (!existsSync(path.join(root, DATASET_DIR))) warnings.push(`Missing ${DATASET_DIR}/`);
  for (const filename of SCHEMA_FILENAMES) {
    const schemaPath = path.join(root, filename);
    if (!existsSync(schemaPath)) continue;
    const validation = validateWorkspaceSchema(await fs.readFile(schemaPath, 'utf8'), filename);
    for (const issue of validation.errors) {
      errors.push(`${filename}: ${issue}`);
    }
  }
  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Local mirror of the server dataset import rules (`parseDatasetZip` in the
 * app's `dataset-archive` module). Canonical layout:
 *
 *   examples/<name>/input.json       REQUIRED, full run input object
 *   examples/<name>/input/<file>     referenced from input.json via { "$file": "input/<path>" }
 *   examples/<name>/expected.json    OPTIONAL, expected output object
 *   examples/<name>/expected/<file>  referenced from expected.json via { "$file": "expected/<path>" }
 *   examples/<name>/meta.json        OPTIONAL, DatasetMetaSchema
 *
 * The folder structure is the manifest; a top-level manifest.json is the
 * legacy format and is rejected. Failure-expected examples (expected.json with
 * a single "$error" key) are workflow-only and rejected for agent datasets:
 * the agent execution path invokes evaluators only for completed runs, so a
 * failure-expected agent example could never receive a passing rollup.
 *
 * When the agent package directory carries input-schema.json, input.json is
 * validated as the FULL run input object against the authored schema — the
 * same semantics as run-start validation (required fields and value types
 * enforced; unknown keys are rejected only when the schema itself sets
 * `additionalProperties: false`; file-typed fields accept `{ "$file": ... }`
 * refs). With output-schema.json, expected.json may stay partial, so only
 * fields present in both the JSON and the schema are checked.
 */
export async function validateDatasetDir(
  dir: string,
  opts: { agentDir?: string } = {}
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];
  if (!existsSync(dir)) errors.push(`Missing dataset directory: ${dir}`);
  for (const [oldName, newName] of LEGACY_LAYOUTS) {
    if (path.basename(dir) === oldName) {
      errors.push(`Use ${newName}/ instead of legacy ${oldName}/`);
    }
  }
  if (errors.length > 0) return { valid: false, errors };

  if (existsSync(path.join(dir, 'manifest.json'))) {
    return {
      valid: false,
      errors: [
        'manifest.json: legacy dataset format — manifest-based archives are no longer accepted. ' +
          'Re-export the dataset using the folder convention (examples/<name>/input.json).',
      ],
    };
  }

  const examplesDir = path.join(dir, 'examples');
  if (!existsSync(examplesDir) || !(await fs.stat(examplesDir)).isDirectory()) {
    errors.push('examples/: missing examples/ directory at dataset root');
    const flatFolders = await listImmediateDirs(dir);
    if (flatFolders.length > 0) {
      errors.push(
        `examples/: found example-like folders at the dataset root (${flatFolders.join(', ')}); ` +
          'move them under examples/ — the canonical layout is examples/<name>/input.json'
      );
    }
    return { valid: false, errors };
  }

  const agentDir = opts.agentDir ?? process.cwd();
  const inputSchema = await loadOptionalWorkspaceSchema(agentDir, 'input-schema.json', errors);
  const outputSchema = await loadOptionalWorkspaceSchema(agentDir, 'output-schema.json', errors);
  if (errors.length > 0) return { valid: false, errors };

  const examples = (await fs.readdir(examplesDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (examples.length === 0) {
    return { valid: false, errors: ['examples/: dataset contains no examples'] };
  }

  for (const example of examples) {
    errors.push(
      ...(await validateDatasetExample(path.join(examplesDir, example), example, {
        inputSchema,
        outputSchema,
      }))
    );
  }
  return { valid: errors.length === 0, errors };
}

async function validateDatasetExample(
  exampleRoot: string,
  example: string,
  schemas: {
    inputSchema: Record<string, unknown> | null;
    outputSchema: Record<string, unknown> | null;
  }
): Promise<string[]> {
  const errors: string[] = [];
  const label = `examples/${example}`;

  if (!DATASET_NAME_PATTERN.test(example)) {
    return [
      `${label}: example folder name must be lowercase kebab/snake-case (matching ${DATASET_NAME_PATTERN})`,
    ];
  }

  const inputFiles = await listFilesUnder(path.join(exampleRoot, 'input'));
  const expectedFiles = await listFilesUnder(path.join(exampleRoot, 'expected'));

  // Old workflow archive paths are rejected outright — excluded from the
  // referenced-file bookkeeping so they don't double-report as unreferenced.
  if (inputFiles.delete('arguments.json')) {
    errors.push(
      `${label}/input/arguments.json: legacy workflow archive path is no longer accepted; use input.json at the example root`
    );
  }
  for (const legacy of ['output.json', 'error.json']) {
    if (expectedFiles.delete(legacy)) {
      errors.push(
        `${label}/expected/${legacy}: legacy workflow archive path is no longer accepted; use expected.json at the example root`
      );
    }
  }

  // input.json — required, must be a JSON object.
  const inputJsonPath = path.join(exampleRoot, AGENT_EXAMPLE_INPUT_JSON);
  if (!existsSync(inputJsonPath)) {
    errors.push(`${label}/input.json: input.json is required`);
    return errors;
  }
  const input = await readJson(inputJsonPath, `${label}/input.json`, errors);
  if (input === undefined) return errors;
  if (!isJsonObject(input)) {
    errors.push(`${label}/input.json: must be a JSON object`);
    return errors;
  }
  errors.push(
    ...validateFileRefs({
      refs: collectFileRefs(input),
      files: inputFiles,
      root: 'input',
      fieldPrefix: `${label}/input.json`,
      exampleLabel: label,
    })
  );

  // expected.json — optional; must be the raw automation output object.
  // Failure-expected examples ({ "$error": ... }) are rejected: the agent
  // execution path invokes evaluators only for completed runs and persists
  // failed runs without scoring them, so a failure-expected agent example
  // could never receive a passing rollup (or satisfy --fail-on-mismatch).
  const expectedJsonPath = path.join(exampleRoot, AGENT_EXAMPLE_EXPECTED_JSON);
  let expectedOutput: Record<string, unknown> | null = null;
  if (existsSync(expectedJsonPath)) {
    const expected = await readJson(expectedJsonPath, `${label}/expected.json`, errors);
    if (expected !== undefined) {
      if (isExpectedErrorRef(expected)) {
        errors.push(
          `${label}/expected.json: failure-expected examples ({ "$error": ... }) are not supported for agent datasets. ` +
            'Agent runs are evaluated only when they complete, so a failed run can never produce a passing score. ' +
            'Remove the example or replace "$error" with the expected output object.'
        );
      } else if (!isJsonObject(expected)) {
        errors.push(`${label}/expected.json: must be the raw automation output object`);
      } else {
        expectedOutput = expected;
        errors.push(
          ...validateFileRefs({
            refs: collectFileRefs(expected),
            files: expectedFiles,
            root: 'expected',
            fieldPrefix: `${label}/expected.json`,
            exampleLabel: label,
          })
        );
      }
    }
  } else if (expectedFiles.size > 0) {
    for (const file of [...expectedFiles].sort()) {
      errors.push(
        `${label}/expected/${file}: file is not referenced from expected.json (expected/ files require an expected.json with { "$file": "expected/${file}" })`
      );
    }
  }

  // meta.json — optional, DatasetMetaSchema.
  const metaJsonPath = path.join(exampleRoot, 'meta.json');
  if (existsSync(metaJsonPath)) {
    const meta = await readJson(metaJsonPath, `${label}/meta.json`, errors);
    if (meta !== undefined) {
      const parsed = DatasetMetaSchema.safeParse(meta);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          const at = issue.path.length > 0 ? issue.path.map(String).join('.') : '(root)';
          errors.push(`${label}/meta.json:${at}: ${issue.message}`);
        }
      }
    }
  }

  // Optional value-level checks against the agent schemas. input.json is the
  // FULL run input object, so it is validated as a whole against the authored
  // schema, matching run-start semantics: required fields and value types are
  // enforced, and unknown keys are rejected only when the schema itself sets
  // `additionalProperties: false` (file-typed fields accept `{ "$file": ... }`
  // refs). Expected output may stay partial, so only fields present in both
  // the JSON and the schema are checked there.
  if (schemas.inputSchema) {
    errors.push(
      ...validateValueAgainstSchema(
        input,
        allowFileRefsInSchema(schemas.inputSchema) as Record<string, unknown>,
        `${label}/input.json`
      )
    );
  }
  if (schemas.outputSchema && expectedOutput) {
    errors.push(
      ...validateValuesAgainstSchemaProps(
        expectedOutput,
        schemas.outputSchema,
        `${label}/expected.json`
      )
    );
  }

  return errors;
}

// ---------------------------------------------------------------------------
// $file ref collection + set comparison (local port of the server's
// collectDatasetFileRefs / validateFileRefs)
// ---------------------------------------------------------------------------

type DatasetFileRef = { path: string; jsonPath: string };

function collectFileRefs(value: unknown, jsonPath = '<root>'): DatasetFileRef[] {
  if (isScopedFileRef(value)) return [{ path: value.$file, jsonPath }];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectFileRefs(item, `${jsonPath}.${index}`));
  }
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) =>
      collectFileRefs(item, jsonPath === '<root>' ? key : `${jsonPath}.${key}`)
    );
  }
  return [];
}

function validateFileRefs(args: {
  refs: DatasetFileRef[];
  files: Set<string>;
  root: 'input' | 'expected';
  fieldPrefix: string;
  exampleLabel: string;
}): string[] {
  const errors: string[] = [];
  const referenced = new Set<string>();
  for (const ref of args.refs) {
    const validation = validateScopedArtifactPath(ref.path, { allowedRoots: [args.root] });
    const relative = validation.ok ? validation.value.segments.slice(1).join('/') : '';
    if (!validation.ok || relative.length === 0) {
      errors.push(
        `${args.fieldPrefix}:${ref.jsonPath}: file reference must point inside ${args.root}/ and must not contain path traversal (got "${ref.path}")`
      );
      continue;
    }
    referenced.add(relative);
    if (!args.files.has(relative)) {
      errors.push(
        `${args.fieldPrefix}:${ref.jsonPath}: referenced file does not exist: ${ref.path}`
      );
    }
  }
  const source = args.root === 'input' ? 'input.json' : 'expected.json';
  for (const filePath of [...args.files].sort()) {
    if (!referenced.has(filePath)) {
      errors.push(
        `${args.exampleLabel}/${args.root}/${filePath}: file is not referenced from ${source}; add { "$file": "${args.root}/${filePath}" }`
      );
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Filesystem + JSON helpers
// ---------------------------------------------------------------------------

/** Recursively list files under `dir` as posix-relative paths. Skips dotfiles
 *  and node_modules to match what `dataset push` packs into the archive. */
async function listFilesUnder(dir: string): Promise<Set<string>> {
  const out = new Set<string>();
  if (!existsSync(dir)) return out;
  async function walk(current: string, relPrefix: string): Promise<void> {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const relative = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path.join(current, entry.name), relative);
      else if (entry.isFile()) out.add(relative);
    }
  }
  await walk(dir, '');
  return out;
}

async function listImmediateDirs(dir: string): Promise<string[]> {
  return (await fs.readdir(dir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort();
}

/** Parse a JSON file; on parse failure pushes an error and returns undefined. */
async function readJson(
  filePath: string,
  label: string,
  errors: string[]
): Promise<unknown | undefined> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown;
  } catch (err) {
    errors.push(`${label}: not valid JSON — ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isExpectedErrorRef(value: unknown): value is { $error: unknown } {
  return (
    isJsonObject(value) &&
    Object.keys(value).length === 1 &&
    Object.prototype.hasOwnProperty.call(value, '$error')
  );
}

// ---------------------------------------------------------------------------
// Optional value-level schema conformance (input-schema.json / output-schema.json)
// ---------------------------------------------------------------------------

async function loadOptionalWorkspaceSchema(
  agentDir: string,
  filename: (typeof SCHEMA_FILENAMES)[number],
  errors: string[]
): Promise<Record<string, unknown> | null> {
  const schemaPath = path.join(agentDir, filename);
  if (!existsSync(schemaPath)) return null;
  const raw = await fs.readFile(schemaPath, 'utf8');
  const validation = validateWorkspaceSchema(raw, filename);
  for (const issue of validation.errors) errors.push(`${filename}: ${issue}`);
  if (!validation.valid) return null;
  return JSON.parse(raw) as Record<string, unknown>;
}

function schemaProperties(
  schema: Record<string, unknown>
): Record<string, Record<string, unknown>> {
  const props = schema.properties;
  if (!props || typeof props !== 'object' || Array.isArray(props)) return {};
  return props as Record<string, Record<string, unknown>>;
}

function isFileField(propSchema: unknown): boolean {
  if (!isJsonObject(propSchema)) return false;
  if (propSchema['x-eigenpal-type'] === 'file') return true;
  if (propSchema.type === 'array' && isJsonObject(propSchema.items)) {
    return propSchema.items['x-eigenpal-type'] === 'file';
  }
  return false;
}

/** JSON Schema for the `{ "$file": "<scoped path>" }` refs dataset examples carry. */
const SCOPED_FILE_REF_JSON_SCHEMA = {
  type: 'object',
  properties: { $file: { type: 'string', minLength: 1 } },
  required: ['$file'],
  additionalProperties: false,
} as const;

/**
 * Rewrite file-typed subschemas (`x-eigenpal-type: 'file'`, scalar or array
 * items) so they also accept the `{ "$file": ... }` refs dataset examples use
 * for files. Everything else is left intact, so validating the full input
 * object against the rewritten schema enforces required fields and value
 * types exactly as authored — including `$file` refs placed in non-file
 * fields, which fail the field's declared type just like they would at run
 * start.
 */
function allowFileRefsInSchema(node: unknown): unknown {
  if (node === null || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map(allowFileRefsInSchema);
  const record = node as Record<string, unknown>;
  if (record['x-eigenpal-type'] === 'file') {
    return { anyOf: [SCOPED_FILE_REF_JSON_SCHEMA, record] };
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) out[key] = allowFileRefsInSchema(value);
  return out;
}

/**
 * Validate top-level values against matching schema properties. Skips file
 * fields, any value carrying `{ "$file": ... }` refs, and keys the schema
 * does not know about. Used for expected.json only — expected output may be
 * partial, unlike input.json which is validated as a whole object.
 */
function validateValuesAgainstSchemaProps(
  data: Record<string, unknown>,
  schema: Record<string, unknown>,
  label: string
): string[] {
  const props = schemaProperties(schema);
  const errors: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    const propSchema = props[key];
    if (!propSchema) continue;
    if (isFileField(propSchema)) continue;
    if (collectFileRefs(value).length > 0) continue;
    errors.push(...validateValueAgainstSchema(value, propSchema, `${label}/${key}`));
  }
  return errors;
}

function validateValueAgainstSchema(
  value: unknown,
  schema: Record<string, unknown>,
  label: string
): string[] {
  try {
    // Compile the authored schema as-is (mirroring run-start validation in
    // `@eigenpal/types` `validateInput`) so accept/reject semantics match the
    // platform exactly: extra keys are rejected only when the schema itself
    // sets `additionalProperties: false`.
    const validate = eigenpalAjv.compile(schema);
    if (validate(value)) return [];
    return (validate.errors ?? []).map((err) => {
      if (err.keyword === 'additionalProperties' && err.params?.additionalProperty) {
        return `${label}${err.instancePath}/${err.params.additionalProperty}: extra field not in schema`;
      }
      return `${label}${err.instancePath}: ${err.message ?? 'invalid'}`;
    });
  } catch (err) {
    return [`${label}: schema compile error — ${err instanceof Error ? err.message : String(err)}`];
  }
}
