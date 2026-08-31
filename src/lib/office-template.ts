import {
  assertSafeOfficeZip,
  detectOfficeTemplateFormat,
  extractPlaceholders,
  inspectXlsxTemplatePlaceholders,
  renderOfficeTemplate,
  type OfficeTemplateFormat,
} from '@eigenpal/common';
import { createHash } from 'node:crypto';
import { extname } from 'node:path';

export const MAX_TEMPLATE_FILE_SIZE_BYTES = 50 * 1024 * 1024;

export const TEMPLATE_MIME_TYPES = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
} as const;

export type TemplateToken = {
  name: string;
  path?: string[];
  kind?: 'variable' | 'loop';
  type?: 'string' | 'number' | 'date' | 'boolean' | 'array' | 'object';
};

export type TemplateGrammar = {
  syntax: string;
  tokenDiscovery: boolean;
  capabilities: string[];
};

export type LocalTemplateInspection = {
  format: OfficeTemplateFormat;
  mimeType: string;
  sha256: string;
  size: number;
  tokens: TemplateToken[];
  warnings: string[];
  grammar: TemplateGrammar;
  doubleBracePlaceholders: string[];
};

export function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function templateNameFromFilename(filename: string): string {
  return filename.replace(/\.(docx|xlsx)$/i, '');
}

export function claimedTemplateFormat(filename: string): OfficeTemplateFormat | null {
  const ext = extname(filename).toLowerCase();
  if (ext === '.docx') return 'docx';
  if (ext === '.xlsx') return 'xlsx';
  return null;
}

export function grammarForFormat(format: OfficeTemplateFormat): TemplateGrammar {
  return format === 'docx'
    ? {
        syntax: '{field}; {#items}…{/items}; nested paths such as {customer.name}',
        tokenDiscovery: true,
        capabilities: ['scalar-values', 'loops', 'nested-paths', 'missing-value-highlighting'],
      }
    : {
        syntax: '{field}; {table:items.field}; {image:field}',
        tokenDiscovery: true,
        capabilities: ['scalar-values', 'table-rows', 'images', 'multi-sheet'],
      };
}

/** First data-object key a placeholder consumes (`table:subjects.first_name` → `subjects`). */
export function tokenDataKey(tokenName: string): string {
  let name = tokenName.trim();
  if (name.startsWith('table:')) name = name.slice('table:'.length);
  else if (name.startsWith('image:')) name = name.slice('image:'.length);
  if (name.startsWith('#') || name.startsWith('/')) name = name.slice(1);
  const dot = name.indexOf('.');
  return (dot === -1 ? name : name.slice(0, dot)).trim();
}

export function inspectOfficeTemplateBytes(
  bytes: Buffer,
  filename: string
): LocalTemplateInspection {
  if (bytes.byteLength > MAX_TEMPLATE_FILE_SIZE_BYTES) {
    throw new Error(
      `Template exceeds ${Math.floor(MAX_TEMPLATE_FILE_SIZE_BYTES / (1024 * 1024))} MB limit`
    );
  }
  assertSafeOfficeZip(bytes);
  const format = detectOfficeTemplateFormat(bytes);
  const claimed = claimedTemplateFormat(filename);
  if (claimed && format !== claimed) {
    throw new Error(
      `File extension .${claimed} does not match Office contents (${format}). Rename the file or export the correct format.`
    );
  }
  const extracted =
    format === 'docx'
      ? extractPlaceholders(bytes)
      : (() => {
          const result = inspectXlsxTemplatePlaceholders(bytes);
          return {
            placeholders: result.placeholders.map((name): TemplateToken => {
              const tableName = name.startsWith('table:') ? name.slice('table:'.length) : null;
              const imageName = name.startsWith('image:') ? name.slice('image:'.length) : null;
              const path = (tableName ?? imageName ?? name).split('.');
              return {
                name,
                path,
                kind: tableName ? 'loop' : 'variable',
                type: tableName ? 'array' : imageName ? 'object' : 'string',
              };
            }),
            warnings: result.warnings,
            doubleBracePlaceholders: result.doubleBracePlaceholders,
          };
        })();
  return {
    format,
    mimeType: TEMPLATE_MIME_TYPES[format],
    sha256: sha256Hex(bytes),
    size: bytes.byteLength,
    tokens: extracted.placeholders,
    warnings: extracted.warnings,
    grammar: grammarForFormat(format),
    doubleBracePlaceholders:
      'doubleBracePlaceholders' in extracted ? extracted.doubleBracePlaceholders : [],
  };
}

export function compareTemplateDataKeys(
  tokens: Array<{ name: string }>,
  dataKeys: string[]
): { unresolved: string[]; unusedDataKeys: string[] } {
  const declared = new Set(dataKeys);
  const needed = new Set(
    tokens.map((token) => tokenDataKey(token.name)).filter((key) => key.length > 0)
  );
  const unresolved = [...needed].filter((key) => !declared.has(key)).sort();
  const unusedDataKeys = dataKeys.filter((key) => !needed.has(key)).sort();
  return { unresolved, unusedDataKeys };
}

export function renderLocalOfficeTemplate(
  bytes: Buffer,
  filename: string,
  data: Record<string, unknown>
): {
  inspection: LocalTemplateInspection;
  output: Buffer;
  missingFields: string[];
} {
  const inspection = inspectOfficeTemplateBytes(bytes, filename);
  const rendered = renderOfficeTemplate(bytes, data, {
    highlightNotFound: inspection.format === 'docx',
    notFoundText: 'NOT FOUND',
  });
  return { inspection, output: rendered.buffer, missingFields: rendered.missingFields };
}
