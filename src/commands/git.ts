import {
  DottedPackageNameSchema,
  dottedPackageNameToPath,
  formatReleaseTag,
  pathToDottedPackageName,
  RootSourceManifestSchema,
  SourceManifestFilenameSchema,
  SourcePackageManifestSchema,
  SourcePackagePathSchema,
  validateSourcePackageRequiredFiles,
  workspaceDependencyNameToPackagePath,
  type SourcePackageManifest,
  type SourcePackagePath,
  type WorkspaceDependencyName,
} from '@eigenpal/types';
import { InvalidArgumentError, Option, type Command } from 'commander';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { z } from 'zod';
import { getProcessEnv } from '../env';
import { ApiClient, ApiError, HtmlResponseError } from '../lib/client';
import { requireApiKey, resolveConfig, type CliConfig } from '../lib/config';
import { action } from '../lib/format-error';
import {
  addJsonFlag,
  dim,
  error,
  formatDuration,
  formatTimestamp,
  renderListResult,
  success,
  table,
  warn,
  withBaseUrl,
  withPagination,
  type PaginationOpts,
} from '../lib/ui';

type BaseOpts = { baseUrl?: string; json?: boolean };
type SourceRepository = { gitRepositoryPath: string; remoteUrl: string };
type ContextOpts = { dir?: string };
type GitAuthorEnv = Pick<
  NodeJS.ProcessEnv,
  'GIT_AUTHOR_NAME' | 'GIT_AUTHOR_EMAIL' | 'GIT_COMMITTER_NAME' | 'GIT_COMMITTER_EMAIL'
>;
type PackageContext = {
  gitRoot: string | null;
  packageRoot: string | null;
  packagePath: SourcePackagePath | null;
};
type ShowAgentPayload = {
  agent: Record<string, unknown> & {
    slug?: string;
    name?: string;
    description?: string | null;
    status?: string;
    sourceIntegrity?: string;
    latestVersion?: string | null;
    latestCommit?: string | null;
    recentRuns?: Array<Record<string, unknown>>;
    runs?: Array<Record<string, unknown>>;
  };
};

const SourceRepositorySchema = z.object({
  gitRepositoryPath: z.string(),
  remoteUrl: z.string().url(),
});

const AgentsListSchema = z.object({
  data: z.array(z.record(z.string(), z.unknown())),
  total: z.number().optional(),
});

const ReleaseSchema = z.object({
  version: z.string(),
  tag: z.string(),
  commit: z.string(),
  date: z.string().optional(),
});

type SourceRelease = z.infer<typeof ReleaseSchema>;

const ReleasesSchema = z.object({
  packagePath: z.string(),
  releases: z.array(ReleaseSchema),
});

const AuthCheckSchema = z.object({
  ok: z.literal(true),
  email: z.string().email().nullable().optional(),
  name: z.string().nullable().optional(),
  keyId: z.string(),
});

function runGit(
  args: string[],
  opts: { cwd?: string; config?: CliConfig; env?: NodeJS.ProcessEnv; gitRemoteUrl?: string } = {}
): void {
  const env = opts.config
    ? gitAuthEnv(opts.config, opts.env, opts.gitRemoteUrl)
    : { ...getProcessEnv(), ...opts.env };
  const result = spawnSync('git', args, {
    cwd: opts.cwd,
    env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status && result.status !== 0) process.exit(result.status);
}

function gitOutput(
  args: string[],
  cwd?: string,
  config?: CliConfig,
  gitRemoteUrl?: string
): string | null {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: config ? gitAuthEnv(config, {}, gitRemoteUrl) : undefined,
  });
  if (result.status !== 0) return null;
  return result.stdout.trim();
}

function gitAuthEnv(
  config: CliConfig,
  extra: NodeJS.ProcessEnv = {},
  gitRemoteUrl?: string | null
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...getProcessEnv(),
    ...extra,
  };
  if (!gitRemoteUrl) return env;

  return {
    ...env,
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: `http.${gitRemoteUrl.replace(/\/+$/, '')}.extraHeader`,
    GIT_CONFIG_VALUE_0: `Authorization: Bearer ${requireApiKey(config)}`,
  };
}

