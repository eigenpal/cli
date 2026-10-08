import { FileReferenceError } from './reference';

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
  /**
   * How a caller writes a file reference for this source (see
   * `parseFileReference`), e.g. `'stackId/fileId'`. Shown in the run form and
   * the API docs so callers know which parts to send.
   */
  referenceFormat?: string;
  /**
   * Names of the two parts when a caller passes the reference as an object
   * instead of a string, e.g. `{ stackId, fileId }` for `stackId/fileId`.
   */
  referenceParts?: { container: string; id: string };
  /** Configurable fields. */
  configFields: FileSourceConfigField[];
  /**
   * Rules spanning several fields (e.g. "an access key or a role"), run after
   * the per-field checks so a contradictory config is refused when it is saved
   * or loaded rather than when a run needs it. Returns error messages.
   */
  check?: (config: FileSourceConfig) => string[];
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * True unless `value` is a plain-HTTP URL to a non-local host. Credentials
 * travel with every request, so plain HTTP is only for a local emulator.
 * Unparseable values pass here; URL validation reports them.
 */
export function isHttpsOrLocal(value: unknown): boolean {
  if (typeof value !== 'string') return true;
  try {
    const url = new URL(value.trim());
    return url.protocol !== 'http:' || LOCAL_HOSTS.has(url.hostname);
  } catch {
    return true;
  }
}

function isSet(config: FileSourceConfig, key: string): boolean {
  const value = config[key];
  return value !== undefined && value !== '';
}

/** Built-in GPFS file source name. */
export const GPFS_FILE_SOURCE_NAME = 'gpfs';

/**
 * Built-in GPFS (IBM Storage Scale, fronted by an HTTP file registry such as
 * GFR) resolver. A GFR file is identified by a stack plus a file id, so it
 * fetches `${baseUrl}/<stackId>/<fileId>/content`, taking the stack from the
 * reference or from `defaultStack`. A base URL that already ends in a stack
 * keeps working for bare file ids. Bearer auth optional.
 */
export const GPFS_FILE_SOURCE_DESCRIPTOR: FileSourceDescriptor = {
  name: GPFS_FILE_SOURCE_NAME,
  label: 'GPFS file registry',
  description: 'Fetch documents from a GPFS/GFR HTTP file registry by stack and file id.',
  referenceFormat: 'stackId/fileId',
  referenceParts: { container: 'stackId', id: 'fileId' },
  configFields: [
    {
      key: 'baseUrl',
      label: 'Base URL',
      type: 'string',
      required: true,
      description:
        'Registry URL without a stack. Files are fetched from <base URL>/<stackId>/<fileId>/content.',
      placeholder: 'https://files.example.com/ims/gfr',
    },
    {
      key: 'defaultStack',
      label: 'Default stack',
      type: 'string',
      required: false,
      description:
        'Stack used when a run passes only a file id. Leave blank if the base URL already ends in a stack.',
    },
    allowedContainersField('stacks'),
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
      description:
        'Only for registries with self-signed or legacy certificates. Prefer installing your CA instead.',
      default: false,
      advanced: true,
    },
    ...transferLimitFields('registry'),
  ],
};

/** Built-in S3 file source name. */
export const S3_FILE_SOURCE_NAME = 's3';

/**
 * Built-in S3 resolver for Amazon S3 and S3-compatible stores (MinIO, Ceph,
 * NetApp StorageGRID). A file is a bucket plus a key, so references read
 * `bucket/key`; the bucket is always explicit because keys contain `/`.
 * Authenticates with an access key, or by assuming `roleArn`. The worker's own
 * AWS identity is never used to read objects, because it can read the
 * platform's storage; with `roleArn` and no access key it is only used to call
 * AssumeRole.
 */
