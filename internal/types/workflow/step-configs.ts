/**
 * Step Configuration Schemas
 *
 * Single source of truth for ALL step type configurations.
 * Used by:
 * - Frontend: Workflow builder validation + React Hook Form
 * - Worker: Runtime config validation before execution
 * - LLM: JSON Schema export for workflow generation
 *
 * Each step type has:
 * - configSchema: What goes in step.with (or step-level for control steps)
 * - outputSchema: What the step produces
 */

import { z } from 'zod';
import { toJsonSchema, type JsonSchema7Type } from '../core/common';
import { compileTypedScript } from '../typed-script';
import type { StepRetryCapability } from './retry';
import { SCRIPT_FN_MAX_BYTES } from './script-function';
import type { StepType } from './steps';
import { STEP_TYPES } from './steps';

// ============================================================================
// AI Step Schemas
// ============================================================================

/**
 * ai.parse - Parse documents using OCR/LLM
 * Config goes in step.with
 */
export const AiParseConfigSchema = z.object({
  input: z.string().describe('Storage reference or template expression for the document'),
  ocrModel: z.string().optional().describe('OCR provider ID for PDF/image parsing'),
  llmModel: z.string().optional().describe('LLM provider ID for vision-based parsing'),
  maxConcurrency: z
    .number()
    .min(1)
    .max(10)
    .default(3)
    .optional()
    .describe('Max concurrent VLM batch requests'),
  pagesPerBatch: z
    .number()
    .min(1)
    .max(20)
    .default(5)
    .optional()
    .describe('Number of page images per VLM request'),
  pdfRenderScale: z
    .number()
    .min(1)
    .max(4)
    .default(1)
    .optional()
    .describe(
      'Scale factor for rendering PDF pages before VLM parsing. Higher values produce sharper images at larger payload sizes.'
    ),
  imageQuality: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(85)
    .optional()
    .describe(
      'JPEG quality for rendered PDF page images sent to VLM parsing. Higher values reduce compression artifacts at larger payload sizes.'
    ),
  prompt: z.string().optional().describe('Custom extraction prompt'),
  languages: z.array(z.string()).optional().describe('OCR language hints'),
  outputFormat: z
    .enum(['plain', 'markdown', 'djot', 'html'])
    .default('markdown')
    .optional()
    .describe(
      'Format for extracted text. `markdown` (default) keeps structure and is best for LLM extraction; `plain` is unstyled text; `djot`/`html` preserve more layout. Only the native (Kreuzberg) parser respects this — OCR/VLM always emit markdown.'
    ),
  nativeText: z
    .boolean()
    .default(false)
    .optional()
    .describe(
      'Extract native/embedded text from PDFs without OCR/VLM. Faster and uses no credits. Falls back to OCR/VLM if the PDF has no embedded text.'
    ),
});

export const AiParseOutputSchema = z.object({
  text: z.string().describe('Extracted text content (combined from all pages)'),
  pages: z
    .array(
      z.object({
        pageIndex: z.number().describe('0-based page index'),
        // Field is `text`, NOT `content` — matches the runtime PageResult
        // shape produced by the worker. The earlier `content` declaration
        // was a long-standing lie: workflows using
        // `{{ steps.parse.output.pages[0].content }}` always got undefined
        // because the actual data is on `.text`.
        text: z.string().describe('Extracted text for this page'),
        pageName: z.string().optional().describe('Page/sheet name (e.g., Excel sheet name)'),
        confidence: z.number().optional().describe('Overall page confidence'),
      })
    )
    .optional()
    .describe('Per-page content'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Document metadata'),
});

/**
 * ai.extract - Extract structured data using LLM
 * Config goes in step.with
 *
 * For per-page extraction, use control.parallel_map to iterate over pages
 * and apply ai.extract to each page individually.
 */
export const AiExtractConfigSchema = z.object({
  input: z.string().describe('Text content or template expression'),
  schema: z
    .object({
      type: z.literal('object'),
      properties: z.record(z.string(), z.unknown()),
      required: z.array(z.string()).optional(),
    })
    .refine((schema) => Object.keys(schema.properties).length > 0, {
      message: 'Extraction schema must define at least one field',
    })
    .describe('JSON Schema defining the structure to extract'),
  prompt: z.string().optional().describe('Custom prompt template for extraction'),
  provider: z.string().optional().describe('Provider ID (e.g., "openai-gpt4o")'),
  model: z.string().optional().describe('Model override'),
  // temperature is intentionally NOT user-controllable — Eigenpal is a
  // deterministic framework so the worker hardcodes `temperature: 0` on
  // every LLM call. Older YAMLs with `temperature: …` parse cleanly
  // (Zod strips unknown keys); the value is silently ignored.
  maxInputTokens: z
    .number()
    .int()
    .optional()
    .describe(
      'Max input tokens. Truncates input text and logs a warning when exceeded. Omit for no limit.'
    ),
  grounded: z
    .boolean()
    .optional()
    .describe(
      'Optional. When true, adds a grounding pass: each schema field gets a source span + confidence (high=verbatim, medium=fuzzy, low=ungrounded) under a `_grounding` key, and ungrounded/fuzzy fields are flagged for human review. Grounding always calls OpenAI directly (independent of the extract provider) and requires OPENAI_API_KEY. Values stay the reliable schema-typed ones.'
    ),
  groundingModel: z
    .string()
    .optional()
    .describe(
      'Provider/model for the grounding pass. Defaults to the workspace default LLM; grounding runs against OpenAI, so pick an OpenAI-compatible model.'
    ),
  groundingExamples: z
    .array(
      z.object({
        text: z.string(),
        extractions: z.array(z.object({ field: z.string(), text: z.string() })),
      })
    )
    .optional()
    .describe('Optional few-shot examples pinning grounding to verbatim source text per field.'),
  reviewOn: z
    .enum(['medium_or_low', 'low_only'])
    .optional()
    .describe('Which grounding confidences flag a field for review. Default: medium_or_low.'),
});

export const AiExtractOutputSchema = z
  .record(z.string(), z.unknown())
  .describe('Extracted structured data matching the provided schema');

/**
 * ai.split - Split a parsed document into named sections using an LLM.
 *
 * Consumes the output of ai.parse (per-page text). Pages are chunked into
 * windows under a token budget; for each window the LLM identifies anchor
 * pages where each named section begins. Anchor merge + continuity fill
 * produces the final page ranges. Inspired by Reducto's /split.
 */
export const AiSplitConfigSchema = z.object({
  input: z
    .string()
    .describe('Template expression resolving to ai.parse output, e.g. "{{ steps.parse.output }}"'),
  sections: z
    .array(
      z.object({
        name: z
          .string()
          .min(1)
          .describe('Stable id, used as the key in output and template references'),
        description: z
          .string()
          .min(1)
          .describe(
            'What this section looks like in the document. Use the document\'s own terminology (e.g. "Príloha 2 / Anlage 2") and visual cues. Multilingual variants belong here.'
          ),
        required: z
          .boolean()
          .optional()
          .describe(
            'If true, log a warn when this section is not found, and lean the LLM toward expecting it. Default: false (sections may be absent).'
          ),
        endHints: z
          .array(z.string())
          .optional()
          .describe(
            'Natural-language hints fed to the LLM about what marks the END of this section (e.g. ["PRÍPAD PORUŠENIA ZMLUVY", "*Koniec prílohy*"]). The LLM uses these as guidance — not a regex match — so casing variants, missing diacritics, and multilingual phrasings all close the section correctly.'
          ),
      })
    )
    .min(1)
    .describe('Named sections to find in the document'),
  rules: z
    .string()
    .optional()
    .describe(
      'Optional natural-language rules appended to the system prompt. E.g. "End-of-section markers like *Koniec prílohy 2* close the current section."'
    ),
  provider: z
    .string()
    .optional()
    .describe(
      'Provider ID from eigenpal.config.yaml (e.g. "openai-gpt5.4-mini"). Falls back to the tenant default LLM provider when omitted.'
    ),
  windowTokenBudget: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      'Override the per-window token ceiling for this step. Defaults to env SPLIT_WINDOW_TOKEN_BUDGET or 20000. Smaller windows give sharper anchors on contract-style documents (less competing context for the LLM to mis-anchor on); bump to 50k–100k when sections routinely exceed per-window page count.'
    ),
});

