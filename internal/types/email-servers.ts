import { z } from 'zod';
import { ID_PREFIXES } from './core/common';

/**
 * Tenant-scoped outbound email servers (`ems_…`).
 *
 * Write requests may include secrets. The public `EmailServer` view and
 * list/delete/test responses never do. Deployment YAML email config is a
 * separate, single-server on-prem shape and is not this contract.
 */

export const EMAIL_SERVER_TRANSPORTS = ['resend', 'smtp'] as const;
export type EmailServerTransport = (typeof EMAIL_SERVER_TRANSPORTS)[number];

export const SMTP_SECURITY_MODES = ['starttls', 'tls', 'none'] as const;
export type SmtpSecurity = (typeof SMTP_SECURITY_MODES)[number];

/** Default SMTP submission port for each `security` mode. */
export const SMTP_DEFAULT_PORT_BY_SECURITY = {
  starttls: 587,
  tls: 465,
  none: 25,
} as const;

export const EMAIL_SERVER_ID_PREFIX = ID_PREFIXES.EMAIL_SERVER;
export const EMAIL_SERVER_ID_PATTERN = /^ems_[A-Za-z0-9_-]+$/;

export const EmailServerIdSchema = z
  .string()
  .regex(EMAIL_SERVER_ID_PATTERN, 'Expected ems_… id')
  .max(128);
export type EmailServerId = z.infer<typeof EmailServerIdSchema>;

export const EmailServerNameSchema = z.string().trim().min(1).max(128);
export type EmailServerName = z.infer<typeof EmailServerNameSchema>;

export const EmailServerFromEmailSchema = z.string().trim().email();

/** Display-name injection / confusion: no C0/C1 controls (includes CR/LF) or `<>`. */
const FROM_NAME_UNSAFE = /[\p{Cc}<>]/u;

export const EmailServerFromNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .refine((value) => !FROM_NAME_UNSAFE.test(value), {
    message: 'fromName cannot contain control characters or angle brackets',
  });

export const SmtpHostSchema = z.string().trim().min(1).max(253);
export const SmtpPortSchema = z.number().int().min(1).max(65535);
export const SmtpSecuritySchema = z.enum(SMTP_SECURITY_MODES);
export const SmtpUsernameSchema = z.string().min(1).max(256);

const SecretStringSchema = z.string().min(1);

const fromFields = {
  fromEmail: EmailServerFromEmailSchema,
  fromName: EmailServerFromNameSchema,
};

function defaultSmtpPort(security: SmtpSecurity, port?: number): number {
  return port ?? SMTP_DEFAULT_PORT_BY_SECURITY[security];
}

/** Unauthenticated `security: 'none'` is allowed; credentials are not. */
export const SMTP_NONE_CREDENTIALS_MESSAGE = "SMTP credentials cannot be used with security 'none'";

/** Post-update SMTP auth must be a pair. Does not name which stored secret exists. */
export const SMTP_CREDENTIAL_PAIR_MESSAGE =
  'SMTP username and password must both be present or both absent';

/**
 * Stored SMTP passwords may not follow a host or username change.
 * Does not name whether a stored secret exists.
 */
export const SMTP_TARGET_PASSWORD_MESSAGE =
  'A new SMTP password is required when the host or username changes';

function refineSmtpCredentialPair(
  data: { username?: string; password?: string },
  ctx: z.RefinementCtx
) {
  const hasUsername = data.username !== undefined;
  const hasPassword = data.password !== undefined;
  if (hasUsername !== hasPassword) {
    ctx.addIssue({
      code: 'custom',
      path: hasUsername ? ['password'] : ['username'],
      message: 'SMTP username and password must both be set or both omitted',
    });
  }
}

function refineSmtpNoneRejectsCredentials(
  data: { security?: SmtpSecurity; username?: string | null; password?: string },
  ctx: z.RefinementCtx
) {
  if (data.security !== 'none') return;
  if (typeof data.username === 'string') {
    ctx.addIssue({
      code: 'custom',
      path: ['username'],
      message: SMTP_NONE_CREDENTIALS_MESSAGE,
    });
  }
  if (data.password !== undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['password'],
      message: SMTP_NONE_CREDENTIALS_MESSAGE,
    });
  }
}

