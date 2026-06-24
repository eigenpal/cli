/**
 * Parser types - document parsing results
 */

export {
  // Schemas
  BoundingRegionSchema,
  CoordinateUnitSchema,
  DocumentMetadataSchema,
  ExtractedTableSchema,
  // Constants
  LayoutElementSchema,
  LayoutElementTypeSchema,
  OFFICE_MIME_TYPES,
  PageResultSchema,
  ParseOptionsSchema,
  ParseResultSchema,
  ParseUsageSchema,
  ParserCategory,
  ParserInputSchema,
  ParserTypeSchema,
  PointSchema,
  PositionedTextSchema,
  TableCellSchema,
  extensionForMimeType,
  getAllSupportedMimeTypes,
  getParserCategory,
  getSupportedFormatsLabel,
  mimeTypeForExtension,
  requiresSpecializedParser,
  resolveEffectiveMimeType,
  // Types
  type BoundingRegion,
  type CoordinateUnit,
  type DocumentMetadata,
  type ExtractedTable,
  type LayoutElement,
  type LayoutElementType,
  type PageResult,
  type ParseOptions,
  type ParseResult,
  type ParseUsage,
  type ParserInput,
  type ParserType,
  type Point,
  type PositionedText,
  type TableCell,
} from './parser';