async function resolveGitAuthorEnv(config: CliConfig): Promise<GitAuthorEnv> {
  const auth = AuthCheckSchema.parse(await new ApiClient(config).get('/api/v1/auth/check'));
  const email = auth.email ?? `${auth.keyId}@api-keys.eigenpal.local`;
  const name = auth.name?.trim() || auth.email || `Eigenpal API Key ${auth.keyId}`;
  return {
    GIT_AUTHOR_NAME: name,
    GIT_AUTHOR_EMAIL: email,
    GIT_COMMITTER_NAME: name,
    GIT_COMMITTER_EMAIL: email,
  };
}

async function getSourceRepository(config: CliConfig): Promise<SourceRepository> {
  const client = new ApiClient(config);
  return SourceRepositorySchema.parse(await client.get('/api/v1/source/repository'));
}

function sourcePathFromPackageRoot(gitRoot: string, packageRoot: string): SourcePackagePath | null {
  const relativePath = path.relative(gitRoot, packageRoot).replace(/\\/g, '/');
  const result = SourcePackagePathSchema.safeParse(relativePath);
  return result.success ? result.data : null;
}

function resolveGitRoot(dir: string): string | null {
  return gitOutput(['rev-parse', '--show-toplevel'], dir);
}

function findNearestPackageRoot(startDir: string, gitRoot: string | null): string | null {
  let current = path.resolve(startDir);
  while (true) {
    if (existsSync(path.join(current, 'eigenpal.yaml'))) return current;
    if (gitRoot && current === gitRoot) return null;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function resolveGitSourceContext(opts: ContextOpts = {}): PackageContext {
  const startDir = realpathSync(path.resolve(opts.dir ?? process.cwd()));
  const gitRoot = resolveGitRoot(startDir);
  const packageRoot = findNearestPackageRoot(startDir, gitRoot);
  const resolvedPackageRoot = packageRoot ? realpathSync(packageRoot) : null;
  return {
    gitRoot,
    packageRoot: resolvedPackageRoot,
    packagePath:
      gitRoot && resolvedPackageRoot
        ? sourcePathFromPackageRoot(gitRoot, resolvedPackageRoot)
        : null,
  };
}

function listRelativeFiles(dir: string): string[] {
  const files: string[] = [];
  const visit = (current: string) => {
    for (const entry of readdirSync(current)) {
      if (entry === '.git' || entry === 'eigenpal_modules' || entry === '.eigenpal') continue;
      const fullPath = path.join(current, entry);
      const rel = path.relative(dir, fullPath).replace(/\\/g, '/');
      if (statSync(fullPath).isDirectory()) visit(fullPath);
      else files.push(rel);
    }
  };
  visit(dir);
  return files;
}

function readYamlFile(filePath: string): unknown {
  return YAML.parse(readFileSync(filePath, 'utf8'));
}

function packageManifestExists(gitRoot: string, packagePath: SourcePackagePath): boolean {
  return existsSync(path.join(gitRoot, packagePath, 'eigenpal.yaml'));
}

function releaseTagExists(
  gitRoot: string,
  packagePath: SourcePackagePath,
  version: string
): boolean {
  const tag = formatReleaseTag(pathToDottedPackageName(packagePath), version);
  return gitOutput(['tag', '--list', tag], gitRoot) === tag;
}

function validatePackageReferences(input: {
  gitRoot: string;
  packageRoot: string;
  manifest: SourcePackageManifest;
}): string[] {
  const errors: string[] = [];
  const dependencies =
    'dependencies' in input.manifest ? Object.entries(input.manifest.dependencies ?? {}) : [];
  for (const [dependencyName, version] of dependencies) {
    const packagePath = workspaceDependencyNameToPackagePath(
      dependencyName as WorkspaceDependencyName
    );
    if (!packageManifestExists(input.gitRoot, packagePath)) {
      errors.push(`Dependency ${dependencyName}@${version} does not exist in this repository.`);
      continue;
    }
    if (!releaseTagExists(input.gitRoot, packagePath, version)) {
      errors.push(`Dependency ${dependencyName}@${version} is missing its release tag.`);
    }
  }

  const evaluatorItems =
    'evaluators' in input.manifest &&
    input.manifest.evaluators &&
    typeof input.manifest.evaluators === 'object' &&
    !Array.isArray(input.manifest.evaluators) &&
    'items' in input.manifest.evaluators
      ? input.manifest.evaluators.items
      : [];
  for (const item of evaluatorItems) {
    if (item.use.startsWith('./')) {
      const evaluatorPath = path.normalize(path.join(input.packageRoot, item.use));
      if (
        !evaluatorPath.startsWith(`${input.packageRoot}${path.sep}`) ||
        !existsSync(evaluatorPath)
      ) {
        errors.push(`Local evaluator ${item.use} does not exist.`);
      }
      continue;
    }

    if (!('version' in item)) continue;
    const packagePath = workspaceDependencyNameToPackagePath(item.use as WorkspaceDependencyName);
    if (!packageManifestExists(input.gitRoot, packagePath)) {
      errors.push(
        `Shared evaluator ${item.use}@${item.version} does not exist in this repository.`
      );
      continue;
    }
    if (!releaseTagExists(input.gitRoot, packagePath, item.version)) {
      errors.push(`Shared evaluator ${item.use}@${item.version} is missing its release tag.`);
    }
  }

  return errors;
}

function validatePackage(dir: string): { valid: boolean; errors: string[]; packagePath?: string } {
  const context = resolveGitSourceContext({ dir });
  const errors: string[] = [];
  const manifestPath = context.packageRoot ? path.join(context.packageRoot, 'eigenpal.yaml') : null;
  let parsedManifest: SourcePackageManifest | null = null;

  if (!context.gitRoot) errors.push('Not inside a Git repository.');
  if (!context.packageRoot || !manifestPath) errors.push('No package eigenpal.yaml found.');
  if (context.packageRoot && existsSync(path.join(context.packageRoot, 'eigenpal.yml'))) {
    errors.push('Use eigenpal.yaml; eigenpal.yml package manifests are not supported.');
  }
  if (!context.packagePath)
    errors.push('Package must live under agents/, workflows/, resources/, or evaluators/.');

  if (manifestPath && existsSync(manifestPath)) {
    const filename = SourceManifestFilenameSchema.safeParse(manifestPath);
    if (!filename.success)
      errors.push(filename.error.issues.map((issue) => issue.message).join('; '));
    const manifest = SourcePackageManifestSchema.safeParse(readYamlFile(manifestPath));
    if (!manifest.success)
      errors.push(manifest.error.issues.map((issue) => issue.message).join('; '));
    else parsedManifest = manifest.data;
  }

  if (context.packageRoot && context.packagePath) {
    const fileIssues = validateSourcePackageRequiredFiles({
      packagePath: context.packagePath,
      files: listRelativeFiles(context.packageRoot),
    });
    errors.push(...fileIssues.map((issue) => issue.message));
  }
  if (context.gitRoot && context.packageRoot && parsedManifest) {
    errors.push(
      ...validatePackageReferences({
        gitRoot: context.gitRoot,
        packageRoot: context.packageRoot,
        manifest: parsedManifest,
      })
    );
  }

  return { valid: errors.length === 0, errors, packagePath: context.packagePath ?? undefined };
}

function readRootManifest(
  gitRoot: string
): { ok: true; version: string } | { ok: false; error: string } {
  const manifestPath = path.join(gitRoot, 'eigenpal.yaml');
  if (!existsSync(manifestPath)) return { ok: false, error: 'Root eigenpal.yaml is missing.' };
  const parsed = RootSourceManifestSchema.safeParse(readYamlFile(manifestPath));
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues.map((issue) => issue.message).join('; ') };
  return { ok: true, version: parsed.data.eigenpalVersion };
}

function checkRepoVersion(gitRoot: string, mutation: boolean): void {
  const manifest = readRootManifest(gitRoot);
  if (!manifest.ok) return;
  const repoMajor = manifest.version.split('.')[0];
  const cliMajor = '1';
  if (repoMajor !== cliMajor && mutation) {
    throw new Error(
      `Repository source version ${manifest.version} is incompatible with this CLI. Run the repository upgrade flow first.`
    );
  }
  if (repoMajor !== cliMajor) {
    warn(
      `Repository source version is ${manifest.version}; this development CLI is dev-compatible.`
    );
  }
}

function resolvePackagePath(target: string): SourcePackagePath {
  return target.includes('/')
    ? SourcePackagePathSchema.parse(target)
    : dottedPackageNameToPath(DottedPackageNameSchema.parse(target));
}

function semverParts(version: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareSemverDesc(a: string, b: string): number {
  const left = semverParts(a);
  const right = semverParts(b);
  if (!left || !right) return b.localeCompare(a);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return right[index] - left[index];
  }
  return 0;
}

export function sortReleasesNewestFirst(releases: SourceRelease[]): SourceRelease[] {
  return [...releases].sort((a, b) => compareSemverDesc(a.version, b.version));
}

export function bumpReleaseVersion(
  releases: SourceRelease[],
  bump: 'patch' | 'minor' | 'major'
): string {
  const latest = sortReleasesNewestFirst(releases)[0]?.version ?? '0.0.0';
  const parts = semverParts(latest);
  if (!parts) throw new Error(`Cannot bump from non-semver latest version ${latest}.`);
  const [major, minor, patch] = parts;
  if (bump === 'major') return `${major + 1}.0.0`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function requirePackageClean(context: PackageContext): void {
  if (!context.gitRoot || !context.packagePath) throw new Error('No package context found.');
  const status = gitOutput(['status', '--short', '--', context.packagePath], context.gitRoot) ?? '';
  if (status.length > 0) {
    throw new Error(`Release requires a clean package working tree:\n${status}`);
  }
}

function requirePushedMain(gitRoot: string, config: CliConfig): void {
  const branch = gitOutput(['rev-parse', '--abbrev-ref', 'HEAD'], gitRoot);
  if (branch !== 'main') throw new Error('Release must be run from the main branch.');
  const remoteUrl = gitOutput(['remote', 'get-url', 'origin'], gitRoot);
  runGit(['fetch', 'origin', 'main'], {
    cwd: gitRoot,
    config,
    gitRemoteUrl: remoteUrl ?? undefined,
  });
  const head = gitOutput(['rev-parse', 'HEAD'], gitRoot);
  const originMain = gitOutput(['rev-parse', 'origin/main'], gitRoot);
  if (!head || !originMain || head !== originMain) {
    throw new Error('Release requires local main to match pushed origin/main.');
  }
}

async function syncLatestAutomation(
  client: ApiClient,
  packagePath: SourcePackagePath
): Promise<void> {
  const automation = pathToDottedPackageName(packagePath);
  try {
    await client.post(`/api/automations/${encodeURIComponent(automation)}/sync`);
    success(`Synced ${automation} to latest release.`);
  } catch (err) {
    if ((err instanceof ApiError && err.status === 404) || err instanceof HtmlResponseError) {
      warn('Automation sync endpoint is not available yet; run sync after it lands.');
      return;
    }
    throw err;
  }
}

async function cloneSource(opts: { out?: string; baseUrl?: string }): Promise<void> {
  const config = resolveConfig(opts);
  const repo = await getSourceRepository(config);
  runGit(['clone', repo.remoteUrl, opts.out ?? path.basename(repo.gitRepositoryPath)], {
    config,
    gitRemoteUrl: repo.remoteUrl,
  });
  success(`Cloned ${repo.remoteUrl}`);
}

async function gitPassthrough(args: string[], opts: BaseOpts): Promise<void> {
  if (args.length === 0) {
    error('Pass Git arguments after `--`, for example `eigenpal git -- status`.');
    process.exit(2);
  }
  const config = resolveConfig(opts);
  const cwd = gitCwdFromArgs(args);
  const remoteUrl = gitOutput(['remote', 'get-url', 'origin'], cwd);
  runGit(args, {
    config,
    env: gitCommandCreatesObjects(args) ? await resolveGitAuthorEnv(config) : undefined,
    gitRemoteUrl: remoteUrl ?? undefined,
  });
}

function gitCommandCreatesObjects(args: string[]): boolean {
  const objectCreatingCommands = new Set([
    'cherry-pick',
    'commit',
    'merge',
    'rebase',
    'revert',
    'tag',
  ]);
  return args.some((arg) => objectCreatingCommands.has(arg));
}

function gitCwdFromArgs(args: string[]): string {
  let cwd = process.cwd();
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '-C' && args[i + 1]) {
      cwd = path.resolve(cwd, args[i + 1]);
      i += 1;
    }
  }
  return cwd;
}