const CreateResendEmailServerRequestSchema = z
  .object({
    name: EmailServerNameSchema,
    enabled: z.boolean().optional().default(true),
    transport: z.literal('resend'),
    apiKey: SecretStringSchema,
    ...fromFields,
  })
  .strict();

const CreateSmtpEmailServerRequestSchema = z
  .object({
    name: EmailServerNameSchema,
    enabled: z.boolean().optional().default(true),
    transport: z.literal('smtp'),
    host: SmtpHostSchema,
    port: SmtpPortSchema.optional(),
    security: SmtpSecuritySchema.optional().default('starttls'),
    username: SmtpUsernameSchema.optional(),
    password: SecretStringSchema.optional(),
    caPem: SecretStringSchema.optional(),
    ...fromFields,
  })
  .strict()
  .superRefine((data, ctx) => {
    refineSmtpCredentialPair(data, ctx);
    refineSmtpNoneRejectsCredentials(data, ctx);
  })
  .transform((data) => ({
    ...data,
    port: defaultSmtpPort(data.security, data.port),
  }));

export const CreateEmailServerRequestSchema = z
  .discriminatedUnion('transport', [
    CreateResendEmailServerRequestSchema,
    CreateSmtpEmailServerRequestSchema,
  ])
  .meta({ id: 'CreateEmailServerRequest' });
export type CreateEmailServerRequest = z.infer<typeof CreateEmailServerRequestSchema>;

const UpdateMetadataOnlySchema = z
  .object({
    name: EmailServerNameSchema.optional(),
    enabled: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.name === undefined && value.enabled === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'at least one field is required',
      });
    }
  });

/**
 * Explicit transport replacement. Non-secret fields must form a complete valid
 * target. Secrets may be omitted to retain the stored value only when the
 * existing transport is compatible and, for SMTP, the host and username are
 * unchanged — see {@link getEmailServerUpdateError}.
 */
const UpdateResendEmailServerRequestSchema = z
  .object({
    name: EmailServerNameSchema.optional(),
    enabled: z.boolean().optional(),
    transport: z.literal('resend'),
    apiKey: SecretStringSchema.optional(),
    ...fromFields,
  })
  .strict();

const UpdateSmtpEmailServerRequestSchema = z
  .object({
    name: EmailServerNameSchema.optional(),
    enabled: z.boolean().optional(),
    transport: z.literal('smtp'),
    host: SmtpHostSchema,
    // Full SMTP replacement must name security and port explicitly. Create still
    // defaults omitted values to starttls/587; a PATCH must never silently do so.
    port: SmtpPortSchema,
    security: SmtpSecuritySchema,
    username: SmtpUsernameSchema.nullable().optional(),
    password: SecretStringSchema.optional(),
    caPem: SecretStringSchema.nullable().optional(),
    ...fromFields,
  })
  .strict()
  .superRefine(refineSmtpNoneRejectsCredentials);

export const UpdateEmailServerRequestSchema = z
  .union([
    UpdateResendEmailServerRequestSchema,
    UpdateSmtpEmailServerRequestSchema,
    UpdateMetadataOnlySchema,
  ])
  .meta({ id: 'UpdateEmailServerRequest' });
export type UpdateEmailServerRequest = z.infer<typeof UpdateEmailServerRequestSchema>;

const PublicEmailServerTimestamps = {
  id: EmailServerIdSchema,
  name: EmailServerNameSchema,
  enabled: z.boolean(),
  createdAt: z.union([z.string(), z.coerce.date()]),
  updatedAt: z.union([z.string(), z.coerce.date()]),
};

export const PublicResendEmailServerSchema = z
  .object({
    ...PublicEmailServerTimestamps,
    transport: z.literal('resend'),
    fromEmail: EmailServerFromEmailSchema,
    fromName: EmailServerFromNameSchema,
    apiKeyConfigured: z.literal(true),
  })
  .strict()
  .meta({ id: 'PublicResendEmailServer' });

