import { apiPath } from './api-paths';
import type { ApiClient } from './client';
import { ApiError } from './client';
import { guessMimeType } from './fs-helpers';
import {
  inspectOfficeTemplateBytes,
  MAX_TEMPLATE_FILE_SIZE_BYTES,
  templateNameFromFilename,
  type TemplateGrammar,
  type TemplateToken,
} from './office-template';
import { uploadReusableFile } from './upload-reusable-file';

export type PublicTemplateRevision = {
  id: string;
  number: number;
  sha256: string;
  createdAt: string | Date;
};

export type PublicTemplate = {
  id: string;
  name: string;
  description?: string | null;
  filename: string;
  format: 'docx' | 'xlsx';
  mimeType: string;
  size?: number | null;
  sha256?: string | null;
  tokens: TemplateToken[];
  grammar: TemplateGrammar;
  currentRevision?: PublicTemplateRevision | null;
  createdAt: string | Date;
  updatedAt?: string | Date | null;
  cleanupProof?: string;
};

export type TemplateListResponse = {
  items: PublicTemplate[];
  total: number;
};

export async function listPublicTemplates(
  client: ApiClient,
  opts: { limit?: number; offset?: number } = {}
): Promise<TemplateListResponse> {
  const params: Record<string, string> = {};
  if (opts.limit != null) params.limit = String(opts.limit);
  if (opts.offset != null) params.offset = String(opts.offset);
  const raw = (await client.get(apiPath('/templates'), params)) as TemplateListResponse;
  return {
    items: Array.isArray(raw.items) ? raw.items : [],
    total: typeof raw.total === 'number' ? raw.total : (raw.items?.length ?? 0),
  };
}

export async function listAllPublicTemplates(client: ApiClient): Promise<PublicTemplate[]> {
  const items: PublicTemplate[] = [];
  let offset = 0;
  const limit = 100;
  for (;;) {
    const page = await listPublicTemplates(client, { limit, offset });
    items.push(...page.items);
    offset += page.items.length;
    if (page.items.length === 0 || items.length >= page.total) break;
  }
  return items;
}

export async function getPublicTemplate(
  client: ApiClient,
  templateId: string
): Promise<PublicTemplate> {
  return (await client.get(
    apiPath(`/templates/${encodeURIComponent(templateId)}`)
  )) as PublicTemplate;
}

export async function downloadTemplateBytes(
  client: ApiClient,
  templateId: string,
  revisionId?: string
): Promise<{ bytes: Buffer; filename: string; contentType: string }> {
  const suffix = revisionId ? `?revisionId=${encodeURIComponent(revisionId)}` : '';
  const res = await client.getStream(
    apiPath(`/templates/${encodeURIComponent(templateId)}/content${suffix}`)
  );
  const bytes = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
  const disposition = res.headers.get('content-disposition') ?? '';
  const filenameMatch = disposition.match(/filename\*?=(?:UTF-8''|"?)([^";]+)/i);
  const fromHeader = filenameMatch?.[1]
    ? decodeURIComponent(filenameMatch[1].replace(/"/g, ''))
    : null;
  const fromType = contentType.includes('spreadsheetml')
    ? `${templateId}.xlsx`
    : contentType.includes('wordprocessingml')
      ? `${templateId}.docx`
      : null;
  const filename = fromHeader || fromType || `${templateId}.bin`;
  return { bytes, filename, contentType };
}

async function createOrReplaceFromBytes(
  client: ApiClient,
  bytes: Buffer,
  filename: string,
  mode:
    | { kind: 'create'; name?: string; description?: string; staged?: boolean }
    | { kind: 'replace'; templateId: string }
): Promise<PublicTemplate> {
  if (bytes.byteLength > MAX_TEMPLATE_FILE_SIZE_BYTES) {
    throw new Error(
      `Template exceeds ${Math.floor(MAX_TEMPLATE_FILE_SIZE_BYTES / (1024 * 1024))} MB limit`
    );
  }
  inspectOfficeTemplateBytes(bytes, filename);
  const uploaded = await uploadReusableFile(client, {
    content: bytes,
    filename,
    mimeType: guessMimeType(filename) || undefined,
  });
  try {
    if (mode.kind === 'create') {
      return (await client.post(apiPath('/templates'), {
        fileId: uploaded.id,
        name: mode.name ?? templateNameFromFilename(filename),
        description: mode.description,
        ...(mode.staged ? { staged: true } : {}),
      })) as PublicTemplate;
    }
    return (await client.put(apiPath(`/templates/${encodeURIComponent(mode.templateId)}`), {
      fileId: uploaded.id,
    })) as PublicTemplate;
  } finally {
    await client
      .delete(apiPath(`/files/${encodeURIComponent(uploaded.id)}`))
      .catch(() => undefined);
  }
}

export async function uploadWorkspaceTemplate(
  client: ApiClient,
  input: {
    bytes: Buffer;
    filename: string;
    name?: string;
    description?: string;
    staged?: boolean;
  }
): Promise<PublicTemplate> {
  return createOrReplaceFromBytes(client, input.bytes, input.filename, {
    kind: 'create',
    name: input.name,
    description: input.description,
    staged: input.staged,
  });
}

export async function replaceWorkspaceTemplate(
  client: ApiClient,
  templateId: string,
  input: { bytes: Buffer; filename: string }
): Promise<PublicTemplate> {
  return createOrReplaceFromBytes(client, input.bytes, input.filename, {
    kind: 'replace',
    templateId,
  });
}

export async function deleteWorkspaceTemplate(
  client: ApiClient,
  templateId: string
): Promise<{ deleted: boolean }> {
  return (await client.delete(apiPath(`/templates/${encodeURIComponent(templateId)}`))) as {
    deleted: boolean;
  };
}

export async function applyStagedTemplateAction(
  client: ApiClient,
  templateId: string,
  input: { proof: string; action: 'cleanup' | 'finalize' }
): Promise<{ cleaned?: boolean; finalized?: boolean }> {
  return (await client.post(apiPath(`/templates/${encodeURIComponent(templateId)}/staging`), {
    proof: input.proof,
    action: input.action,
  })) as { cleaned?: boolean; finalized?: boolean };
}

export function isNotFoundApiError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404;
}

export type TemplateSummary = {
  id: string;
  currentRevisionId: string | null;
  format: string;
  filename: string;
  sha256: string | null;
  tokens: TemplateToken[];
  grammar: TemplateGrammar;
  name: string;
};

export function summarizeTemplate(template: PublicTemplate): TemplateSummary {
  return {
    id: template.id,
    currentRevisionId: template.currentRevision?.id ?? null,
    format: template.format,
    filename: template.filename,
    sha256: template.currentRevision?.sha256 ?? template.sha256 ?? null,
    tokens: template.tokens ?? [],
    grammar: template.grammar,
    name: template.name,
  };
}
