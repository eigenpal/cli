import { z } from 'zod';

/**
 * Client certificates (mutual TLS identities) that EigenPal presents to
 * services that require one: an SSO token service, a file registry, a webhook
 * receiver behind a gateway.
 *
 * Two kinds:
 * - a **deployment certificate**: named in the deployment configuration
 *   (`clientCertificates.<name>` in eigenpal.config.yaml, mounted from a
 *   Kubernetes TLS Secret by the Helm chart). Its key never enters the
 *   database; connections refer to it by name.
 * - a **custom certificate**: a PEM certificate and key pasted into a file
 *   source or webhook endpoint, stored encrypted.
 *
 * Only public identity (subject CN, expiry) ever leaves the server.
 */

/**
 * A deployment certificate name: a DNS label (lowercase letters, digits and
 * hyphens, at most 63 characters). It becomes a directory name in the pods.
 */
export const CLIENT_CERTIFICATE_NAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export const ClientCertificateNameSchema = z
  .string()
  .regex(
    CLIENT_CERTIFICATE_NAME,
    'Use lowercase letters, digits and hyphens (a DNS label) for a client certificate name'
  );

/** Size caps for pasted PEM material. A long chain stays far below these. */
export const CLIENT_CERTIFICATE_PEM_MAX_BYTES = 64 * 1024;
export const CLIENT_CERTIFICATE_CA_MAX_BYTES = 256 * 1024;

/** Public identity of a client certificate. Never includes PEM, key or file paths. */
export interface ClientCertificateIdentity {
  /** Subject CN, when the certificate has one. */
  commonName: string | null;
  /** ISO 8601 end of validity. */
  expiresAt: string;
}

/** A deployment certificate as the dashboard lists it. */
export interface DeploymentClientCertificateStatus {
  name: string;
  /** False when the files are missing, unreadable, mismatched or expired. */
  available: boolean;
  commonName: string | null;
  expiresAt: string | null;
  /** Hosts workflow HTTP steps may present it to (`workflowHosts`); empty means none. */
  workflowHosts?: string[];
}

const pem = (max: number, label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .max(max, `${label} is too large`)
    .refine((value) => value.includes('-----BEGIN'), `${label} must be PEM`);

/**
 * A webhook endpoint's client certificate as the API accepts it:
 * - `none`: no certificate;
 * - `deployment`: a certificate configured in the deployment, by name;
 * - `custom`: a pasted PEM certificate chain and unencrypted private key, plus
 *   an optional CA bundle that the receiver's server certificate must chain to.
 */
export const WebhookClientCertificateInputSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('none') }).strict(),
  z.object({ source: z.literal('deployment'), name: ClientCertificateNameSchema }).strict(),
  z
    .object({
      source: z.literal('custom'),
      certificate: pem(CLIENT_CERTIFICATE_PEM_MAX_BYTES, 'Client certificate'),
      privateKey: pem(CLIENT_CERTIFICATE_PEM_MAX_BYTES, 'Private key'),
      ca: pem(CLIENT_CERTIFICATE_CA_MAX_BYTES, 'CA certificate').optional(),
    })
    .strict(),
]);
export type WebhookClientCertificateInput = z.infer<typeof WebhookClientCertificateInputSchema>;

/** What the API returns about an endpoint's client certificate. */
export type WebhookClientCertificateSummary =
  | { source: 'deployment'; name: string; commonName: string | null; expiresAt: string | null }
  | { source: 'custom'; commonName: string | null; expiresAt: string };
