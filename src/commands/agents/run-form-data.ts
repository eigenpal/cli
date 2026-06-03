import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AgentInputFileSpec } from './shared';

export async function buildAgentExecutionRunFormData(
  inputFile: string | string[],
  inputJson?: string
): Promise<FormData> {
  const form = new FormData();
  for (const spec of parseAgentInputFileSpecs(inputFile)) {
    const data = await fs.readFile(spec.filePath);
    form.append(spec.fieldName, new Blob([data]), path.basename(spec.filePath));
  }
  if (inputJson) form.append('_json', inputJson);
  return form;
}

function parseAgentInputFileSpecs(inputFile: string | string[]): AgentInputFileSpec[] {
  const values = Array.isArray(inputFile) ? inputFile : [inputFile];
  return values.map((value) => {
    const separatorIndex = value.indexOf('=');
    if (separatorIndex === -1) {
      return { fieldName: 'file', filePath: value };
    }
    const fieldName = value.slice(0, separatorIndex).trim();
    const filePath = value.slice(separatorIndex + 1).trim();
    if (!fieldName || !filePath) {
      throw new Error('--input-file must be <field=path> or a bare path');
    }
    if (fieldName === '_json' || fieldName === '_metadata' || fieldName === 'input') {
      throw new Error(`--input-file field "${fieldName}" is reserved`);
    }
    return { fieldName, filePath };
  });
}
