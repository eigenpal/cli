import { z } from 'zod';
import { ReasoningEffortSchema } from '../../client/ai-client';

/**
 * Split Processor Schemas
 *
 * Splits a parsed document into named sections using an LLM. Consumes the
 * output of the document parser (per-page text); emits per-section page
 * ranges + hydrated text. Designed for VUB-style banking workflows where a
 * single PDF contains intro + multiple `Príloha` annexes.
 *
 * Algorithm: divide-and-conquer windowed anchor detection. Pages are chunked
 * into windows that fit a configurable token budget; each window receives
 * one LLM call asking for anchor pages (where each section begins);
 * deterministic merge + continuity fill produces the final ranges.
 */

export const SplitInputSchema = z
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

export const SplitConfigSchema = z.object({
  sections: z
    .array(
      z.object({
        name: z.string().min(1).describe('Stable id for the section'),
        description: z
          .string()
          .min(1)
          .describe(
            "What this section looks like in the document. Use the document's own terminology (e.g. 'Príloha 2 / Anlage 2') and visual cues."
          ),
        required: z
          .boolean()
          .optional()
          .describe(
            'If true, log a warn when this section is not found, and lean the LLM toward expecting it. Default: false (Reducto-style "may be absent").'
          ),
        endHints: z
          .array(z.string())
          .optional()
          .describe(
            'Natural-language hints fed to the LLM about what marks the END of this section (e.g. ["PRÍPAD PORUŠENIA ZMLUVY", "*Koniec prílohy*", "the next chapter heading"]). The LLM uses these as guidance — not a regex match — so casing variants, missing diacritics, and multilingual phrasings still close the section correctly. The LLM emits a structured end_anchor per section it judges closed; deterministic merge applies it.'
          ),
      })
    )
    .min(1),
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
  reasoningEffort: ReasoningEffortSchema.optional().describe(
    'Reasoning effort for the split model. Omit to use the model default.'
  ),
  windowTokenBudget: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      'Per-window token ceiling. Defaults to env SPLIT_WINDOW_TOKEN_BUDGET or 20000. Smaller windows give sharper anchors on contract-style documents (less competing context for the LLM to mis-anchor on); 50k–100k when sections routinely exceed per-window page count.'
    ),
});

const ConfidenceLevelSchema = z
  .enum(['low', 'medium', 'high'])
  .describe(
    'LLM confidence as a coarse enum. Numeric (0..1) confidences cluster at 0.85–0.95 and gradations are noise; low/medium/high is reliable.'
  );

const SplitSectionSchema = z.object({
  name: z.string(),
  page_range: z.tuple([z.number().int(), z.number().int()]),
  confidence: ConfidenceLevelSchema.describe(
    'LLM confidence at the start anchor: low | medium | high.'
  ),
  notes: z.string(),
  evidence: z
    .object({
      // .nullable() is defensive — mergeAnchors strips nulls before this
      // validator runs, but if one slips through we accept it rather than
      // abort the run. LLMs sometimes emit null leaves for unanchorable
      // sections despite the prompt saying to omit.
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
      'Structured start-anchor evidence the LLM cited — for downstream parsing without regex over `notes`.'
    ),
  end_evidence: z
    .object({
      end_page: z.number().int().describe('LAST page of the section (inclusive)'),
      confidence: ConfidenceLevelSchema,
      notes: z
        .string()
        .describe(
          'LLM justification for the end. Pairs with start-anchor `notes` so a reconciliation pass can judge whether the section is correctly bounded.'
        ),
    })
    .optional()
    .describe(
      'Set when the LLM flagged a section close (matched against `endHints` or detected end-of-section markers). Absent when the section was closed by deterministic continuity-fill (next section start - 1).'
    ),
  text: z.string().describe('Joined per-page text for this section, ready for ai.extract'),
  pages: z
    .array(
      z.object({
        pageIndex: z.number().int(),
        text: z.string(),
        pageName: z.string().optional(),
        source: z
          .enum(['anchored', 'inferred'])
          .describe(
            'Whether this page was the LLM anchor (direct evidence) or filled in by continuity'
          ),
      })
    )
    .describe(
      'Raw per-page records covered by this split (in page order). Use when downstream needs to iterate page-by-page rather than treating the section as one blob.'
    ),
  pages_anchored: z.array(z.number().int()),
  pages_inferred: z.array(z.number().int()),
});

export const SplitOutputSchema = z.object({
  splits: z.array(SplitSectionSchema),
  sections: z
    .record(z.string(), SplitSectionSchema)
    .describe(
      'The same sections keyed by their config name, for direct reference: `steps.<split>.output.sections.<name>.page_range`. On the rare duplicate name, the last section wins; use `splits` for the full ordered list.'
    ),
});

export type SplitInput = z.infer<typeof SplitInputSchema>;
export type SplitConfig = z.infer<typeof SplitConfigSchema>;
export type SplitOutput = z.infer<typeof SplitOutputSchema>;
