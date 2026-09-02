export {
  XLSX_TABLE_PLACEHOLDER_GRAMMAR_ERROR,
  assertValidXlsxPlaceholderGrammar,
  collectXlsxTextNodes,
  inspectXlsxTemplatePlaceholders,
  parseXlsxPlaceholderInner,
  xlsxTablePlaceholderGrammarIssue,
  type ParsedXlsxPlaceholder,
  type XlsxPlaceholderInspection,
} from './office-placeholder-inspect';
export {
  EXCEL_WORKSHEET_MAX_COLUMNS,
  EXCEL_WORKSHEET_MAX_ROWS,
  OLE_COMPOUND_MAGIC,
  SPREADSHEET_WORKSHEET_PATH_RE,
  SPREADSHEET_ZIP_STRUCTURE_DEFAULTS,
  assertExcelGridRange,
  assertSafeSpreadsheetZip,
  classifyOfficeSpreadsheetZip,
  decodeA1RangeDimensions,
  isOleCompoundFile,
  type SafeSpreadsheetZip,
  type SpreadsheetWorksheetDimension,
  type SpreadsheetZipClassification,
  type SpreadsheetZipStructureLimits,
} from './office-spreadsheet-preflight';
export {
  NotFoundHighlightModule,
  XLSX_DOUBLE_BRACE_ERROR,
  detectOfficeTemplateFormat,
  extractDocxtemplaterErrors,
  nullifyEmptyStrings,
  renderDocxTemplate,
  renderOfficeTemplate,
  renderXlsxTemplate,
  type OfficeTemplateFormat,
  type OfficeTemplateRenderResult,
} from './office-template-render';
export {
  MAX_TEMPLATE_INFLATED_BYTES,
  MAX_TEMPLATE_ZIP_ENTRIES,
  assertSafeOfficeZip,
  inspectSafeOfficeZip,
  isOfficeZipContainer,
  type OfficeZipEntry,
  type OfficeZipInspection,
} from './office-zip-safety';
export {
  deepMerge,
  getStepOverrideMode,
  isPlainObject,
  resolveStepOverride,
  type ResolveStepOverrideResult,
} from './override-utils';
export { extractPlaceholders, type PlaceholderExtractionResult } from './placeholder-extractor';
export {
  assertXlsxTemplateExpansionWithinLimits,
  assertXlsxTemplateOutputBytes,
  assertXlsxTemplateWorkload,
  estimateXlsxTemplateExpansion,
  xlsxTemplateRenderLimits,
  type XlsxTemplateRenderLimits,
  type XlsxTemplateSheetWorkload,
} from './xlsx-template-workload';
