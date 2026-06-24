import { z } from 'zod';

/**
 * Office MIME types - all natively supported via Kreuzberg
 */
export const OFFICE_MIME_TYPES = [
  // Word processing
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
  'application/msword', // doc
  'application/vnd.oasis.opendocument.text', // odt
  'application/rtf', // rtf
  'text/rtf', // rtf (alternate MIME used by some browsers)
  // Spreadsheets
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
  'application/vnd.ms-excel', // xls
  'application/vnd.ms-excel.sheet.macroenabled.12', // xlsm
  'application/vnd.ms-excel.sheet.binary.macroenabled.12', // xlsb
  'application/vnd.oasis.opendocument.spreadsheet', // ods
  // Presentations
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // pptx
  'application/vnd.openxmlformats-officedocument.presentationml.slideshow', // ppsx
  'application/vnd.ms-powerpoint.presentation.macroenabled.12', // pptm
  'application/vnd.ms-powerpoint', // ppt
  'application/vnd.oasis.opendocument.presentation', // odp
  // Email
  'message/rfc822', // eml
  'application/vnd.ms-outlook', // msg
  // eBooks
  'application/epub+zip', // epub
] as const;

/**
 * Supported MIME types grouped by parser category
 */
export const ParserCategory = {
  PLAINTEXT: [
    'text/plain',
    'text/markdown',
    'text/csv',
    'text/tab-separated-values', // tsv
    'text/html',
    'text/xml',
    'application/json',
    'application/x-yaml', // yaml
    'application/toml', // toml
    'image/svg+xml', // svg (text-based XML)
    // Markup & academic
    'text/x-rst', // reStructuredText
    'text/x-org', // Org Mode
    'application/x-latex', // LaTeX
    'application/x-ipynb+json', // Jupyter Notebook
    'application/x-bibtex', // BibTeX
    'application/docbook+xml', // DocBook
    'application/x-fictionbook+xml', // FictionBook
  ],
  OFFICE: [...OFFICE_MIME_TYPES],
  DOCUMENT: [
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/tiff',
    'image/gif',
    'image/bmp',
  ],
} as const;

/**
 * Parser type identifier
 */
export const ParserTypeSchema = z.enum([
  'plaintext', // No parsing needed, just read
  'office', // Office documents (docx, xlsx, pptx)
  'llm-vision', // LLM-based vision parsing (PDF, images)
  'ocr', // OCR-based parsing (Azure Document Intelligence, etc.)
]);

export type ParserType = z.infer<typeof ParserTypeSchema>;

/**
 * Document metadata
 */
export const DocumentMetadataSchema = z.object({
  filename: z.string(),
  mimeType: z.string(),
  size: z.number().describe('File size in bytes'),
  storageRef: z.string().optional().describe('Storage reference for the original file'),
});

export type DocumentMetadata = z.infer<typeof DocumentMetadataSchema>;

/**
 * Usage information
 */
export const ParseUsageSchema = z.object({
  pageCount: z.number(),
  processingTimeMs: z.number().optional(),
});

export type ParseUsage = z.infer<typeof ParseUsageSchema>;

/**
 * Coordinate unit for bounding regions
 *
 * - pixel: Absolute pixel coordinates (common for images)
 * - inch: Inches from top-left (Azure uses this for PDFs)
 * - point: PDF points (1/72 inch)
 * - normalized: 0-1 ratio relative to page dimensions (AWS Textract, Google Doc AI)
 */
export const CoordinateUnitSchema = z.enum(['pixel', 'inch', 'point', 'normalized']);
export type CoordinateUnit = z.infer<typeof CoordinateUnitSchema>;

/**
 * A single point in 2D space
 */
export const PointSchema = z.object({
  x: z.number(),
  y: z.number(),
});
export type Point = z.infer<typeof PointSchema>;

/**
 * Bounding region using polygon representation
 *
 * Supports arbitrary polygons (not just rectangles) to handle:
 * - Rotated/skewed text
 * - Non-rectangular regions
 * - Provider-native polygon formats
 *
 * Vertices are ordered clockwise from top-left.
 * For rectangles: [top-left, top-right, bottom-right, bottom-left]
 */
export const BoundingRegionSchema = z.object({
  /** Polygon vertices (minimum 3 for triangle, typically 4 for rectangles) */
  polygon: z.array(PointSchema).min(3),
  /** Coordinate unit - required for proper interpretation */
  unit: CoordinateUnitSchema,
  /** 0-based page index */
  pageIndex: z.number(),
});