export async function runGitPassthroughFromArgv(argv: string[]): Promise<boolean> {
  const gitIndex = argv.indexOf('git');
  const separatorIndex = argv.indexOf('--', gitIndex + 1);
  if (gitIndex === -1 || separatorIndex === -1) return false;

  const beforeSeparator = argv.slice(gitIndex + 1, separatorIndex);
  const baseUrlIndex = beforeSeparator.indexOf('--base-url');
  const baseUrl =
    baseUrlIndex >= 0 && beforeSeparator[baseUrlIndex + 1]
      ? beforeSeparator[baseUrlIndex + 1]
      : undefined;
  await gitPassthrough(argv.slice(separatorIndex + 1), { baseUrl });
  return true;
}

export function hasGitPassthroughSeparator(argv: string[]): boolean {
  const gitIndex = argv.indexOf('git');
  return gitIndex !== -1 && argv.indexOf('--', gitIndex + 1) !== -1;
}

function doctor(opts: BaseOpts & ContextOpts): void {
  const context = resolveGitSourceContext(opts);
  const checks: Array<{ check: string; status: string; detail: string }> = [];
  checks.push({
    check: 'git',
    status: gitOutput(['--version']) ? 'pass' : 'fail',
    detail: gitOutput(['--version']) ?? 'git not found',
  });
  checks.push({
    check: 'repo',
    status: context.gitRoot ? 'pass' : 'fail',
    detail: context.gitRoot ?? 'not inside a Git repository',
  });

  if (context.gitRoot) {
    const root = readRootManifest(context.gitRoot);
    checks.push({
      check: 'root manifest',
      status: root.ok ? 'pass' : 'fail',
      detail: root.ok ? `eigenpalVersion ${root.version}` : root.error,
    });
    if (root.ok) {
      const repoMajor = root.version.split('.')[0];
      checks.push({
        check: 'repo version',
        status: repoMajor === '1' ? 'pass' : 'fail',
        detail:
          repoMajor === '1'
            ? `compatible ${root.version}`
            : `incompatible ${root.version}; run repository upgrade first`,
      });
    }
    const gitignore = existsSync(path.join(context.gitRoot, '.gitignore'))
      ? readFileSync(path.join(context.gitRoot, '.gitignore'), 'utf8')
      : '';
    for (const ignored of ['.eigenpal/', 'eigenpal_modules/']) {
      checks.push({
        check: `ignore ${ignored}`,
        status: gitignore.includes(ignored) ? 'pass' : 'fail',
        detail: gitignore.includes(ignored) ? ignored : `add ${ignored} to .gitignore`,
      });
    }
    checks.push({
      check: 'unsupported manifest',
      status: existsSync(path.join(context.gitRoot, 'eigenpal.yml')) ? 'fail' : 'pass',
      detail: 'root eigenpal.yml must not exist',
    });
    const remoteUrl = gitOutput(['remote', 'get-url', 'origin'], context.gitRoot);
    checks.push({
      check: 'remote origin',
      status: remoteUrl ? 'pass' : 'fail',
      detail: remoteUrl ?? 'origin remote is not configured',
    });
    if (remoteUrl) {
      let authDetail = 'git ls-remote origin succeeded';
      let authStatus = 'pass';
      try {
        const config = resolveConfig(opts);
        if (!gitOutput(['ls-remote', '--heads', 'origin'], context.gitRoot, config, remoteUrl)) {
          authStatus = 'fail';
          authDetail = 'git ls-remote origin failed';
        }
      } catch (err) {
        authStatus = 'fail';
        authDetail = err instanceof Error ? err.message : 'Git auth check failed';
      }
      checks.push({
        check: 'remote auth',
        status: authStatus,
        detail: authDetail,
      });
    }
  }

  if (context.packageRoot) {
    const result = validatePackage(context.packageRoot);
    checks.push({
      check: 'package structure',
      status: result.valid ? 'pass' : 'fail',
      detail: result.valid ? (result.packagePath ?? '-') : result.errors.join('; '),
    });
  }

  if (opts.json) console.log(JSON.stringify({ checks }, null, 2));
  else
    console.log(
      table(checks, [
        { key: 'check', header: 'check' },
        { key: 'status', header: 'status' },
        { key: 'detail', header: 'detail' },
      ])
    );

  if (checks.some((check) => check.status === 'fail')) process.exit(1);
}

