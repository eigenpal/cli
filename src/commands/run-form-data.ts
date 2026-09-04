import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ApiClient } from '../lib/client';
import { guessMimeType } from '../lib/fs-helpers';
import { indicesRequiringPreUpload } from '../lib/upload-limits';
import { newIdempotencyKey, uploadReusableFile } from '../lib/upload-reusable-file';

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

type LocalRunFile = {
  fieldName: string;
  content: Buffer;
  filename: string;
  mimeType: string;
};

export type PreparedRunInputFiles = {
  /** Remaining small files that stay on the multipart round-trip. */
  form: FormData;
  /** True when at least one file part remains on the form. */
  hasMultipartFiles: boolean;
};

/**
 * Build a run-start request, pre-uploading files that would exceed the
 * configured aggregate multipart budget through the Files API with
 * `purpose=run-input`. A disabled budget leaves every file on multipart.
 */
export async function buildPreparedRunRequest(
  client: ApiClient,
  input: {
    target: string;
    inputJson?: string;
    input?: Record<string, unknown>;
    inputFile?: string | string[];
    overrides?: Record<string, unknown> | null;
    metadata?: Record<string, unknown>;
    files?: RunFormFile[];
  }
): Promise<PreparedRunInputFiles> {
  const inputObj: Record<string, unknown> = {
    ...(input.input ?? (input.inputJson ? JSON.parse(input.inputJson) : {})),
  };

  const localFiles: LocalRunFile[] = [];

  for (const spec of parseInputFileSpecs(input.inputFile ?? [])) {
    const data = await fs.readFile(spec.filePath);
    localFiles.push({
      fieldName: spec.fieldName,
      content: data,
      filename: path.basename(spec.filePath),
      mimeType: guessMimeType(path.basename(spec.filePath)) || 'application/octet-stream',
    });
  }

  for (const file of input.files ?? []) {
    const content = Buffer.isBuffer(file.content)
      ? file.content
      : Buffer.from(file.content as ArrayBuffer);
    localFiles.push({
      fieldName: file.fieldName,
      content,
      filename: file.filename,
      mimeType: file.mimeType || guessMimeType(file.filename) || 'application/octet-stream',
    });
  }

  const preUploadIndices = indicesRequiringPreUpload(
    localFiles.map((file) => ({ size: file.content.byteLength }))
  );
  upgradeMixedFieldPreUpload(localFiles, preUploadIndices);

  const preUploadRefsByField = new Map<string, Array<{ $fileId: string }>>();
  const preUploadIdempotencyKeys = localFiles.map(() => newIdempotencyKey());
  for (let index = 0; index < localFiles.length; index++) {
    const file = localFiles[index]!;
    if (!preUploadIndices.has(index)) continue;
    const uploaded = await uploadReusableFile(client, {
      content: file.content,
      filename: file.filename,
      mimeType: file.mimeType,
      purpose: 'run-input',
      idempotencyKey: preUploadIdempotencyKeys[index],
    });
    const refs = preUploadRefsByField.get(file.fieldName) ?? [];
    refs.push({ $fileId: uploaded.id });
    preUploadRefsByField.set(file.fieldName, refs);
  }

  for (const [fieldName, refs] of preUploadRefsByField) {
    inputObj[fieldName] = refs.length === 1 ? refs[0] : refs;
  }

  const remaining = localFiles.filter((_, index) => !preUploadIndices.has(index));
  const form = new FormData();
  form.append('target', input.target);
  form.append('input', JSON.stringify(inputObj));
  if (input.overrides) form.append('overrides', JSON.stringify(input.overrides));
  if (input.metadata) form.append('metadata', JSON.stringify(input.metadata));

  for (const file of remaining) {
    appendFilePart(form, file.fieldName, file.content, file.filename, file.mimeType);
  }

  return { form, hasMultipartFiles: remaining.length > 0 };
}

/** @deprecated Prefer {@link buildPreparedRunRequest} which applies aggregate pre-upload. */
export async function buildRunFormData(input: {
  target: string;
  inputJson?: string;
  input?: Record<string, unknown>;
  inputFile?: string | string[];
  overrides?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
  files?: RunFormFile[];
}): Promise<FormData> {
  // Legacy helper kept for unit tests that assert form shape without a client.
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

/**
 * When the same field has both pre-uploaded and multipart files, the canonical
 * run-start envelope rejects `files.<field>` if that field already appears in
 * `input`. Upgrade every file for that field to pre-upload so order is preserved
 * without dropping or overwriting values.
 */
function upgradeMixedFieldPreUpload(
  localFiles: ReadonlyArray<LocalRunFile>,
  preUploadIndices: Set<number>
): void {
  const fieldHasPreUpload = new Set<string>();
  const fieldHasMultipart = new Set<string>();

  for (let index = 0; index < localFiles.length; index++) {
    const { fieldName } = localFiles[index]!;
    if (preUploadIndices.has(index)) fieldHasPreUpload.add(fieldName);
    else fieldHasMultipart.add(fieldName);
  }

  for (const fieldName of fieldHasPreUpload) {
    if (!fieldHasMultipart.has(fieldName)) continue;
    for (let index = 0; index < localFiles.length; index++) {
      if (localFiles[index]!.fieldName === fieldName) preUploadIndices.add(index);
    }
  }
}

function appendFilePart(
  form: FormData,
  fieldName: string,
  content: Buffer | ArrayBuffer | Uint8Array,
  filename: string,
  mimeType?: string
) {
  assertValidFileFieldName(fieldName);
  const type = mimeType || guessMimeType(filename) || 'application/octet-stream';
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
