import { SourcePackageManifestSchema, eigenpalAjv, validateWorkspaceSchema } from '@eigenpal/types';
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

  const agentDir = opts.agentDir ?? process.cwd();
  const inputSchema = await loadOptionalWorkspaceSchema(agentDir, 'input-schema.json', errors);
  const outputSchema = await loadOptionalWorkspaceSchema(agentDir, 'output-schema.json', errors);
  if (errors.length > 0) return { valid: false, errors };

  const entries = await fs.readdir(dir, { withFileTypes: true });
  const examples = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const example of examples) {
    const exampleRoot = path.join(dir, example);
    if (inputSchema) {
      errors.push(...(await validateAgentDatasetInputExample(example, exampleRoot, inputSchema)));
    } else {
      await validateJsonObjectIfPresent(
        path.join(exampleRoot, AGENT_EXAMPLE_INPUT_JSON),
        `${example}/${AGENT_EXAMPLE_INPUT_JSON}`,
        errors
      );
    }
    if (outputSchema) {
      errors.push(
        ...(await validateAgentDatasetExpectedExample(example, exampleRoot, outputSchema))
      );
    } else {
      await validateJsonObjectIfPresent(
        path.join(exampleRoot, AGENT_EXAMPLE_EXPECTED_JSON),
        `${example}/${AGENT_EXAMPLE_EXPECTED_JSON}`,
        errors
      );
    }
  }
  return { valid: errors.length === 0, errors };
}

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

