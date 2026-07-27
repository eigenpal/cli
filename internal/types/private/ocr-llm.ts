/**
 * Eigenpal-private OpenParser LLM catalog / billing internals.
 *
 * Not part of `@openparser/schema`. Kept here so public OSS schemas never ship
 * provider-list costs, retail markup, emergency seeds, or admit snapshots.
 */

import {
  OcrLlmModelCatalogEntrySchema,
  OcrLlmReasoningEffortRequestSchema,
  OcrLlmReasoningEffortSchema,
  type OcrLlmModelCatalogEntry,
  type OcrLlmReasoningEffort,
  type OcrLlmReasoningEffortRequest,
} from '@openparser/schema';
import { z } from 'zod';

/** Operational model used by Eigenpal's schema-suggestion endpoint. */
export const SUGGEST_SCHEMA_LLM_MODEL = 'anthropic/claude-haiku-4.5';

/** Internal provider-catalog pricing basis — never returned on public `/models/llm`. */
export const OcrLlmProviderListPricingBasisSchema = z.literal('provider_list');
export type OcrLlmProviderListPricingBasis = z.infer<typeof OcrLlmProviderListPricingBasisSchema>;

/** @deprecated Prefer the public or provider-list literal schemas. */
export const OcrLlmPricingBasisSchema = z.enum(['customer_retail', 'provider_list']);
export type OcrLlmPricingBasis = z.infer<typeof OcrLlmPricingBasisSchema>;

/**
 * OpenParser extraction LLM retail multiplier over definitive OpenRouter
 * provider USD cost. Billing invariant for correctness — never surface this
 * multiplier in customer-facing UI copy or changelogs.
 */
export const OCR_LLM_RETAIL_MARKUP = 2 as const;

/**
 * Internal OpenRouter provider-list cost. Used by the emergency seed, live
 * OpenRouter cache, and admit-time snapshot construction. Never expose on the
 * public `/models/llm` response schema.
 */
export const OcrLlmProviderListPricingSchema = z
  .object({
    prompt_usd_per_1m: z.number().finite().nonnegative(),
    completion_usd_per_1m: z.number().finite().nonnegative(),
    basis: OcrLlmProviderListPricingBasisSchema,
  })
  .strict();
export type OcrLlmProviderListPricing = z.infer<typeof OcrLlmProviderListPricingSchema>;

/** Internal provider-list catalog entry (OpenRouter cache + emergency seed). */
export const OcrLlmProviderCatalogEntrySchema = OcrLlmModelCatalogEntrySchema.omit({
  pricing: true,
}).extend({
  pricing: OcrLlmProviderListPricingSchema,
});
export type OcrLlmProviderCatalogEntry = z.infer<typeof OcrLlmProviderCatalogEntrySchema>;

/**
 * Immutable admit-time snapshot stored on the job for reproducibility,
 * idempotency, and billing without price drift.
 *
 * `pricing` MUST remain OpenRouter **provider list** rates (cost basis).
 * Customer retail rates are derived at charge time via OCR_LLM_RETAIL_MARKUP
 * and MUST NOT be stored here — otherwise fallback token billing would
 * double-apply the retail multiplier.
 */
export const OcrLlmRequestSnapshotSchema = z
  .object({
    catalog_version: z.string().min(1),
    model_id: z.string().min(1).max(200),
    pricing: z
      .object({
        prompt_usd_per_token: z.number().finite().nonnegative(),
        completion_usd_per_token: z.number().finite().nonnegative(),
        source: z.literal('openrouter_provider_list'),
      })
      .strict(),
    reasoning_effort_requested: OcrLlmReasoningEffortRequestSchema.nullable(),
    reasoning_effort_resolved: OcrLlmReasoningEffortSchema.nullable(),
  })
  .strict();
export type OcrLlmRequestSnapshot = z.infer<typeof OcrLlmRequestSnapshotSchema>;

/**
 * Fail-closed emergency seed + certified grounding/suggest allowlist.
 * Also used as stable suggested fallbacks so the suggested list never empties.
 *
 * Pricing on this seed is OpenRouter **provider list** cost (`provider_list`).
 * Public `GET /models/llm` responses MUST run {@link toCustomerRetailCatalogEntry}
 * before returning so callers see customer retail rates only.
 */