export const PublicSmtpEmailServerSchema = z
  .object({
    ...PublicEmailServerTimestamps,
    transport: z.literal('smtp'),
    fromEmail: EmailServerFromEmailSchema,
    fromName: EmailServerFromNameSchema,
    host: SmtpHostSchema,
    port: SmtpPortSchema,
    security: SmtpSecuritySchema,
    username: z.string().nullable(),
    passwordConfigured: z.boolean(),
    caPemConfigured: z.boolean(),
  })
  .strict()
  .meta({ id: 'PublicSmtpEmailServer' });

/**
 * Canonical public email-server view. Omits tenant, actor, deletion, secrets,
 * and key ids. Create/get/update return this object directly.
 */
export const EmailServerSchema = z
  .discriminatedUnion('transport', [PublicResendEmailServerSchema, PublicSmtpEmailServerSchema])
  .meta({ id: 'EmailServer' });
export type EmailServer = z.infer<typeof EmailServerSchema>;
export type PublicResendEmailServer = z.infer<typeof PublicResendEmailServerSchema>;
export type PublicSmtpEmailServer = z.infer<typeof PublicSmtpEmailServerSchema>;

/** Canonical list page for `GET /api/v1/email-servers`. */
export const ListEmailServersResponseSchema = z
  .object({
    data: z.array(EmailServerSchema),
    total: z.number().int(),
    limit: z.number().int(),
    offset: z.number().int(),
  })
  .meta({ id: 'ListEmailServersResponse' });
export type ListEmailServersResponse = z.infer<typeof ListEmailServersResponseSchema>;

export const DeleteEmailServerResponseSchema = z
  .object({
    deleted: z.literal(true),
    id: EmailServerIdSchema,
  })
  .strict()
  .meta({ id: 'DeleteEmailServerResponse' });
export type DeleteEmailServerResponse = z.infer<typeof DeleteEmailServerResponseSchema>;

export const TestEmailServerRequestSchema = z
  .object({
    to: EmailServerFromEmailSchema,
  })
  .strict()
  .meta({ id: 'TestEmailServerRequest' });
export type TestEmailServerRequest = z.infer<typeof TestEmailServerRequestSchema>;

export const TestEmailServerResponseSchema = z
  .discriminatedUnion('ok', [
    z
      .object({
        ok: z.literal(true),
        transport: z.enum(EMAIL_SERVER_TRANSPORTS),
        messageId: z.string().min(1),
      })
      .strict(),
    z
      .object({
        ok: z.literal(false),
        error: z.string().min(1),
      })
      .strict(),
  ])
  .meta({ id: 'TestEmailServerResponse' });
export type TestEmailServerResponse = z.infer<typeof TestEmailServerResponseSchema>;

export type EmailServerSecretAction = 'set' | 'retain' | 'clear';

export interface EmailServerSecretPlan {
  resendApiKey: EmailServerSecretAction;
  smtpPassword: EmailServerSecretAction;
  caPem: EmailServerSecretAction;
}

function hasTransport(
  patch: UpdateEmailServerRequest
): patch is Extract<UpdateEmailServerRequest, { transport: EmailServerTransport }> {
  return 'transport' in patch;
}

/** Stored SMTP destination the request schema cannot see. Never include secrets. */
export type EmailServerStoredSmtpAuth = {
  host?: string | null;
  username?: string | null;
  passwordConfigured?: boolean;
};

function smtpDestinationChanged(
  existingTransport: EmailServerTransport,
  patch: Extract<UpdateEmailServerRequest, { transport: 'smtp' }>,
  storedSmtp?: EmailServerStoredSmtpAuth
): boolean {
  if (existingTransport !== 'smtp') return false;
  const hostChanged = storedSmtp?.host != null && storedSmtp.host !== patch.host;
  const usernameChanged =
    typeof patch.username === 'string' && patch.username !== (storedSmtp?.username ?? null);
  return hostChanged || usernameChanged;
}

/**
 * Decide how each stored secret should change for an update.
 *
 * Omitted secrets retain only when the existing transport is compatible with
 * the target. Switching transport clears incompatible secrets and requires any
 * secret the target transport cannot function without. Clearing SMTP `username`
 * also clears the stored password. A stored SMTP password is not retained when
 * the host or username changes; the caller must set a new password or clear
 * auth.
 */
