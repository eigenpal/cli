import type { BoundingRegion, CoordinateUnit, Point } from '../parser/parser';

/**
 * OCR Client Types
 *
 * Core types for OCR/Document Intelligence providers.
 * Uses plain TypeScript types - Zod validation happens at boundaries.
 *
 * All bounding regions use polygon representation with explicit units
 * for provider-agnostic coordinate handling.
 */

// Re-export spatial types for convenience
export type { BoundingRegion, CoordinateUnit, Point };

/**
 * Word extracted by OCR with position and confidence
 */
export interface OCRWord {
  text: string;
  confidence: number;
  boundingRegion?: BoundingRegion;
}

/**
 * Line of text extracted by OCR
 */
export interface OCRLine {
  text: string;
  words?: OCRWord[];
  boundingRegion?: BoundingRegion;
}

/**
 * Semantic role of a paragraph in the document layout
 */
export type ParagraphRole =
  | 'title'
  | 'sectionHeading'
  | 'pageHeader'
  | 'pageFooter'
  | 'pageNumber'
  | 'footnote'
  | 'formulaBlock'
  | undefined;

/**
 * Paragraph extracted by OCR with semantic role
 */
export interface OCRParagraph {
  text: string;
  /** Semantic role in document layout (title, sectionHeading, pageHeader, pageFooter, etc.) */
  role?: ParagraphRole;
  lines?: OCRLine[];
  boundingRegion?: BoundingRegion;
}

/**
 * Figure/image detected in document
 */
export interface OCRFigure {
  /** Figure ID */
  id?: string;
  /** Caption text if detected */
  caption?: string;
  /** Page index where figure appears */
  pageIndex: number;
  boundingRegion?: BoundingRegion;
}

/**
 * Table cell
 */
export interface OCRTableCell {
  text: string;
  rowIndex: number;
  columnIndex: number;
  rowSpan?: number;
  columnSpan?: number;
  isHeader?: boolean;
  boundingRegion?: BoundingRegion;
}

/**
 * Table extracted from document
 */
export interface OCRTable {
  rowCount: number;
  columnCount: number;
  cells: OCRTableCell[];
  boundingRegion?: BoundingRegion;
}

/**
 * Key-value pair extracted from forms
 */
export interface OCRKeyValue {
  key: string;
  value: string;
  confidence?: number;
  keyBoundingRegion?: BoundingRegion;
  valueBoundingRegion?: BoundingRegion;
}

/**
 * Single page result from OCR
 */
export interface OCRPageResult {
  pageIndex: number;
  width: number;
  height: number;
  /** Coordinate unit for dimensions and bounding regions */
  unit: CoordinateUnit;

  /** Full text content of the page */
  text: string;

  /** Markdown content when outputContentFormat is 'markdown' */
  markdown?: string;

  /** Structured content (optional, based on analysis options) */
  words?: OCRWord[];
  lines?: OCRLine[];
  paragraphs?: OCRParagraph[];
  tables?: OCRTable[];
  figures?: OCRFigure[];
  keyValues?: OCRKeyValue[];

  /** Overall confidence for the page */
  confidence?: number;
}

/**
 * Complete OCR analysis result
 */
export interface OCRResult {
  /** Provider that performed the analysis */
  provider: string;

  /** Model/version used */
  model: string;

  /** Per-page results */
  pages: OCRPageResult[];

  /** Combined text from all pages */
  text: string;

  /** Combined markdown from all pages */
  markdown?: string;

  /** Output format used */
  outputContentFormat?: 'text' | 'markdown';

  /** Document-level key-value pairs (for forms) */
  keyValues?: OCRKeyValue[];

  /** Processing time in milliseconds */
  processingTimeMs?: number;

  /** Detected languages */
  languages?: string[];
}

/**
 * OCR analysis options
 */
export interface OCROptions {
  /** Include word-level positions */
  includeWords?: boolean;

  /** Include line-level positions */
  includeLines?: boolean;

  /** Include paragraph detection */
  includeParagraphs?: boolean;

  /** Extract tables */
  extractTables?: boolean;

  /** Extract key-value pairs (forms) */
  extractKeyValues?: boolean;

  /** Specific pages to analyze (1-indexed, empty = all) */
  pages?: number[];

  /** Preferred languages for OCR (e.g., ['en', 'de']) */
  languages?: string[];

  /** Output format: 'text' (default) or 'markdown' (Azure prebuilt-layout only) */
  outputContentFormat?: 'text' | 'markdown';

  /** Abort the provider request/poll when the caller cancels the step */
  signal?: AbortSignal;
}

/**
 * OCR Client interface
 *
 * Implementations handle provider-specific APIs while exposing
 * this common interface for document analysis.
 */
export interface OCRClient {
  /** Provider identifier (e.g., 'azure', 'google', 'aws', 'tesseract') */
  readonly provider: string;

  /** Model/version string */
  readonly model: string;

  /**
   * Analyze a document and extract text, tables, and structure
   */
  analyze(data: Buffer, mimeType: string, options?: OCROptions): Promise<OCRResult>;

  /**
   * Get supported MIME types for this provider
   */
  supportedMimeTypes(): string[];

  /**
   * Check if this provider supports table extraction
   */
  supportsTableExtraction(): boolean;

  /**
   * Check if this provider supports key-value extraction (forms)
   */
  supportsKeyValueExtraction(): boolean;

  /**
   * Check if this provider supports handwriting recognition
   */
  supportsHandwriting(): boolean;
}

/**
 * OCR Client configuration
 */
export interface OCRClientConfig {
  provider: 'azure' | 'google' | 'aws' | 'tesseract';
  apiKey?: string;
  endpoint?: string;
  region?: string;
  model?: string;
}