export type BoundingRegion = z.infer<typeof BoundingRegionSchema>;

/**
 * Word/token with position information (for OCR)
 */
export const PositionedTextSchema = z.object({
  text: z.string(),
  confidence: z.number().min(0).max(1).optional(),
  boundingRegion: BoundingRegionSchema.optional(),
});

export type PositionedText = z.infer<typeof PositionedTextSchema>;

/**
 * Table cell for structured table extraction
 */
export const TableCellSchema = z.object({
  content: z.string(),
  rowIndex: z.number(),
  columnIndex: z.number(),
  rowSpan: z.number().default(1),
  columnSpan: z.number().default(1),
  boundingRegion: BoundingRegionSchema.optional(),
});

export type TableCell = z.infer<typeof TableCellSchema>;

/**
 * Extracted table structure
 */
export const ExtractedTableSchema = z.object({
  cells: z.array(TableCellSchema),
  rowCount: z.number(),
  columnCount: z.number(),
  boundingRegion: BoundingRegionSchema.optional(),
});

export type ExtractedTable = z.infer<typeof ExtractedTableSchema>;

/**
 * Layout element type - semantic role in document structure
 */
export const LayoutElementTypeSchema = z.enum([
  'paragraph',
  'title',
  'sectionHeading',
  'pageHeader',
  'pageFooter',
  'pageNumber',
  'footnote',
  'table',
  'figure',
  'formulaBlock',
]);

export type LayoutElementType = z.infer<typeof LayoutElementTypeSchema>;

/**
 * Layout element - a semantic block in reading order
 */
export const LayoutElementSchema = z.object({
  /** Semantic type of this element */
  type: LayoutElementTypeSchema,
  /** Text content (for paragraphs, headings, etc.) */
  content: z.string(),
  /** Table data if type is 'table' */
  table: ExtractedTableSchema.optional(),
  /** Figure caption if type is 'figure' */
  caption: z.string().optional(),
  /** Figure ID for reference */
  figureId: z.string().optional(),
  /** Bounding region for highlighting */
  boundingRegion: BoundingRegionSchema.optional(),
});

export type LayoutElement = z.infer<typeof LayoutElementSchema>;

/**
 * Per-page result with optional metadata
 */
export const PageResultSchema = z.object({
  pageIndex: z.number().describe('0-based page index'),
  text: z.string().describe('Extracted text content (markdown/HTML)'),

  // Page identification (useful for multi-sheet Excel files)
  pageName: z.string().optional().describe('Page/sheet name (e.g., Excel sheet name)'),

  // Structured layout elements in reading order
  layoutElements: z
    .array(LayoutElementSchema)
    .optional()
    .describe('Semantic layout elements in reading order'),

  // Optional rich metadata (primarily from OCR parsers)
  words: z.array(PositionedTextSchema).optional().describe('Word-level positions'),
  lines: z.array(PositionedTextSchema).optional().describe('Line-level positions'),
  tables: z.array(ExtractedTableSchema).optional().describe('Extracted tables'),

  // Page-level metadata
  width: z.number().optional().describe('Page width'),
  height: z.number().optional().describe('Page height'),
  unit: CoordinateUnitSchema.optional().describe('Unit for width/height and bounding regions'),
  confidence: z.number().min(0).max(1).optional().describe('Overall page confidence'),
});

export type PageResult = z.infer<typeof PageResultSchema>;

/**
 * Complete parse result
 */
export const ParseResultSchema = z.object({
  document: DocumentMetadataSchema,
  usage: ParseUsageSchema,
  pages: z.array(PageResultSchema),
  text: z.string().describe('Combined text from all pages'),

  // Parser metadata
  parserType: ParserTypeSchema,
  parserVersion: z.string().optional(),
  model: z.string().optional().describe('Model used (for LLM/OCR parsers)'),

  // Optional: raw response for debugging
  rawResponse: z.unknown().optional(),
});

export type ParseResult = z.infer<typeof ParseResultSchema>;

/**
 * Parse options/config
 */