export const S3_FILE_SOURCE_DESCRIPTOR: FileSourceDescriptor = {
  name: S3_FILE_SOURCE_NAME,
  label: 'Amazon S3',
  description: 'Fetch documents from Amazon S3 or S3-compatible storage by bucket and key.',
  referenceFormat: 'bucket/key',
  referenceParts: { container: 'bucket', id: 'key' },
  check: (config) => {
    const keyId = isSet(config, 'accessKeyId');
    const secret = isSet(config, 'secretAccessKey');
    if (keyId !== secret) return ['Set both the access key ID and the secret access key'];
    if (!keyId && !isSet(config, 'roleArn')) return ['Set an access key or a role ARN'];
    return [];
  },
  configFields: [
    {
      key: 'region',
      label: 'Region',
      type: 'string',
      required: true,
      default: 'us-east-1',
      description: 'AWS region of the bucket. Most S3-compatible stores accept us-east-1.',
    },
    allowedContainersField('buckets'),
    {
      key: 'accessKeyId',
      label: 'Access key ID',
      type: 'string',
      required: false,
      description: 'Required unless a role ARN is set.',
    },
    {
      key: 'secretAccessKey',
      label: 'Secret access key',
      type: 'secret',
      required: false,
      description: 'Use a key that can only read the buckets EigenPal should fetch from.',
    },
    {
      key: 'roleArn',
      label: 'Role ARN',
      type: 'string',
      required: false,
      description:
        'AWS role to assume for reading objects. Without an access key, the worker identity is used only to assume it.',
      placeholder: 'arn:aws:iam::123456789012:role/eigenpal-documents-read',
      advanced: true,
    },
    {
      key: 'externalId',
      label: 'External ID',
      type: 'string',
      required: false,
      description: 'External ID the role trust policy requires, if any.',
      advanced: true,
    },
    {
      key: 'stsEndpointUrl',
      label: 'STS endpoint URL',
      type: 'string',
      required: false,
      description:
        'Where to assume the role. Leave blank for AWS; set it for S3-compatible storage with STS, such as MinIO.',
      advanced: true,
    },
    {
      key: 'sessionToken',
      label: 'Session token',
      type: 'secret',
      required: false,
      description: 'Only for temporary access keys.',
      advanced: true,
    },
    {
      key: 'endpointUrl',
      label: 'Endpoint URL',
      type: 'string',
      required: false,
      description: 'Only for S3-compatible storage such as MinIO or Ceph. Leave blank for AWS.',
      placeholder: 'https://minio.example.com',
      advanced: true,
    },
    ...transferLimitFields('storage'),
  ],
};

/** Built-in Azure Blob Storage file source name. */
export const AZURE_BLOB_FILE_SOURCE_NAME = 'azure-blob';

/**
 * Built-in Azure Blob Storage resolver. A file is a container plus a blob
 * name, so references read `container/blobName`; the container is always
 * explicit because blob names contain `/`. Authenticates with a Microsoft
 * Entra ID service principal (needs Storage Blob Data Reader) or a SAS token.
 */
export const AZURE_BLOB_FILE_SOURCE_DESCRIPTOR: FileSourceDescriptor = {
  name: AZURE_BLOB_FILE_SOURCE_NAME,
  label: 'Azure Blob Storage',
  description: 'Fetch documents from Azure Blob Storage by container and blob name.',
  referenceFormat: 'container/blobName',
  referenceParts: { container: 'container', id: 'blobName' },
  check: (config) => {
    const principal = ['tenantId', 'clientId', 'clientSecret'].filter((k) => isSet(config, k));
    const sas = isSet(config, 'sasToken');
    if (principal.length > 0 && sas)
      return ['Use either the service principal or the SAS token, not both'];
    if (principal.length > 0 && principal.length < 3) {
      return ['A service principal needs the tenant ID, client ID and client secret'];
    }
    if (principal.length === 0 && !sas) return ['Set a service principal or a SAS token'];
    if (!isHttpsOrLocal(config.accountUrl)) {
      return ['The account URL must use HTTPS (HTTP only for a local emulator)'];
    }
    return [];
  },
  configFields: [
    {
      key: 'accountUrl',
      label: 'Account URL',
      type: 'string',
      required: true,
      description: 'Blob service URL of the storage account.',
      placeholder: 'https://myaccount.blob.core.windows.net',
    },
    allowedContainersField('containers'),
    {
      key: 'tenantId',
      label: 'Entra tenant ID',
      type: 'string',
      required: false,
      description:
        'Service principal sign-in. Set tenant, client ID and client secret, or a SAS token instead.',
    },
    {
      key: 'clientId',
      label: 'Client ID',
      type: 'string',
      required: false,
    },
    {
      key: 'clientSecret',
      label: 'Client secret',
      type: 'secret',
      required: false,
      description: 'The service principal needs the Storage Blob Data Reader role.',
    },
    {
      key: 'sasToken',
      label: 'SAS token',
      type: 'secret',
      required: false,
      description: 'Alternative to a service principal: a SAS token with read permission.',
    },
    {
      key: 'authorityHost',
      label: 'Authority host',
      type: 'string',
      required: false,
      description: 'Only for sovereign clouds, for example Azure Government.',
      default: 'https://login.microsoftonline.com',
      advanced: true,
    },
    ...transferLimitFields('storage account'),
  ],
};

