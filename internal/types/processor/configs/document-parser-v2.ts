import { z } from 'zod';
import { ReasoningEffortSchema } from '../../client/ai-client';
import { PageResultSchema, ParseResultSchema } from '../../parser/parser';
import { DocumentParserInputSchema } from './document-parser';

export const ImageReadingBackendSchema = z.enum(['ocr', 'vision']);
export const ParseV2TextFormatSchema = z.enum(['plain', 'markdown', 'html', 'djot']);
export const ParseV2SettingsSchema = z
  .strictObject({
    policy: z
      .strictObject({
        native: z
          .enum(['prefer', 'require', 'skip'])
          .default('prefer')
          .describe(
            'Prefer local text extraction, require local text extraction with no image transcription, or skip native PDF extraction. Figure enrichment is independent.'
          ),
        imageReading: z
          .strictObject({
            order: z
              .array(ImageReadingBackendSchema)
              .min(1)
              .max(2)
              .refine((v) => new Set(v).size === v.length, 'Backends must be unique')
              .default(['ocr', 'vision'])
              .describe('Ordered allowed backends. A single entry prohibits the other backend.'),
          })
          .prefault({}),
      })
      .prefault({}),
    providers: z
      .strictObject({
        ocr: z
          .string()
          .min(1)
          .optional()
          .describe(
            'Exact configured OCR provider ID. Missing pins fail; they never resolve to another provider.'
          ),
        vision: z
          .string()
          .min(1)
          .optional()
          .describe(
            'Exact configured vision provider ID. Otherwise uses the deployment parsing default or vision role.'
          ),
      })
      .prefault({}),
    output: z
      .strictObject({
        textFormat: ParseV2TextFormatSchema.default('markdown'),
        includeCellMetadata: z
          .boolean()
          .default(false)
          .describe(
            'Include spreadsheet cell evidence in pages[].spreadsheet and annotate text for downstream extraction. Preserves raw/displayed values and workbook date system.'
          ),
        nativeWhitespace: z
          .enum(['reading-order', 'spatial'])
          .default('reading-order')
          .describe(
            'Spatial preserves native PDF column spacing. It does not promise OCR/vision coordinates.'
          ),
        require: z
          .array(z.enum(['wordCoordinates', 'tables']))
          .default([])
          .describe(
            'Required evidence capabilities on nonblank pages. Backends unable to satisfy them are rejected.'
          ),
      })
      .prefault({}),
    enrichment: z
      .strictObject({
        figures: z
          .strictObject({
            enabled: z.boolean().default(false),
            provider: z.string().min(1).optional(),
            instructions: z.string().optional(),
            reasoningEffort: ReasoningEffortSchema.optional(),
          })
          .prefault({}),
      })
      .prefault({}),
    advanced: z
      .strictObject({
        vision: z
          .strictObject({
            maxConcurrency: z.number().int().min(1).max(10).default(3),
            pagesPerBatch: z.number().int().min(1).max(20).default(5),
            renderScale: z.number().min(1).max(4).default(2),
            imageQuality: z.number().int().min(1).max(100).default(85),
            instructions: z
              .string()
              .optional()
              .describe(
                'Transcription instructions, never document-specific extraction/schema instructions.'
              ),
            reasoningEffort: ReasoningEffortSchema.optional(),
          })
          .prefault({}),
        languages: z.array(z.string().min(1)).optional(),
        allowPartial: z
          .boolean()
          .default(false)
          .describe('Return unresolved pages explicitly instead of failing. Default false.'),
        cache: z.boolean().default(false),
      })
      .prefault({}),
  })
  .superRefine((config, ctx) => {
    if (config.output.nativeWhitespace === 'spatial' && config.output.textFormat !== 'plain') {
      ctx.addIssue({
        code: 'custom',
        path: ['output'],
        message: 'Spatial native whitespace requires textFormat: plain.',
      });
    }
  });
export const DocumentParserV2ConfigSchema = ParseV2SettingsSchema.prefault({});
export const AiParseV2ConfigSchema = ParseV2SettingsSchema.safeExtend({
  input: z.string().min(1).describe('File reference or template expression for the document'),
});
export const ParseV2PageSchema = PageResultSchema.extend({
  provenance: z.object({
    source: z.enum(['native', 'ocr', 'vision']),
    provider: z.string().optional(),
    model: z.string().optional(),
    reason: z.string(),
    textFormat: ParseV2TextFormatSchema,
    capabilities: z.array(z.enum(['wordCoordinates', 'tables'])),
  }),
  status: z.enum(['complete', 'blank', 'no-text', 'unresolved']),
  warnings: z.array(z.string()).default([]),
});
export const ParseV2ResultSchema = ParseResultSchema.omit({ rawResponse: true }).extend({
  parserVersion: z.literal('2'),
  pages: z.array(ParseV2PageSchema),
  completeness: z.object({
    status: z.enum(['complete', 'partial']),
    unresolvedPageIndexes: z.array(z.number().int().nonnegative()),
  }),
  usage: ParseResultSchema.shape.usage.extend({
    visionPagesProcessed: z.number().int().nonnegative(),
  }),
});
export const DocumentParserV2InputSchema = DocumentParserInputSchema;
export type DocumentParserV2Config = z.infer<typeof DocumentParserV2ConfigSchema>;
export type ParseV2Result = z.infer<typeof ParseV2ResultSchema>;
export type ParseV2Page = z.infer<typeof ParseV2PageSchema>;
export type ImageReadingBackend = z.infer<typeof ImageReadingBackendSchema>;
