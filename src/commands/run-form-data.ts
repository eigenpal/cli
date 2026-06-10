import { promises as fs } from 'node:fs';
import path from 'node:path';
import { guessMimeType } from '../lib/fs-helpers';

export async function buildRunFormData(input: {
  inputFile: string | string[];
  inputJson?: string;
}): Promise<FormData> {
  const form = new FormData();
  for (const spec of parseInputFileSpecs(input.inputFile)) {
    const data = await fs.readFile(spec.filePath);
    const filename = path.basename(spec.filePath);
    const mimeType = guessMimeType(filename) || 'application/octet-stream';
    form.append(spec.fieldName, new Blob([data], { type: mimeType }), filename);
  }
  form.append('_json', JSON.stringify(input.inputJson ? JSON.parse(input.inputJson) : {}));
  return form;
}

function parseInputFileSpecs(inputFile: string | string[]) {
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