export const AiSplitOutputSchema = z.object({
  splits: z
    .array(
      z.object({
        name: z.string().describe('Section name from the config'),
        page_range: z
          .tuple([z.number().int(), z.number().int()])
          .describe('[startIndex, endIndex] inclusive, 0-based page indices'),
        confidence: z
          .enum(['low', 'medium', 'high'])
          .describe(
            'LLM confidence at the anchor page. Coarse enum (low | medium | high) — numeric scores cluster meaninglessly at 0.85-0.95.'
          ),
        notes: z.string().describe("LLM's justification for the anchor — useful for debugging"),
        evidence: z
          .object({
            // .nullable() is defensive — the operator strips nulls in
            // mergeAnchors, but if one slips through we accept it rather
            // than abort the run. LLMs sometimes emit `null` here for
            // sections they can't anchor (despite prompt saying to omit).
            start_heading_text: z
              .string()
              .nullable()
              .optional()
              .describe('Verbatim heading text the LLM cited as the section start'),
            start_page: z
              .number()
              .int()
              .nullable()
              .optional()
              .describe('Page where start_heading_text appears'),
          })
          .optional()
          .describe(
            'Structured start-anchor evidence — parse this instead of regexing over `notes`.'
          ),
        end_evidence: z
          .object({
            end_page: z.number().int().describe('LAST page of the section (inclusive)'),
            confidence: z.enum(['low', 'medium', 'high']),
            notes: z
              .string()
              .describe(
                "LLM's justification for the end. Pair with start `notes` for reconciliation."
              ),
          })
          .optional()
          .describe(
            "Set when the LLM detected an end-of-section cue (matched against the section's `endHints` or an explicit closing marker). Absent when the section was closed by continuity-fill alone."
          ),
        text: z
          .string()
          .describe('Joined per-page content for this section, ready for downstream ai.extract'),
        pages: z
          .array(
            z.object({
              pageIndex: z.number().int(),
              text: z.string(),
              pageName: z.string().optional(),
              source: z
                .enum(['anchored', 'inferred'])
                .describe(
                  'Whether this page is direct LLM evidence (anchored) or continuity-filled (inferred)'
                ),
            })
          )
          .describe(
            'Raw per-page records covered by this split (in page order). Iterate when downstream needs per-page context (e.g. control.parallel_map over section pages).'
          ),
        pages_anchored: z.array(z.number().int()).describe('Pages with direct LLM evidence'),
        pages_inferred: z
          .array(z.number().int())
          .describe('Pages assigned by deterministic continuity fill'),
      })
    )
    .describe('Sections found in the document, in page order. Absent sections are omitted.'),
});

/**
 * ai.segment - Separate a concatenated batch into typed document instances.
 *
 * The inverse of ai.split: instead of locating a KNOWN, ordered list of named
 * sections inside one document, segment takes ONLY a type taxonomy and discovers
 * an UNKNOWN number of documents in arbitrary order, finding each boundary and
 * assigning a type. Repeated instances of the same type are first-class. Reuses
 * split's windowed boundary-detection engine.
 */
export const AiSegmentConfigSchema = z.object({
  input: z
    .string()
    .describe('Template expression resolving to ai.parse output, e.g. "{{ steps.parse.output }}"'),
  documentTypes: z
    .array(
      z.object({
        name: z
          .string()
          .min(1)
          .describe('Type label returned in documents[].type (e.g. "timesheet", "deal-memo")'),
        description: z
          .string()
          .optional()
          .describe(
            'What this document type looks like — headings, layout, vocabulary, and the cues that mark its FIRST page. Fed to the LLM for both boundary detection and typing.'
          ),
      })
    )
    .min(1)
    .describe(
      'The document-type taxonomy. The LLM tags each detected document with one of these names, or the reserved "unknown" type when none fit.'
    ),
  rules: z
    .string()
    .optional()
    .describe('Optional natural-language rules appended to the system prompt.'),
  provider: z
    .string()
    .optional()
    .describe(
      'Provider ID from eigenpal.config.yaml. Falls back to the tenant default LLM provider when omitted.'
    ),
  windowTokenBudget: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      'Override the per-window token ceiling. Defaults to env SPLIT_WINDOW_TOKEN_BUDGET or 20000.'
    ),
});

export const AiSegmentOutputSchema = z.object({
  summary: z
    .object({
      total: z.number().int().describe('Total documents discovered.'),
      labelled: z.number().int().describe('Documents assigned a known taxonomy type.'),
      unlabelled: z
        .number()
        .int()
        .describe(
          'Documents the segmenter could not label (type "unknown") — escalate to a human.'
        ),
      lowConfidence: z.number().int().describe('Documents with low boundary/type confidence.'),
      byType: z.record(z.string(), z.number().int()).describe('Per-type document counts.'),
      needsReview: z
        .array(
          z.object({
            index: z.number().int(),
            type: z.string(),
            page_range: z.tuple([z.number().int(), z.number().int()]),
            reason: z.enum(['unlabelled', 'low_confidence']),
            notes: z.string(),
          })
        )
        .describe('Documents to escalate to a human operator, with the reason for each.'),
    })
    .describe(
      'Batch-level escalation summary: labelled vs unlabelled counts + docs needing review.'
    ),
  documents: z
    .array(
      z.object({
        index: z.number().int().describe('0-based position of this document in the batch'),
        type: z.string().describe('Chosen type name from the taxonomy, or "unknown"'),
        page_range: z
          .tuple([z.number().int(), z.number().int()])
          .describe('[startIndex, endIndex] inclusive, 0-based page indices'),
        confidence: z
          .enum(['low', 'medium', 'high'])
          .describe('LLM confidence at the boundary + type. Coarse enum (low | medium | high).'),
        notes: z.string().describe('LLM justification for the boundary — useful for debugging'),
        evidence: z
          .object({
            start_heading_text: z
              .string()
              .nullable()
              .optional()
              .describe('Verbatim heading/title text the LLM cited as the document start'),
            start_page: z
              .number()
              .int()
              .nullable()
              .optional()
              .describe('Page where the start appears'),
          })
          .optional()
          .describe('Structured start evidence — parse this instead of regexing over `notes`.'),
        text: z
          .string()
          .describe('Joined per-page content for this document, ready for downstream ai.extract'),
        pages: z
          .array(
            z.object({
              pageIndex: z.number().int(),
              text: z.string(),
              pageName: z.string().optional(),
              source: z.enum(['anchored', 'inferred']),
            })
          )
          .describe('Raw per-page records covered by this document, in page order.'),
        pages_anchored: z
          .array(z.number().int())
          .describe('Pages with direct LLM boundary evidence'),
        pages_inferred: z
          .array(z.number().int())
          .describe('Pages assigned by deterministic continuity fill'),
      })
    )
    .describe('Documents discovered in the batch, in page order. The full batch is covered.'),
});

/**
 * ai.classify - Classify a document or text into one of a fixed label set.
 *
 * Customizable prompt + pre-selected enum. Under the hood the worker
 * synthesizes an extract schema with `label: enum(labels[].name)` and routes
 * through the existing ai.extract LLM pipeline — same provider cascade, same
 * structured-output guarantees, no extra LLM logic to maintain.
 */
