/**
 * OpenParser LLM model catalog contracts.
 *
 * Clients discover models via `GET /models/llm`. Ordinary extract may use any
 * currently *compatible* catalog entry. Field grounding and schema suggestion
 * remain restricted to certified models. Admission still accepts a free-form
 * `llm_model` string first so the registry can return a stable
 * `unsupported_llm_model` (or capability) API error — same pattern as
 * `OcrModelSchema` / `unsupported_ocr_model`.
 *
 * The live catalog is a cached, normalized OpenRouter `/models` wrapper.
 * `OCR_LLM_EMERGENCY_CATALOG` is the fail-closed seed used when OpenRouter is
 * unavailable and no last-known-good snapshot exists.
 *
 * Pricing is split deliberately:
 * - **Public** (`GET /models/llm` / OpenAPI): `basis: customer_retail` only.
 * - **Internal** (provider catalog + admit snapshots): `basis: provider_list`.
 *   Billing multiplies provider list by {@link OCR_LLM_RETAIL_MARKUP} at charge
 *   time — never store retail on the durable snapshot (double markup).
 */

import { z } from 'zod';

export const OCR_LLM_REASONING_EFFORTS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;
export const OcrLlmReasoningEffortSchema = z.enum(OCR_LLM_REASONING_EFFORTS);
export type OcrLlmReasoningEffort = z.infer<typeof OcrLlmReasoningEffortSchema>;

/** Request contract: omit/`auto` uses model metadata; explicit values must be supported. */
export const OcrLlmReasoningEffortRequestSchema = z.union([
  z.literal('auto'),
  OcrLlmReasoningEffortSchema,
]);
export type OcrLlmReasoningEffortRequest = z.infer<typeof OcrLlmReasoningEffortRequestSchema>;

export const OcrLlmRecommendationTierSchema = z.enum(['suggested', 'compatible']);
export type OcrLlmRecommendationTier = z.infer<typeof OcrLlmRecommendationTierSchema>;

/** Public OpenAPI / `GET /models/llm` pricing basis — retail only. */
export const OcrLlmPublicPricingBasisSchema = z.literal('customer_retail');
export type OcrLlmPublicPricingBasis = z.infer<typeof OcrLlmPublicPricingBasisSchema>;

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
 * Public customer-retail token pricing (`GET /models/llm` / OpenAPI).
 * `provider_list` is intentionally excluded from this schema.
 */
export const OcrLlmModelPricingSchema = z
  .object({
    /** USD per 1M prompt tokens at the customer retail rate. */
    prompt_usd_per_1m: z.number().finite().nonnegative(),
    /** USD per 1M completion tokens at the customer retail rate. */
    completion_usd_per_1m: z.number().finite().nonnegative(),
    basis: OcrLlmPublicPricingBasisSchema,
  })
  .strict();
export type OcrLlmModelPricing = z.infer<typeof OcrLlmModelPricingSchema>;

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

export const OcrLlmModelReasoningSchema = z
  .object({
    supported_efforts: z.array(OcrLlmReasoningEffortSchema).nullable(),
    default_effort: OcrLlmReasoningEffortSchema.nullable(),
    mandatory: z.boolean(),
    supports_max_tokens: z.boolean(),
  })
  .strict();
export type OcrLlmModelReasoning = z.infer<typeof OcrLlmModelReasoningSchema>;

const ocrLlmCatalogEntryFields = {
  id: z.string().min(1).max(200),
  label: z.string().min(1).max(120),
  provider: z.string().min(1).max(64),
  created_at: z.string().datetime().nullable(),
  context_length: z.number().int().positive().nullable(),
  recommendation: OcrLlmRecommendationTierSchema,
  is_default: z.boolean(),
  /** Certified for field grounding (tested). */
  certified_grounding: z.boolean(),
  /** Certified for schema suggestion (tested). */
  certified_suggest: z.boolean(),
  /**
   * Compatibility aliases for Playground clients that still filter on the
   * previous catalog field names. Equal to the certified_* flags.
   */
  supports_grounding: z.boolean(),
  supports_suggest: z.boolean(),
  pricing_known: z.literal(true),
  reasoning: OcrLlmModelReasoningSchema.nullable(),
  deprecated_at: z.string().datetime().nullable(),
} as const;

/** Public catalog entry returned by `GET /models/llm` (OpenAPI component). */
export const OcrLlmModelCatalogEntrySchema = z
  .object({
    ...ocrLlmCatalogEntryFields,
    pricing: OcrLlmModelPricingSchema,
  })
  .strict();
export type OcrLlmModelCatalogEntry = z.infer<typeof OcrLlmModelCatalogEntrySchema>;

/** Internal provider-list catalog entry (OpenRouter cache + emergency seed). */
export const OcrLlmProviderCatalogEntrySchema = z
  .object({
    ...ocrLlmCatalogEntryFields,
    pricing: OcrLlmProviderListPricingSchema,
  })
  .strict();
export type OcrLlmProviderCatalogEntry = z.infer<typeof OcrLlmProviderCatalogEntrySchema>;

export const OcrLlmModelsListModeSchema = z.enum(['suggested', 'search']);
export type OcrLlmModelsListMode = z.infer<typeof OcrLlmModelsListModeSchema>;

export const OcrLlmModelsQuerySchema = z
  .object({
    /**
     * `suggested` (default): short recommended subset.
     * `search`: full compatible catalog filtered by `q`.
     */
    mode: OcrLlmModelsListModeSchema.default('suggested'),
    /** Case-insensitive substring match against id/label/provider. */
    q: z.string().max(200).optional(),
    /** 1-based page index when paginating search results. */
    page: z.coerce.number().int().min(1).default(1),
    /** Page size for search; ignored for suggested mode (bounded server-side). */
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
export type OcrLlmModelsQuery = z.infer<typeof OcrLlmModelsQuerySchema>;

export const OcrLlmModelsResponseSchema = z
  .object({
    mode: OcrLlmModelsListModeSchema,
    catalog_version: z.string().min(1),
    fetched_at: z.string().datetime(),
    stale: z.boolean(),
    data: z.array(OcrLlmModelCatalogEntrySchema),
    page: z.number().int().min(1),
    limit: z.number().int().min(1).max(100),
    total: z.number().int().min(0),
    has_more: z.boolean(),
  })
  .strict();
export type OcrLlmModelsResponse = z.infer<typeof OcrLlmModelsResponseSchema>;

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
    is_default: true,
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
  {
    id: 'anthropic/claude-sonnet-4',
    label: 'Claude Sonnet 4',
    provider: 'anthropic',
    created_at: null,
    context_length: 200_000,
    pricing: {
      prompt_usd_per_1m: 3,
      completion_usd_per_1m: 15,
      basis: 'provider_list' as const,
    },
    recommendation: 'suggested' as const,
    is_default: false,
    certified_grounding: true,
    certified_suggest: true,
    supports_grounding: true,
    supports_suggest: true,
    pricing_known: true as const,
    reasoning: {
      supported_efforts: ['low', 'medium', 'high'] as OcrLlmReasoningEffort[],
      default_effort: 'medium' as const,
      mandatory: false,
      supports_max_tokens: true,
    },
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
