import { z } from 'zod';

/**
 * Organization-level webhook delivery settings.
 *
 * Three knobs are worth exposing to an organization admin: whether deliveries
 * may reach private network addresses, how long one request may take, and how
 * persistently failures are retried. Each one resolves in the same order:
 *
 *   1. deployment env var (Helm values / ConfigMap), which locks the setting
 *   2. the organization's saved setting (dashboard)
 *   3. the built-in default
 *
 * App and worker both resolve through {@link resolveWebhookDeliverySettings}, so
 * the dashboard shows exactly what the worker will do.
 */

export const WEBHOOK_DELIVERY_SETTINGS_KEY = 'webhookDelivery' as const;

export const WEBHOOK_REQUEST_TIMEOUT_MIN_MS = 1_000;
export const WEBHOOK_REQUEST_TIMEOUT_MAX_MS = 120_000;
export const DEFAULT_WEBHOOK_REQUEST_TIMEOUT_MS = 10_000;

export const WEBHOOK_RETRY_POLICIES = ['standard', 'quick', 'none'] as const;
export type WebhookRetryPolicy = (typeof WEBHOOK_RETRY_POLICIES)[number];

/** Delay before each attempt; index 0 is the first attempt. */
export const WEBHOOK_RETRY_SCHEDULES: Record<WebhookRetryPolicy, readonly number[]> = {
  standard: [0, 30_000, 120_000, 600_000, 3_600_000, 21_600_000, 86_400_000],
  quick: [0, 30_000, 120_000, 600_000],
  none: [0],
};
export const DEFAULT_WEBHOOK_RETRY_POLICY: WebhookRetryPolicy = 'standard';

const AllowPrivateDestinationsSchema = z.boolean();
// Whole seconds: the dashboard edits seconds, so a value it cannot show must
// not be storable through the API either.
const RequestTimeoutMsSchema = z
  .number()
  .int()
  .min(WEBHOOK_REQUEST_TIMEOUT_MIN_MS)
  .max(WEBHOOK_REQUEST_TIMEOUT_MAX_MS)
  .multipleOf(1000);
const RetryPolicySchema = z.enum(WEBHOOK_RETRY_POLICIES);

export const WebhookDeliverySettingsSchema = z.object({
  allowPrivateDestinations: AllowPrivateDestinationsSchema.optional(),
  requestTimeoutMs: RequestTimeoutMsSchema.optional(),
  retryPolicy: RetryPolicySchema.optional(),
});
export type WebhookDeliverySettings = z.infer<typeof WebhookDeliverySettingsSchema>;
export type WebhookDeliverySettingKey = keyof WebhookDeliverySettings;
export const WEBHOOK_DELIVERY_SETTING_KEYS = [
  'allowPrivateDestinations',
  'requestTimeoutMs',
  'retryPolicy',
] as const satisfies readonly WebhookDeliverySettingKey[];

/**
 * Body of `PATCH /api/webhook-settings`. Only the fields present change: a
 * value sets the organization's setting, `null` returns it to the default, and
 * an omitted field is left alone, so two admins editing different settings do
 * not overwrite each other.
 */
export const WebhookDeliverySettingsPatchSchema = z
  .object({
    allowPrivateDestinations: AllowPrivateDestinationsSchema.nullable().optional(),
    requestTimeoutMs: RequestTimeoutMsSchema.nullable().optional(),
    retryPolicy: RetryPolicySchema.nullable().optional(),
  })
  .strict();
export type WebhookDeliverySettingsPatch = z.infer<typeof WebhookDeliverySettingsPatchSchema>;

/** Values pinned by the deployment (env vars). `undefined` means not pinned. */
export interface WebhookDeploymentOverrides {
  allowPrivateDestinations?: boolean;
  requestTimeoutMs?: number;
  retrySchedule?: readonly number[];
}

export type WebhookSettingSource = 'deployment' | 'organization' | 'default';

export interface ResolvedWebhookSetting<T> {
  value: T;
  source: WebhookSettingSource;
}

export interface ResolvedWebhookDeliverySettings {
  /** False on multi-tenant deployments: the private-network option does not exist there. */
  privateDestinationsAvailable: boolean;
  allowPrivateDestinations: ResolvedWebhookSetting<boolean>;
  requestTimeoutMs: ResolvedWebhookSetting<number>;
  retrySchedule: ResolvedWebhookSetting<readonly number[]> & {
    /** The named policy, or `custom` for a deployment schedule that matches none. */
    policy: WebhookRetryPolicy | 'custom';
  };
}