export const ParseOptionsSchema = z.object({
  // Output format preference. Vocabulary matches @kreuzberg/node, the only
  // parser that actually consumes this value. `plain` is text without markup,
  // `markdown` keeps headings/lists/tables (default — best for downstream LLM
  // extraction), `djot` is a stricter markdown variant, `html` preserves the
  // full layout. OCR/VLM parsers ignore this field — they emit markdown.
  outputFormat: z.enum(['plain', 'markdown', 'djot', 'html']).default('markdown'),

  // OCR-specific options
  ocrProvider: z.string().optional().describe('OCR provider ID to use'),
  includeWordPositions: z.boolean().default(false),
  includeLinePositions: z.boolean().default(false),
  extractTables: z.boolean().default(true),

  // LLM-specific options
  provider: z.string().optional().describe('LLM provider ID to use'),
  model: z.string().optional(),
  maxConcurrency: z.number().min(1).max(30).default(3),
  pagesPerBatch: z.number().min(1).max(20).default(5),
  prompt: z.string().optional().describe('Custom prompt for LLM-based parsing'),

  // Language hints
  languages: z.array(z.string()).optional().describe('OCR language hints'),

  // Internal: tenant context. Set by the document-parser processor so the
  // LLM-vision parser can fall back to the workspace-level default LLM
  // provider when `provider` is unset. Not exposed in step YAML; the worker
  // injects it at parse time.
  tenantId: z.string().optional(),
});

export type ParseOptions = z.infer<typeof ParseOptionsSchema>;

/**
 * Parser input
 */
export const ParserInputSchema = z.object({
  data: z.instanceof(Buffer).or(z.instanceof(Uint8Array)),
  filename: z.string(),
  mimeType: z.string(),
  options: ParseOptionsSchema.optional(),
});

export type ParserInput = z.infer<typeof ParserInputSchema>;

/**
 * Map from file extension to the canonical MIME type.
 * Used to correct misdetected MIME types (e.g. RTF detected as application/msword).
 */
const EXTENSION_TO_MIME: Record<string, string> = {
  // Word processing
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  odt: 'application/vnd.oasis.opendocument.text',
  rtf: 'application/rtf',
  // Spreadsheets
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  xlsm: 'application/vnd.ms-excel.sheet.macroenabled.12',
  xlsb: 'application/vnd.ms-excel.sheet.binary.macroenabled.12',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  // Presentations
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ppsx: 'application/vnd.openxmlformats-officedocument.presentationml.slideshow',
  pptm: 'application/vnd.ms-powerpoint.presentation.macroenabled.12',
  ppt: 'application/vnd.ms-powerpoint',
  odp: 'application/vnd.oasis.opendocument.presentation',
  // Email
  eml: 'message/rfc822',
  msg: 'application/vnd.ms-outlook',
  // eBooks
  epub: 'application/epub+zip',
  // PDF & images
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  tiff: 'image/tiff',
  tif: 'image/tiff',
  gif: 'image/gif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  // Plaintext & data
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  html: 'text/html',
  htm: 'text/html',
  xml: 'text/xml',
  json: 'application/json',
  yaml: 'application/x-yaml',
  yml: 'application/x-yaml',
  toml: 'application/toml',
  // Markup & academic
  rst: 'text/x-rst',
  org: 'text/x-org',
  tex: 'application/x-latex',
  latex: 'application/x-latex',
  ipynb: 'application/x-ipynb+json',
  bib: 'application/x-bibtex',
  dbk: 'application/docbook+xml',
  docbook: 'application/docbook+xml',
  fb2: 'application/x-fictionbook+xml',
};

/**
 * Resolve the effective MIME type using the filename extension.
 *
 * File extensions are unambiguous for most document formats and more reliable
 * than browser/OS MIME detection (which frequently misdetects, e.g. RTF as
 * application/msword). When a known extension maps to a different MIME type
 * than what was declared, the extension-based MIME wins.
 *
 * Falls back to the declared MIME type when the extension is unknown.
 */
export function resolveEffectiveMimeType(filename: string, declaredMimeType: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (!ext) return declaredMimeType;

  const extensionMime = EXTENSION_TO_MIME[ext];
  return extensionMime ?? declaredMimeType;
}

/**
 * Map a bare file extension (without the dot, case-insensitive) to its MIME
 * type, or `undefined` when the extension is unknown. The inverse direction of
 * {@link resolveEffectiveMimeType}'s extension table.
 */
export function mimeTypeForExtension(extension: string): string | undefined {
  return EXTENSION_TO_MIME[extension.replace(/^\./, '').toLowerCase()];
}