function validate(opts: BaseOpts & ContextOpts): void {
  const context = resolveGitSourceContext({ dir: opts.dir });
  if (context.gitRoot) checkRepoVersion(context.gitRoot, false);
  const result = validatePackage(opts.dir ?? process.cwd());
  if (opts.json) console.log(JSON.stringify(result, null, 2));
  else if (result.valid) success(`Valid package ${result.packagePath ?? ''}`.trim());
  else {
    error('Package validation failed.');
    for (const issue of result.errors) dim(`  ${issue}`);
  }
  if (!result.valid) process.exit(1);
}

function packageStatus(opts: BaseOpts & ContextOpts): void {
  const context = resolveGitSourceContext(opts);
  if (context.gitRoot) checkRepoVersion(context.gitRoot, false);
  const validation = context.packageRoot ? validatePackage(context.packageRoot) : null;
  const gitStatus = context.gitRoot
    ? (gitOutput(['status', '--short'], context.gitRoot) ?? '')
    : '';
  const payload = {
    gitRoot: context.gitRoot,
    packageRoot: context.packageRoot,
    packagePath: context.packagePath,
    clean: gitStatus.length === 0,
    valid: validation?.valid ?? false,
    errors: validation?.errors ?? [],
  };
  if (opts.json) console.log(JSON.stringify(payload, null, 2));
  else {
    console.log(
      table(
        [payload],
        [
          { key: 'packagePath', header: 'package' },
          { key: 'clean', header: 'clean' },
          { key: 'valid', header: 'valid' },
        ]
      )
    );
  }
}

