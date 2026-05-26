import { z } from 'zod';
import { SourceManifestSchemaVersionSchema } from './manifests';

export const SOURCE_SECRETS_FILENAME = 'secrets.enc.yaml';

export const SecretNameSchema = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]*$/, 'Secret names must be uppercase env-style identifiers');
export type SecretName = z.infer<typeof SecretNameSchema>;

const Base64LikeSchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9+/=_-]+$/, {
    message: 'Encrypted secret fields must be encoded strings',
  });

export const EncryptedSecretValueSchema = z
  .object({
    algorithm: z.literal('aes-256-gcm'),
    keyId: z.string().min(1),
    nonce: Base64LikeSchema,
    ciphertext: Base64LikeSchema,
    tag: Base64LikeSchema,
  })
  .strict();
export type EncryptedSecretValue = z.infer<typeof EncryptedSecretValueSchema>;

const SourceSecretEntrySchema = z
  .object({
    description: z.string().optional(),
    encrypted: EncryptedSecretValueSchema.optional(),
  })
  .passthrough()
  .superRefine((entry, ctx) => {
    const raw = entry as Record<string, unknown>;
    if ('value' in raw || 'plaintext' in raw || 'secret' in raw) {
      ctx.addIssue({
        code: 'custom',
        message: 'secrets.enc.yaml must not contain plaintext secret values',
      });
    }
    if (!raw.encrypted) {
      ctx.addIssue({
        code: 'custom',
        path: ['encrypted'],
        message: 'Encrypted secret values are required',
      });
    }
    const extraKeys = Object.keys(raw).filter(
      (key) => key !== 'description' && key !== 'encrypted'
    );
    for (const key of extraKeys) {
      if (key === 'value' || key === 'plaintext' || key === 'secret') continue;
      ctx.addIssue({
        code: 'custom',
        path: [key],
        message: `Unknown secret metadata field: ${key}`,
      });
    }
  });

export const SourceSecretsFileSchema = z
  .object({
    schemaVersion: SourceManifestSchemaVersionSchema,
    secrets: z.record(SecretNameSchema, SourceSecretEntrySchema),
  })
  .strict();
export type SourceSecretsFile = z.infer<typeof SourceSecretsFileSchema>;
