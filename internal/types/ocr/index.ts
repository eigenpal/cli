/**
 * Compatibility re-exports for OpenParser OCR contracts.
 *
 * Public wire schemas: `@openparser/schema`.
 * Eigenpal-private internals: `@eigenpal/types/private/*` (also re-exported
 * here so existing `@eigenpal/types` imports keep working).
 */
export * from '@openparser/schema';
export * from '../private/ocr-figure-assets';
export * from '../private/ocr-id-lookup';
export * from '../private/ocr-llm';
