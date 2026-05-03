import { existsSync, readFileSync, writeFileSync } from 'fs';
import { basename, isAbsolute, relative } from 'path';
import { env } from '../env';
import { activeProfileName, readActiveCredentials } from './credentials';
import { error, ui } from './ui';

export interface CliConfig {
  baseUrl: string;
  apiKey: string;
  dir: string;
}

export type ApiKeySource = 'env' | 'profile' | 'none';

export interface ResolvedSource {
  apiKey: ApiKeySource;
  /** Active profile name when `apiKey === 'profile'`. */
  profile?: string;
}

/**
 * Default base URL when nothing else is set. Mirrors the gh / vercel /
 * kubectl convention of falling back to the public service — a fresh
 * `npm install -g @eigenpal/cli && EIGENPAL_API_KEY=… eigenpal status`
 * should "just work" against the hosted Eigenpal service. Override with
 * `--base-url <url>` or `EIGENPAL_BASE_URL=<url>` to target a different
 * environment.
 */
const DEFAULT_BASE_URL = 'https://studio.eigenpal.com';

/**
 * Resolve CLI config in priority order:
 *   flags > env vars > active profile > defaults
 *
 * Profile selection (when env doesn't provide a key):
 *   EIGENPAL_PROFILE > persisted `current` > `default`
 *
 * `EIGENPAL_API_KEY` is a one-off bypass intended for CI. When it's set
 * the profile is **not consulted at all** — including for baseUrl.
 * Mixing an env apiKey with a stored profile's baseUrl always fails (an
 * API key is provisioned for one server; using it against another's URL
 * never works). To target an on-prem server in CI, set both the API key
 * and `EIGENPAL_BASE_URL`. Otherwise the bypass uses the cloud default.
 */
export function resolveConfig(flags: { baseUrl?: string; dir?: string }): CliConfig {
  const usingEnvKey = !!env.EIGENPAL_API_KEY;
  const profile = usingEnvKey ? null : readActiveCredentials();

  const baseUrl = flags.baseUrl || env.EIGENPAL_BASE_URL || profile?.baseUrl || DEFAULT_BASE_URL;
  const apiKey = env.EIGENPAL_API_KEY || profile?.apiKey || '';
  const dir = flags.dir || env.EIGENPAL_DIR || './eigenpal';

  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    apiKey,
    dir,
  };
}

/**
 * Diagnostic for `status`: surfaces WHERE the API key came from
 * so a stale `EIGENPAL_API_KEY` export in a parent shell is immediately
 * obvious instead of silently picking the wrong tenant.
 */
export function resolveSource(): ResolvedSource {
  if (env.EIGENPAL_API_KEY) return { apiKey: 'env' };
  const creds = readActiveCredentials();
  if (creds?.apiKey) return { apiKey: 'profile', profile: activeProfileName() };
  return { apiKey: 'none' };
}

export function ensureEvalArtifactsGitignore(dir: string): void {
  const gitignorePath = '.gitignore';
  const rel = isAbsolute(dir) ? relative(process.cwd(), dir) : dir;
  const base = rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : basename(dir || 'eigenpal');
  const normalizedBase = base.replace(/\\/g, '/').replace(/^\.\/+/, '');
  const patterns = [
    `${normalizedBase}/**/executions/**`,
    `${normalizedBase}/workflows/**/eval/llm-judge-summary-*.*`,
  ];
  const legacyPatterns = patterns.map((pattern) => `./${pattern}`);
  const sectionHeader = '# Eigenpal eval artifacts';

  let content = '';
  if (existsSync(gitignorePath)) {
    content = readFileSync(gitignorePath, 'utf-8');
    const lines = content.split(/\r?\n/).map((line) => line.trim());
    const hasAll = patterns.every(
      (pattern, index) => lines.includes(pattern) || lines.includes(legacyPatterns[index])
    );
    if (hasAll) return;
  }

  const cleaned = (content ? content.split(/\r?\n/) : []).filter((line) => {
    const trimmed = line.trim();
    if (trimmed === sectionHeader) return false;
    if (trimmed === '# Eigenpal eval artifacts./eigenpal/**/executions/**') return false;
    if (patterns.includes(trimmed)) return false;
    if (legacyPatterns.includes(trimmed)) return false;
    return true;
  });

  const prefix = cleaned.length > 0 ? `${cleaned.join('\n').replace(/\s*$/, '')}\n` : '';
  const next = `${prefix}${sectionHeader}\n${patterns.join('\n')}\n`;
  writeFileSync(gitignorePath, next, 'utf-8');
}

export function requireApiKey(config: CliConfig): string {
  if (!config.apiKey) {
    error('Not authenticated.');
    process.stderr.write(
      `  ${ui.dim('Run')} ${ui.bold('eigenpal auth login')} ${ui.dim('to add a profile,')}\n` +
        `  ${ui.dim('or set')} ${ui.bold('EIGENPAL_API_KEY')} ${ui.dim('in your env.')}\n`
    );
    process.exit(1);
  }
  return config.apiKey;
}