function schemaRequired(schema: Record<string, unknown>): Set<string> {
  return new Set(Array.isArray(schema.required) ? schema.required.filter(isString) : []);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isFileField(propSchema: unknown): boolean {
  if (!propSchema || typeof propSchema !== 'object' || Array.isArray(propSchema)) return false;
  const prop = propSchema as Record<string, unknown>;
  if (prop['x-eigenpal-type'] === 'file') return true;
  if (prop.type === 'array' && prop.items && typeof prop.items === 'object') {
    return (prop.items as Record<string, unknown>)['x-eigenpal-type'] === 'file';
  }
  return false;
}

async function validateAgentDatasetInputExample(
  example: string,
  exampleRoot: string,
  inputSchema: Record<string, unknown>
): Promise<string[]> {
  const errors: string[] = [];
  const props = schemaProperties(inputSchema);
  const required = schemaRequired(inputSchema);
  const inputDir = path.join(exampleRoot, 'input');
  const inputFiles = existsSync(inputDir)
    ? (await fs.readdir(inputDir, { withFileTypes: true }))
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
    : [];
  const matchedFiles = new Set<string>();

  for (const [fieldName, propSchema] of Object.entries(props)) {
    if (!isFileField(propSchema)) continue;
    const match = inputFiles.find((file) => file === fieldName || file.startsWith(`${fieldName}.`));
    if (match) {
      matchedFiles.add(match);
    } else if (required.has(fieldName)) {
      errors.push(
        `${example}/input: missing file for "${fieldName}" (expected ${fieldName} or ${fieldName}.*)`
      );
    }
  }

  const dataFields = Object.entries(props)
    .filter(([, propSchema]) => !isFileField(propSchema))
    .map(([fieldName]) => fieldName);
  const inputJsonPath = path.join(exampleRoot, AGENT_EXAMPLE_INPUT_JSON);
  let inputData: Record<string, unknown> | null = null;
  if (existsSync(inputJsonPath)) {
    inputData = await readJsonObject(
      inputJsonPath,
      `${example}/${AGENT_EXAMPLE_INPUT_JSON}`,
      errors
    );
  } else {
    const missingRequired = dataFields.filter((fieldName) => required.has(fieldName));
    if (missingRequired.length > 0) {
      errors.push(
        `${example}/${AGENT_EXAMPLE_INPUT_JSON}: missing file (needed for ${missingRequired.join(', ')})`
      );
    }
  }

  if (inputData) {
    for (const fieldName of dataFields) {
      if (required.has(fieldName) && !(fieldName in inputData)) {
        errors.push(`${example}/${AGENT_EXAMPLE_INPUT_JSON}: missing field "${fieldName}"`);
      }
    }
    for (const key of Object.keys(inputData)) {
      const propSchema = props[key];
      if (!propSchema) {
        errors.push(
          `${example}/${AGENT_EXAMPLE_INPUT_JSON}: extra field "${key}" not in input schema`
        );
      } else if (isFileField(propSchema)) {
        errors.push(
          `${example}/${AGENT_EXAMPLE_INPUT_JSON}: "${key}" is a file field; put it under input/`
        );
      } else {
        errors.push(
          ...validateValueAgainstSchema(
            inputData[key],
            propSchema,
            `${example}/${AGENT_EXAMPLE_INPUT_JSON}/${key}`
          )
        );
      }
    }
  }

  for (const file of inputFiles) {
    if (matchedFiles.has(file)) continue;
    const stem = file.includes('.') ? file.slice(0, file.indexOf('.')) : file;
    if (!props[stem] || !isFileField(props[stem])) {
      errors.push(`${example}/input: extra file "${file}" does not match a file input field`);
    }
  }

  return errors;
}

async function validateAgentDatasetExpectedExample(
  example: string,
  exampleRoot: string,
  outputSchema: Record<string, unknown>
): Promise<string[]> {
  const errors: string[] = [];
  const props = schemaProperties(outputSchema);
  const expectedPath = path.join(exampleRoot, AGENT_EXAMPLE_EXPECTED_JSON);
  const expectedDir = path.join(exampleRoot, 'expected');
  const goldenFiles = existsSync(expectedDir)
    ? (await fs.readdir(expectedDir, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
        .map((entry) => entry.name)
    : [];

  let expected: Record<string, unknown> | null = null;
  if (existsSync(expectedPath)) {
    expected = await readJsonObject(
      expectedPath,
      `${example}/${AGENT_EXAMPLE_EXPECTED_JSON}`,
      errors
    );
  } else if (goldenFiles.length === 0) {
    errors.push(
      `${example}: missing ${AGENT_EXAMPLE_EXPECTED_JSON} and no golden files under expected/`
    );
  }

  if (expected) {
    for (const [key, value] of Object.entries(expected)) {
      const propSchema = props[key];
      if (!propSchema) {
        errors.push(
          `${example}/${AGENT_EXAMPLE_EXPECTED_JSON}: extra field "${key}" not in output schema`
        );
        continue;
      }
      if (isFileField(propSchema) && filePlaceholderValue(value)) continue;
      errors.push(
        ...validateValueAgainstSchema(
          value,
          propSchema,
          `${example}/${AGENT_EXAMPLE_EXPECTED_JSON}/${key}`
        )
      );
    }
  }

  for (const file of goldenFiles) {
    const matched = Object.entries(props).some(
      ([fieldName, propSchema]) =>
        isFileField(propSchema) && goldenNameMatchesFileField(file, fieldName)
    );
    if (!matched) {
      errors.push(
        `${example}/expected: extra golden file "${file}" does not match a file output field`
      );
    }
  }

  return errors;
}

function filePlaceholderValue(value: unknown): boolean {
  if (value === '__any__') return true;
  return Array.isArray(value) && value.every((item) => item === '__any__');
}

function goldenNameMatchesFileField(goldenName: string, fieldName: string): boolean {
  if (goldenName === fieldName) return true;
  if (goldenName.startsWith(`${fieldName}.`)) return true;
  const dot = goldenName.indexOf('.');
  const stem = dot === -1 ? goldenName : goldenName.slice(0, dot);
  return stem === fieldName;
}

async function validateJsonObjectIfPresent(
  filePath: string,
  label: string,
  errors: string[]
): Promise<void> {
  if (!existsSync(filePath)) return;
  await readJsonObject(filePath, label, errors);
}

async function readJsonObject(
  filePath: string,
  label: string,
  errors: string[]
): Promise<Record<string, unknown> | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      errors.push(`${label}: must be a JSON object`);
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    errors.push(`${label}: invalid JSON — ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

function validateValueAgainstSchema(
  value: unknown,
  schema: Record<string, unknown>,
  label: string
): string[] {
  try {
    const validate = eigenpalAjv.compile(tightenObjectSchemas(schema) as Record<string, unknown>);
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

function tightenObjectSchemas(node: unknown): unknown {
  if (node === null || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map(tightenObjectSchemas);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) out[key] = tightenObjectSchemas(value);
  const type = out.type;
  const isObjectType = type === 'object' || (Array.isArray(type) && type.includes('object'));
  if (isObjectType && out.additionalProperties === undefined) out.additionalProperties = false;
  return out;
}