export const AiClassifyConfigSchema = z.object({
  input: z
    .string()
    .describe(
      'Template expression for the text to classify. Typically the output of ai.parse, e.g. "{{ steps.parse.output.text }}".'
    ),
  labels: z
    .array(
      z.object({
        name: z
          .string()
          .min(1)
          .describe(
            'The label value returned in output.label. Keep it short and stable (used in downstream conditions).'
          ),
        description: z
          .string()
          .optional()
          .describe('What documents fall into this label. Fed to the LLM as guidance.'),
      })
    )
    .min(2)
    .describe('Allowed labels. The LLM is constrained to pick exactly one of these names.'),
  prompt: z
    .string()
    .optional()
    .describe(
      'Custom classification instructions appended to the system prompt. Use to clarify edge cases or emphasize evidence the model should weigh.'
    ),
  provider: z
    .string()
    .optional()
    .describe(
      'Provider ID from eigenpal.config.yaml (e.g. "openai-gpt4o-mini"). Falls back to the tenant default LLM provider when omitted.'
    ),
  model: z.string().optional().describe('Model override (advanced)'),
  maxInputTokens: z
    .number()
    .int()
    .optional()
    .describe('Max input tokens. Truncates input text when exceeded. Omit for no limit.'),
});

export const AiClassifyOutputSchema = z.object({
  label: z
    .string()
    .describe(
      'The selected label name (one of the configured labels). Compare against literal strings to gate downstream steps.'
    ),
  confidence: z
    .enum(['low', 'medium', 'high'])
    .describe(
      'LLM confidence in the classification. Coarse enum — numeric scores cluster meaninglessly at 0.85-0.95.'
    ),
  reason: z.string().describe('Short justification for the chosen label — useful for debugging.'),
});

// ============================================================================
// Transform Step Schemas
// ============================================================================

/**
 * transform.set - Set key-value pairs in output
 * Config goes in step.with
 */
export const TransformSetConfigSchema = z.object({
  fields: z
    .record(z.string(), z.unknown())
    .refine((obj) => Object.keys(obj).length > 0, {
      message: 'At least one field must be defined',
    })
    .describe('Key-value pairs to set in output'),
  input: z.record(z.string(), z.unknown()).optional().describe('Base object to extend'),
});

export const TransformSetOutputSchema = z
  .record(z.string(), z.unknown())
  .describe('Object with all fields set');

/**
 * transform.remove - Remove fields from object
 * Config goes in step.with
 */
export const TransformRemoveConfigSchema = z.object({
  input: z.record(z.string(), z.unknown()).optional().describe('Object to remove fields from'),
  fields: z
    .array(z.string())
    .min(1, 'At least one field to remove is required')
    .describe('Field names to remove'),
});

export const TransformRemoveOutputSchema = z
  .record(z.string(), z.unknown())
  .describe('Object with fields removed');

/**
 * transform.combine - Merge multiple objects or arrays
 * Config goes in step.with
 */
export const TransformCombineConfigSchema = z.object({
  sources: z
    .array(z.string())
    .min(1, 'At least one source is required')
    .describe('Template expressions for sources to combine'),
  target: z.string().min(1, 'Target path is required').describe('Target path in output'),
  mode: z.enum(['merge', 'concat', 'deep']).default('merge').optional(),
});

export const TransformCombineOutputSchema = z
  .union([z.record(z.string(), z.unknown()), z.array(z.unknown())])
  .describe('Combined result');

/**
 * transform.split - Split string or object
 * Config goes in step.with
 */
export const TransformSplitConfigSchema = z.object({
  input: z
    .union([z.string(), z.record(z.string(), z.unknown())])
    .optional()
    .describe('String or object to split'),
  source: z.string().optional().describe('Template expression for source'),
  by: z.string().default(',').optional().describe('Delimiter for string splitting'),
  delimiter: z.string().optional().describe('Alias for by'),
  limit: z.number().optional().describe('Max number of splits'),
  keys: z.array(z.string()).optional().describe('Keys to extract from object'),
});

export const TransformSplitOutputSchema = z
  .union([
    z.array(z.string()),
    z.object({
      extracted: z.record(z.string(), z.unknown()),
      remaining: z.record(z.string(), z.unknown()),
    }),
  ])
  .describe('Split result - array or extracted/remaining object');

/**
 * transform.merge - Merge multiple named inputs
 * Config goes in step.with
 */
export const TransformMergeConfigSchema = z.object({
  preservePortNames: z.boolean().default(true).optional(),
  outputKey: z.string().optional(),
});

export const TransformMergeOutputSchema = z.object({
  items: z.array(z.unknown()),
  count: z.number(),
  merged: z.record(z.string(), z.unknown()).optional(),
});

/**
 * transform.template - Fill DOCX template with data
 * Config goes in step.with
 */
export const TransformTemplateConfigSchema = z.object({
  templateId: z
    .string()
    .min(1, 'Template is required')
    .describe('ID of the template from templates table'),
  data: z
    .record(z.string(), z.unknown())
    .describe(
      'Data object to merge into template. Each key must be explicitly defined - cannot pass a whole object as single expression'
    ),
  outputFilename: z.string().optional().describe('Output filename - supports {{field}} syntax'),
  highlightNotFound: z
    .boolean()
    .default(true)
    .optional()
    .describe('Highlight missing variables with red-colored text in the output document'),
  notFoundText: z
    .string()
    .default('NOT FOUND')
    .optional()
    .describe('Text to display for missing variables when highlightNotFound is enabled'),
});

export const TransformTemplateOutputSchema = z.object({
  fileId: z.string().describe('File ID from files table'),
});

/**
 * transform.pdf-embed - Embed text layer into scanned PDFs/images
 * Requires ai.parse step to run first to get word positions
 * Config goes in step.with
 */
export const TransformPdfEmbedConfigSchema = z.object({
  // Source file (from workflow input)
  input: z.string().describe('File input - template expression e.g. {{input.document}}'),
  // Parse result from ai.parse step
  parseResult: z
    .string()
    .describe('Parse result - template expression e.g. {{steps.parse.output}}'),
  // Output options
  outputFilename: z.string().optional().describe('Output filename - supports {{filename}} syntax'),
  confidenceThreshold: z
    .number()
    .min(0)
    .max(1)
    .default(0.7)
    .optional()
    .describe('Minimum OCR confidence (0-1) to include a word'),
});

export const TransformPdfEmbedOutputSchema = z.object({
  fileId: z.string().describe('File ID from files table'),
  pageCount: z.number().describe('Number of pages in the output PDF'),
  wordCount: z.number().describe('Number of words embedded'),
  text: z.string().describe('Extracted text from the document'),
});

/**
 * transform.xlsx-to-json - Convert XLSX spreadsheet to JSON (array of row objects)
 * Config goes in step.with
 */
export const TransformXlsxToJsonConfigSchema = z.object({
  input: z
    .string()
    .min(1, 'Input is required')
    .describe(
      'File input - template expression e.g. {{input.document}} resolving to a scoped $file artifact at runtime'
    ),
  sheet: z
    .union([z.number().int().min(0), z.string()])
    .optional()
    .describe('Sheet to read: 0-based index or sheet name. Omit for first sheet.'),
  outputCsv: z
    .boolean()
    .default(false)
    .describe('If true, also write CSV to storage and include fileId in output'),
  outputFilename: z
    .string()
    .optional()
    .describe(
      'Output CSV filename when outputCsv is true - supports LiquidJS e.g. {{filename}}.csv'
    ),
});

export const TransformXlsxToJsonOutputSchema = z.object({
  rows: z
    .array(z.record(z.string(), z.unknown()))
    .describe('Array of row objects (first row = headers as keys)'),
  fileId: z.string().optional().describe('File ID of stored CSV when outputCsv is true'),
});

/**
 * transform.script — Execute a TypeScript function in a QuickJS sandbox.
 *
 * The user provides a typed function declaration:
 *   `function script(p1: T1, p2: T2): R { … }`
 *
 * Three rules, all enforced at YAML push time and edit time:
 *   1. Function name MUST be `script`.
 *   2. Parameter list MUST equal `Object.keys(inputs)` in order.
 *   3. **Return type annotation `: R` is required.** R becomes this step's
 *      output schema (no separate `outputSchema:` field exists). R drives
 *      both downstream autocomplete and runtime AJV validation of the
 *      sandbox's actual return value.
 *
 * The worker compiles the TS source through sucrase before the sandbox
 * runs (sub-millisecond on small functions). Babel parses the same source
 * to walk the return-type AST and derive the JSON Schema. Both happen
 * once per push and once per worker run.
 */
