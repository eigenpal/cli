/**
 * Eigenpal-private figure-crop persistence mode for the HPS adapter / storage path.
 * Not part of the public `ocr_options` contract.
 */

import { z } from 'zod';

export const OcrFigureAssetsModeSchema = z.enum(['none', 'stored']);
export type OcrFigureAssetsMode = z.infer<typeof OcrFigureAssetsModeSchema>;