/**
 * Reads the organization's settings out of `tenants.settings`. Each field is
 * parsed on its own, so one malformed or unknown key (say, written by a newer
 * release during a rolling deploy) cannot discard the rest. Discarding them
 * would be unsafe: a saved `allowPrivateDestinations: false` would fall back to
 * the single-tenant default of `true`.
 */
export function readWebhookDeliverySettings(tenantSettings: unknown): WebhookDeliverySettings {
  const raw =
    tenantSettings && typeof tenantSettings === 'object'
      ? (tenantSettings as Record<string, unknown>)[WEBHOOK_DELIVERY_SETTINGS_KEY]
      : undefined;
  if (!raw || typeof raw !== 'object') return {};
  const stored = raw as Record<string, unknown>;
  const settings: WebhookDeliverySettings = {};
  const allowPrivateDestinations = AllowPrivateDestinationsSchema.safeParse(
    stored.allowPrivateDestinations
  );
  if (allowPrivateDestinations.success) {
    settings.allowPrivateDestinations = allowPrivateDestinations.data;
  }
  const requestTimeoutMs = RequestTimeoutMsSchema.safeParse(stored.requestTimeoutMs);
  if (requestTimeoutMs.success) settings.requestTimeoutMs = requestTimeoutMs.data;
  const retryPolicy = RetryPolicySchema.safeParse(stored.retryPolicy);
  if (retryPolicy.success) settings.retryPolicy = retryPolicy.data;
  return settings;
}

export function resolveWebhookDeliverySettings(input: {
  deployment: WebhookDeploymentOverrides;
  organization: WebhookDeliverySettings;
  singleTenant: boolean;
}): ResolvedWebhookDeliverySettings {
  const { deployment, organization, singleTenant } = input;

  // Single-tenant deployments run inside the customer's own network, where
  // webhook receivers usually have internal addresses, so private destinations
  // are allowed unless someone turns them off (the same rule file sources and
  // OTLP export already follow). Multi-tenant never allows them.
  const allowPrivateDestinations: ResolvedWebhookSetting<boolean> = !singleTenant
    ? { value: false, source: 'default' }
    : pick(deployment.allowPrivateDestinations, organization.allowPrivateDestinations, true);

  const requestTimeoutMs = pick(
    deployment.requestTimeoutMs,
    organization.requestTimeoutMs,
    DEFAULT_WEBHOOK_REQUEST_TIMEOUT_MS
  );

  const retrySchedule =
    deployment.retrySchedule !== undefined
      ? {
          value: deployment.retrySchedule,
          source: 'deployment' as const,
          policy: retryPolicyForSchedule(deployment.retrySchedule),
        }
      : organization.retryPolicy !== undefined
        ? {
            value: WEBHOOK_RETRY_SCHEDULES[organization.retryPolicy],
            source: 'organization' as const,
            policy: organization.retryPolicy,
          }
        : {
            value: WEBHOOK_RETRY_SCHEDULES[DEFAULT_WEBHOOK_RETRY_POLICY],
            source: 'default' as const,
            policy: DEFAULT_WEBHOOK_RETRY_POLICY,
          };

  return {
    privateDestinationsAvailable: singleTenant,
    allowPrivateDestinations,
    requestTimeoutMs,
    retrySchedule,
  };
}

function pick<T>(
  deployment: T | undefined,
  organization: T | undefined,
  fallback: T
): ResolvedWebhookSetting<T> {
  if (deployment !== undefined) return { value: deployment, source: 'deployment' };
  if (organization !== undefined) return { value: organization, source: 'organization' };
  return { value: fallback, source: 'default' };
}

function retryPolicyForSchedule(schedule: readonly number[]): WebhookRetryPolicy | 'custom' {
  const match = WEBHOOK_RETRY_POLICIES.find((policy) => {
    const candidate = WEBHOOK_RETRY_SCHEDULES[policy];
    return (
      candidate.length === schedule.length &&
      candidate.every((delay, index) => delay === schedule[index])
    );
  });
  return match ?? 'custom';
}

// ---------------------------------------------------------------------------
// Delivery failure categories
// ---------------------------------------------------------------------------

/**
 * Why an attempt failed without an HTTP response (HTTP failures are stored as
 * `http_<status>`). Stored on each attempt; the dashboard explains each one.
 * `security_validation` and `network` remain for attempts recorded before the
 * finer categories existed.
 */
export const WEBHOOK_TRANSPORT_ERROR_CATEGORIES = [
  'private_destination_blocked',
  'host_local_destination_blocked',
  'invalid_url',
  'dns_failed',
  'connection_refused',
  'tls_failed',
  'timeout',
  'network',
  'invalid_header',
  'security_validation',
  'invalid_payload',
  'payload_too_large',
] as const;
export type WebhookTransportErrorCategory = (typeof WEBHOOK_TRANSPORT_ERROR_CATEGORIES)[number];