export const TransformScriptConfigSchema = z
  .object({
    inputs: z
      .record(z.string(), z.string())
      .optional()
      .describe(
        'Named inputs mapped from template expressions. Keys become the function parameter list in declaration order: `inputs: { items, taxRate }` ⇒ `function script(items: …, taxRate: …): R { … }`.'
      ),

    function: z
      .string()
      .min(1)
      .max(
        SCRIPT_FN_MAX_BYTES,
        `script function is too long (max ${(SCRIPT_FN_MAX_BYTES / 1000).toFixed(0)}k characters)`
      )
      .describe(
        "TypeScript function declaration. Must be `function script(args): R { … }` where the parameter list equals `Object.keys(inputs)` in order and `R` is a return type annotation. The annotation IS this step's output schema."
      ),

    timeout: z
      .number()
      .positive()
      .default(5000)
      .optional()
      .describe('Max execution time in milliseconds (default: 5000)'),

    memoryLimit: z
      .number()
      .positive()
      .default(10 * 1024 * 1024)
      .optional()
      .describe('Max memory in bytes (default: 10MB)'),
  })
  .superRefine((cfg, ctx) => {
    // Input keys become function parameter names, so they must be valid JS
    // identifiers. Catch this here with a clear, field-targeted error
    // rather than letting it surface as a confusing param-list mismatch.
    for (const key of Object.keys(cfg.inputs ?? {})) {
      if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `input key \`${key}\` is not a valid JavaScript identifier; it becomes a function parameter name, so use letters, digits, \`_\`, or \`$\` (and don't start with a digit)`,
          path: ['inputs', key],
        });
      }
    }
    const result = compileTypedScript({
      kind: 'transform',
      source: cfg.function,
      paramNames: Object.keys(cfg.inputs ?? {}),
    });
    if (result.ok) return;
    for (const issue of result.issues) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: issue.message,
        path: ['function'],
      });
    }
  });

export const TransformScriptOutputSchema = z
  .unknown()
  .describe(
    "Value returned from script. Validated at runtime against the JSON Schema derived from the function's return type annotation."
  );

/**
 * Deterministic text chunker. Replaces hand-rolled `transform.script` chunking
 * (clause-aligned splits, paragraph fallback, header preservation, max-cap).
 *
 * Input: either a raw string OR a parsed-document shape `{ pages: [{ pageIndex, text }] }`.
 * When pages are provided each output chunk carries the source `pages: number[]`
 * (page indexes that contributed text). For raw-string input `pages` is empty.
 */
const ParsedDocPageSchema = z.object({
  pageIndex: z.number().int().nonnegative(),
  text: z.string(),
});

export const TransformTextChunkerConfigSchema = z.object({
  input: z
    .union([z.string(), z.object({ pages: z.array(ParsedDocPageSchema).min(1) }).passthrough()])
    .describe(
      'Either raw text or a parsed-document object `{ pages: [{ pageIndex, text }] }` (e.g. `{{ steps.parse.output }}`). Pages preserve per-chunk page provenance.'
    ),
  maxChars: z
    .number()
    .int()
    .min(100)
    .max(100_000)
    .describe('Target chunk size in characters. Hard ceiling per chunk is 1.5×.'),
  overlap: z
    .number()
    .int()
    .nonnegative()
    .default(0)
    .describe('Characters duplicated at chunk boundaries (default 0). Must be < maxChars / 2.'),
  splitOn: z
    .array(z.string())
    .optional()
    .describe(
      'Ordered list of regexes; the first that matches near the chunk boundary wins. Falls back to char-cut when none match. Tip: list narrowest first (e.g. /\\d+\\.\\d+\\s+/ before /\\n\\n+/).'
    ),
  maxChunks: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .default(64)
    .describe('Safety cap; later chunks are dropped and `summary.truncated` flips to true.'),
  preserveHeader: z
    .number()
    .int()
    .nonnegative()
    .default(0)
    .describe(
      'Prepend the first N characters of the input to every chunk (good for "always include the contract title").'
    ),
  minChunkChars: z
    .number()
    .int()
    .nonnegative()
    .default(0)
    .describe('Trailing chunks shorter than this are merged into the previous chunk.'),
});

export const TransformTextChunkerOutputSchema = z.object({
  chunks: z.array(
    z.object({
      text: z.string(),
      index: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
      startOffset: z.number().int().nonnegative(),
      endOffset: z.number().int().nonnegative(),
      pages: z
        .array(z.number().int().nonnegative())
        .describe('Page indexes that contributed text to this chunk (empty for raw-string input).'),
    })
  ),
  summary: z.object({
    inputChars: z.number().int().nonnegative(),
    totalChunks: z.number().int().nonnegative(),
    avgChunkChars: z.number().int().nonnegative(),
    maxChunkChars: z.number().int().nonnegative(),
    truncated: z.boolean(),
  }),
});

/**
 * Deterministic field extraction by named regex patterns. The deterministic
 * counterpart to ai.extract — pulls a few fields (contract numbers, dates,
 * IDs) without an LLM round-trip.
 *
 * Input mirrors text-chunker: raw string OR `{ pages: [{ pageIndex, text }] }`.
 * When pages are provided each match's source `pageIndex` is recorded in the
 * `_evidence` envelope so callers can trace which page yielded which value.
 */
const RegexNormalizerSchema = z.enum([
  'strip-spaces',
  'strip-punct',
  'collapse-whitespace',
  'lower',
  'upper',
  'trim',
]);

const RegexFormatSchema = z.enum(['iso-date', 'iso-number', 'lower', 'upper', 'trim']);

/**
 * Validate a regex flag string is a subset of `gimsuy` with no duplicates.
 * Caught at parse/push time so a typo like `flags: "ix"` is a config error,
 * not a runtime worker explosion.
 */
const REGEX_FLAGS = /^(?!.*(.).*\1)[gimsuy]*$/;

const RegexFieldSchema = z
  .object({
    pattern: z
      .string()
      .min(1)
      .refine(
        (p) => {
          try {
            new RegExp(p);
            return true;
          } catch {
            return false;
          }
        },
        { message: 'Invalid regex — pattern fails RegExp() compilation.' }
      )
      .describe('Regex source. Must contain at least one capturing group.'),
    flags: z
      .string()
      .regex(REGEX_FLAGS, 'flags must be a unique subset of "gimsuy"')
      .optional()
      .describe('Per-field regex flags (overrides the step-level `flags`). Subset of "gimsuy".'),
    max: z
      .union([z.literal(1), z.literal('all'), z.number().int().positive()])
      .default(1)
      .describe(
        'Max matches to keep. Default 1. Use "all" plus `select` to combine multiple hits.'
      ),
    select: z
      .enum(['first', 'last', 'min', 'max', 'all'])
      .optional()
      .describe(
        'When max ≠ 1: which match to surface. "first" (default), "last", "min", "max", or "all" — `all` returns the full array of matches AND a parallel array of evidence entries.'
      ),
    normalize: RegexNormalizerSchema.optional(),
    format: RegexFormatSchema.optional().describe(
      'Post-processing. iso-date accepts DD.MM.YYYY (1 group) or DD/MM/YYYY split across 3 groups → "YYYY-MM-DD".'
    ),
    exclude: z
      .array(z.string())
      .optional()
      .describe('Post-normalize values to skip (known wrong matches).'),
    default: z.string().optional().describe('Value when nothing matches.'),
    contextChars: z
      .number()
      .int()
      .nonnegative()
      .max(2000)
      .optional()
      .describe(
        'When > 0, evidence entries gain `contextBefore` and `contextAfter` snippets of N characters surrounding the match. Useful for UI/debug display.'
      ),
  })
  // `select: 'all'` is incompatible with `max: 1` — the loop would break after
  // the first match and silently emit a single-element array. Force `max` to
  // 'all' (or any explicit number ≥ 2) when `select === 'all'`.
  .refine((v) => !(v.select === 'all' && v.max === 1), {
    message:
      "select: 'all' requires max: 'all' or a number ≥ 2 (otherwise only the first match is collected).",
    path: ['max'],
  });

