import { promises as fs } from 'node:fs';
import path from 'node:path';
import { guessMimeType } from '../lib/fs-helpers';

const RESERVED_FIELD_NAMES = new Set([
  '_json',
  '_metadata',
  '_overrides',
  'input',
  'target',
  'overrides',
  'metadata',
]);

export type RunFormFile = {
  fieldName: string;
  content: Buffer | ArrayBuffer | Uint8Array;
  filename: string;
  mimeType?: string;
};

export async function buildRunFormData(input: {
  target: string;
  inputJson?: string;
  input?: Record<string, unknown>;
  inputFile?: string | string[];
  overrides?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
  files?: RunFormFile[];
}): Promise<FormData> {
  const form = new FormData();
  form.append('target', input.target);

  const inputObj = input.input ?? (input.inputJson ? JSON.parse(input.inputJson) : {});
  form.append('input', JSON.stringify(inputObj));

  if (input.overrides) {
    form.append('overrides', JSON.stringify(input.overrides));
  }
  if (input.metadata) {
    form.append('metadata', JSON.stringify(input.metadata));
  }

  for (const spec of parseInputFileSpecs(input.inputFile ?? [])) {
    const data = await fs.readFile(spec.filePath);
    appendFilePart(form, spec.fieldName, data, path.basename(spec.filePath));
  }

  for (const file of input.files ?? []) {
    appendFilePart(form, file.fieldName, file.content, file.filename, file.mimeType);
  }

  return form;
}

function appendFilePart(
  form: FormData,
  fieldName: string,
  content: Buffer | ArrayBuffer | Uint8Array,
  filename: string,
  mimeType?: string
) {
  assertValidFileFieldName(fieldName);
  const type = mimeType ?? guessMimeType(filename) ?? 'application/octet-stream';
  form.append(`files.${fieldName}`, new Blob([content as BlobPart], { type }), filename);
}

function assertValidFileFieldName(fieldName: string) {
  if (RESERVED_FIELD_NAMES.has(fieldName) || fieldName.startsWith('files.')) {
    throw new Error(`file field "${fieldName}" is reserved`);
  }
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
    assertValidFileFieldName(fieldName);
    return { fieldName, filePath };
  });
}
