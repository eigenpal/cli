/**
 * File-source resolver descriptors — the metadata that lets the dashboard render
 * a configuration form for an external file source and lets the server validate
 * stored config, without depending on the worker-side resolver implementation.
 *
 * A "file source" resolves a plain string id (passed as a `type: 'file'` workflow
 * input declared with `source: <name>`) into downloaded file bytes. The resolver
 * implementation lives in the worker (`@eigenpal/worker` file-source registry);
 * the descriptor here is the shared contract both app and worker reference.
 *
 * Single-tenant only — the run-input/string-id resolution feature is gated to
 * single-tenant deployments and must not be exposed in multi-tenant.
 */

/** Supported config-field input kinds rendered by the settings UI. */
export type FileSourceConfigFieldType = 'string' | 'secret' | 'boolean' | 'number';

/** One configurable field of a file source (drives the settings form + validation). */
export interface FileSourceConfigField {
  /** Stable key stored in the config object (e.g. `'baseUrl'`). */
  key: string;
  /** Human-readable label for the settings form. */
  label: string;
  /** Field input kind. `secret` values are encrypted at rest and never echoed back. */
  type: FileSourceConfigFieldType;
  /** Whether the field must be present (and non-empty) for the source to be usable. */
  required: boolean;
  /** Optional help text shown under the field. */
  description?: string;
  /** Optional placeholder / example value for the form. */
  placeholder?: string;
  /** Optional default applied when the field is omitted. */
  default?: string | number | boolean;
  /** Rarely-changed tuning field — rendered under an "Advanced" section in the UI. */
  advanced?: boolean;
}

/** Descriptor for a named file source. */
export interface FileSourceDescriptor {
  /** Resolver name — matches the worker-registered resolver and the input `source`. */
  name: string;
  /** Human-readable label (e.g. `'GPFS file registry'`). */
  label: string;
  /** Short description for the settings UI. */
  description: string;
  /** Configurable fields. */
  configFields: FileSourceConfigField[];
}

/** Built-in GPFS file source name. */
export const GPFS_FILE_SOURCE_NAME = 'gpfs';

/**
 * Built-in GPFS (IBM Storage Scale, fronted by an HTTP file registry) resolver.
 * Fetches `${baseUrl}/<id>/content` and returns the bytes. Bearer auth optional.
 */
export const GPFS_FILE_SOURCE_DESCRIPTOR: FileSourceDescriptor = {
  name: GPFS_FILE_SOURCE_NAME,
  label: 'GPFS file registry',
  description: 'Fetch documents by id from a GPFS/GFR HTTP file registry.',
  configFields: [
    {
      key: 'baseUrl',
      label: 'Base URL',
      type: 'string',
      required: true,
      description: 'Base URL of the registry. The file id is appended to fetch each file.',
      placeholder: 'https://files.example.com/registry',
    },
    {
      key: 'authToken',
      label: 'Bearer token',
      type: 'secret',
      required: false,
      description: 'Bearer token for the registry, if it requires one.',
    },
    {
      key: 'insecureSkipTlsVerify',
      label: 'Skip TLS verification',
      type: 'boolean',
      required: false,
      description: 'Only for registries with self-signed or legacy certificates.',
      default: false,
      advanced: true,
    },
    {
      key: 'timeoutMs',
      label: 'Timeout (ms)',
      type: 'number',
      required: false,
      description: 'How long to wait for the registry before giving up.',
      default: 30000,
      advanced: true,
    },
    {
      key: 'maxFileBytes',
      label: 'Max file size (bytes)',
      type: 'number',
      required: false,
      description: 'Reject files larger than this.',
      default: 50 * 1024 * 1024,
      advanced: true,
    },
  ],
};

/** All built-in file-source descriptors. */
export const BUILTIN_FILE_SOURCE_DESCRIPTORS: readonly FileSourceDescriptor[] = [
  GPFS_FILE_SOURCE_DESCRIPTOR,
];

/** Look up a built-in descriptor by resolver name. */
export function getBuiltinFileSourceDescriptor(name: string): FileSourceDescriptor | undefined {
  return BUILTIN_FILE_SOURCE_DESCRIPTORS.find((d) => d.name === name);
}

/** Normalized, validated config for a file source (secret values are plaintext here). */
export type FileSourceConfig = Record<string, string | number | boolean>;

export interface FileSourceConfigValidation {
  ok: boolean;
  value: FileSourceConfig;
  errors: Array<{ key: string; message: string }>;
}

/**
 * Validate + coerce a raw config object against a descriptor. Numbers are parsed
 * from strings, booleans coerced, and required fields checked for presence.
 * Unknown keys are dropped. Returns `{ ok, value, errors }`.
 */
export function validateFileSourceConfig(
  descriptor: FileSourceDescriptor,
  raw: Record<string, unknown>
): FileSourceConfigValidation {
  const value: FileSourceConfig = {};
  const errors: Array<{ key: string; message: string }> = [];

  for (const field of descriptor.configFields) {
    const provided = raw[field.key];
    const isEmpty = provided === undefined || provided === null || provided === '';

    if (isEmpty) {
      if (field.default !== undefined) {
        value[field.key] = field.default;
      } else if (field.required) {
        errors.push({ key: field.key, message: `${field.label} is required` });
      }
      continue;
    }

    switch (field.type) {
      case 'number': {
        const n = typeof provided === 'number' ? provided : Number(provided);
        if (!Number.isFinite(n)) {
          errors.push({ key: field.key, message: `${field.label} must be a number` });
        } else {
          value[field.key] = n;
        }
        break;
      }
      case 'boolean': {
        value[field.key] =
          typeof provided === 'boolean' ? provided : provided === 'true' || provided === '1';
        break;
      }
      case 'string':
      case 'secret': {
        value[field.key] = String(provided);
        break;
      }
    }
  }

  return { ok: errors.length === 0, value, errors };
}

/**
 * Return a copy of a config with every `secret` field replaced by a boolean
 * "is set" indicator, for safe display in API responses (never echo secrets).
 */
export function redactFileSourceSecrets(
  descriptor: FileSourceDescriptor,
  config: Record<string, unknown>
): Record<string, unknown> {
  const secretKeys = new Set(
    descriptor.configFields.filter((f) => f.type === 'secret').map((f) => f.key)
  );
  const out: Record<string, unknown> = {};
  // Non-secret values pass through.
  for (const [key, val] of Object.entries(config)) {
    if (!secretKeys.has(key)) out[key] = val;
  }
  // Every secret field reports a boolean "is set", even when absent.
  for (const key of secretKeys) {
    const val = config[key];
    out[key] = val !== undefined && val !== null && val !== '';
  }
  return out;
}