export interface WebhookFailureExplanation {
  title: string;
  detail: string;
  /**
   * The delivery setting that can fix this failure, if any. Whether the
   * viewer can actually change it (deployment locks, hosted deployments) is
   * for the caller to check against the resolved settings.
   */
  setting: 'allowPrivateDestinations' | 'requestTimeoutMs' | null;
}

export function explainWebhookFailure(
  category: string | null | undefined,
  statusCode?: number | null,
  context: { privateDestinationsAvailable?: boolean } = {}
): WebhookFailureExplanation | null {
  if (!category) return null;
  const http = /^http_(\d{3})$/.exec(category);
  if (http || statusCode) {
    const status = Number(http?.[1] ?? statusCode);
    if (status === 429) {
      return {
        title: `HTTP ${status}: rate limited`,
        detail: 'Your server asked us to slow down. We retry and honor its Retry-After header.',
        setting: null,
      };
    }
    if (status >= 500 || status === 408 || status === 425) {
      return {
        title: `HTTP ${status} from your server`,
        detail: 'Your server returned an error. We retry this on the retry schedule.',
        setting: null,
      };
    }
    if (status >= 300 && status < 400) {
      return {
        title: `HTTP ${status}: redirect not followed`,
        detail: 'Webhook requests do not follow redirects. Point the endpoint at the final URL.',
        setting: null,
      };
    }
    return {
      title: `HTTP ${status} from your server`,
      detail: 'Your server rejected the request. Responses in the 4xx range are not retried.',
      setting: null,
    };
  }
  switch (category as WebhookTransportErrorCategory) {
    case 'private_destination_blocked':
      return context.privateDestinationsAvailable === false
        ? {
            title: 'Blocked: private network address',
            detail:
              'The endpoint hostname resolves to a private or internal address, which hosted deployments never deliver to. Use a publicly reachable HTTPS URL. No request was sent.',
            setting: null,
          }
        : {
            title: 'Blocked: private network address',
            detail:
              'The endpoint hostname resolves to a private or internal address, and delivery to private addresses is turned off. No request was sent.',
            setting: 'allowPrivateDestinations',
          };
    case 'host_local_destination_blocked':
      return {
        title: 'Blocked: loopback or metadata address',
        detail:
          'The endpoint resolves to a loopback, link-local or cloud metadata address. These are never allowed, even with private network delivery on, because they reach the worker itself or node credentials. No request was sent.',
        setting: null,
      };
    case 'invalid_url':
      return {
        title: 'Invalid endpoint URL',
        detail: 'The URL must use HTTPS and cannot contain credentials or a fragment.',
        setting: null,
      };
    case 'dns_failed':
      return {
        title: 'Hostname did not resolve',
        detail: 'The worker could not look up the endpoint hostname. Check the URL and DNS.',
        setting: null,
      };
    case 'connection_refused':
      return {
        title: 'Connection refused',
        detail: 'Nothing accepted the connection. Check the port and that the server is running.',
        setting: null,
      };
    case 'tls_failed':
      return {
        title: 'TLS handshake failed',
        detail:
          'The server certificate was not trusted or did not match the hostname. The worker must trust the issuing CA.',
        setting: null,
      };
    case 'timeout':
      return {
        title: 'Timed out',
        detail: 'Your server did not answer within the request timeout.',
        setting: 'requestTimeoutMs',
      };
    case 'invalid_header':
      return {
        title: 'Invalid custom header',
        detail: 'A custom header on this endpoint is not allowed. Edit the endpoint headers.',
        setting: null,
      };
    case 'security_validation':
      // Only attempts recorded before the finer categories existed carry this.
      return {
        title: 'Blocked by outbound security checks',
        detail:
          'The request was not sent. This attempt predates detailed failure reasons; redeliver to see the exact cause.',
        setting: null,
      };
    case 'invalid_payload':
      return {
        title: 'Invalid event payload',
        detail: 'The stored event could not be serialized. This is not retried.',
        setting: null,
      };
    case 'payload_too_large':
      return {
        title: 'Event too large',
        detail: 'The event exceeded the 1 MB webhook payload limit.',
        setting: null,
      };
    case 'network':
      return {
        title: 'Network error',
        detail: 'The connection failed before a response arrived. We retry this.',
        setting: null,
      };
    default:
      return { title: category, detail: '', setting: null };
  }
}