export function planEmailServerSecretUpdate(input: {
  existingTransport: EmailServerTransport;
  storedSmtp?: EmailServerStoredSmtpAuth;
  patch: UpdateEmailServerRequest;
}): EmailServerSecretPlan {
  if (!hasTransport(input.patch)) {
    return { resendApiKey: 'retain', smtpPassword: 'retain', caPem: 'retain' };
  }

  if (input.patch.transport === 'resend') {
    return {
      resendApiKey: input.patch.apiKey !== undefined ? 'set' : 'retain',
      smtpPassword: 'clear',
      caPem: 'clear',
    };
  }

  const password =
    input.patch.password !== undefined
      ? 'set'
      : input.patch.username === null
        ? 'clear'
        : input.existingTransport !== 'smtp'
          ? 'clear'
          : smtpDestinationChanged(input.existingTransport, input.patch, input.storedSmtp)
            ? 'clear'
            : 'retain';
  const caPem =
    input.patch.caPem === null
      ? 'clear'
      : input.patch.caPem !== undefined
        ? 'set'
        : input.existingTransport === 'smtp'
          ? 'retain'
          : 'clear';

  return {
    resendApiKey: 'clear',
    smtpPassword: password,
    caPem,
  };
}

function planSmtpAuthActions(
  existingTransport: EmailServerTransport,
  patch: Extract<UpdateEmailServerRequest, { transport: 'smtp' }>,
  storedSmtp?: EmailServerStoredSmtpAuth
): { username: EmailServerSecretAction; password: EmailServerSecretAction } {
  const secrets = planEmailServerSecretUpdate({ existingTransport, storedSmtp, patch });
  const username =
    patch.username === null
      ? 'clear'
      : typeof patch.username === 'string'
        ? 'set'
        : existingTransport === 'smtp'
          ? 'retain'
          : 'clear';
  return { username, password: secrets.smtpPassword };
}

function actionLeavesPresent(action: EmailServerSecretAction, storedPresent: boolean): boolean {
  if (action === 'set') return true;
  if (action === 'clear') return false;
  return storedPresent;
}

/**
 * Returns a user-facing error when an update would leave SMTP username/password
 * unpaired, keep credentials with `security: 'none'`, reuse a stored password
 * against a new host or username, or retain a secret across an incompatible
 * transport change. `null` means the patch is compatible.
 *
 * Pair, none, and destination messages do not name whether a stored secret
 * exists; callers already see admin-redacted `username` / `passwordConfigured`.
 */
export function getEmailServerUpdateError(
  existingTransport: EmailServerTransport,
  patch: UpdateEmailServerRequest,
  storedSmtp?: EmailServerStoredSmtpAuth
): string | null {
  if (hasTransport(patch) && patch.transport === 'smtp') {
    const auth = planSmtpAuthActions(existingTransport, patch, storedSmtp);
    const hasUsername = actionLeavesPresent(auth.username, Boolean(storedSmtp?.username));
    const hasPassword = actionLeavesPresent(auth.password, storedSmtp?.passwordConfigured === true);

    if (patch.security === 'none' && (hasUsername || hasPassword)) {
      return SMTP_NONE_CREDENTIALS_MESSAGE;
    }
    if (
      smtpDestinationChanged(existingTransport, patch, storedSmtp) &&
      patch.password === undefined &&
      hasUsername &&
      storedSmtp?.passwordConfigured === true
    ) {
      return SMTP_TARGET_PASSWORD_MESSAGE;
    }
    if (hasUsername !== hasPassword) {
      return SMTP_CREDENTIAL_PAIR_MESSAGE;
    }
  }

  if (!hasTransport(patch)) return null;
  if (patch.transport === existingTransport) return null;

  if (patch.transport === 'resend' && patch.apiKey === undefined) {
    return 'Resend API key is required when changing transport to resend';
  }
  return null;
}

export function isEmailServerId(value: string): boolean {
  return EMAIL_SERVER_ID_PATTERN.test(value);
}
