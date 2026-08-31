import PizZip from 'pizzip';

const SHARED_STRING_ITEM_RE = /<si\b[^>]*>([\s\S]*?)<\/si>/gi;
const TEXT_NODE_RE = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/gi;
const DOUBLE_BRACE_RE = /\{\{([^{}]+)\}\}/g;
const SINGLE_BRACE_RE = /\{([^{}]+)\}/g;
/** Matches the vendored xlsx-template tokenizer: `{type:name.key:subtype}`. */
const PLACEHOLDER_INNER_RE = /^(?:([^{}:]+?):)?([^{}:]+?)(?:\.([^{}:]+?))?(?::([^{}:]+?))?$/;

export const XLSX_TABLE_PLACEHOLDER_GRAMMAR_ERROR = 'Invalid XLSX table placeholder';

export interface ParsedXlsxPlaceholder {
  /** Full `{...}` token. */
  placeholder: string;
  /** Inner text without braces. */
  inner: string;
  type: 'normal' | 'table' | 'image' | 'imageincell' | string;
  name: string;
  key?: string;
  subType?: string;
}

export interface XlsxPlaceholderInspection {
  /** Canonical `{placeholder}` names found in spreadsheet text nodes. */
  placeholders: string[];
  /** Inner names of `{{placeholder}}` occurrences. These are not canonical. */
  doubleBracePlaceholders: string[];
  /**
   * Inner names that match `{...}` but are not valid XLSX template grammar
   * (currently `{table:array}` without `.field`).
   */
  invalidPlaceholders: string[];
  /** User-facing warnings. Does not include cell values or other customer data. */
  warnings: string[];
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function collectTextNodesFromXml(xml: string): string[] {
  const texts: string[] = [];
  TEXT_NODE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TEXT_NODE_RE.exec(xml))) {
    texts.push(decodeXmlEntities(match[1]));
  }
  return texts;
}

/**
 * Reconstruct text from XLSX shared strings and worksheet inline strings.
 * Shared-string items join consecutive `<t>` runs so a placeholder split across
 * rich-text runs is still visible as one string.
 */
/** Index-preserving shared-string items, including empty entries. */
export function collectXlsxSharedStringItems(xml: string): string[] {
  const items: string[] = [];
  SHARED_STRING_ITEM_RE.lastIndex = 0;
  let si: RegExpExecArray | null;
  while ((si = SHARED_STRING_ITEM_RE.exec(xml))) {
    items.push(collectTextNodesFromXml(si[1]).join(''));
  }
  return items;
}

export function collectXlsxTextFromXml(xml: string): string[] {
  return collectTextNodesFromXml(xml);
}

export function collectXlsxTextNodes(buffer: Buffer): string[] {
  const zip = new PizZip(buffer);
  const texts: string[] = [];

  for (const [name, file] of Object.entries(zip.files)) {
    if (file.dir) continue;
    const isSharedStrings = name === 'xl/sharedStrings.xml';
    const isWorksheet = name.startsWith('xl/worksheets/') && name.endsWith('.xml');
    if (!isSharedStrings && !isWorksheet) continue;

    const xml = file.asText();
    if (isSharedStrings) {
      const items = collectXlsxSharedStringItems(xml);
      if (items.length > 0) {
        texts.push(...items.filter((item) => item.length > 0));
      } else {
        texts.push(...collectTextNodesFromXml(xml));
      }
    } else {
      texts.push(...collectTextNodesFromXml(xml));
    }
  }

  return texts;
}

function formatDoubleBraceWarning(names: string[]): string {
  const examples = names.slice(0, 5).map((name) => `{{${name}}}`);
  const extra = names.length > 5 ? `, and ${names.length - 5} more` : '';
  return (
    `XLSX templates use {placeholder} syntax, not {{placeholder}}. Found ${examples.join(', ')}` +
    `${extra}. Extra braces are left in the filled spreadsheet. Replace them with {placeholder} in the file.`
  );
}

/**
 * Parse the inner text of a `{...}` XLSX placeholder using the same grammar as
 * the vendored xlsx-template engine.
 */
export function parseXlsxPlaceholderInner(inner: string): ParsedXlsxPlaceholder | null {
  const trimmed = inner.trim();
  if (!trimmed) return null;
  const match = PLACEHOLDER_INNER_RE.exec(trimmed);
  if (!match) return null;
  const type = match[1] || 'normal';
  const name = match[2];
  const key = match[3];
  const subType = match[4];
  if (!name) return null;
  return {
    placeholder: `{${trimmed}}`,
    inner: trimmed,
    type,
    name,
    ...(key ? { key } : {}),
    ...(subType ? { subType } : {}),
  };
}

export function xlsxTablePlaceholderGrammarIssue(inner: string): string | null {
  const parsed = parseXlsxPlaceholderInner(inner);
  if (!parsed || parsed.type !== 'table') return null;
  if (parsed.key) return null;
  return (
    `${XLSX_TABLE_PLACEHOLDER_GRAMMAR_ERROR} {${parsed.inner}}. ` +
    'Use {table:array.field} with a field name after the array, e.g. {table:items.name}.'
  );
}

export function assertValidXlsxPlaceholderGrammar(inspection: XlsxPlaceholderInspection): void {
  if (inspection.invalidPlaceholders.length === 0) return;
  const issue = xlsxTablePlaceholderGrammarIssue(inspection.invalidPlaceholders[0]!);
  throw new Error(issue ?? `${XLSX_TABLE_PLACEHOLDER_GRAMMAR_ERROR}. Use {table:array.field}.`);
}

/**
 * Inspect XLSX text nodes for Office placeholder grammar.
 *
 * Canonical placeholders are `{field}` and `{table:array.prop}`. Double-brace
 * `{{field}}` is a common mistake (Liquid/YAML syntax in the spreadsheet) and
 * silently leaves leftover braces during fill — callers should warn on upload
 * and fail at render rather than produce `{value}`. `{table:array}` without a
 * `.field` is invalid grammar: callers should warn on upload/authoring and fail
 * at render rather than TypeError inside the engine.
 */
export function inspectXlsxTemplatePlaceholders(buffer: Buffer): XlsxPlaceholderInspection {
  const texts = collectXlsxTextNodes(buffer);
  const doubleBrace = new Set<string>();
  const singleBrace = new Set<string>();
  const invalid = new Set<string>();

  for (const text of texts) {
    DOUBLE_BRACE_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = DOUBLE_BRACE_RE.exec(text))) {
      const name = match[1].trim();
      if (name) doubleBrace.add(name);
    }

    const withoutDouble = text.replace(/\{\{[^{}]+\}\}/g, '');
    SINGLE_BRACE_RE.lastIndex = 0;
    while ((match = SINGLE_BRACE_RE.exec(withoutDouble))) {
      const name = match[1].trim();
      if (!name) continue;
      const grammarIssue = xlsxTablePlaceholderGrammarIssue(name);
      if (grammarIssue) {
        invalid.add(name);
        continue;
      }
      singleBrace.add(name);
    }
  }

  const doubleBracePlaceholders = [...doubleBrace].sort();
  const invalidPlaceholders = [...invalid].sort();
  const warnings: string[] = [];
  if (doubleBracePlaceholders.length > 0) {
    warnings.push(formatDoubleBraceWarning(doubleBracePlaceholders));
  }
  for (const name of invalidPlaceholders) {
    const issue = xlsxTablePlaceholderGrammarIssue(name);
    if (issue) warnings.push(issue);
  }

  return {
    placeholders: [...singleBrace].sort(),
    doubleBracePlaceholders,
    invalidPlaceholders,
    warnings,
  };
}