/** Optional allow-list narrowing which containers runs may name. */
function allowedContainersField(plural: string): FileSourceConfigField {
  return {
    key: 'allowedContainers',
    label: `Allowed ${plural}`,
    type: 'string',
    required: false,
    description: `Comma-separated. Runs can only fetch from these ${plural}. Leave blank to allow any the credentials can read.`,
  };
}

/** Timeout and size cap, shared by every built-in source. */
function transferLimitFields(remote: string): FileSourceConfigField[] {
  return [
    {
      key: 'timeoutMs',
      label: 'Timeout (ms)',
      type: 'number',
      required: false,
      description: `How long to wait for the ${remote} before giving up.`,
      default: 30000,
      advanced: true,
    },
    {
      key: 'maxFileBytes',
      label: 'Max file size (bytes)',
      type: 'number',
      required: false,
      description: 'Reject files larger than this. At most 1 GiB.',
      default: 50 * 1024 * 1024,
      advanced: true,
    },
  ];
}

/** All built-in file-source descriptors. */
export const BUILTIN_FILE_SOURCE_DESCRIPTORS: readonly FileSourceDescriptor[] = [
  GPFS_FILE_SOURCE_DESCRIPTOR,
  S3_FILE_SOURCE_DESCRIPTOR,
  AZURE_BLOB_FILE_SOURCE_DESCRIPTOR,
];

/** Look up a built-in descriptor by resolver name. */
export function getBuiltinFileSourceDescriptor(name: string): FileSourceDescriptor | undefined {
  return BUILTIN_FILE_SOURCE_DESCRIPTORS.find((d) => d.name === name);
}

/**
 * True when `value` is a reference passed as an object: exactly the two part
 * names of one built-in type (`{ stackId, fileId }`, `{ bucket, key }`,
 * `{ container, blobName }`). Any other object is not a reference.
 */
export function isFileReferenceObject(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  return BUILTIN_FILE_SOURCE_DESCRIPTORS.some((descriptor) => {
    const parts = descriptor.referenceParts;
    return parts !== undefined && keys.join() === [parts.container, parts.id].sort().join();
  });
}

/**
 * The string form of a reference a caller passed for a connection of `type`:
 * a string as is, or an object of that type's two parts joined with `/`.
 * Throws a `FileReferenceError` naming the expected shape otherwise.
 */
export function fileReferenceString(value: unknown, type: string): string {
  if (typeof value === 'string') return value;
  const descriptor = getBuiltinFileSourceDescriptor(type);
  const parts = descriptor?.referenceParts;
  const expected = parts
    ? `"${descriptor.referenceFormat}" or { "${parts.container}": ..., "${parts.id}": ... }`
    : 'a string';
  if (!parts || !isFileReferenceObject(value)) {
    throw new FileReferenceError(
      `A ${descriptor?.label ?? type} file reference must be ${expected}`
    );
  }
  const container = value[parts.container];
  const id = value[parts.id];
  if (typeof container !== 'string' || typeof id !== 'string') {
    throw new FileReferenceError(`A ${descriptor.label} file reference must be ${expected}`);
  }
  // The container becomes the first path part, so it cannot contain "/".
  if (container === '' || container.includes('/')) {
    throw new FileReferenceError(`"${parts.container}" must be a non-empty name without "/"`);
  }
  return `${container}/${id}`;
}

/**
 * A file source connection name, e.g. `gfr-prod`: lowercase letters, digits
 * and hyphens, 2 to 63 characters, starting with a letter or digit. Workflow
 * inputs reference it as `source`, and it appears in URLs.
 */
export const FILE_SOURCE_CONNECTION_NAME = /^[a-z0-9][a-z0-9-]{1,62}$/;

/**
 * One-line explanation of a source-backed file input, shared by the run form
 * and the API docs so both tell callers the same reference format. `type` is
 * the connection's resolver type when known; a connection named after a
 * built-in type (`gpfs`) needs none.
 */
export function fileReferenceHint(sourceName: string, type?: string): string {
  const format = getBuiltinFileSourceDescriptor(type ?? sourceName)?.referenceFormat;
  return format
    ? `File reference (${format}) resolved via the "${sourceName}" file source.`
    : `File id resolved via the "${sourceName}" file source.`;
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

  if (errors.length === 0 && descriptor.check) {
    for (const message of descriptor.check(value)) errors.push({ key: 'config', message });
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
