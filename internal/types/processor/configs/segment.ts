import { z } from 'zod';

/**
 * Segment Processor Schemas
 *
 * Document separation ("mailroom" / deconcatenation): given a parsed batch of
 * pages (the document-parser output) and a TAXONOMY of possible document types,
 * the segmenter discovers an UNKNOWN number of document instances in arbitrary
 * order, finds where each one begins and ends, and assigns each a type. Output
 * is a `[page_range -> type]` map plus hydrated per-document text ready for a
 * type-specific `ai.extract` via `control.parallel_map`.
 *
 * This is the inverse of `ai.split`: split takes a KNOWN, ordered list of named
 * sections and locates each within ONE document. Segment takes ONLY a type
 * taxonomy and separates a STACK of glued-together documents — repeated
 * instances of the same type are first-class (five timesheets in a row are five
 * separate documents).
 *
 * Algorithm (shared engine with split): divide-and-conquer windowed boundary
 * detection. Pages are packed into token-budgeted windows; each window receives
 * one LLM call asking for the pages where a NEW document begins (a "start"),
 * each tagged with a type from the taxonomy. Deterministic dedup-by-page +
 * continuity-fill (each start runs until the next start) produces the final
 * typed page ranges.
 */

export const SegmentInputSchema = z
  .object({
    pages: z
      .array(
        z.object({
          pageIndex: z.number().describe('0-based page index'),
          text: z.string().describe('Extracted text for this page'),
          pageName: z.string().optional(),
        })
      )
      .min(1)
      .describe('Per-page parsed content from a document parser'),
  })
  .passthrough()
  .describe(
    'Document-parser-shaped input. Pass {{ steps.parse.output }} directly — extra fields like text/metadata are ignored.'
  );

/**
 * Reserved type the LLM may use for documents that match none of the configured
 * taxonomy entries. Always allowed so a single off-taxonomy page never breaks
 * separation — it lands in its own `unknown` document rather than being forced
 * into a wrong type.
 */
export const SEGMENT_UNKNOWN_TYPE = 'unknown';

export const SegmentConfigSchema = z.object({
  documentTypes: z
    .array(
      z.object({
        name: z
          .string()
          .min(1)
          .describe('Type label returned in documents[].type (e.g. "timesheet", "deal-memo").'),
        description: z
          .string()
          .optional()
          .describe(
            'What this document type looks like — headings, layout, vocabulary, and the visual cues that mark its FIRST page. Fed to the LLM as guidance for both boundary detection and typing.'
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
    .describe('Optional natural-language rules appended to the system prompt'),
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
      'Per-window token ceiling. Defaults to env SPLIT_WINDOW_TOKEN_BUDGET or 20000. Smaller windows give sharper boundaries on dense batches; larger windows when documents routinely exceed the per-window page count.'
    ),
});

const ConfidenceLevelSchema = z
  .enum(['low', 'medium', 'high'])
  .describe(
    'LLM confidence as a coarse enum. Numeric (0..1) confidences cluster at 0.85–0.95 and gradations are noise; low/medium/high is reliable.'
  );

/**
 * Escalation summary: labelled vs unlabelled counts so an operator can route the
 * unmatched/low-confidence documents to a human. `unlabelled` = documents the
 * LLM could not fit to any taxonomy type (`unknown`). `needsReview` enumerates
 * exactly which documents to escalate and why.
 */
export const SegmentSummarySchema = z.object({
  total: z.number().int().describe('Total documents discovered in the batch.'),
  labelled: z
    .number()
    .int()
    .describe('Documents assigned a known taxonomy type (type !== "unknown").'),
  unlabelled: z
    .number()
    .int()
    .describe(
      'Documents the segmenter could not label (type === "unknown") — escalate to a human.'
    ),
  lowConfidence: z
    .number()
    .int()
    .describe('Documents whose boundary/type confidence is "low" — also worth human review.'),
  byType: z
    .record(z.string(), z.number().int())
    .describe('Per-type document counts, keyed by type name (includes "unknown").'),
  needsReview: z
    .array(
      z.object({
        index: z.number().int(),
        type: z.string(),
        page_range: z.tuple([z.number().int(), z.number().int()]),
        reason: z
          .enum(['unlabelled', 'low_confidence'])
          .describe('Why this document should be escalated to a human operator.'),
        notes: z.string(),
      })
    )
    .describe('The exact documents to escalate to a human operator, with the reason for each.'),
});

export const SegmentOutputSchema = z.object({
  summary: SegmentSummarySchema.describe(
    'Batch-level escalation summary: labelled vs unlabelled counts and the documents needing human review.'
  ),
  documents: z.array(
    z.object({
      index: z
        .number()
        .int()
        .describe('0-based position of this document in the batch, in page order.'),
      type: z.string().describe('Chosen type name from the taxonomy, or "unknown" when none fit.'),
      page_range: z
        .tuple([z.number().int(), z.number().int()])
        .describe('Inclusive [startPage, endPage], 0-based, matching input pageIndex.'),
      confidence: ConfidenceLevelSchema.describe(
        'LLM confidence at the document boundary + type: low | medium | high.'
      ),
      notes: z.string().describe('Short prose citing what marked this page as a new document.'),
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
        .describe('Structured start evidence — for downstream parsing without regex over `notes`.'),
      text: z.string().describe('Joined per-page text for this document, ready for ai.extract'),
      pages: z
        .array(
          z.object({
            pageIndex: z.number().int(),
            text: z.string(),
            pageName: z.string().optional(),
            source: z
              .enum(['anchored', 'inferred'])
              .describe(
                'Whether this page was the LLM boundary (direct evidence) or filled in by continuity'
              ),
          })
        )
        .describe('Raw per-page records covered by this document, in page order.'),
      pages_anchored: z.array(z.number().int()),
      pages_inferred: z.array(z.number().int()),
    })
  ),
});

export type SegmentInput = z.infer<typeof SegmentInputSchema>;
export type SegmentConfig = z.infer<typeof SegmentConfigSchema>;
export type SegmentOutput = z.infer<typeof SegmentOutputSchema>;
export type SegmentSummary = z.infer<typeof SegmentSummarySchema>;