export const TransformRegexExtractConfigSchema = z.object({
  input: z
    .union([z.string(), z.object({ pages: z.array(ParsedDocPageSchema).min(1) }).passthrough()])
    .describe(
      'Either raw text or a parsed-document object `{ pages: [{ pageIndex, text }] }`. Pages enable per-match `_evidence.pageIndex`.'
    ),
  fields: z.record(z.string(), RegexFieldSchema).describe('Named field → pattern mapping.'),
  flags: z
    .string()
    .regex(REGEX_FLAGS, 'flags must be a unique subset of "gimsuy"')
    .optional()
    .describe(
      'Default regex flags applied when a field omits its own `flags`. Subset of "gimsuy".'
    ),
  searchWindow: z
    .number()
    .int()
    .min(100)
    .optional()
    .describe('Only search the first N characters of input (perf). Omit for full search.'),
});

export const TransformRegexExtractOutputSchema = z
  .record(z.string(), z.unknown())
  .describe(
    'Field name → extracted value (or default), plus `_evidence: { [field]: { pageIndex, matchOffset, raw } }` and `_unmatched: string[]`.'
  );

// ============================================================================
// Action Step Schemas
// ============================================================================

/**
 * action.http - Make HTTP request
 * Config goes in step.with
 */
export const ActionHttpConfigSchema = z.object({
  url: z.string().min(1, 'URL is required').describe('Request URL (supports template expressions)'),
  method: z.enum(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']).default('GET').optional(),
  headers: z.record(z.string(), z.string()).optional().describe('HTTP headers'),
  body: z.unknown().optional().describe('Request body (JSON or string)'),
  timeout: z.number().positive().default(30000).optional().describe('Timeout in milliseconds'),
  insecureSkipTlsVerify: z
    .boolean()
    .default(false)
    .optional()
    .describe(
      'If true, skip TLS certificate verification (use only for read-only public endpoints with bad/expired certs)'
    ),
});

export const ActionHttpOutputSchema = z.object({
  status: z.number().describe('HTTP status code'),
  statusText: z.string(),
  headers: z.record(z.string(), z.string()),
  body: z.unknown().describe('Response body (parsed JSON or string)'),
  responseCharset: z
    .string()
    .describe('Charset used to decode the response body (e.g. utf-8, windows-1250)'),
});

/**
 * action.invoke-workflow - Invoke another workflow
 * Config goes in step.with
 */
export const ActionInvokeWorkflowConfigSchema = z
  .object({
    workflow: z
      .string()
      .min(1)
      .optional()
      .describe('Workflow to invoke — definition name or wf_ id (tenant-scoped)'),
    workflowId: z
      .string()
      .min(1)
      .optional()
      .describe('Legacy alias for workflow when the value is a wf_ id'),
    execution: z
      .enum(['inline', 'child'])
      .optional()
      .describe(
        'inline: run target steps in this execution (default). child: spawn a separate run with lineage.'
      ),
    input: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Input record keyed by the invoked workflow's declared inputs"),
    wait: z
      .boolean()
      .optional()
      .describe(
        'Child mode only. Wait for the invoked workflow to complete and return its output (default: true). Set false for fire-and-forget.'
      ),
    timeout: z
      .number()
      .optional()
      .describe('Child mode only. Max wait time in ms when waiting (default: 300000)'),
    pollInterval: z
      .number()
      .optional()
      .describe('Child mode only. How often to poll status in ms when waiting (default: 1000)'),
  })
  .superRefine((data, ctx) => {
    const hasWorkflow = typeof data.workflow === 'string' && data.workflow.length > 0;
    const hasWorkflowId = typeof data.workflowId === 'string' && data.workflowId.length > 0;
    if (hasWorkflow && hasWorkflowId) {
      ctx.addIssue({
        code: 'custom',
        message: 'Cannot set both workflow and workflowId',
        path: ['workflow'],
      });
    }
    if (!hasWorkflow && !hasWorkflowId) {
      ctx.addIssue({
        code: 'custom',
        message: 'workflow or workflowId is required',
        path: ['workflow'],
      });
    }
    const mode = data.execution === 'child' ? 'child' : 'inline';
    if (mode === 'inline') {
      if (data.wait === false) {
        ctx.addIssue({
          code: 'custom',
          message: 'wait: false is not supported with execution: inline',
          path: ['wait'],
        });
      }
      if (data.timeout !== undefined) {
        ctx.addIssue({
          code: 'custom',
          message: 'timeout is only supported with execution: child',
          path: ['timeout'],
        });
      }
      if (data.pollInterval !== undefined) {
        ctx.addIssue({
          code: 'custom',
          message: 'pollInterval is only supported with execution: child',
          path: ['pollInterval'],
        });
      }
    }
  });

export const ActionInvokeWorkflowOutputSchema = z
  .record(z.string(), z.unknown())
  .describe(
    "When wait is true, the invoked workflow's declared output fields are flattened to the top level alongside a `files` array — reference them as {{ steps.<invoke>.output.<field> }} (there is no `.data` or `.result` wrapper). When wait is false, execution metadata. Call get_workflow_output_schema to see the exact resolved fields."
  );

/**
 * action.website-reader - Fetch and parse website content to markdown
 * Config goes in step.with
 */
export const ActionWebsiteReaderConfigSchema = z.object({
  url: z
    .string()
    .min(1, 'URL is required')
    .describe('Website URL to fetch (supports template expressions)'),
  timeout: z.number().positive().default(30000).optional().describe('Timeout in milliseconds'),
  encoding: z
    .enum(['auto', 'utf-8', 'latin1', 'windows-1250', 'windows-1252', 'iso-8859-2'])
    .default('auto')
    .optional()
    .describe('Response encoding. Auto detects from Content-Type header and HTML meta tags.'),
});

export const ActionWebsiteReaderOutputSchema = z.object({
  markdown: z.string().describe('Page content converted to markdown'),
  title: z.string().nullable().describe('Page title'),
  excerpt: z.string().nullable().describe('Page excerpt/description'),
  byline: z.string().nullable().describe('Author information'),
  siteName: z.string().nullable().describe('Site name'),
  length: z.number().describe('Content length in characters'),
  url: z.string().describe('Final URL after redirects'),
});

// ============================================================================
// Control Step Schemas
// ============================================================================

/**
 * control.if - Conditional branching
 * Config is step-level (condition), not in step.with
 */
export const ControlIfConfigSchema = z.object({
  condition: z
    .string()
    .min(1, 'Condition is required')
    .describe('LiquidJS expression that evaluates to boolean'),
});

export const ControlIfOutputSchema = z.object({
  condition: z.boolean().describe('Evaluated condition result'),
  branch: z.enum(['then', 'else']).describe('Which branch was executed'),
  result: z.unknown().describe('Output from executed branch'),
});

/**
 * control.switch - Multi-way routing. Config is step-level (on, cases, default),
 * not in step.with.
 */
export const ControlSwitchConfigSchema = z.object({
  on: z
    .string()
    .min(1, 'Switch `on` expression is required')
    .describe('Template expression whose resolved value selects the case, e.g. "{{ doc.type }}".'),
  cases: z
    .array(
      z.object({
        when: z
          .union([z.string(), z.number(), z.boolean()])
          .describe('Value matched (string-compared) against the resolved `on` value.'),
      })
    )
    .min(1)
    .describe('Ordered cases; the first whose `when` matches runs. Each case has its own `steps`.'),
});

export const ControlSwitchOutputSchema = z.object({
  matched: z
    .union([z.string(), z.number(), z.boolean()])
    .nullable()
    .describe('The `when` value that matched, or null when the default (or no) branch ran.'),
  branch: z.enum(['case', 'default', 'none']).describe('Which branch executed.'),
  result: z.unknown().describe('Output from the executed branch (its last step).'),
});

/**
 * control.foreach - Loop over array
 * Config is step-level (items, as, indexAs), not in step.with
 */
export const ControlForeachConfigSchema = z.object({
  items: z
    .string()
    .min(1, 'Items expression is required')
    .describe('Expression resolving to array'),
  as: z.string().min(1, 'Variable name is required').describe('Variable name for current item'),
  indexAs: z.string().optional().describe('Variable name for current index'),
});

export const ControlForeachOutputSchema = z.object({
  items: z.array(z.unknown()).describe('Results from each iteration'),
  count: z.number().describe('Number of completed iterations'),
  totalIterations: z.number().describe('Total iterations'),
});

/**
 * control.parallel_map - Concurrent iteration with limited parallelism
 * Config is step-level (items, as, indexAs, concurrency), not in step.with
 */
export const ControlParallelMapConfigSchema = z.object({
  items: z
    .string()
    .min(1, 'Items expression is required')
    .describe('Expression resolving to array'),
  as: z.string().min(1, 'Variable name is required').describe('Variable name for current item'),
  indexAs: z.string().optional().describe('Variable name for current index'),
  concurrency: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(5)
    .optional()
    .describe('Maximum concurrent executions (1-50, default 5)'),
});

export const ControlParallelMapOutputSchema = z.object({
  items: z.array(z.unknown()).describe('Results from each iteration (maintains original order)'),
  count: z.number().describe('Number of completed iterations'),
  totalIterations: z.number().describe('Total iterations'),
});

/**
 * control.parallel - Parallel branch execution
 * Config is step-level (branches), not in step.with
 */
export const ControlParallelConfigSchema = z.object({
  // branches is handled separately as it contains nested steps
});

export const ControlParallelOutputSchema = z
  .record(z.string(), z.unknown())
  .describe('Results keyed by branch name');

/**
 * control.wait - Pause for duration
 * Config is step-level (duration), not in step.with
 */
export const ControlWaitConfigSchema = z.object({
  duration: z.number().positive().describe('Duration in milliseconds'),
});

export const ControlWaitOutputSchema = z.object({
  waited: z.number().describe('Actual milliseconds waited'),
});

/**
 * control.fail - Terminate the workflow with a typed status code + message.
 *
 * When `condition` is empty, the step always fails when reached. When set,
 * the condition (LiquidJS) is evaluated against the current scope; truthy
 * → fail with the given code+message, falsy → skip and continue. The
 * executor catches the typed `WorkflowFailedError`, persists `{code, message}`
 * as JSON in the `executions.error` column, and the sync HTTP API surfaces
 * `code` as the response status.
 */
export const ControlFailConfigSchema = z.object({
  condition: z
    .string()
    .optional()
    .describe(
      'Optional LiquidJS expression. When set, the step only fails if this evaluates truthy; when omitted, it always fails when reached (compose with control.if for legacy gating).'
    ),
  statusCode: z
    .number()
    .int()
    .min(400)
    .max(599)
    .default(422)
    .describe(
      'HTTP-style status code returned to the caller (sync runs) and persisted on the execution. Default 422 (Unprocessable Entity).'
    ),
  message: z
    .string()
    .min(1)
    .describe(
      'Human-readable failure message. Supports template expressions, e.g. "Document classified as {{ steps.classify.output.label }}".'
    ),
});

export const ControlFailOutputSchema = z
  .never()
  .describe('control.fail never produces output — it terminates the workflow when triggered.');

// ============================================================================
// Step Schema Registry
// ============================================================================

export type StepCategory = 'ai' | 'transform' | 'action' | 'control';

export interface StepSchemaDefinition {
  type: StepType;
  category: StepCategory;
  name: string;
  description: string;
  configSchema: z.ZodType;
  outputSchema: z.ZodType;
  /** Whether config goes in step.with (true) or step-level properties (false) */
  configInWith: boolean;
}

const AI_RETRY_CAPABILITY: StepRetryCapability = {
  replaySafety: 'safe',
  automaticCategories: [
    'timeout',
    'rate_limited',
    'temporarily_unavailable',
    'invalid_provider_output',
  ],
  hasProviderRequestRetries: true,
};

const DETERMINISTIC_RETRY_CAPABILITY: StepRetryCapability = {
  replaySafety: 'safe',
  automaticCategories: [],
};

const CONTROL_RETRY_CAPABILITY: StepRetryCapability = {
  replaySafety: 'never',
  automaticCategories: [],
};

// These processors publish durable file rows and object-storage keys during
// execution. Keep replay disabled until attempt-scoped artifact staging can
// atomically promote their outputs.
const FILE_OUTPUT_RETRY_CAPABILITY: StepRetryCapability = {
  replaySafety: 'never',
  automaticCategories: [],
};

export const STEP_RETRY_CAPABILITIES: Record<StepType, StepRetryCapability> = {
  'ai.parse': AI_RETRY_CAPABILITY,
  'ai.extract': AI_RETRY_CAPABILITY,
  'ai.split': AI_RETRY_CAPABILITY,
  'ai.segment': AI_RETRY_CAPABILITY,
  'ai.classify': AI_RETRY_CAPABILITY,
  'transform.set': DETERMINISTIC_RETRY_CAPABILITY,
  'transform.remove': DETERMINISTIC_RETRY_CAPABILITY,
  'transform.combine': DETERMINISTIC_RETRY_CAPABILITY,
  'transform.split': DETERMINISTIC_RETRY_CAPABILITY,
  'transform.merge': DETERMINISTIC_RETRY_CAPABILITY,
  'transform.template': FILE_OUTPUT_RETRY_CAPABILITY,
  'transform.pdf-embed': FILE_OUTPUT_RETRY_CAPABILITY,
  'transform.xlsx-to-json': FILE_OUTPUT_RETRY_CAPABILITY,
  'transform.script': DETERMINISTIC_RETRY_CAPABILITY,
  'transform.text-chunker': DETERMINISTIC_RETRY_CAPABILITY,
  'transform.regex-extract': DETERMINISTIC_RETRY_CAPABILITY,
  'action.http': {
    replaySafety: 'requires-idempotency',
    automaticCategories: ['timeout', 'rate_limited', 'temporarily_unavailable'],
  },
  'action.invoke-workflow': {
    replaySafety: 'requires-idempotency',
    automaticCategories: ['timeout', 'temporarily_unavailable'],
  },
  'action.website-reader': {
    replaySafety: 'safe',
    automaticCategories: ['timeout', 'rate_limited', 'temporarily_unavailable'],
  },
  'control.if': CONTROL_RETRY_CAPABILITY,
  'control.switch': CONTROL_RETRY_CAPABILITY,
  'control.foreach': CONTROL_RETRY_CAPABILITY,
  'control.parallel': CONTROL_RETRY_CAPABILITY,
  'control.parallel_map': CONTROL_RETRY_CAPABILITY,
  'control.wait': CONTROL_RETRY_CAPABILITY,
  'control.fail': CONTROL_RETRY_CAPABILITY,
};

export function getStepRetryCapability(stepType: StepType): StepRetryCapability {
  return STEP_RETRY_CAPABILITIES[stepType];
}

export const STEP_SCHEMAS: Record<StepType, StepSchemaDefinition> = {
  // AI Steps
  'ai.parse': {
    type: 'ai.parse',
    category: 'ai',
    name: 'Parse Document',
    description: 'Extract text from documents (PDF, DOCX, images) using OCR or vision models',
    configSchema: AiParseConfigSchema,
    outputSchema: AiParseOutputSchema,
    configInWith: true,
  },
  'ai.extract': {
    type: 'ai.extract',
    category: 'ai',
    name: 'Extract Data',
    description: 'Extract structured data from text using AI with a JSON schema',
    configSchema: AiExtractConfigSchema,
    outputSchema: AiExtractOutputSchema,
    configInWith: true,
  },
  'ai.split': {
    type: 'ai.split',
    category: 'ai',
    name: 'Split Document',
    description:
      'Split a parsed document into named sections using an LLM. Consumes ai.parse output; emits per-section page ranges and text ready for downstream ai.extract via control.parallel_map.',
    configSchema: AiSplitConfigSchema,
    outputSchema: AiSplitOutputSchema,
    configInWith: true,
  },
  'ai.segment': {
    type: 'ai.segment',
    category: 'ai',
    name: 'Separate Documents',
    description:
      'Separate a concatenated batch (one big scan) into typed document instances using an LLM. Consumes ai.parse output and a type taxonomy; discovers an unknown number of documents in any order and emits per-document page ranges + text + type, ready for type-specific ai.extract via control.parallel_map. The inverse of ai.split.',
    configSchema: AiSegmentConfigSchema,
    outputSchema: AiSegmentOutputSchema,
    configInWith: true,
  },
  'ai.classify': {
    type: 'ai.classify',
    category: 'ai',
    name: 'Classify',
    description:
      'Classify a document or text into one of a fixed label set using an LLM. Output exposes the picked label (constrained to the configured names), a coarse confidence, and a short justification. Pair with control.fail to reject documents that match an undesired label.',
    configSchema: AiClassifyConfigSchema,
    outputSchema: AiClassifyOutputSchema,
    configInWith: true,
  },

  // Transform Steps
  'transform.set': {
    type: 'transform.set',
    category: 'transform',
    name: 'Set Value',
    description: 'Set key-value pairs in the output object',
    configSchema: TransformSetConfigSchema,
    outputSchema: TransformSetOutputSchema,
    configInWith: true,
  },
  'transform.remove': {
    type: 'transform.remove',
    category: 'transform',
    name: 'Remove Fields',
    description: 'Remove specified fields from an object',
    configSchema: TransformRemoveConfigSchema,
    outputSchema: TransformRemoveOutputSchema,
    configInWith: true,
  },
  'transform.combine': {
    type: 'transform.combine',
    category: 'transform',
    name: 'Combine Data',
    description: 'Merge multiple objects or concatenate arrays',
    configSchema: TransformCombineConfigSchema,
    outputSchema: TransformCombineOutputSchema,
    configInWith: true,
  },
  'transform.split': {
    type: 'transform.split',
    category: 'transform',
    name: 'Split Data',
    description: 'Split a string by delimiter or extract keys from an object',
    configSchema: TransformSplitConfigSchema,
    outputSchema: TransformSplitOutputSchema,
    configInWith: true,
  },
  'transform.merge': {
    type: 'transform.merge',
    category: 'transform',
    name: 'Merge Inputs',
    description: 'Merge multiple named inputs into a single output',
    configSchema: TransformMergeConfigSchema,
    outputSchema: TransformMergeOutputSchema,
    configInWith: true,
  },
  'transform.template': {
    type: 'transform.template',
    category: 'transform',
    name: 'Fill Template',
    description:
      'Fill a DOCX template with data from previous steps. Select a template in the workflow builder or provide a template ID from your workspace.',
    configSchema: TransformTemplateConfigSchema,
    outputSchema: TransformTemplateOutputSchema,
    configInWith: true,
  },
  'transform.pdf-embed': {
    type: 'transform.pdf-embed',
    category: 'transform',
    name: 'Embed PDF Text',
    description: 'Embed OCR text layer into scanned PDFs/images to make them searchable',
    configSchema: TransformPdfEmbedConfigSchema,
    outputSchema: TransformPdfEmbedOutputSchema,
    configInWith: true,
  },
  'transform.xlsx-to-json': {
    type: 'transform.xlsx-to-json',
    category: 'transform',
    name: 'XLSX to JSON',
    description:
      'Convert XLSX spreadsheet to JSON array of row objects for use in scripts or downstream steps',
    configSchema: TransformXlsxToJsonConfigSchema,
    outputSchema: TransformXlsxToJsonOutputSchema,
    configInWith: true,
  },
  'transform.script': {
    type: 'transform.script',
    category: 'transform',
    name: 'Script',
    description:
      "Execute a TypeScript function in a QuickJS sandbox. Input keys become the function's parameter list, in declaration order, and the required `: R` return-type annotation IS this step's output schema: `inputs: { items, taxRate }` ⇒ `function script(items: …, taxRate: …): R { … }`.",
    configSchema: TransformScriptConfigSchema,
    outputSchema: TransformScriptOutputSchema,
    configInWith: true,
  },
  'transform.text-chunker': {
    type: 'transform.text-chunker',
    category: 'transform',
    name: 'Text Chunker',
    description:
      'Split long text into chunks with regex-anchored boundaries, overlap, and header preservation. Accepts raw text or a parsed-document object; chunks carry source page indexes when pages are provided.',
    configSchema: TransformTextChunkerConfigSchema,
    outputSchema: TransformTextChunkerOutputSchema,
    configInWith: true,
  },
  'transform.regex-extract': {
    type: 'transform.regex-extract',
    category: 'transform',
    name: 'Regex Extract',
    description:
      'Pull named fields from text via regex patterns (deterministic counterpart to ai.extract). Accepts raw text or a parsed-document object; matches carry `_evidence.pageIndex` when pages are provided.',
    configSchema: TransformRegexExtractConfigSchema,
    outputSchema: TransformRegexExtractOutputSchema,
    configInWith: true,
  },

  // Action Steps
  'action.http': {
    type: 'action.http',
    category: 'action',
    name: 'HTTP Request',
    description: 'Make an HTTP request to an external API',
    configSchema: ActionHttpConfigSchema,
    outputSchema: ActionHttpOutputSchema,
    configInWith: true,
  },
  'action.invoke-workflow': {
    type: 'action.invoke-workflow',
    category: 'action',
    name: 'Invoke Workflow',
    description: 'Execute another workflow and return its output',
    configSchema: ActionInvokeWorkflowConfigSchema,
    outputSchema: ActionInvokeWorkflowOutputSchema,
    configInWith: true,
  },
  'action.website-reader': {
    type: 'action.website-reader',
    category: 'action',
    name: 'Website Reader',
    description: 'Fetch a webpage and convert content to markdown',
    configSchema: ActionWebsiteReaderConfigSchema,
    outputSchema: ActionWebsiteReaderOutputSchema,
    configInWith: true,
  },

  // Control Steps
  'control.if': {
    type: 'control.if',
    category: 'control',
    name: 'Condition',
    description: 'Branch execution based on a condition expression',
    configSchema: ControlIfConfigSchema,
    outputSchema: ControlIfOutputSchema,
    configInWith: false,
  },
  'control.switch': {
    type: 'control.switch',
    category: 'control',
    name: 'Switch',
    description:
      'Multi-way routing: resolve an expression and run the first case whose value matches (else default). Cleaner than a nested control.if chain for routing an item to one of N pipelines by a discriminator field like a document type.',
    configSchema: ControlSwitchConfigSchema,
    outputSchema: ControlSwitchOutputSchema,
    configInWith: false,
  },
  'control.foreach': {
    type: 'control.foreach',
    category: 'control',
    name: 'For Each',
    description: 'Loop over an array and execute steps for each item',
    configSchema: ControlForeachConfigSchema,
    outputSchema: ControlForeachOutputSchema,
    configInWith: false,
  },
  'control.parallel_map': {
    type: 'control.parallel_map',
    category: 'control',
    name: 'Parallel Map',
    description: 'Iterate over an array with concurrent execution up to a limit',
    configSchema: ControlParallelMapConfigSchema,
    outputSchema: ControlParallelMapOutputSchema,
    configInWith: false,
  },
  'control.parallel': {
    type: 'control.parallel',
    category: 'control',
    name: 'Parallel',
    description: 'Execute multiple branches concurrently',
    configSchema: ControlParallelConfigSchema,
    outputSchema: ControlParallelOutputSchema,
    configInWith: false,
  },
  'control.wait': {
    type: 'control.wait',
    category: 'control',
    name: 'Wait',
    description: 'Pause workflow execution for a specified duration',
    configSchema: ControlWaitConfigSchema,
    outputSchema: ControlWaitOutputSchema,
    configInWith: false,
  },
  'control.fail': {
    type: 'control.fail',
    category: 'control',
    name: 'Fail',
    description:
      'Terminate the workflow with a typed status code + message. With an optional condition, only fails when the condition is truthy; otherwise always fails when reached. Pair with ai.classify or any prior step to fail fast on bad inputs.',
    configSchema: ControlFailConfigSchema,
    outputSchema: ControlFailOutputSchema,
    // Step-level config like every other control.* step — fields sit at the
    // step root, not inside `step.with`.
    configInWith: false,
  },
};

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get the complete schema definition for a step type
 */
export function getStepSchema(stepType: StepType): StepSchemaDefinition | undefined {
  return STEP_SCHEMAS[stepType];
}

/**
 * Get just the config schema for a step type (for validation)
 */
export function getStepConfigSchema(stepType: StepType): z.ZodType | undefined {
  return STEP_SCHEMAS[stepType]?.configSchema;
}

/**
 * Get just the output schema for a step type
 */
export function getStepOutputSchema(stepType: StepType): z.ZodType | undefined {
  return STEP_SCHEMAS[stepType]?.outputSchema;
}

/**
 * List all available step types
 */
export function listStepTypes(): StepType[] {
  return [...STEP_TYPES];
}

/**
 * List step types by category
 */
export function listStepTypesByCategory(category: StepCategory): StepType[] {
  return Object.values(STEP_SCHEMAS)
    .filter((s) => s.category === category)
    .map((s) => s.type);
}

/**
 * Get all step schemas as JSON Schema (for LLM consumption)
 */
export function getAllStepJsonSchemas(): Array<{
  type: StepType;
  category: StepCategory;
  name: string;
  description: string;
  configSchema: JsonSchema7Type;
  outputSchema: JsonSchema7Type;
  configInWith: boolean;
}> {
  return Object.values(STEP_SCHEMAS).map((def) => ({
    type: def.type,
    category: def.category,
    name: def.name,
    description: def.description,
    configSchema: toJsonSchema(def.configSchema),
    outputSchema: toJsonSchema(def.outputSchema),
    configInWith: def.configInWith,
  }));
}

/**
 * Validate a step config against its schema
 * Returns { success: true, data } or { success: false, error }
 */
export function validateStepConfig(
  stepType: StepType,
  config: unknown
): { success: true; data: unknown } | { success: false; error: z.ZodError } {
  const schema = getStepConfigSchema(stepType);
  if (!schema) {
    return { success: true, data: config };
  }

  const result = schema.safeParse(config);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}

function isZodOptional(schema: unknown): boolean {
  return schema instanceof z.ZodOptional;
}

/**
 * Get the top-level required keys for a step type's output schema.
 * Returns null if the output schema is unknown (e.g. transform.script) or not an object.
 * Used to decide if an override has "all" outputs: if override has all required keys and
 * passes validation, the step can be skipped.
 */
export function getRequiredOutputKeys(stepType: StepType): string[] | null {
  const schema = getStepOutputSchema(stepType);
  if (!schema) return null;

  // Unwrap ZodOptional/ZodNullable to get to the inner type
  let current: z.ZodType = schema;
  while (true) {
    const def = (current as { _def?: { typeName?: string; innerType?: z.ZodType } })._def;
    if (def?.typeName === 'ZodOptional' || def?.typeName === 'ZodNullable') {
      current = def.innerType ?? current;
    } else {
      break;
    }
  }

  // Record schemas (e.g. control.block: z.record(z.string(), z.unknown())) accept any object;
  // there are no fixed required keys, so we return [] to signal this. The caller decides how to handle:
  // - resolveStepOverride treats [] as partial override (can't know runtime keys without expectedOutputKeys)
  if (current instanceof z.ZodRecord) return [];

  if (!(current instanceof z.ZodObject)) return null;
  const shape = (current as z.ZodObject<z.ZodRawShape>).shape;
  const required: string[] = [];
  for (const key of Object.keys(shape)) {
    if (!isZodOptional(shape[key])) required.push(key);
  }
  return required;
}

/**
 * True if the step type's output schema is z.unknown() (e.g. transform.script).
 * For such steps we cannot validate "all outputs" so overrides are always partial (run step + merge).
 */
export function isOutputSchemaUnknown(stepType: StepType): boolean {
  const schema = getStepOutputSchema(stepType);
  if (!schema) return true;
  const def = (schema as { _def?: { typeName?: string } })._def;
  return def?.typeName === 'ZodUnknown';
}

// ============================================================================
// Type exports
// ============================================================================

export type AiParseConfig = z.infer<typeof AiParseConfigSchema>;
export type AiParseOutput = z.infer<typeof AiParseOutputSchema>;
export type AiExtractConfig = z.infer<typeof AiExtractConfigSchema>;
export type AiExtractOutput = z.infer<typeof AiExtractOutputSchema>;
export type AiSplitConfig = z.infer<typeof AiSplitConfigSchema>;
export type AiSplitOutput = z.infer<typeof AiSplitOutputSchema>;
export type AiSegmentConfig = z.infer<typeof AiSegmentConfigSchema>;
export type AiSegmentOutput = z.infer<typeof AiSegmentOutputSchema>;
export type AiClassifyConfig = z.infer<typeof AiClassifyConfigSchema>;
export type AiClassifyOutput = z.infer<typeof AiClassifyOutputSchema>;
export type TransformSetConfig = z.infer<typeof TransformSetConfigSchema>;
export type TransformRemoveConfig = z.infer<typeof TransformRemoveConfigSchema>;
export type TransformCombineConfig = z.infer<typeof TransformCombineConfigSchema>;
export type TransformSplitConfig = z.infer<typeof TransformSplitConfigSchema>;
export type TransformMergeConfig = z.infer<typeof TransformMergeConfigSchema>;
export type TransformTemplateConfig = z.infer<typeof TransformTemplateConfigSchema>;
export type TransformPdfEmbedConfig = z.infer<typeof TransformPdfEmbedConfigSchema>;
export type TransformPdfEmbedOutput = z.infer<typeof TransformPdfEmbedOutputSchema>;
export type TransformScriptConfig = z.infer<typeof TransformScriptConfigSchema>;
export type TransformTextChunkerConfig = z.infer<typeof TransformTextChunkerConfigSchema>;
export type TransformTextChunkerOutput = z.infer<typeof TransformTextChunkerOutputSchema>;
export type TransformRegexExtractConfig = z.infer<typeof TransformRegexExtractConfigSchema>;
export type TransformRegexExtractOutput = z.infer<typeof TransformRegexExtractOutputSchema>;
export type ActionHttpConfig = z.infer<typeof ActionHttpConfigSchema>;
export type ActionInvokeWorkflowConfig = z.infer<typeof ActionInvokeWorkflowConfigSchema>;
export type ActionWebsiteReaderConfig = z.infer<typeof ActionWebsiteReaderConfigSchema>;
export type ActionWebsiteReaderOutput = z.infer<typeof ActionWebsiteReaderOutputSchema>;
export type ControlIfConfig = z.infer<typeof ControlIfConfigSchema>;
export type ControlSwitchConfig = z.infer<typeof ControlSwitchConfigSchema>;
export type ControlSwitchOutput = z.infer<typeof ControlSwitchOutputSchema>;
export type ControlForeachConfig = z.infer<typeof ControlForeachConfigSchema>;
export type ControlParallelMapConfig = z.infer<typeof ControlParallelMapConfigSchema>;
export type ControlParallelConfig = z.infer<typeof ControlParallelConfigSchema>;
export type ControlWaitConfig = z.infer<typeof ControlWaitConfigSchema>;
export type ControlFailConfig = z.infer<typeof ControlFailConfigSchema>;
