import {
  CreateEmailServerRequestSchema,
  UpdateEmailServerRequestSchema,
  getEmailServerUpdateError,
  type CreateEmailServerRequest,
  type EmailServer,
  type EmailServerTransport,
  type UpdateEmailServerRequest,
} from '@eigenpal/types';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SECRET_KEYS = new Set(['apiKey', 'password', 'caPem', 'ciphertext']);

const SMTP_UPDATE_TARGET_FIELDS = ['host', 'port', 'security', 'fromEmail', 'fromName'] as const;

const SMTP_UPDATE_FLAG_BY_FIELD: Record<(typeof SMTP_UPDATE_TARGET_FIELDS)[number], string> = {
  host: '--host',
  port: '--port',
  security: '--security',
  fromEmail: '--from-email',
  fromName: '--from-name',
};

/** SMTP PATCH is a full target: omitted security/port must not silently become starttls/587. */
export function assertCompleteSmtpUpdateTarget(body: Record<string, unknown>): void {
  if (body.transport !== 'smtp') return;
  const missing = SMTP_UPDATE_TARGET_FIELDS.filter(
    (field) => body[field] === undefined || body[field] === ''
  );
  if (missing.length === 0) return;
  const flags = missing.map((field) => SMTP_UPDATE_FLAG_BY_FIELD[field]).join(', ');
  throw new Error(
    `SMTP updates that set --transport smtp require a complete target (host, port, security, from-email, from-name). Missing: ${flags}. Update does not default --security/--port (create still defaults to starttls and the matching port). Metadata-only updates omit --transport.`
  );
}

export type ConfigSourceOpts = {
  configJson?: string;
  configFile?: string;
};

export type SecretInputOpts = {
  stdin?: boolean;
  file?: string;
};

function countTruthy(values: unknown[]): number {
  return values.filter(Boolean).length;
}

export function assertExclusiveConfigSource(
  explicitFieldCount: number,
  opts: ConfigSourceOpts,
  command: 'create' | 'update'
): void {
  const configSources = countTruthy([opts.configJson, opts.configFile]);
  if (configSources > 1) {
    throw new Error('Pass only one of --config-json or --config-file.');
  }
  if (configSources > 0 && explicitFieldCount > 0) {
    throw new Error(
      `${command} accepts either explicit flags or --config-json/--config-file, not both.`
    );
  }
  if (configSources === 0 && explicitFieldCount === 0 && command === 'create') {
    throw new Error(
      'create requires explicit fields or --config-json/--config-file (plus secret input for Resend or authenticated SMTP).'
    );
  }
}

export function readConfigObject(opts: ConfigSourceOpts): Record<string, unknown> {
  if (opts.configJson) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(opts.configJson);
    } catch {
      throw new Error('--config-json must be valid JSON.');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('--config-json must be a JSON object.');
    }
    return parsed as Record<string, unknown>;
  }
  if (opts.configFile) {
    const filePath = opts.configFile === '-' ? undefined : resolve(opts.configFile);
    let raw: string;
    try {
      raw = opts.configFile === '-' ? readFileSync(0, 'utf8') : readFileSync(filePath!, 'utf8');
    } catch (err) {
      const code = err && typeof err === 'object' && 'code' in err ? String(err.code) : '';
      if (code === 'ENOENT') {
        throw new Error(`Config file not found: ${resolve(opts.configFile)}`);
      }
      throw err;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('--config-file must contain a JSON object.');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('--config-file must contain a JSON object.');
    }
    return parsed as Record<string, unknown>;
  }
  return {};
}

export function rejectInlineSecrets(body: Record<string, unknown>): void {
  for (const key of SECRET_KEYS) {
    if (key in body && body[key] != null) {
      throw new Error(
        `Secret field "${key}" cannot be set in --config-json/--config-file. Use the matching *-stdin or *-file flag, or answer the secure prompt.`
      );
    }
  }
}

export async function readSecretInput(
  label: string,
  opts: SecretInputOpts,
  required: boolean
): Promise<string | undefined> {
  const selected = countTruthy([opts.stdin, opts.file]);
  if (selected > 1) {
    throw new Error(`Pass only one of --${label}-stdin or --${label}-file.`);
  }
  if (opts.stdin) {
    return readFileSync(0, 'utf8').replace(/\n$/, '');
  }
  if (opts.file) {
    const filePath = opts.file === '-' ? undefined : resolve(opts.file);
    try {
      return (
        opts.file === '-' ? readFileSync(0, 'utf8') : readFileSync(filePath!, 'utf8')
      ).replace(/\n$/, '');
    } catch (err) {
      const code = err && typeof err === 'object' && 'code' in err ? String(err.code) : '';
      if (code === 'ENOENT') {
        throw new Error(`Secret file not found: ${resolve(opts.file)}`);
      }
      throw err;
    }
  }
  if (!required) return undefined;
  if (process.stdin.isTTY && process.stdout.isTTY) {
    const { password, isCancel, cancel } = await import('@clack/prompts');
    const answer = await password({ message: `${label} (input hidden)` });
    if (isCancel(answer)) {
      cancel('Cancelled');
      process.exit(1);
    }
    return String(answer);
  }
  throw new Error(
    `${label} is required in noninteractive mode (use --${label}-stdin or --${label}-file).`
  );
}