export const OCR_LLM_EMERGENCY_CATALOG = [
  {
    id: 'openai/gpt-5.6-terra',
    label: 'GPT-5.6 Terra',
    provider: 'openai',
    created_at: null,
    context_length: 1_050_000,
    pricing: {
      prompt_usd_per_1m: 2.5,
      completion_usd_per_1m: 15,
      basis: 'provider_list' as const,
    },
    recommendation: 'suggested' as const,
    is_default: true,
    certified_grounding: true,
    certified_suggest: true,
    supports_grounding: true,
    supports_suggest: true,
    pricing_known: true as const,
    reasoning: {
      supported_efforts: [
        'none',
        'low',
        'medium',
        'high',
        'xhigh',
        'max',
      ] as OcrLlmReasoningEffort[],
      default_effort: 'medium' as const,
      mandatory: false,
      supports_max_tokens: false,
    },
    deprecated_at: null,
  },
  {
    id: 'openai/gpt-4.1-mini',
    label: 'GPT-4.1 Mini',
    provider: 'openai',
    created_at: null,
    context_length: 1_047_576,
    pricing: {
      prompt_usd_per_1m: 0.4,
      completion_usd_per_1m: 1.6,
      basis: 'provider_list' as const,
    },
    recommendation: 'suggested' as const,
    is_default: false,
    certified_grounding: true,
    certified_suggest: true,
    supports_grounding: true,
    supports_suggest: true,
    pricing_known: true as const,
    reasoning: null,
    deprecated_at: null,
  },
  {
    id: 'openai/gpt-4.1',
    label: 'GPT-4.1',
    provider: 'openai',
    created_at: null,
    context_length: 1_047_576,
    pricing: {
      prompt_usd_per_1m: 2,
      completion_usd_per_1m: 8,
      basis: 'provider_list' as const,
    },
    recommendation: 'suggested' as const,
    is_default: false,
    certified_grounding: true,
    certified_suggest: true,
    supports_grounding: true,
    supports_suggest: true,
    pricing_known: true as const,
    reasoning: null,
    deprecated_at: null,
  },
] as const satisfies readonly OcrLlmProviderCatalogEntry[];

/** @deprecated Use OCR_LLM_EMERGENCY_CATALOG — kept for gradual call-site migration. */
export const OCR_LLM_CATALOG = OCR_LLM_EMERGENCY_CATALOG;

export const OCR_LLM_MODEL_IDS = OCR_LLM_EMERGENCY_CATALOG.map((entry) => entry.id);

export const OCR_LLM_CERTIFIED_MODEL_IDS = OCR_LLM_EMERGENCY_CATALOG.filter(
  (entry) => entry.certified_grounding || entry.certified_suggest
).map((entry) => entry.id);

export type OcrLlmModelId = (typeof OCR_LLM_EMERGENCY_CATALOG)[number]['id'];

/** Default suggested-provider namespaces (OpenRouter id prefix before `/`). */
export const OCR_LLM_SUGGESTED_PROVIDERS = [
  'openai',
  'anthropic',
  'google',
  'x-ai',
  'moonshotai',
] as const;

/** Models created within this window may appear in the default suggested subset. */
export const OCR_LLM_SUGGESTED_MAX_AGE_DAYS = 90;

export function getDefaultOcrLlmModelId(): OcrLlmModelId {
  const defaults = OCR_LLM_EMERGENCY_CATALOG.filter((entry) => entry.is_default);
  if (defaults.length !== 1) {
    throw new Error('OCR_LLM_EMERGENCY_CATALOG must declare exactly one default model');
  }
  return defaults[0]!.id;
}

/**
 * Map an internal provider-list catalog entry to the public customer-retail
 * shape returned by `GET /models/llm`. Idempotent when already retail.
 * Does not mutate the input.
 */
export function toCustomerRetailCatalogEntry(
  entry: OcrLlmProviderCatalogEntry | OcrLlmModelCatalogEntry,
  markup: number = OCR_LLM_RETAIL_MARKUP
): OcrLlmModelCatalogEntry {
  if (entry.pricing.basis === 'customer_retail') {
    // Nested discriminant: TS does not narrow the union on `pricing.basis`.
    return entry as OcrLlmModelCatalogEntry;
  }
  if (!Number.isFinite(markup) || markup <= 0) {
    throw new Error('OCR retail markup must be a positive finite number');
  }
  return {
    ...entry,
    pricing: {
      prompt_usd_per_1m: entry.pricing.prompt_usd_per_1m * markup,
      completion_usd_per_1m: entry.pricing.completion_usd_per_1m * markup,
      basis: 'customer_retail',
    },
  };
}

/**
 * Build the durable admit-time snapshot from an internal **provider_list**
 * catalog entry. Refuses customer_retail rates so token-fallback billing
 * cannot double-apply the retail multiplier.
 */
export function toOcrLlmRequestSnapshot(input: {
  catalogVersion: string;
  entry: OcrLlmProviderCatalogEntry;
  reasoningEffortRequested: OcrLlmReasoningEffortRequest | null;
  reasoningEffortResolved: OcrLlmReasoningEffort | null;
}): OcrLlmRequestSnapshot {
  if (input.entry.pricing.basis !== 'provider_list') {
    throw new Error(
      'OCR LLM request snapshot requires provider_list pricing (refuse retail rates to avoid double markup)'
    );
  }
  return {
    catalog_version: input.catalogVersion,
    model_id: input.entry.id,
    pricing: {
      prompt_usd_per_token: input.entry.pricing.prompt_usd_per_1m / 1_000_000,
      completion_usd_per_token: input.entry.pricing.completion_usd_per_1m / 1_000_000,
      source: 'openrouter_provider_list',
    },
    reasoning_effort_requested: input.reasoningEffortRequested,
    reasoning_effort_resolved: input.reasoningEffortResolved,
  };
}