function deps(opts: BaseOpts & ContextOpts): void {
  const context = resolveGitSourceContext(opts);
  if (!context.packageRoot) throw new Error('No package eigenpal.yaml found.');
  const manifest = SourcePackageManifestSchema.parse(
    readYamlFile(path.join(context.packageRoot, 'eigenpal.yaml'))
  ) as { dependencies?: Record<string, string> };
  const rows = Object.entries(manifest.dependencies ?? {}).map(([name, version]) => ({
    name,
    version,
  }));
  if (opts.json) console.log(JSON.stringify({ dependencies: rows }, null, 2));
  else
    console.log(
      table(rows, [
        { key: 'name', header: 'dependency' },
        { key: 'version', header: 'version' },
      ])
    );
}

function clean(opts: BaseOpts & ContextOpts): void {
  const context = resolveGitSourceContext(opts);
  if (!context.gitRoot) throw new Error('Not inside a Git repository.');
  const status = gitOutput(['status', '--short'], context.gitRoot) ?? '';
  if (status.length > 0) {
    error('Working tree is not clean.');
    process.stdout.write(`${status}\n`);
    process.exit(1);
  }
  success('Working tree is clean.');
}

async function list(
  opts: BaseOpts & PaginationOpts & { type?: string; search?: string; includeArchived?: boolean }
): Promise<void> {
  if (opts.type && opts.type !== 'agent') {
    throw new Error('Only agent automation listing is available before workflow cutover.');
  }
  const client = new ApiClient(resolveConfig(opts));
  const raw = await client.get('/api/v1/agents', {
    limit: String(opts.limit),
    offset: String(opts.offset),
    ...(opts.search ? { search: opts.search } : {}),
    ...(opts.includeArchived ? { includeArchived: 'true' } : {}),
  });
  const parsed = AgentsListSchema.parse(raw);
  if (opts.json) console.log(JSON.stringify(parsed, null, 2));
  else {
    const rows = parsed.data.map((row) => ({
      ...row,
      inconsistency:
        typeof row.sourceIntegrity === 'string' && row.sourceIntegrity !== 'healthy'
          ? row.sourceIntegrity
          : '',
    }));
    renderListResult(
      { ...parsed, data: rows },
      [
        { key: 'type', header: 'type', format: () => 'agent' },
        { key: 'slug', header: 'slug' },
        { key: 'name', header: 'name' },
        { key: 'status', header: 'status' },
        { key: 'sourceIntegrity', header: 'source' },
        { key: 'latestVersion', header: 'latest' },
        { key: 'inconsistency', header: 'inconsistency' },
      ],
      { entityLabel: 'automation' }
    );
  }
}