function parseEnabled(opts: { enabled?: boolean; disabled?: boolean }): boolean | undefined {
  if (opts.enabled && opts.disabled) {
    throw new Error('Pass only one of --enabled or --disabled.');
  }
  if (opts.disabled) return false;
  if (opts.enabled) return true;
  return undefined;
}

export type CreateFlagOpts = ConfigSourceOpts & {
  name?: string;
  transport?: string;
  fromEmail?: string;
  fromName?: string;
  enabled?: boolean;
  disabled?: boolean;
  host?: string;
  port?: number;
  security?: string;
  username?: string;
  apiKeyStdin?: boolean;
  apiKeyFile?: string;
  passwordStdin?: boolean;
  passwordFile?: string;
  caPemStdin?: boolean;
  caPemFile?: string;
};

export async function buildCreateRequest(opts: CreateFlagOpts): Promise<CreateEmailServerRequest> {
  const explicitCount = countTruthy([
    opts.name,
    opts.transport,
    opts.fromEmail,
    opts.fromName,
    opts.enabled,
    opts.disabled,
    opts.host,
    opts.port,
    opts.security,
    opts.username,
  ]);
  assertExclusiveConfigSource(explicitCount, opts, 'create');

  const body: Record<string, unknown> = {};
  if (countTruthy([opts.configJson, opts.configFile]) > 0) {
    Object.assign(body, readConfigObject(opts));
    rejectInlineSecrets(body);
  }

  if (opts.name !== undefined) body.name = opts.name;
  if (opts.transport !== undefined) body.transport = opts.transport;
  if (opts.fromEmail !== undefined) body.fromEmail = opts.fromEmail;
  if (opts.fromName !== undefined) body.fromName = opts.fromName;
  const enabled = parseEnabled(opts);
  if (enabled !== undefined) body.enabled = enabled;
  if (opts.host !== undefined) body.host = opts.host;
  if (opts.port !== undefined) body.port = opts.port;
  if (opts.security !== undefined) body.security = opts.security;
  if (opts.username !== undefined) body.username = opts.username;

  const apiKey = await readSecretInput(
    'api-key',
    { stdin: opts.apiKeyStdin, file: opts.apiKeyFile },
    false
  );
  if (apiKey !== undefined) body.apiKey = apiKey;

  const password = await readSecretInput(
    'password',
    { stdin: opts.passwordStdin, file: opts.passwordFile },
    false
  );
  if (password !== undefined) body.password = password;

  const caPem = await readSecretInput(
    'ca-pem',
    { stdin: opts.caPemStdin, file: opts.caPemFile },
    false
  );
  if (caPem !== undefined) body.caPem = caPem;

  const transport = body.transport;
  if (transport === 'resend' && body.apiKey === undefined) {
    body.apiKey = await readSecretInput(
      'api-key',
      { stdin: opts.apiKeyStdin, file: opts.apiKeyFile },
      true
    );
  }

  if (
    body.transport === 'smtp' &&
    typeof body.username === 'string' &&
    body.username.length > 0 &&
    body.password === undefined
  ) {
    body.password = await readSecretInput(
      'password',
      { stdin: opts.passwordStdin, file: opts.passwordFile },
      true
    );
  }

  return CreateEmailServerRequestSchema.parse(body);
}

export type UpdateFlagOpts = CreateFlagOpts & {
  clearCaPem?: boolean;
  clearUsername?: boolean;
};

