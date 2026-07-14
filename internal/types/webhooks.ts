import { z } from 'zod';
import { EXECUTION_STATUSES } from './execution-row';

export const WEBHOOK_API_VERSION = '2026-07-01' as const;
export const WEBHOOK_NOTIFY_CHANNEL = 'eigenpal:webhooks' as const;
export const WEBHOOK_MAX_PAYLOAD_BYTES = 1024 * 1024;
export const WEBHOOK_MAX_HEADERS = 20;
export const WEBHOOK_MAX_HEADER_BYTES = 16 * 1024;
export const WEBHOOK_EVENT_TYPES = ['run.created', 'run.status_changed'] as const;
export const WEBHOOK_DELIVERY_STATES = [
  'pending',
  'processing',
  'succeeded',
  'failed',
  'cancelled',
] as const;
export const WEBHOOK_RESERVED_HEADERS = [
  'connection',
  'content-length',
  'content-type',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'user-agent',
  'webhook-id',
  'webhook-signature',
  'webhook-timestamp',
] as const;
const RESERVED_HEADER_SET = new Set<string>(WEBHOOK_RESERVED_HEADERS);

export const WebhookEventTypeSchema = z.enum(WEBHOOK_EVENT_TYPES);
export const WebhookDeliveryStateSchema = z.enum(WEBHOOK_DELIVERY_STATES);
export const WebhookEndpointIdSchema = z.string().regex(/^whep_[A-Za-z0-9_-]+$/);
export const WebhookEventIdSchema = z.string().regex(/^whev_[A-Za-z0-9_-]+$/);
export const WebhookDeliveryIdSchema = z.string().regex(/^whdl_[A-Za-z0-9_-]+$/);
export const WebhookAttemptIdSchema = z.string().regex(/^what_[A-Za-z0-9_-]+$/);

const HeaderNameSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/);

export const WebhookCustomHeaderSchema = z.object({
  name: HeaderNameSchema.refine(
    (name) =>
      !RESERVED_HEADER_SET.has(name.toLowerCase()) && !name.toLowerCase().startsWith('webhook-'),
    { message: 'Reserved webhook header' }
  ),
  value: z
    .string()
    .min(1)
    .max(8192)
    .refine((value) => !/[\r\n]/.test(value), {
      message: 'Header values cannot contain CR or LF',
    }),
});

const RetainedWebhookCustomHeaderSchema = z.object({
  name: WebhookCustomHeaderSchema.shape.name,
  retained: z.literal(true),
});

export const RedactedWebhookCustomHeaderSchema = z.object({
  name: HeaderNameSchema,
  configured: z.literal(true),
});

export const PublicWebhookRunSchema = z.object({
  id: z.string().min(1),
  automationId: z.string().min(1),
  type: z.enum(['workflow', 'agent']),
  status: z.enum(EXECUTION_STATUSES),
  triggerType: z.string(),
  createdAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  output: z.unknown().optional(),
  outputOmitted: z.boolean().optional(),
});

const EnvelopeBaseSchema = z.object({
  id: WebhookEventIdSchema,
  apiVersion: z.literal(WEBHOOK_API_VERSION),
  createdAt: z.string().datetime(),
  test: z.boolean().default(false),
});

export const RunCreatedWebhookEventSchema = EnvelopeBaseSchema.extend({
  type: z.literal('run.created'),
  data: z.object({ run: PublicWebhookRunSchema }),
});

export const RunStatusChangedWebhookEventSchema = EnvelopeBaseSchema.extend({
  type: z.literal('run.status_changed'),
  data: z.object({
    run: PublicWebhookRunSchema,
    previousStatus: z.enum(EXECUTION_STATUSES),
    currentStatus: z.enum(EXECUTION_STATUSES),
  }),
});

export const WebhookEventEnvelopeSchema = z.discriminatedUnion('type', [
  RunCreatedWebhookEventSchema,
  RunStatusChangedWebhookEventSchema,
]);

/** Serialize once so the exact validated bytes can be persisted and signed. */
export function serializeWebhookEvent(event: WebhookEventEnvelope): string {
  return JSON.stringify(WebhookEventEnvelopeSchema.parse(event));
}

/**
 * Drop only the optional output when the complete wire envelope would exceed
 * the configured limit. The returned envelope is always schema-valid.
 */
export function boundWebhookEventOutput(
  event: WebhookEventEnvelope,
  maxBytes: number
): WebhookEventEnvelope {
  const parsed = WebhookEventEnvelopeSchema.parse(event);
  if (new TextEncoder().encode(JSON.stringify(parsed)).byteLength <= maxBytes) return parsed;
  const run = { ...parsed.data.run };
  delete run.output;
  run.outputOmitted = true;
  const bounded = { ...parsed, data: { ...parsed.data, run } } as WebhookEventEnvelope;
  const serialized = JSON.stringify(bounded);
  if (new TextEncoder().encode(serialized).byteLength > maxBytes) {
    throw new Error('Webhook envelope exceeds payload limit without output');
  }
  return WebhookEventEnvelopeSchema.parse(bounded);
}

