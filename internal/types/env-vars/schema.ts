/**
 * Environment variables: named values a workflow reads as `{{ env.NAME }}`.
 *
 * Each installation keeps its own values; names and types are what travel
 * between environments. A variable is organization-wide or belongs to one
 * workflow (which then overrides an organization-wide one of the same name).
 * Secret values are encrypted at rest, never returned by an API, and masked
 * in stored run data.
 */
import { z } from 'zod';

export const ENV_VAR_TYPES = ['string', 'number', 'boolean'] as const;
export type EnvVarType = (typeof ENV_VAR_TYPES)[number];
export const EnvVarTypeSchema = z.enum(ENV_VAR_TYPES);

/** A resolved value as templates and steps see it. */
export type EnvVarValue = string | number | boolean;

export const ENV_VAR_NAME_MAX = 64;
export const ENV_VAR_VALUE_MAX_BYTES = 16_384;
/** Reserved for variables EigenPal may provide itself. */
export const ENV_VAR_RESERVED_PREFIX = 'EIGENPAL_';
/** Secret values shorter than this are not masked: they would match unrelated text. */
export const ENV_VAR_MASK_MIN_LENGTH = 8;

const NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/;

export const EnvVarNameSchema = z
  .string()
  .max(ENV_VAR_NAME_MAX, `Names are at most ${ENV_VAR_NAME_MAX} characters`)
  .regex(NAME_PATTERN, 'Use capital letters, digits and underscores, starting with a letter')
  .refine((name) => !name.startsWith(ENV_VAR_RESERVED_PREFIX), {
    message: `Names starting with ${ENV_VAR_RESERVED_PREFIX} are reserved`,
  });

/**
 * Parse a stored or submitted value as its type. Returns `null` when the text
 * is not a value of that type, so callers can report it on the `value` field.
 */
export function parseEnvVarValue(type: EnvVarType, text: string): EnvVarValue | null {
  switch (type) {
    case 'string':
      return text;
    case 'number': {
      const trimmed = text.trim();
      if (trimmed === '') return null;
      const value = Number(trimmed);
      return Number.isFinite(value) ? value : null;
    }
    case 'boolean':
      return text === 'true' ? true : text === 'false' ? false : null;
  }
}

export function envVarValueError(type: EnvVarType, secret: boolean, text: string): string | null {
  if (secret && type !== 'string') return 'Secrets are always strings';
  if (new TextEncoder().encode(text).byteLength > ENV_VAR_VALUE_MAX_BYTES) {
    return `Values are at most ${ENV_VAR_VALUE_MAX_BYTES / 1024} KB`;
  }
  if (parseEnvVarValue(type, text) === null) {
    return type === 'number' ? 'Enter a number' : 'Enter true or false';
  }
  return null;
}

/** A variable as it travels between environments: name and type, never a value. */
export const EnvVarRefSchema = z.strictObject({
  name: z.string().regex(NAME_PATTERN),
  type: EnvVarTypeSchema,
});
export type EnvVarRef = z.infer<typeof EnvVarRefSchema>;