export async function buildUpdateRequest(input: {
  existing: {
    transport: EmailServerTransport;
    host?: string;
    username?: string | null;
    passwordConfigured?: boolean;
  };
  opts: UpdateFlagOpts;
}): Promise<UpdateEmailServerRequest> {
  const { existing, opts } = input;
  const explicitCount = countTruthy([
    opts.name,
    opts.transport,
    opts.fromEmail,
    opts.fromName,
    opts.enabled,
    opts.disabled,
    opts.host,
    opts.port,
    opts.security,
    opts.username,
    opts.clearCaPem,
    opts.clearUsername,
  ]);
  assertExclusiveConfigSource(explicitCount, opts, 'update');

  const body: Record<string, unknown> = {};
  if (countTruthy([opts.configJson, opts.configFile]) > 0) {
    Object.assign(body, readConfigObject(opts));
    rejectInlineSecrets(body);
  }

  if (opts.name !== undefined) body.name = opts.name;
  const enabled = parseEnabled(opts);
  if (enabled !== undefined) body.enabled = enabled;
  if (opts.transport !== undefined) body.transport = opts.transport;
  if (opts.fromEmail !== undefined) body.fromEmail = opts.fromEmail;
  if (opts.fromName !== undefined) body.fromName = opts.fromName;
  if (opts.host !== undefined) body.host = opts.host;
  if (opts.port !== undefined) body.port = opts.port;
  if (opts.security !== undefined) body.security = opts.security;
  if (opts.clearUsername) body.username = null;
  else if (opts.username !== undefined) body.username = opts.username;
  if (opts.clearCaPem) body.caPem = null;

  const apiKey = await readSecretInput(
    'api-key',
    { stdin: opts.apiKeyStdin, file: opts.apiKeyFile },
    false
  );
  if (apiKey !== undefined) body.apiKey = apiKey;

  const password = await readSecretInput(
    'password',
    { stdin: opts.passwordStdin, file: opts.passwordFile },
    false
  );
  if (password !== undefined) body.password = password;

  const caPem = await readSecretInput(
    'ca-pem',
    { stdin: opts.caPemStdin, file: opts.caPemFile },
    false
  );
  if (caPem !== undefined) body.caPem = caPem;

  if (Object.keys(body).length === 0) {
    throw new Error('No changes requested. Pass fields to update or --config-json/--config-file.');
  }

  assertCompleteSmtpUpdateTarget(body);

  if (body.transport === 'resend' && existing.transport !== 'resend' && body.apiKey === undefined) {
    body.apiKey = await readSecretInput(
      'api-key',
      { stdin: opts.apiKeyStdin, file: opts.apiKeyFile },
      true
    );
  }

  if (body.transport === 'smtp' && body.password === undefined) {
    const targetUsername =
      body.username === null
        ? null
        : typeof body.username === 'string'
          ? body.username
          : (existing.username ?? null);
    const destinationChanged =
      existing.transport !== 'smtp' ||
      (typeof body.host === 'string' &&
        existing.host !== undefined &&
        body.host !== existing.host) ||
      targetUsername !== (existing.username ?? null);

    if (destinationChanged && targetUsername) {
      body.password = await readSecretInput(
        'password',
        { stdin: opts.passwordStdin, file: opts.passwordFile },
        true
      );
    }
  }

  const patch = UpdateEmailServerRequestSchema.parse(body);
  const transportError = getEmailServerUpdateError(existing.transport, patch, {
    host: existing.host,
    username: existing.username,
    passwordConfigured: existing.passwordConfigured,
  });
  if (transportError) throw new Error(transportError);

  return patch;
}

function redactValue(key: string, value: unknown): unknown {
  if (SECRET_KEYS.has(key)) return '[redacted]';
  if (value && typeof value === 'object') {
    if (Array.isArray(value)) return value.map((item) => redactUnknown(item));
    return redactUnknown(value as Record<string, unknown>);
  }
  return value;
}

function redactUnknown(value: unknown): unknown {
  if (value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => redactUnknown(item));
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    out[key] = redactValue(key, nested);
  }
  return out;
}

/** Defense-in-depth redaction before printing or returning CLI JSON views. */
export function redactEmailServerPayload<T>(value: T): T {
  return redactUnknown(value) as T;
}

export function formatEmailServerHuman(server: EmailServer): string {
  const lines: string[] = [];
  lines.push(`${server.id}  ${server.name}${server.enabled ? '' : '  (disabled)'}`);
  lines.push(`  transport   ${server.transport}`);
  lines.push(`  from        ${server.fromName} <${server.fromEmail}>`);
  if (server.transport === 'resend') {
    lines.push(`  api key     configured`);
  } else {
    lines.push(`  host        ${server.host}:${server.port} (${server.security})`);
    lines.push(`  username    ${server.username ?? '-'}`);
    lines.push(`  password    ${server.passwordConfigured ? 'configured' : 'not configured'}`);
    lines.push(`  ca pem      ${server.caPemConfigured ? 'configured' : 'not configured'}`);
  }
  lines.push(
    `  updated     ${server.updatedAt instanceof Date ? server.updatedAt.toISOString() : server.updatedAt}`
  );
  return lines.join('\n');
}

export function assertLocalFile(path: string | undefined, label: string): void {
  if (!path || path === '-') return;
  const resolved = resolve(path);
  if (!existsSync(resolved)) {
    throw new Error(`${label} file not found: ${resolved}`);
  }
}
