import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';
import {
  assertValidXlsxPlaceholderGrammar,
  inspectXlsxTemplatePlaceholders,
} from './office-placeholder-inspect';
import { assertSafeOfficeZip } from './office-zip-safety';
import {
  assertXlsxTemplateOutputBytes,
  assertXlsxTemplateWorkload,
} from './xlsx-template-workload';
import XlsxTemplate from './xlsx-template.js';

const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export const XLSX_DOUBLE_BRACE_ERROR =
  'XLSX templates use {placeholder} syntax, not {{placeholder}}.';

export type OfficeTemplateFormat = 'docx' | 'xlsx';

export interface OfficeTemplateRenderResult {
  buffer: Buffer;
  mimeType: string;
  extension: OfficeTemplateFormat;
  missingFields: string[];
}

const MARKER = '__EIGENPAL_NFM__';

export class NotFoundHighlightModule {
  private missingFields: Set<string>;
  private enabled: boolean;
  private escapedText: string;
  private recordRun = false;
  private recordedRun = '';

  constructor(opts: { notFoundText: string; enabled: boolean; missingFields: Set<string> }) {
    this.missingFields = opts.missingFields;
    this.enabled = opts.enabled;
    this.escapedText = opts.notFoundText
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  set() {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  nullGetter(part: any) {
    if (!this.enabled) return null;
    if (part.module === 'rawxml') return null;
    if (part.value) this.missingFields.add(part.value);
    return MARKER;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  render(part: any) {
    this.trackRunProps(part);
    return null;
  }

  postrender(parts: string[]) {
    if (!this.enabled) return parts;

    const result: string[] = [];
    for (const part of parts) {
      if (!part.includes(MARKER)) {
        result.push(part);
        continue;
      }
      result.push(this.replaceMarkers(part));
    }
    return result;
  }

  private replaceMarkers(part: string): string {
    const rPrMatch = part.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/);
    const rPr = rPrMatch ? rPrMatch[0] : '';

    let redRPr: string;
    if (rPrMatch) {
      const cleaned = rPrMatch[1].replace(/<w:color[^/]*\/>/g, '');
      redRPr = `<w:rPr>${cleaned}<w:color w:val="FF0000"/></w:rPr>`;
    } else {
      redRPr = '<w:rPr><w:color w:val="FF0000"/></w:rPr>';
    }

    const replacement =
      `</w:t></w:r>` +
      `<w:r>${redRPr}<w:t>${this.escapedText}</w:t></w:r>` +
      `<w:r>${rPr}<w:t xml:space="preserve">`;

    return part.split(MARKER).join(replacement);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private trackRunProps(part: any) {
    if (part.tag === 'w:r') {
      this.recordedRun = '';
    } else if (part.tag === 'w:rPr') {
      if (part.position === 'start') {
        this.recordRun = true;
        this.recordedRun += part.value;
      }
      if (part.position === 'end' || part.position === 'selfclosing') {
        this.recordedRun += part.value;
        this.recordRun = false;
      }
    } else if (this.recordRun) {
      this.recordedRun += part.value;
    }
  }
}

export function nullifyEmptyStrings(data: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === '') {
      result[key] = null;
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) => {
        if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
          return nullifyEmptyStrings(item as Record<string, unknown>);
        }
        return item === '' ? null : item;
      });
    } else if (typeof value === 'object' && value !== null) {
      result[key] = nullifyEmptyStrings(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function detectOfficeTemplateFormat(buffer: Buffer): OfficeTemplateFormat {
  try {
    assertSafeOfficeZip(buffer);
    const zip = new PizZip(buffer);
    const contentTypes = zip.file('[Content_Types].xml');
    if (!contentTypes) {
      throw new Error('Invalid Office document: missing [Content_Types].xml');
    }
    const content = contentTypes.asText();
    if (content.includes('spreadsheetml')) return 'xlsx';
    if (content.includes('wordprocessingml')) return 'docx';
    throw new Error('Unknown Office document type');
  } catch (error) {
    if (error instanceof Error && /Office|Unknown Office/.test(error.message)) {
      throw error;
    }
    throw new Error(
      `Failed to detect template type: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export function extractDocxtemplaterErrors(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const err = error as {
    message?: string;
    properties?: {
      errors?: Array<{
        message?: string;
        properties?: { id?: string; explanation?: string; file?: string; xtag?: string };
      }>;
    };
  };
  const errors = err.properties?.errors;
  if (!errors || errors.length === 0) return null;
  const details = errors.map((e) => {
    const props = e.properties;
    const parts: string[] = [];
    if (props?.id) parts.push(props.id);
    if (props?.xtag) parts.push(`tag: ${props.xtag}`);
    if (props?.explanation) parts.push(props.explanation);
    else if (e.message) parts.push(e.message);
    return parts.join(' - ') || 'Unknown error';
  });
  return details.join('\n');
}

export function renderDocxTemplate(
  templateBuffer: Buffer,
  data: Record<string, unknown>,
  options: { highlightNotFound: boolean; notFoundText: string }
): OfficeTemplateRenderResult {
  assertSafeOfficeZip(templateBuffer);
  const missingFields = new Set<string>();
  const zip = new PizZip(templateBuffer);
  const highlightModule = new NotFoundHighlightModule({
    notFoundText: options.notFoundText,
    enabled: options.highlightNotFound,
    missingFields,
  });
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    modules: [highlightModule],
    nullGetter: (part) => {
      if (part.module === 'rawxml') return '';
      if (part.value) missingFields.add(part.value);
      return '';
    },
  });
  const renderData = options.highlightNotFound ? nullifyEmptyStrings(data) : data;
  doc.render(renderData);
  return {
    buffer: doc.getZip().generate({ type: 'nodebuffer' }),
    mimeType: DOCX_MIME_TYPE,
    extension: 'docx',
    missingFields: [...missingFields],
  };
}

export function renderXlsxTemplate(
  templateBuffer: Buffer,
  data: Record<string, unknown>,
  _options: { highlightNotFound: boolean; notFoundText: string }
): OfficeTemplateRenderResult {
  assertSafeOfficeZip(templateBuffer);
  const inspection = inspectXlsxTemplatePlaceholders(templateBuffer);
  if (inspection.doubleBracePlaceholders.length > 0) {
    const examples = inspection.doubleBracePlaceholders.slice(0, 8).map((name) => `{{${name}}}`);
    throw new Error(
      `${XLSX_DOUBLE_BRACE_ERROR} Found ${examples.join(', ')} in the spreadsheet. Extra braces would be left in the output. Use {placeholder} in the XLSX file; {{ }} is only for workflow YAML data mapping.`
    );
  }
  assertValidXlsxPlaceholderGrammar(inspection);
  assertXlsxTemplateWorkload(templateBuffer, data);
  const template = new XlsxTemplate(templateBuffer);
  template.substituteAll(data);
  const buffer = template.generate({ type: 'nodebuffer' }) as Buffer;
  assertXlsxTemplateOutputBytes(buffer);
  return {
    buffer,
    mimeType: XLSX_MIME_TYPE,
    extension: 'xlsx',
    missingFields: [],
  };
}

export function renderOfficeTemplate(
  templateBuffer: Buffer,
  data: Record<string, unknown>,
  options: { highlightNotFound?: boolean; notFoundText?: string } = {}
): OfficeTemplateRenderResult {
  const highlightNotFound = options.highlightNotFound !== false;
  const notFoundText = options.notFoundText || 'NOT FOUND';
  const format = detectOfficeTemplateFormat(templateBuffer);
  try {
    if (format === 'xlsx') {
      return renderXlsxTemplate(templateBuffer, data, { highlightNotFound, notFoundText });
    }
    return renderDocxTemplate(templateBuffer, data, { highlightNotFound, notFoundText });
  } catch (error) {
    if (format === 'docx') {
      const details = extractDocxtemplaterErrors(error);
      if (details) throw new Error(`Template rendering failed:\n${details}`);
    }
    throw new Error(
      `Template rendering failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