async function show(target: string, opts: BaseOpts): Promise<void> {
  const packagePath = resolvePackagePath(target);
  const slug = packagePath.replace(/^agents\//, '');
  const client = new ApiClient(resolveConfig(opts));
  const payload = (await client.get(`/api/v1/agents/${encodeURIComponent(slug)}`, {
    include: 'files,dataset,runs',
  })) as ShowAgentPayload;
  if (opts.json) console.log(JSON.stringify(payload, null, 2));
  else {
    const agent = payload.agent;
    console.log(
      table(
        [
          {
            type: 'agent',
            slug: agent.slug ?? slug,
            path: packagePath,
            name: agent.name ?? '',
            status: agent.status ?? '',
            source: agent.sourceIntegrity ?? '',
            latest: agent.latestVersion ?? '',
            commit: agent.latestCommit ?? '',
          },
        ],
        [
          { key: 'type', header: 'type' },
          { key: 'slug', header: 'slug' },
          { key: 'path', header: 'path' },
          { key: 'name', header: 'name' },
          { key: 'status', header: 'status' },
          { key: 'source', header: 'source' },
          { key: 'latest', header: 'latest' },
          { key: 'commit', header: 'commit', format: (value) => String(value || '-').slice(0, 12) },
        ]
      )
    );
    if (agent.description) console.log(`\ndescription: ${agent.description}`);
    const runs = agent.recentRuns ?? agent.runs ?? [];
    console.log('\nrecent runs');
    console.log(
      table(runs.slice(0, 5), [
        { key: 'id', header: 'id' },
        { key: 'createdAt', header: 'time', format: (value) => formatTimestamp(value) },
        { key: 'durationMs', header: 'duration', format: (value) => formatDuration(Number(value)) },
        { key: 'triggeredBy', header: 'triggered-by' },
        { key: 'requestedVersion', header: 'requested' },
        { key: 'resolvedVersion', header: 'resolved' },
        { key: 'status', header: 'status' },
      ])
    );
  }
}

async function versions(target: string, opts: BaseOpts): Promise<void> {
  const packagePath = resolvePackagePath(target);
  const client = new ApiClient(resolveConfig(opts));
  const parsed = ReleasesSchema.parse(await client.get('/api/v1/source/releases', { packagePath }));
  const sorted = { ...parsed, releases: sortReleasesNewestFirst(parsed.releases) };
  if (opts.json) console.log(JSON.stringify(sorted, null, 2));
  else
    console.log(
      table(sorted.releases, [
        { key: 'version', header: 'version' },
        { key: 'tag', header: 'tag' },
        { key: 'commit', header: 'commit', format: (value) => String(value).slice(0, 12) },
        { key: 'date', header: 'date', format: (value) => formatTimestamp(value) },
      ])
    );
}

async function release(
  versionOrBump: string,
  dir: string | undefined,
  opts: BaseOpts & { message?: string }
): Promise<void> {
  const context = resolveGitSourceContext({ dir });
  if (!context.gitRoot || !context.packageRoot || !context.packagePath) {
    throw new Error('Run release inside a source package in an organization Git repo.');
  }
  const config = resolveConfig(opts);
  checkRepoVersion(context.gitRoot, true);
  const validation = validatePackage(context.packageRoot);
  if (!validation.valid)
    throw new Error(`Package validation failed: ${validation.errors.join('; ')}`);
  requirePackageClean(context);
  requirePushedMain(context.gitRoot, config);
  if (!opts.message) throw new Error('Release requires -m <message>.');
  const client = new ApiClient(config);
  const version = ['patch', 'minor', 'major'].includes(versionOrBump)
    ? bumpReleaseVersion(
        ReleasesSchema.parse(
          await client.get('/api/v1/source/releases', { packagePath: context.packagePath })
        ).releases,
        versionOrBump as 'patch' | 'minor' | 'major'
      )
    : versionOrBump;
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error('Release version must be X.Y.Z, patch, minor, or major.');
  }
  const existing = ReleasesSchema.parse(
    await client.get('/api/v1/source/releases', {
      packagePath: context.packagePath,
      version,
    })
  );
  if (existing.releases.length > 0) {
    throw new Error(`Release ${version} already exists for ${context.packagePath}.`);
  }
  const tag = formatReleaseTag(pathToDottedPackageName(context.packagePath), version);
  const authorEnv = await resolveGitAuthorEnv(config);
  runGit(['tag', '-a', tag, '-m', opts.message], { cwd: context.gitRoot, env: authorEnv });
  const remoteUrl = gitOutput(['remote', 'get-url', 'origin'], context.gitRoot);
  try {
    runGit(['push', 'origin', tag], {
      cwd: context.gitRoot,
      config,
      gitRemoteUrl: remoteUrl ?? undefined,
    });
  } catch (err) {
    runGit(['tag', '-d', tag], { cwd: context.gitRoot });
    throw err;
  }
  success(`Released ${tag}.`);
  await syncLatestAutomation(client, context.packagePath);
}

