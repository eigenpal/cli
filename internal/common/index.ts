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