export const WebhookEndpointSchema = z.object({
  id: WebhookEndpointIdSchema,
  tenantId: z.string(),
  name: z.string().min(1).max(200),
  url: z.string().url(),
  eventTypes: z.array(WebhookEventTypeSchema).min(1),
  enabled: z.boolean(),
  signingConfigured: z.literal(true),
  customHeaders: z.array(RedactedWebhookCustomHeaderSchema),
  createdBy: z.string().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  deletedAt: z.coerce.date().nullable(),
});

const WebhookDestinationUrlSchema = z
  .string()
  .url()
  .superRefine((raw, ctx) => {
    if (!URL.canParse(raw)) return;
    const url = new URL(raw);
    if (url.protocol !== 'https:') {
      ctx.addIssue({ code: 'custom', message: 'Webhook URLs must use HTTPS' });
    }
    if (url.username || url.password) {
      ctx.addIssue({ code: 'custom', message: 'Webhook URLs cannot contain credentials' });
    }
    if (url.hash) {
      ctx.addIssue({ code: 'custom', message: 'Webhook URLs cannot contain fragments' });
    }
  });

export function getWebhookDestinationUrlError(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return 'Enter a valid HTTPS URL.';
  const result = WebhookDestinationUrlSchema.safeParse(trimmed);
  if (result.success) return null;
  return result.error.issues[0]?.message ?? 'Enter a valid HTTPS URL.';
}

function validateWebhookHeaderCollection(
  input: {
    customHeaders?: Array<
      z.infer<typeof WebhookCustomHeaderSchema> | z.infer<typeof RetainedWebhookCustomHeaderSchema>
    >;
  },
  ctx: z.RefinementCtx
) {
  if (input.customHeaders) {
    const seen = new Set<string>();
    let bytes = 0;
    input.customHeaders.forEach((header, index) => {
      const normalized = header.name.toLowerCase();
      if (seen.has(normalized)) {
        ctx.addIssue({
          code: 'custom',
          path: ['customHeaders', index, 'name'],
          message: 'Duplicate webhook header',
        });
      }
      seen.add(normalized);
      bytes += new TextEncoder().encode(
        header.name + ('value' in header ? header.value : '')
      ).byteLength;
    });
    if (bytes > WEBHOOK_MAX_HEADER_BYTES) {
      ctx.addIssue({
        code: 'custom',
        path: ['customHeaders'],
        message: 'Custom webhook headers are too large',
      });
    }
  }
}

export const CreateWebhookEndpointSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    url: WebhookDestinationUrlSchema,
    eventTypes: z.array(WebhookEventTypeSchema).min(1),
    customHeaders: z.array(WebhookCustomHeaderSchema).max(WEBHOOK_MAX_HEADERS).default([]),
  })
  .superRefine(validateWebhookHeaderCollection);

export const UpdateWebhookEndpointSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    url: WebhookDestinationUrlSchema.optional(),
    eventTypes: z.array(WebhookEventTypeSchema).min(1).optional(),
    customHeaders: z
      .array(z.union([WebhookCustomHeaderSchema, RetainedWebhookCustomHeaderSchema]))
      .max(WEBHOOK_MAX_HEADERS)
      .optional(),
    enabled: z.boolean().optional(),
  })
  .superRefine(validateWebhookHeaderCollection);

export const CreateWebhookEndpointResponseSchema = z.object({
  endpoint: WebhookEndpointSchema,
  signingSecret: z.string().regex(/^whsec_[A-Za-z0-9_-]+$/),
});

export const WebhookDeliverySchema = z.object({
  id: WebhookDeliveryIdSchema,
  tenantId: z.string(),
  endpointId: WebhookEndpointIdSchema,
  eventId: WebhookEventIdSchema,
  state: WebhookDeliveryStateSchema,
  attemptCount: z.number().int().nonnegative(),
  nextAttemptAt: z.coerce.date().nullable(),
  latestStatusCode: z.number().int().nullable(),
  latestErrorCategory: z.string().nullable(),
  createdAt: z.coerce.date(),
  completedAt: z.coerce.date().nullable(),
});

export const WebhookDeliveryAttemptSchema = z.object({
  id: WebhookAttemptIdSchema,
  deliveryId: WebhookDeliveryIdSchema,
  attemptNumber: z.number().int().positive(),
  startedAt: z.coerce.date(),
  completedAt: z.coerce.date(),
  latencyMs: z.number().int().nonnegative(),
  statusCode: z.number().int().nullable(),
  errorCategory: z.string().nullable(),
  responseExcerpt: z.string().nullable(),
});

export type WebhookEventType = z.infer<typeof WebhookEventTypeSchema>;
export type WebhookDeliveryState = z.infer<typeof WebhookDeliveryStateSchema>;
export type WebhookCustomHeader = z.infer<typeof WebhookCustomHeaderSchema>;
export type PublicWebhookRun = z.infer<typeof PublicWebhookRunSchema>;
export type WebhookEventEnvelope = z.infer<typeof WebhookEventEnvelopeSchema>;
export type RunCreatedWebhookEvent = z.infer<typeof RunCreatedWebhookEventSchema>;
export type RunStatusChangedWebhookEvent = z.infer<typeof RunStatusChangedWebhookEventSchema>;
export type CreateWebhookEndpoint = z.infer<typeof CreateWebhookEndpointSchema>;
export type UpdateWebhookEndpoint = z.infer<typeof UpdateWebhookEndpointSchema>;