async function sync(target: string | undefined, opts: BaseOpts & ContextOpts): Promise<void> {
  const context = resolveGitSourceContext({ dir: opts.dir });
  const packagePath = target ? resolvePackagePath(target) : context.packagePath;
  if (!packagePath) {
    throw new Error('Pass an automation target or run sync inside a source package.');
  }
  if (target?.includes('@')) {
    throw new Error('Sync always uses latest; do not pass a versioned target.');
  }
  await syncLatestAutomation(new ApiClient(resolveConfig(opts)), packagePath);
}

function parseReleaseVersion(value: string): string {
  if (!/^\d+\.\d+\.\d+$/.test(value) && !['patch', 'minor', 'major'].includes(value)) {
    throw new InvalidArgumentError('version must be X.Y.Z, patch, minor, or major');
  }
  return value;
}

function parseType(value: string): string {
  if (!['agent', 'workflow'].includes(value))
    throw new InvalidArgumentError('type must be agent or workflow');
  return value;
}

export function registerGitCommands(program: Command): void {
  const git = program
    .command('git', { hidden: true })
    .description('Experimental Git-backed source commands.')
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .argument('[gitArgs...]', 'Git arguments after --')
    .action(
      action(async (gitArgs: string[] | undefined, opts: BaseOpts) =>
        gitPassthrough(gitArgs ?? [], opts)
      )
    );

  withBaseUrl(git.command('clone'))
    .description('Clone the organization source repository.')
    .option('--out <dir>', 'Output directory')
    .action(action(cloneSource));

  addJsonFlag(git.command('doctor'))
    .description('Check organization source repository health.')
    .option('--dir <dir>', 'Directory to inspect')
    .action(action(async (opts: BaseOpts & ContextOpts) => doctor(opts)));

  addJsonFlag(git.command('validate [dir]'))
    .description('Validate the nearest source package.')
    .action(action(async (dir: string | undefined, opts: BaseOpts) => validate({ ...opts, dir })));

  addJsonFlag(git.command('status'))
    .description('Show source repo and package status.')
    .option('--dir <dir>', 'Directory to inspect')
    .action(action(async (opts: BaseOpts & ContextOpts) => packageStatus(opts)));

  addJsonFlag(git.command('deps'))
    .description('List package workspace dependencies.')
    .option('--dir <dir>', 'Directory to inspect')
    .action(action(async (opts: BaseOpts & ContextOpts) => deps(opts)));

  git
    .command('clean')
    .description('Require a clean source working tree.')
    .option('--dir <dir>', 'Directory to inspect')
    .action(action(async (opts: BaseOpts & ContextOpts) => clean(opts)));

  addJsonFlag(withPagination(withBaseUrl(git.command('list')), 50))
    .description('List Git-backed automations.')
    .option('--type <type>', 'Filter by automation type', parseType)
    .option('--search <q>', 'Search by slug, name, or description')
    .option('--include-archived', 'Include archived automations')
    .action(action(list));

  addJsonFlag(withBaseUrl(git.command('show <automation>')))
    .description('Show Git-backed automation details.')
    .action(action(show));

  addJsonFlag(withBaseUrl(git.command('versions <package>')))
    .description('List package release versions.')
    .action(action(versions));

  withBaseUrl(git.command('release'))
    .description('Create and push a package release tag.')
    .argument('<version>', 'Version or bump level', parseReleaseVersion)
    .argument('[dir]', 'Package directory')
    .addOption(new Option('-m, --message <message>', 'Annotated tag message').makeOptionMandatory())
    .action(
      action(
        async (
          versionOrBump: string,
          dir: string | undefined,
          opts: BaseOpts & { message?: string }
        ) => release(versionOrBump, dir, opts)
      )
    );

  withBaseUrl(git.command('sync [automation]'))
    .description('Sync an automation from the latest Git source release.')
    .option('--dir <dir>', 'Directory to inspect')
    .action(action(sync));
}