const MIME_TO_EXTENSION: Record<string, string> = Object.entries(EXTENSION_TO_MIME).reduce(
  (acc, [ext, mime]) => {
    // First extension wins (e.g. image/jpeg → jpg, not jpeg).
    if (!(mime in acc)) acc[mime] = ext;
    return acc;
  },
  {} as Record<string, string>
);

/**
 * Best-effort canonical file extension (without the dot) for a MIME type, or
 * `undefined` when unknown. The MIME type is matched case-insensitively and any
 * `; charset=...` suffix is ignored.
 */
export function extensionForMimeType(mimeType: string): string | undefined {
  const base = mimeType.split(';')[0]?.trim().toLowerCase();
  return base ? MIME_TO_EXTENSION[base] : undefined;
}

/**
 * Determine which parser category a MIME type belongs to
 */
export function getParserCategory(mimeType: string): 'plaintext' | 'office' | 'document' | null {
  const normalized = mimeType.toLowerCase().trim();

  if (ParserCategory.PLAINTEXT.includes(normalized as (typeof ParserCategory.PLAINTEXT)[number])) {
    return 'plaintext';
  }
  if (ParserCategory.OFFICE.includes(normalized as (typeof ParserCategory.OFFICE)[number])) {
    return 'office';
  }
  if (ParserCategory.DOCUMENT.includes(normalized as (typeof ParserCategory.DOCUMENT)[number])) {
    return 'document';
  }

  return null;
}

/**
 * Check if MIME type requires specialized parsing (PDF, images)
 */
export function requiresSpecializedParser(mimeType: string): boolean {
  return getParserCategory(mimeType) === 'document';
}

/**
 * Human-readable labels for MIME types (used in error messages)
 */
const MIME_TO_LABEL: Record<string, string> = {
  // Word processing
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'application/msword': 'DOC',
  'application/vnd.oasis.opendocument.text': 'ODT',
  'application/rtf': 'RTF',
  'text/rtf': 'RTF',
  // Spreadsheets
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
  'application/vnd.ms-excel': 'XLS',
  'application/vnd.ms-excel.sheet.macroenabled.12': 'XLSM',
  'application/vnd.ms-excel.sheet.binary.macroenabled.12': 'XLSB',
  'application/vnd.oasis.opendocument.spreadsheet': 'ODS',
  // Presentations
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PPTX',
  'application/vnd.openxmlformats-officedocument.presentationml.slideshow': 'PPSX',
  'application/vnd.ms-powerpoint.presentation.macroenabled.12': 'PPTM',
  'application/vnd.ms-powerpoint': 'PPT',
  'application/vnd.oasis.opendocument.presentation': 'ODP',
  // Email
  'message/rfc822': 'EML',
  'application/vnd.ms-outlook': 'MSG',
  // eBooks
  'application/epub+zip': 'EPUB',
  // PDF & images
  'application/pdf': 'PDF',
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
  'image/webp': 'WebP',
  'image/tiff': 'TIFF',
  'image/gif': 'GIF',
  'image/bmp': 'BMP',
  'image/svg+xml': 'SVG',
  // Plaintext & data
  'text/plain': 'TXT',
  'text/markdown': 'Markdown',
  'text/csv': 'CSV',
  'text/tab-separated-values': 'TSV',
  'text/html': 'HTML',
  'text/xml': 'XML',
  'application/json': 'JSON',
  'application/x-yaml': 'YAML',
  'application/toml': 'TOML',
  // Markup & academic
  'text/x-rst': 'RST',
  'text/x-org': 'Org',
  'application/x-latex': 'LaTeX',
  'application/x-ipynb+json': 'Jupyter',
  'application/x-bibtex': 'BibTeX',
  'application/docbook+xml': 'DocBook',
  'application/x-fictionbook+xml': 'FB2',
};

/**
 * Get a flat list of all supported MIME types across all parser categories
 */
export function getAllSupportedMimeTypes(): string[] {
  return [...ParserCategory.PLAINTEXT, ...ParserCategory.OFFICE, ...ParserCategory.DOCUMENT];
}

/**
 * Get a human-readable label listing supported formats (for error messages)
 */
export function getSupportedFormatsLabel(): string {
  const allMimes = getAllSupportedMimeTypes();
  const labels = [...new Set(allMimes.map((m) => MIME_TO_LABEL[m] ?? m))];
  return labels.join(', ');
}
