/**
 * Client types - AI and OCR client interfaces
 */

// AI Client
export type {
  AIClient,
  AIResponse,
  CompleteOptions,
  ExtractOptions,
  ExtractResponse,
  ImageInput,
  TokenUsage,
  VisionOptions,
} from './ai-client';

// OCR Client
export type {
  OCRClient,
  OCRClientCapabilities,
  OCRClientConfig,
  OCRFigure,
  OCRKeyValue,
  OCRLine,
  OCROptions,
  OCRPageResult,
  OCRParagraph,
  OCRResult,
  OCRTable,
  OCRTableCell,
  OCRWord,
  ParagraphRole,
} from './ocr-client';
