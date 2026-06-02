import {
  DottedPackageNameSchema,
  dottedPackageNameToPath,
  formatReleaseTag,
  parseReleaseTag,
  pathToDottedPackageName,
  ReleaseTagSchema,
  RootSourceManifestSchema,
  SOURCE_SECRETS_FILENAME,
  sourceLockfileInputHash,
  SourceManifestFilenameSchema,
  SourcePackageManifestSchema,
  SourcePackagePathSchema,
  SourceSecretsFileSchema,
  SourceVersionRefSchema,
  validateSourcePackageRequiredFiles,
  workspaceDependencyNameToPackagePath,
  type EncryptedSecretValue,
  type SourcePackageManifest,
  type SourcePackagePath,
  type SourceSecretsFile,
  type SourceVersionRef,
  type WorkspaceDependencyName,
} from '@eigenpal/types';
import { InvalidArgumentError, Option, type Command } from 'commander';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { z } from 'zod';
import { getProcessEnv } from '../env';
import { ApiClient } from '../lib/client';
import { requireApiKey, resolveConfig, type CliConfig } from '../lib/config';
import { exitDeprecatedCli } from '../lib/deprecation-forward';
import { action } from '../lib/format-error';
import {
  addJsonFlag,
  error,
  formatDuration,
  formatTimestamp,
  success,
  table,
  ui,
  warn,
  withBaseUrl,
} from '../lib/ui';

type BaseOpts = { baseUrl?: string; json?: boolean };
type SourceRepository = { gitRepositoryPath: string; remoteUrl: string };
type RuntimeInstallOpts = { remoteUrl?: string };
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
type ResolvedPackageContext = {
  gitRoot: string;
  packageRoot: string;
  packagePath: SourcePackagePath;
};
type InstallLockPackage = {
  packagePath: SourcePackagePath;
  requestedRef: SourceVersionRef;
  resolvedRef: string;
  resolvedTag?: string;
  commit: string;
  dependencies: InstallLockPackage[];
};
type InstallLockfile = {
  lockfileVersion: 1;
  eigenpalVersion: string;
  inputHash: string;
  root: InstallLockPackage;
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

const CommitShaSchema = z.string().regex(/^[0-9a-f]{40}$/);

const InstallLockPackageSchema: z.ZodType<InstallLockPackage> = z.lazy(() =>
  z.object({
    packagePath: SourcePackagePathSchema,
    requestedRef: SourceVersionRefSchema,
    resolvedRef: z.string().min(1),
    resolvedTag: z.string().min(1).optional(),
    commit: CommitShaSchema,
    dependencies: z.array(InstallLockPackageSchema),
  })
);

const InstallLockfileSchema: z.ZodType<InstallLockfile> = z.object({
  lockfileVersion: z.literal(1),
  eigenpalVersion: z.string().min(1),
  inputHash: z.string().min(1),
  root: InstallLockPackageSchema,
});

const AuthCheckSchema = z.object({
  ok: z.literal(true),
  email: z.string().email().nullable().optional(),
  name: z.string().nullable().optional(),
  keyId: z.string(),
});
const INSTALL_LOCKFILE_NAME = 'eigenpal.lock';

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

function runGitStrict(
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
  if (result.status && result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed with exit code ${result.status}`);
  }
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
  const env = getProcessEnv();
  if (
    env.GIT_AUTHOR_NAME &&
    env.GIT_AUTHOR_EMAIL &&
    env.GIT_COMMITTER_NAME &&
    env.GIT_COMMITTER_EMAIL
  ) {
    return {
      GIT_AUTHOR_NAME: env.GIT_AUTHOR_NAME,
      GIT_AUTHOR_EMAIL: env.GIT_AUTHOR_EMAIL,
      GIT_COMMITTER_NAME: env.GIT_COMMITTER_NAME,
      GIT_COMMITTER_EMAIL: env.GIT_COMMITTER_EMAIL,
    };
  }
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

function sourceRepositoryFromRemoteUrl(remoteUrl?: string): SourceRepository | null {
  if (!remoteUrl) return null;
  const parsed = SourceRepositorySchema.parse({ gitRepositoryPath: '', remoteUrl });
  const match = parsed.remoteUrl.match(/\/orgs\/([^/]+)\.git$/);
  return {
    gitRepositoryPath: match ? decodeURIComponent(match[1]) : '',
    remoteUrl: parsed.remoteUrl,
  };
}

async function getSourceRepository(
  config: CliConfig,
  opts: RuntimeInstallOpts = {}
): Promise<SourceRepository> {
  const explicit = sourceRepositoryFromRemoteUrl(opts.remoteUrl);
  if (explicit) return explicit;
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

function isOrganizationSourceGitRoot(gitRoot: string | null): gitRoot is string {
  if (!gitRoot) return false;
  return Boolean(gitOutput(['remote', 'get-url', 'origin'], gitRoot)?.match(/\/orgs\/[^/]+\.git$/));
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

function writeYamlFile(filePath: string, value: unknown): void {
  writeFileSync(filePath, YAML.stringify(value));
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

function readPackageManifest(packageRoot: string): SourcePackageManifest {
  return SourcePackageManifestSchema.parse(readYamlFile(path.join(packageRoot, 'eigenpal.yaml')));
}

function requirePackageContext(opts: ContextOpts = {}): ResolvedPackageContext {
  const context = resolveGitSourceContext(opts);
  if (!context.gitRoot || !context.packageRoot || !context.packagePath) {
    throw new Error('Run this command inside a source package, or pass --dir.');
  }
  return {
    gitRoot: context.gitRoot,
    packageRoot: context.packageRoot,
    packagePath: context.packagePath,
  };
}

function parsePackageRef(input: string): { packagePath: SourcePackagePath; ref: SourceVersionRef } {
  const [rawPackage, rawRef, extra] = input.split('@');
  if (!rawPackage || extra !== undefined) {
    throw new Error('Package ref must be <package>[@latest|main|version|range|commit].');
  }
  const packagePath = resolvePackagePath(rawPackage);
  const ref = SourceVersionRefSchema.parse(rawRef || 'latest');
  return { packagePath, ref };
}

function versionMatchesRange(version: string, range: string): boolean {
  const parts = semverParts(version);
  if (!parts) return false;
  const rangeParts = range.replace('*', 'x').split('.');
  if (String(parts[0]) !== rangeParts[0]) return false;
  if (rangeParts.length === 2) return rangeParts[1] === 'x';
  if (rangeParts.length !== 3) return false;
  if (rangeParts[1] === 'x') return true;
  return String(parts[1]) === rangeParts[1];
}

function listLocalPackageReleases(
  gitRoot: string,
  packagePath: SourcePackagePath
): SourceRelease[] {
  const tagPrefix = `${pathToDottedPackageName(packagePath)}@`;
  const output = gitOutput(['tag', '--list', `${tagPrefix}*`], gitRoot) ?? '';
  return output
    .split('\n')
    .map((tag) => tag.trim())
    .filter(Boolean)
    .map((tag) => {
      const parsed = parseReleaseTag(tag);
      const commit = gitOutput(['rev-list', '-n', '1', tag], gitRoot) ?? '';
      return { tag, version: parsed.version, commit };
    })
    .sort((left, right) => compareSemverDesc(left.version, right.version));
}

async function listPackageReleases(input: {
  config: CliConfig;
  gitRoot?: string | null;
  repository?: SourceRepository | null;
  packagePath: SourcePackagePath;
}): Promise<SourceRelease[]> {
  if (input.gitRoot) {
    const local = listLocalPackageReleases(input.gitRoot, input.packagePath);
    if (local.length > 0) return local;
  }
  if (input.repository?.remoteUrl) {
    const remote = listRemotePackageReleases(input.config, input.repository, input.packagePath);
    if (remote.length > 0) return remote;
  }
  const client = new ApiClient(input.config);
  return ReleasesSchema.parse(
    await client.get('/api/v1/source/releases', { packagePath: input.packagePath })
  ).releases;
}

function listRemotePackageReleases(
  config: CliConfig,
  repository: SourceRepository,
  packagePath: SourcePackagePath
): SourceRelease[] {
  const tagPrefix = `${pathToDottedPackageName(packagePath)}@`;
  const output =
    gitOutput(
      ['ls-remote', '--tags', repository.remoteUrl, `refs/tags/${tagPrefix}*`],
      undefined,
      config,
      repository.remoteUrl
    ) ?? '';
  const refs = output
    .split('\n')
    .map((line) => line.trim().split(/\s+/) as [string, string | undefined])
    .filter(([commit, ref]) => CommitShaSchema.safeParse(commit).success && ref);
  const peeledCommits = new Map(
    refs
      .filter(([, ref]) => ref?.startsWith('refs/tags/') && ref.endsWith('^{}'))
      .map(([commit, ref]) => [ref!.slice('refs/tags/'.length, -3), commit] as const)
  );
  return refs
    .filter(([, ref]) => ref?.startsWith('refs/tags/') && !ref.endsWith('^{}'))
    .map(([commit, ref]) => {
      const tag = ref!.slice('refs/tags/'.length);
      const parsed = ReleaseTagSchema.safeParse(tag);
      if (!parsed.success) return null;
      const release = parseReleaseTag(parsed.data);
      if (release.packagePath !== packagePath) return null;
      return {
        version: release.version,
        tag,
        commit: peeledCommits.get(tag) ?? commit,
      };
    })
    .filter((release): release is SourceRelease => release !== null)
    .sort((left, right) => compareSemverDesc(left.version, right.version));
}

function hostedArchiveRequest(input: {
  repository: SourceRepository;
  ref: string;
  packagePath: SourcePackagePath;
}): string | null {
  const match = input.repository.remoteUrl.match(/^(.*)\/orgs\/([^/]+)\.git$/);
  if (!match) return null;
  const [, baseUrl, gitRepositoryPath] = match;
  return `${baseUrl}/export/orgs/${encodeURIComponent(gitRepositoryPath)}/${encodeURIComponent(input.ref)}/${input.packagePath}`;
}

async function resolvePackageRef(input: {
  config: CliConfig;
  gitRoot?: string | null;
  repository?: SourceRepository | null;
  packagePath: SourcePackagePath;
  ref: SourceVersionRef;
}): Promise<{
  requestedRef: SourceVersionRef;
  resolvedRef: string;
  resolvedTag?: string;
  commit: string;
}> {
  if (input.ref === 'main' || /^[0-9a-f]{40}$/.test(input.ref)) {
    const commit = input.gitRoot
      ? gitOutput(['rev-parse', input.ref], input.gitRoot)
      : await resolveRemoteRefCommit(input.config, input.repository, input.ref);
    if (!commit) throw new Error(`Source ref ${input.ref} does not exist.`);
    return { requestedRef: input.ref, resolvedRef: input.ref, commit };
  }

  const releases = await listPackageReleases({
    config: input.config,
    gitRoot: input.gitRoot,
    repository: input.repository,
    packagePath: input.packagePath,
  });
  const release =
    input.ref === 'latest'
      ? sortReleasesNewestFirst(releases)[0]
      : /^\d+\.\d+\.\d+$/.test(input.ref)
        ? releases.find((candidate) => candidate.version === input.ref)
        : sortReleasesNewestFirst(releases).find((candidate) =>
            versionMatchesRange(candidate.version, input.ref)
          );
  if (!release) {
    throw new Error(`No release found for ${input.packagePath}@${input.ref}.`);
  }
  return {
    requestedRef: input.ref,
    resolvedRef: release.version,
    resolvedTag: release.tag,
    commit:
      release.commit ||
      (input.gitRoot ? (gitOutput(['rev-list', '-n', '1', release.tag], input.gitRoot) ?? '') : ''),
  };
}

async function resolveRemoteRefCommit(
  config: CliConfig,
  repository: SourceRepository | null | undefined,
  ref: SourceVersionRef
): Promise<string | null> {
  if (/^[0-9a-f]{40}$/.test(ref)) return ref;
  if (!repository?.remoteUrl) return null;
  const output = gitOutput(
    ['ls-remote', repository.remoteUrl, `refs/heads/${ref}`],
    undefined,
    config,
    repository.remoteUrl
  );
  const [commit] = output?.split(/\s+/) ?? [];
  return CommitShaSchema.safeParse(commit).success ? commit : null;
}

function archivePackage(input: {
  gitRoot: string;
  ref: string;
  packagePath: SourcePackagePath;
  outDir: string;
}): void {
  rmSync(input.outDir, { recursive: true, force: true });
  mkdirSync(input.outDir, { recursive: true });
  const tarPath = path.join(mkdtempSyncCompat('eigenpal-source-archive-'), 'package.tar');
  try {
    runGit(['archive', '--format=tar', `--output=${tarPath}`, input.ref, input.packagePath], {
      cwd: input.gitRoot,
    });
    const extract = spawnSync(
      'tar',
      ['-xf', tarPath, '--strip-components', String(input.packagePath.split('/').length)],
      {
        cwd: input.outDir,
        encoding: 'utf8',
      }
    );
    if (extract.status !== 0) throw new Error(extract.stderr.trim() || 'tar extraction failed');
  } finally {
    rmSync(path.dirname(tarPath), { recursive: true, force: true });
  }
}

async function tryHostedArchive(input: {
  config: CliConfig;
  gitRoot?: string | null;
  repository?: SourceRepository | null;
  ref: string;
  packagePath: SourcePackagePath;
  outDir: string;
}): Promise<boolean> {
  const repository =
    input.repository ??
    (input.gitRoot
      ? ({
          gitRepositoryPath: '',
          remoteUrl: gitOutput(['remote', 'get-url', 'origin'], input.gitRoot) ?? '',
        } satisfies SourceRepository)
      : null);
  if (!repository) return false;
  const url = hostedArchiveRequest({
    repository,
    ref: input.ref,
    packagePath: input.packagePath,
  });
  if (!url) return false;
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${requireApiKey(input.config)}` },
  }).catch(() => null);
  if (!response?.ok) return false;
  rmSync(input.outDir, { recursive: true, force: true });
  mkdirSync(input.outDir, { recursive: true });
  const tarPath = path.join(mkdtempSyncCompat('eigenpal-hosted-source-'), 'package.tar');
  try {
    writeFileSync(tarPath, Buffer.from(await response.arrayBuffer()));
    const extract = spawnSync(
      'tar',
      ['-xf', tarPath, '--strip-components', String(input.packagePath.split('/').length)],
      {
        cwd: input.outDir,
        encoding: 'utf8',
      }
    );
    if (extract.status !== 0) throw new Error(extract.stderr.trim() || 'tar extraction failed');
    return true;
  } finally {
    rmSync(path.dirname(tarPath), { recursive: true, force: true });
  }
}

function mkdtempSyncCompat(prefix: string): string {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

function dependencyInstallPath(parentRoot: string, packagePath: SourcePackagePath): string {
  const modulesRoot = path.resolve(parentRoot, 'eigenpal_modules');
  const destination = path.resolve(modulesRoot, packagePath);
  if (destination !== modulesRoot && !destination.startsWith(`${modulesRoot}${path.sep}`)) {
    throw new Error(`Dependency path escapes eigenpal_modules: ${packagePath}`);
  }
  return destination;
}

async function resolvePackageGraph(input: {
  config: CliConfig;
  gitRoot?: string | null;
  repository?: SourceRepository | null;
  packagePath: SourcePackagePath;
  ref: SourceVersionRef;
  seen?: string[];
}): Promise<InstallLockPackage> {
  const seen = input.seen ?? [];
  const key = `${input.packagePath}@${input.ref}`;
  if (seen.includes(key)) {
    throw new Error(`Dependency cycle detected: ${[...seen, key].join(' -> ')}`);
  }
  const resolved = await resolvePackageRef(input);
  const tempDir = await mkdtemp(path.join(tmpdir(), 'eigenpal-install-resolve-'));
  try {
    const packageRoot = path.join(tempDir, 'package');
    const ref = resolved.commit;
    if (input.gitRoot) {
      archivePackage({
        gitRoot: input.gitRoot,
        ref,
        packagePath: input.packagePath,
        outDir: packageRoot,
      });
    } else if (
      !(await tryHostedArchive({
        config: input.config,
        repository: input.repository,
        ref,
        packagePath: input.packagePath,
        outDir: packageRoot,
      }))
    ) {
      throw new Error(`Hosted source export unavailable for ${input.packagePath}@${ref}.`);
    }
    const manifest = readPackageManifest(packageRoot);
    const dependencies =
      'dependencies' in manifest ? Object.entries(manifest.dependencies ?? {}) : [];
    return {
      packagePath: input.packagePath,
      requestedRef: input.ref,
      resolvedRef: resolved.resolvedRef,
      ...(resolved.resolvedTag ? { resolvedTag: resolved.resolvedTag } : {}),
      commit: resolved.commit,
      dependencies: await Promise.all(
        dependencies.map(([dependencyName, version]) =>
          resolvePackageGraph({
            config: input.config,
            gitRoot: input.gitRoot,
            repository: input.repository,
            packagePath: workspaceDependencyNameToPackagePath(
              dependencyName as WorkspaceDependencyName
            ),
            ref: SourceVersionRefSchema.parse(version),
            seen: [...seen, key],
          })
        )
      ),
    };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function materializeLockPackage(input: {
  config: CliConfig;
  gitRoot?: string | null;
  repository?: SourceRepository | null;
  lockPackage: InstallLockPackage;
  outDir: string;
}): Promise<void> {
  const ref = input.lockPackage.commit;
  const usedHostedArchive = await tryHostedArchive({
    config: input.config,
    gitRoot: input.gitRoot,
    repository: input.repository,
    ref,
    packagePath: input.lockPackage.packagePath,
    outDir: input.outDir,
  });
  if (!usedHostedArchive) {
    if (!input.gitRoot) {
      throw new Error(
        `Hosted source export unavailable for ${input.lockPackage.packagePath}@${ref}.`
      );
    }
    warn(
      `Hosted source export unavailable for ${input.lockPackage.packagePath}; using local git archive.`
    );
    archivePackage({
      gitRoot: input.gitRoot,
      ref,
      packagePath: input.lockPackage.packagePath,
      outDir: input.outDir,
    });
  }
  const occupied = new Set<string>();
  for (const dependency of input.lockPackage.dependencies) {
    const dependencyPath = dependencyInstallPath(input.outDir, dependency.packagePath);
    if (occupied.has(dependencyPath)) {
      throw new Error(`Dependency conflict at ${dependencyPath}`);
    }
    occupied.add(dependencyPath);
    await materializeLockPackage({
      config: input.config,
      gitRoot: input.gitRoot,
      repository: input.repository,
      lockPackage: dependency,
      outDir: dependencyPath,
    });
  }
}

function writeLockfile(lockfilePath: string, lockfile: InstallLockfile): void {
  mkdirSync(path.dirname(lockfilePath), { recursive: true });
  writeFileSync(lockfilePath, `${JSON.stringify(lockfile, null, 2)}\n`);
}

function readLockfile(lockfilePath: string): InstallLockfile {
  const parsed = InstallLockfileSchema.safeParse(JSON.parse(readFileSync(lockfilePath, 'utf8')));
  if (!parsed.success) {
    throw new Error(
      `Invalid lockfile ${lockfilePath}: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`
    );
  }
  return parsed.data;
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

  if (context.packageRoot) {
    const secretsPath = path.join(context.packageRoot, SOURCE_SECRETS_FILENAME);
    if (existsSync(secretsPath)) {
      const secrets = SourceSecretsFileSchema.safeParse(readYamlFile(secretsPath));
      if (!secrets.success)
        errors.push(secrets.error.issues.map((issue) => issue.message).join('; '));
    }
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

function resolveAgentPackagePath(target: string): SourcePackagePath {
  if (target.includes('/') || target.includes('.')) return resolvePackagePath(target);
  return SourcePackagePathSchema.parse(`agents/${target}`);
}

function isAutomationPackagePath(packagePath: SourcePackagePath): boolean {
  return packagePath.startsWith('agents/') || packagePath.startsWith('workflows/');
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

function currentBranch(gitRoot: string): string {
  const branch = gitOutput(['rev-parse', '--abbrev-ref', 'HEAD'], gitRoot);
  if (!branch || branch === 'HEAD') {
    throw new Error('Cannot operate from detached HEAD; check out a branch first.');
  }
  return branch;
}

function requirePushedMain(gitRoot: string, config: CliConfig): void {
  const branch = currentBranch(gitRoot);
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

function checkoutOriginalBranch(gitRoot: string, branch: string): void {
  if (gitOutput(['rev-parse', '--abbrev-ref', 'HEAD'], gitRoot) === branch) return;
  runGitStrict(['checkout', branch], { cwd: gitRoot });
}

function mergeCurrentBranchToMain(input: {
  gitRoot: string;
  branch: string;
  config: CliConfig;
  authorEnv: GitAuthorEnv;
}): void {
  const remoteUrl = gitOutput(['remote', 'get-url', 'origin'], input.gitRoot);
  runGitStrict(['fetch', 'origin', 'main'], {
    cwd: input.gitRoot,
    config: input.config,
    gitRemoteUrl: remoteUrl ?? undefined,
  });
  const hasLocalMain = Boolean(
    gitOutput(['rev-parse', '--verify', 'refs/heads/main'], input.gitRoot)
  );
  runGitStrict(hasLocalMain ? ['checkout', 'main'] : ['checkout', '-b', 'main', 'origin/main'], {
    cwd: input.gitRoot,
  });
  runGitStrict(['pull', '--ff-only', 'origin', 'main'], {
    cwd: input.gitRoot,
    config: input.config,
    gitRemoteUrl: remoteUrl ?? undefined,
  });
  runGitStrict(['merge', '--no-edit', input.branch], {
    cwd: input.gitRoot,
    env: input.authorEnv,
  });
  runGitStrict(['push', 'origin', 'main'], {
    cwd: input.gitRoot,
    config: input.config,
    gitRemoteUrl: remoteUrl ?? undefined,
  });
}

async function syncLatestAutomation(
  client: ApiClient,
  packagePath: SourcePackagePath
): Promise<void> {
  const automation = pathToDottedPackageName(packagePath);
  await client.post(`/api/automations/${encodeURIComponent(automation)}/sync`);
  success(`Synced ${automation} to latest release.`);
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

const MOVED_FROM_GIT_SUBCOMMANDS = new Set([
  'clone',
  'install',
  'init',
  'pull',
  'commit',
  'save',
  'push',
  'upgrade',
  'doctor',
  'validate',
  'status',
  'deps',
  'clean',
  'show',
  'versions',
  'release',
  'sync',
  'secret',
]);

function forwardDeprecatedGitSubcommand(args: string[]): void {
  const subcommand = args[0];
  if (subcommand === 'trigger') {
    exitDeprecatedCli(
      'Trigger CLI removed. Edit triggers in eigenpal.yaml, then run eigenpal agents save, agents release, and agents sync.'
    );
  }
  if (subcommand === 'list') {
    exitDeprecatedCli(
      'eigenpal git list removed. Use eigenpal agents list for the agent registry, or browse packages in your cloned source repo.'
    );
  }
  if (!subcommand || !MOVED_FROM_GIT_SUBCOMMANDS.has(subcommand)) return;
  exitDeprecatedCli(`eigenpal git ${subcommand} removed. Use eigenpal agents ${subcommand}.`);
}

async function gitPassthrough(args: string[], opts: BaseOpts): Promise<void> {
  if (args.length === 0) {
    error('Pass Git arguments after `--`, for example `eigenpal git -- status`.');
    process.exit(2);
  }
  forwardDeprecatedGitSubcommand(args);
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
  const command = gitSubcommandFromArgs(args);
  if (!command) return false;
  if (command === 'tag' && args.some((arg) => arg === '-l' || arg === '--list')) return false;
  return objectCreatingCommands.has(command);
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

function gitSubcommandFromArgs(args: string[]): string | null {
  const optionsWithValue = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace']);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--') continue;
    if (optionsWithValue.has(arg)) {
      i += 1;
      continue;
    }
    if (
      arg.startsWith('--git-dir=') ||
      arg.startsWith('--work-tree=') ||
      arg.startsWith('--namespace=')
    ) {
      continue;
    }
    if (arg.startsWith('-')) continue;
    return arg;
  }
  return null;
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

  if (context.packageRoot && context.packageRoot !== context.gitRoot) {
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

export function validateSourcePackage(dir: string): {
  valid: boolean;
  errors: string[];
  packagePath?: string;
} {
  const context = resolveGitSourceContext({ dir });
  if (context.gitRoot) checkRepoVersion(context.gitRoot, false);
  return validatePackage(dir);
}

function packageStatus(opts: BaseOpts & ContextOpts): void {
  const context = resolveGitSourceContext(opts);
  if (context.gitRoot) checkRepoVersion(context.gitRoot, false);
  const isRepoRootStatus =
    context.gitRoot && context.packageRoot && context.gitRoot === context.packageRoot;
  const validation =
    context.packageRoot && !isRepoRootStatus ? validatePackage(context.packageRoot) : null;
  const gitStatusLines = context.gitRoot ? readGitStatusLines(context.gitRoot) : [];
  const branch = context.gitRoot ? currentBranchOrNull(context.gitRoot) : null;
  const upstream = context.gitRoot
    ? gitOutput(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], context.gitRoot)
    : null;
  const head = context.gitRoot ? gitOutput(['rev-parse', 'HEAD'], context.gitRoot) : null;
  const aheadOfMain = context.gitRoot ? countAheadOfMain(context.gitRoot) : null;
  const dirtyPackages = context.gitRoot ? dirtyPackagePaths(context.gitRoot) : [];
  const packages = dirtyPackages.map((packagePath) => {
    const packageValidation = validatePackage(path.join(context.gitRoot!, packagePath));
    return {
      packagePath,
      clean: false,
      valid: packageValidation.valid,
      errors: packageValidation.errors,
    };
  });
  if (
    context.gitRoot &&
    context.packagePath &&
    !packages.some((item) => item.packagePath === context.packagePath)
  ) {
    packages.push({
      packagePath: context.packagePath,
      clean: readGitStatusLines(context.gitRoot, [context.packagePath]).length === 0,
      valid:
        validation?.valid ??
        validatePackage(context.packageRoot ?? opts.dir ?? process.cwd()).valid,
      errors: validation?.errors ?? [],
    });
  }
  const payload = {
    gitRoot: context.gitRoot,
    packageRoot: context.packageRoot,
    packagePath: context.packagePath,
    branch,
    upstream,
    head,
    aheadOfMain,
    dirtyCount: gitStatusLines.length,
    clean: gitStatusLines.length === 0,
    valid: validation?.valid ?? null,
    errors: validation?.errors ?? [],
    packages,
  };
  if (opts.json) console.log(JSON.stringify(payload, null, 2));
  else {
    console.log(
      table(
        [payload],
        [
          { key: 'packagePath', header: 'package' },
          { key: 'branch', header: 'branch' },
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

async function show(target: string, opts: BaseOpts): Promise<void> {
  const packagePath = resolveAgentPackagePath(target);
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
  const resolvedContext: ResolvedPackageContext = {
    gitRoot: context.gitRoot,
    packageRoot: context.packageRoot,
    packagePath: context.packagePath,
  };
  const config = resolveConfig(opts);
  checkRepoVersion(resolvedContext.gitRoot, true);
  const validation = validatePackage(resolvedContext.packageRoot);
  if (!validation.valid)
    throw new Error(`Package validation failed: ${validation.errors.join('; ')}`);
  const releaseMessage = opts.message?.trim() || `Release ${resolvedContext.packagePath}`;
  const originalBranch = currentBranch(resolvedContext.gitRoot);
  const releaseFromMain = originalBranch === 'main';
  if (releaseFromMain) {
    requirePackageClean(resolvedContext);
    requirePushedMain(resolvedContext.gitRoot, config);
  } else {
    await commitSourceChanges({ config, context: resolvedContext, message: releaseMessage });
    await pushCurrentBranch({ config, gitRoot: resolvedContext.gitRoot });
  }
  const client = new ApiClient(config);
  const version = ['patch', 'minor', 'major'].includes(versionOrBump)
    ? bumpReleaseVersion(
        ReleasesSchema.parse(
          await client.get('/api/v1/source/releases', { packagePath: resolvedContext.packagePath })
        ).releases,
        versionOrBump as 'patch' | 'minor' | 'major'
      )
    : versionOrBump;
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error('Release version must be X.Y.Z, patch, minor, or major.');
  }
  const existing = ReleasesSchema.parse(
    await client.get('/api/v1/source/releases', {
      packagePath: resolvedContext.packagePath,
      version,
    })
  );
  if (existing.releases.length > 0) {
    throw new Error(`Release ${version} already exists for ${resolvedContext.packagePath}.`);
  }
  const authorEnv = await resolveGitAuthorEnv(config);
  if (!releaseFromMain) {
    try {
      mergeCurrentBranchToMain({
        gitRoot: resolvedContext.gitRoot,
        branch: originalBranch,
        config,
        authorEnv,
      });
      await tagAndSyncRelease({
        context: resolvedContext,
        config,
        client,
        version,
        message: releaseMessage,
        authorEnv,
      });
    } finally {
      checkoutOriginalBranch(resolvedContext.gitRoot, originalBranch);
    }
    return;
  }
  await tagAndSyncRelease({
    context: resolvedContext,
    config,
    client,
    version,
    message: releaseMessage,
    authorEnv,
  });
}

async function tagAndSyncRelease(input: {
  context: ResolvedPackageContext;
  config: CliConfig;
  client: ApiClient;
  version: string;
  message: string;
  authorEnv: GitAuthorEnv;
}): Promise<void> {
  const tag = formatReleaseTag(pathToDottedPackageName(input.context.packagePath), input.version);
  runGitStrict(['tag', '-a', tag, '-m', input.message], {
    cwd: input.context.gitRoot,
    env: input.authorEnv,
  });
  const remoteUrl = gitOutput(['remote', 'get-url', 'origin'], input.context.gitRoot);
  try {
    runGitStrict(['push', 'origin', tag], {
      cwd: input.context.gitRoot,
      config: input.config,
      gitRemoteUrl: remoteUrl ?? undefined,
    });
  } catch (err) {
    runGitStrict(['tag', '-d', tag], { cwd: input.context.gitRoot });
    throw err;
  }
  success(`Released ${tag}.`);
  if (isAutomationPackagePath(input.context.packagePath)) {
    await syncLatestAutomation(input.client, input.context.packagePath);
  }
}

async function sync(target: string | undefined, opts: BaseOpts & ContextOpts): Promise<void> {
  const context = resolveGitSourceContext({ dir: opts.dir });
  if (target?.includes('@')) {
    throw new Error('Sync always uses latest; do not pass a versioned target.');
  }
  const packagePath = target ? resolveAgentPackagePath(target) : context.packagePath;
  if (!packagePath) {
    throw new Error('Pass an automation target or run sync inside a source package.');
  }
  if (!isAutomationPackagePath(packagePath)) {
    throw new Error('Sync only supports agent and workflow packages.');
  }
  await syncLatestAutomation(new ApiClient(resolveConfig(opts)), packagePath);
}

function readSecretsFile(packageRoot: string): SourceSecretsFile {
  const filePath = path.join(packageRoot, SOURCE_SECRETS_FILENAME);
  if (!existsSync(filePath)) return { schemaVersion: 1, secrets: {} };
  return SourceSecretsFileSchema.parse(readYamlFile(filePath));
}

function writeSecretsFile(packageRoot: string, value: SourceSecretsFile): void {
  const secretsFile = SourceSecretsFileSchema.parse(value);
  writeYamlFile(path.join(packageRoot, SOURCE_SECRETS_FILENAME), secretsFile);
}

async function readSecretInput(opts: { stdin?: boolean; valueFile?: string }): Promise<string> {
  const selected = [opts.stdin, opts.valueFile].filter(Boolean).length;
  if (selected > 1) throw new Error('Pass only one of --stdin or --value-file.');
  if (opts.stdin) return readFileSync(0, 'utf8').replace(/\n$/, '');
  if (opts.valueFile) return readFileSync(opts.valueFile, 'utf8').replace(/\n$/, '');
  if (process.stdin.isTTY && process.stdout.isTTY) {
    const { password, isCancel, cancel } = await import('@clack/prompts');
    const answer = await password({ message: 'Secret value' });
    if (isCancel(answer)) {
      cancel('Cancelled');
      process.exit(1);
    }
    return String(answer);
  }
  throw new Error('Secret value input is required in noninteractive mode.');
}

async function encryptSecretsViaApi(
  client: ApiClient,
  secrets: Array<{ sourcePath: string; secretName: string; plaintext: string }>
): Promise<Record<string, EncryptedSecretValue>> {
  const payload = (await client.post('/api/v1/source/secrets/encrypt', { secrets })) as {
    secrets?: Record<string, EncryptedSecretValue>;
  };
  return payload.secrets ?? {};
}

async function setSecret(
  name: string,
  opts: ContextOpts & {
    stdin?: boolean;
    valueFile?: string;
    description?: string;
    baseUrl?: string;
  }
): Promise<void> {
  const context = requirePackageContext(opts);
  const config = resolveConfig(opts);
  requireApiKey(config);
  const client = new ApiClient(config);
  const sourcePath = `${context.packagePath}/${SOURCE_SECRETS_FILENAME}`;
  const encryptedByName = await encryptSecretsViaApi(client, [
    {
      sourcePath,
      secretName: name,
      plaintext: await readSecretInput(opts),
    },
  ]);
  const encrypted = encryptedByName[name];
  if (!encrypted) throw new Error('Server did not return encrypted secret.');
  const secretsFile = readSecretsFile(context.packageRoot);
  const secrets = { ...secretsFile.secrets };
  secrets[name] = {
    ...(opts.description ? { description: opts.description } : {}),
    encrypted,
  };
  writeSecretsFile(context.packageRoot, { schemaVersion: 1, secrets });
  success(`Encrypted ${ui.bold(name)} into secrets.enc.yaml.`);
}

function unsetSecret(name: string, opts: ContextOpts): void {
  const context = requirePackageContext(opts);
  const secretsFile = readSecretsFile(context.packageRoot);
  const secrets = { ...secretsFile.secrets };
  delete secrets[name];
  writeSecretsFile(context.packageRoot, { schemaVersion: 1, secrets });
  success(`Removed ${ui.bold(name)} from secrets.enc.yaml.`);
}

async function importSecrets(
  envFile: string,
  opts: Parameters<typeof setSecret>[1]
): Promise<void> {
  const context = requirePackageContext(opts);
  const config = resolveConfig(opts);
  requireApiKey(config);
  const client = new ApiClient(config);
  const sourcePath = `${context.packagePath}/${SOURCE_SECRETS_FILENAME}`;
  const entries: Array<{ sourcePath: string; secretName: string; plaintext: string }> = [];
  const content = readFileSync(envFile, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    entries.push({
      sourcePath,
      secretName: trimmed.slice(0, idx),
      plaintext: trimmed.slice(idx + 1),
    });
  }
  if (entries.length === 0) return;
  const encryptedByName = await encryptSecretsViaApi(client, entries);
  const secretsFile = readSecretsFile(context.packageRoot);
  const secrets = { ...secretsFile.secrets };
  for (const entry of entries) {
    const encrypted = encryptedByName[entry.secretName];
    if (!encrypted) {
      throw new Error(`Server did not return encrypted secret for ${entry.secretName}.`);
    }
    secrets[entry.secretName] = { encrypted };
  }
  writeSecretsFile(context.packageRoot, { schemaVersion: 1, secrets });
  success(`Imported ${ui.bold(String(entries.length))} secret(s) into secrets.enc.yaml.`);
}

async function install(
  packageRef: string | undefined,
  opts: BaseOpts &
    RuntimeInstallOpts & { out?: string; lockfile?: string; frozenLockfile?: boolean }
): Promise<void> {
  const config = resolveConfig(opts);
  const context = resolveGitSourceContext();
  const sourceGitRoot = isOrganizationSourceGitRoot(context.gitRoot) ? context.gitRoot : null;
  if (sourceGitRoot) checkRepoVersion(sourceGitRoot, false);

  const installFromLock = async (
    lockfilePath: string,
    packageDestination: string | null,
    explicitRef: boolean,
    repository?: SourceRepository | null,
    expectedPackagePath?: SourcePackagePath | null,
    explicitGitRoot?: string | null
  ): Promise<void> => {
    const lockfile = readLockfile(lockfilePath);
    if (expectedPackagePath && lockfile.root.packagePath !== expectedPackagePath) {
      throw new Error(
        `Lockfile root package ${lockfile.root.packagePath} does not match requested package ${expectedPackagePath}.`
      );
    }
    const destination = explicitRef
      ? path.resolve(opts.out ?? path.basename(lockfile.root.packagePath))
      : packageDestination;
    if (!destination) throw new Error('No package context found for lockfile install.');
    const lockInstallGitRoot = explicitRef ? (explicitGitRoot ?? sourceGitRoot) : context.gitRoot;
    if (explicitRef) {
      await materializeLockPackage({
        config,
        gitRoot: lockInstallGitRoot,
        repository,
        lockPackage: lockfile.root,
        outDir: destination,
      });
      writeLockfile(path.join(destination, '.eigenpal', INSTALL_LOCKFILE_NAME), lockfile);
    } else {
      rmSync(path.join(destination, 'eigenpal_modules'), { recursive: true, force: true });
      for (const dependency of lockfile.root.dependencies) {
        await materializeLockPackage({
          config,
          gitRoot: lockInstallGitRoot,
          repository,
          lockPackage: dependency,
          outDir: dependencyInstallPath(destination, dependency.packagePath),
        });
      }
    }
    success(`Installed from lockfile ${lockfilePath}.`);
  };

  if (opts.frozenLockfile) {
    const explicitRef = Boolean(packageRef);
    const expectedPackagePath = packageRef ? parsePackageRef(packageRef).packagePath : null;
    const explicitGitRoot =
      explicitRef && expectedPackagePath && context.gitRoot
        ? packageManifestExists(context.gitRoot, expectedPackagePath)
          ? context.gitRoot
          : sourceGitRoot
        : sourceGitRoot;
    const repository =
      explicitRef && !explicitGitRoot ? await getSourceRepository(config, opts) : null;
    const lockfilePath =
      opts.lockfile ??
      path.join(
        packageRef && opts.out ? path.resolve(opts.out) : (context.packageRoot ?? process.cwd()),
        '.eigenpal',
        INSTALL_LOCKFILE_NAME
      );
    if (!explicitRef) {
      if (!context.packageRoot || !context.packagePath) {
        throw new Error(
          'Run eigenpal agents install --frozen-lockfile inside a source package or pass a package ref.'
        );
      }
      const manifest = readPackageManifest(context.packageRoot);
      const dependencies =
        'dependencies' in manifest ? Object.entries(manifest.dependencies ?? {}) : [];
      const inputHash = sourceLockfileInputHash({ packagePath: context.packagePath, dependencies });
      const existing = readLockfile(lockfilePath);
      if (existing.inputHash !== inputHash) {
        throw new Error(`Existing lockfile ${lockfilePath} does not match current package inputs.`);
      }
    } else if (packageRef) {
      const existing = readLockfile(lockfilePath);
      const inputHash = sourceLockfileInputHash({ packageRef });
      if (existing.inputHash !== inputHash) {
        throw new Error(`Existing lockfile ${lockfilePath} does not match requested package ref.`);
      }
    }
    await installFromLock(
      lockfilePath,
      context.packageRoot,
      explicitRef,
      repository,
      expectedPackagePath,
      explicitGitRoot
    );
    return;
  }

  if (packageRef) {
    const parsed = parsePackageRef(packageRef);
    const explicitGitRoot =
      context.gitRoot && packageManifestExists(context.gitRoot, parsed.packagePath)
        ? context.gitRoot
        : sourceGitRoot;
    const repository = explicitGitRoot ? null : await getSourceRepository(config, opts);
    if (parsed.ref === 'main') warn('Installing @main uses draft source and is not reproducible.');
    const intendedLockfile =
      opts.lockfile ??
      path.join(
        path.resolve(opts.out ?? path.basename(parsed.packagePath)),
        '.eigenpal',
        INSTALL_LOCKFILE_NAME
      );
    const inputHash = sourceLockfileInputHash({ packageRef });
    if (existsSync(intendedLockfile)) {
      const existing = readLockfile(intendedLockfile);
      if (existing.inputHash !== inputHash) {
        throw new Error(
          `Existing lockfile ${intendedLockfile} does not match requested package ref.`
        );
      }
      await installFromLock(
        intendedLockfile,
        null,
        true,
        repository,
        parsed.packagePath,
        explicitGitRoot
      );
      return;
    }
    const lockRoot = await resolvePackageGraph({
      config,
      gitRoot: explicitGitRoot,
      repository,
      packagePath: parsed.packagePath,
      ref: parsed.ref,
    });
    const outDir = path.resolve(opts.out ?? path.basename(parsed.packagePath));
    await materializeLockPackage({
      config,
      gitRoot: explicitGitRoot,
      repository,
      lockPackage: lockRoot,
      outDir,
    });
    const lockfile: InstallLockfile = {
      lockfileVersion: 1,
      eigenpalVersion: '1.0.0',
      inputHash,
      root: lockRoot,
    };
    writeLockfile(intendedLockfile, lockfile);
    success(`Installed ${parsed.packagePath}@${lockRoot.resolvedRef} into ${outDir}.`);
    return;
  }

  if (!context.packageRoot || !context.packagePath) {
    throw new Error('Run eigenpal agents install inside a source package or pass a package ref.');
  }
  if (!context.gitRoot) {
    throw new Error('Run eigenpal agents install inside an organization source repository.');
  }
  const manifest = readPackageManifest(context.packageRoot);
  const dependencies =
    'dependencies' in manifest ? Object.entries(manifest.dependencies ?? {}) : [];
  const inputHash = sourceLockfileInputHash({ packagePath: context.packagePath, dependencies });
  const intendedLockfile =
    opts.lockfile ?? path.join(context.packageRoot, '.eigenpal', INSTALL_LOCKFILE_NAME);
  if (existsSync(intendedLockfile)) {
    const existing = readLockfile(intendedLockfile);
    if (existing.inputHash !== inputHash) {
      throw new Error(
        `Existing lockfile ${intendedLockfile} does not match current package inputs.`
      );
    }
    await installFromLock(intendedLockfile, context.packageRoot, false);
    return;
  }
  const root: InstallLockPackage = {
    packagePath: context.packagePath,
    requestedRef: 'main',
    resolvedRef: 'main',
    commit: gitOutput(['rev-parse', 'HEAD'], context.gitRoot) ?? '',
    dependencies: await Promise.all(
      dependencies.map(([dependencyName, version]) =>
        resolvePackageGraph({
          config,
          gitRoot: context.gitRoot!,
          packagePath: workspaceDependencyNameToPackagePath(
            dependencyName as WorkspaceDependencyName
          ),
          ref: SourceVersionRefSchema.parse(version),
        })
      )
    ),
  };
  rmSync(path.join(context.packageRoot, 'eigenpal_modules'), { recursive: true, force: true });
  for (const dependency of root.dependencies) {
    await materializeLockPackage({
      config,
      gitRoot: context.gitRoot,
      lockPackage: dependency,
      outDir: dependencyInstallPath(context.packageRoot, dependency.packagePath),
    });
  }
  const lockfile: InstallLockfile = {
    lockfileVersion: 1,
    eigenpalVersion: '1.0.0',
    inputHash,
    root,
  };
  writeLockfile(intendedLockfile, lockfile);
  success(`Installed ${root.dependencies.length} dependencies for ${context.packagePath}.`);
}

function slugifyPackageSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function packagePathForTemplate(template: string, name: string): SourcePackagePath {
  const slug = slugifyPackageSegment(name);
  if (!slug) throw new Error('Package name must include at least one letter or number.');
  const rootByTemplate: Record<string, string> = {
    agent: 'agents',
    workflow: 'workflows',
    skill: 'resources/skills',
    rule: 'resources/rules',
    knowledge: 'resources/knowledge',
    evaluator: 'evaluators',
  };
  const root = rootByTemplate[template];
  if (!root)
    throw new Error('Template must be agent, workflow, skill, rule, knowledge, or evaluator.');
  return SourcePackagePathSchema.parse(`${root}/${slug}`);
}

function writePackageScaffold(
  packageRoot: string,
  packagePath: SourcePackagePath,
  name: string
): void {
  const [root, resourceKind] = packagePath.split('/');
  mkdirSync(packageRoot, { recursive: true });
  const title = name.trim();
  writeFileSync(
    path.join(packageRoot, 'eigenpal.yaml'),
    YAML.stringify({ schemaVersion: 1, name: title || path.basename(packagePath) })
  );
  if (root === 'agents') writeFileSync(path.join(packageRoot, 'AGENT.md'), `# ${title}\n\n`);
  if (root === 'evaluators') {
    writeFileSync(
      path.join(packageRoot, 'evaluator.yaml'),
      YAML.stringify({ schemaVersion: 1, type: 'exact-diff', config: {} })
    );
  }
  if (root === 'resources' && resourceKind === 'skills') {
    writeFileSync(path.join(packageRoot, 'SKILL.md'), `# ${title}\n\n`);
  }
  if (root === 'resources' && (resourceKind === 'rules' || resourceKind === 'knowledge')) {
    writeFileSync(path.join(packageRoot, 'README.md'), `# ${title}\n\n`);
  }
}

function initPackage(name: string, opts: { template: string; dir?: string }): void {
  const startDir = path.resolve(opts.dir ?? process.cwd());
  const gitRoot = resolveGitRoot(startDir) ?? startDir;
  mkdirSync(gitRoot, { recursive: true });
  if (!existsSync(path.join(gitRoot, '.git'))) runGit(['init', '-b', 'main', gitRoot]);
  if (!existsSync(path.join(gitRoot, 'eigenpal.yaml'))) {
    writeFileSync(
      path.join(gitRoot, 'eigenpal.yaml'),
      'schemaVersion: 1\neigenpalVersion: 1.0.0\n'
    );
  }
  const gitignorePath = path.join(gitRoot, '.gitignore');
  const gitignore = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf8') : '';
  const additions = ['.eigenpal/', 'eigenpal_modules/'].filter(
    (entry) => !gitignore.includes(entry)
  );
  if (additions.length > 0)
    writeFileSync(
      gitignorePath,
      `${gitignore}${gitignore.endsWith('\n') || !gitignore ? '' : '\n'}${additions.join('\n')}\n`
    );
  const packagePath = packagePathForTemplate(opts.template, name);
  const packageRoot = path.join(gitRoot, packagePath);
  if (existsSync(packageRoot)) throw new Error(`Package already exists: ${packagePath}`);
  writePackageScaffold(packageRoot, packagePath, name);
  success(`Created ${packagePath}.`);
}

async function pullSource(opts: BaseOpts & { dir?: string }): Promise<void> {
  const config = resolveConfig(opts);
  const context = resolveGitSourceContext({ dir: opts.dir });
  if (!context.gitRoot) throw new Error('Not inside a Git repository.');
  const remoteUrl = gitOutput(['remote', 'get-url', 'origin'], context.gitRoot);
  runGit(['pull', '--ff-only', 'origin', 'main'], {
    cwd: context.gitRoot,
    config,
    gitRemoteUrl: remoteUrl ?? undefined,
  });
}

function readGitStatusLines(gitRoot: string, pathspec: string[] = []): string[] {
  const status =
    gitOutput(
      [
        'status',
        '--porcelain',
        '--untracked-files=all',
        ...(pathspec.length ? ['--', ...pathspec] : []),
      ],
      gitRoot
    ) ?? '';
  return status.split('\n').filter(Boolean);
}

function currentBranchOrNull(gitRoot: string): string | null {
  const branch = gitOutput(['rev-parse', '--abbrev-ref', 'HEAD'], gitRoot);
  return branch && branch !== 'HEAD' ? branch : null;
}

function countAheadOfMain(gitRoot: string): number | null {
  const base = gitOutput(['rev-parse', '--verify', 'origin/main'], gitRoot)
    ? 'origin/main'
    : gitOutput(['rev-parse', '--verify', 'main'], gitRoot)
      ? 'main'
      : null;
  if (!base) return null;
  const count = gitOutput(['rev-list', '--count', `${base}..HEAD`], gitRoot);
  return count ? Number(count) : null;
}

function statusPath(line: string): string {
  return line.slice(2).trim().split(' -> ').pop()!.replace(/\\/g, '/');
}

function dirtyPackagePaths(gitRoot: string): SourcePackagePath[] {
  const packagePaths = new Set<SourcePackagePath>();
  for (const line of readGitStatusLines(gitRoot)) {
    const file = statusPath(line);
    const parts = file.split('/');
    for (let index = parts.length; index >= 2; index -= 1) {
      const candidate = parts.slice(0, index).join('/');
      if (
        SourcePackagePathSchema.safeParse(candidate).success &&
        existsSync(path.join(gitRoot, candidate, 'eigenpal.yaml'))
      ) {
        packagePaths.add(candidate as SourcePackagePath);
        break;
      }
    }
  }
  return [...packagePaths].sort();
}

function dirtyRootFiles(gitRoot: string): string[] {
  return readGitStatusLines(gitRoot, ['eigenpal.yaml', '.gitignore'])
    .map(statusPath)
    .filter((file) => file === 'eigenpal.yaml' || file === '.gitignore');
}

function hasDirtySharedResources(gitRoot: string): boolean {
  return readGitStatusLines(gitRoot, ['resources']).length > 0;
}

async function commitSourceChanges(input: {
  config: CliConfig;
  context: PackageContext;
  message?: string;
}): Promise<boolean> {
  if (!input.context.gitRoot) throw new Error('Not inside a Git repository.');
  const packagePaths = dirtyPackagePaths(input.context.gitRoot);
  const sharedPaths = hasDirtySharedResources(input.context.gitRoot) ? ['resources'] : [];
  const rootFiles = dirtyRootFiles(input.context.gitRoot);
  if (packagePaths.length === 0 && sharedPaths.length === 0 && rootFiles.length === 0) {
    warn('No source package or shared resource changes to commit.');
    return false;
  }
  if (!input.message) {
    throw new Error('Commit requires -m <message> when source changes are dirty.');
  }
  for (const packagePath of packagePaths) {
    const validation = validatePackage(path.join(input.context.gitRoot, packagePath));
    if (!validation.valid) {
      throw new Error(
        `Package validation failed for ${packagePath}: ${validation.errors.join('; ')}`
      );
    }
  }
  runGit(['add', ...rootFiles, ...packagePaths, ...sharedPaths], { cwd: input.context.gitRoot });
  const authorEnv = await resolveGitAuthorEnv(input.config);
  runGit(['commit', '-m', input.message], { cwd: input.context.gitRoot, env: authorEnv });
  return true;
}

async function commitSource(opts: BaseOpts & { message?: string; dir?: string }): Promise<void> {
  const config = resolveConfig(opts);
  const context = resolveGitSourceContext({ dir: opts.dir });
  if (!context.gitRoot) throw new Error('Not inside a Git repository.');
  checkRepoVersion(context.gitRoot, true);
  await commitSourceChanges({ config, context, message: opts.message });
}

async function saveSource(opts: BaseOpts & { message?: string; dir?: string }): Promise<void> {
  const config = resolveConfig(opts);
  const context = resolveGitSourceContext({ dir: opts.dir });
  if (!context.gitRoot) throw new Error('Not inside a Git repository.');
  checkRepoVersion(context.gitRoot, true);
  await commitSourceChanges({ config, context, message: opts.message });
  await pushCurrentBranch({ config, gitRoot: context.gitRoot });
  success('Saved source branch.');
}

async function pushCurrentBranch(input: { config: CliConfig; gitRoot: string }): Promise<void> {
  const branch = currentBranch(input.gitRoot);
  if (!branch) {
    throw new Error('Cannot push from detached HEAD; check out a branch first.');
  }
  const remoteUrl = gitOutput(['remote', 'get-url', 'origin'], input.gitRoot);
  runGit(['push', '-u', 'origin', 'HEAD', '--follow-tags'], {
    cwd: input.gitRoot,
    config: input.config,
    gitRemoteUrl: remoteUrl ?? undefined,
  });
}

async function pushSource(opts: BaseOpts & { dir?: string }): Promise<void> {
  const config = resolveConfig(opts);
  const context = resolveGitSourceContext({ dir: opts.dir });
  if (!context.gitRoot) throw new Error('Not inside a Git repository.');
  await pushCurrentBranch({ config, gitRoot: context.gitRoot });
}

function upgradeSource(opts: { dir?: string; dryRun?: boolean }): void {
  const context = resolveGitSourceContext({ dir: opts.dir });
  if (!context.gitRoot) throw new Error('Not inside a Git repository.');
  const manifestPath = path.join(context.gitRoot, 'eigenpal.yaml');
  const manifest = readRootManifest(context.gitRoot);
  if (!manifest.ok) throw new Error(manifest.error);
  if (manifest.version === '1.0.0') {
    success('Repository source schema is already 1.0.0.');
    return;
  }
  if (opts.dryRun) {
    console.log(`Would upgrade repository source schema from ${manifest.version} to 1.0.0.`);
    return;
  }
  console.log('Source repository changelog:');
  console.log(`- ${manifest.version} -> 1.0.0: normalize root eigenpal.yaml schema version.`);
  writeFileSync(manifestPath, 'schemaVersion: 1\neigenpalVersion: 1.0.0\n');
  doctor({
    dir: context.packagePath && context.packageRoot ? context.packageRoot : context.gitRoot,
  });
  success(`Upgraded repository source schema from ${manifest.version} to 1.0.0.`);
}

function parseReleaseVersion(value: string): string {
  if (!/^\d+\.\d+\.\d+$/.test(value) && !['patch', 'minor', 'major'].includes(value)) {
    throw new InvalidArgumentError('version must be X.Y.Z, patch, minor, or major');
  }
  return value;
}

function parseTemplate(value: string): string {
  if (!['agent', 'workflow', 'skill', 'rule', 'knowledge', 'evaluator'].includes(value)) {
    throw new InvalidArgumentError(
      'template must be agent, workflow, skill, rule, knowledge, or evaluator'
    );
  }
  return value;
}

export function registerAgentSourceCommands(agent: Command): void {
  withBaseUrl(agent.command('clone'))
    .description('Clone the organization source repository.')
    .option('--out <dir>', 'Output directory')
    .action(action(cloneSource));

  withBaseUrl(agent.command('install [packageRef]'))
    .description('Materialize a source package and its workspace dependencies.')
    .option('--out <dir>', 'Output directory for an explicit package ref')
    .option('--lockfile <path>', 'Lockfile path')
    .option('--frozen-lockfile', 'Install exactly from the existing lockfile')
    .option('--remote-url <url>', 'Use an explicit organization Git remote URL')
    .action(action(install));

  agent
    .command('init <name>')
    .description('Create a new source package scaffold.')
    .addOption(
      new Option('--template <template>', 'Package template')
        .argParser(parseTemplate)
        .makeOptionMandatory()
    )
    .option('--dir <dir>', 'Repository directory')
    .action(
      action(async (name: string, opts: { template: string; dir?: string }) =>
        initPackage(name, opts)
      )
    );

  withBaseUrl(agent.command('pull'))
    .description(
      'Pull organization source from origin/main with --ff-only. For datasets use agents dataset pull; for run artifacts use agents runs pull.'
    )
    .option('--dir <dir>', 'Repository directory')
    .action(action(pullSource));

  withBaseUrl(agent.command('commit'))
    .description('Validate changed source packages and commit them.')
    .addOption(new Option('-m, --message <message>', 'Commit message').makeOptionMandatory())
    .option('--dir <dir>', 'Repository directory')
    .action(action(commitSource));

  withBaseUrl(agent.command('save'))
    .description('Validate, commit if dirty, and push the current source branch.')
    .option('-m, --message <message>', 'Commit message when source changes are dirty')
    .option('--dir <dir>', 'Repository directory')
    .action(action(saveSource));

  withBaseUrl(agent.command('push'))
    .description('Push the current organization source branch and tags.')
    .option('--dir <dir>', 'Repository directory')
    .action(action(pushSource));

  agent
    .command('upgrade')
    .description('Upgrade the source repository schema in place.')
    .option('--dir <dir>', 'Repository directory')
    .option('--dry-run', 'Print upgrade actions without changing files')
    .action(action(async (opts: { dir?: string; dryRun?: boolean }) => upgradeSource(opts)));

  addJsonFlag(agent.command('doctor'))
    .description('Check organization source repository health.')
    .option('--dir <dir>', 'Directory to inspect')
    .action(action(async (opts: BaseOpts & ContextOpts) => doctor(opts)));

  addJsonFlag(agent.command('status'))
    .description('Show source repo and package status.')
    .option('--dir <dir>', 'Directory to inspect')
    .action(action(async (opts: BaseOpts & ContextOpts) => packageStatus(opts)));

  addJsonFlag(agent.command('deps'))
    .description('List package workspace dependencies.')
    .option('--dir <dir>', 'Directory to inspect')
    .action(action(async (opts: BaseOpts & ContextOpts) => deps(opts)));

  agent
    .command('clean')
    .description('Require a clean source working tree.')
    .option('--dir <dir>', 'Directory to inspect')
    .action(action(async (opts: BaseOpts & ContextOpts) => clean(opts)));

  addJsonFlag(withBaseUrl(agent.command('show <automation>')))
    .description('Show Git-backed automation details.')
    .action(action(show));

  addJsonFlag(withBaseUrl(agent.command('versions <package>')))
    .description('List package release versions.')
    .action(action(versions));

  withBaseUrl(agent.command('release'))
    .description(
      'Create and push an immutable package release tag. Never move or overwrite an existing tag; release a new patch instead.'
    )
    .argument(
      '<version>',
      'Version (X.Y.Z) or bump level (patch, minor, major)',
      parseReleaseVersion
    )
    .argument('[dir]', 'Package directory')
    .option('-m, --message <message>', 'Annotated tag message (default: Release <packagePath>)')
    .action(
      action(
        async (
          versionOrBump: string,
          dir: string | undefined,
          opts: BaseOpts & { message?: string }
        ) => release(versionOrBump, dir, opts)
      )
    );

  withBaseUrl(agent.command('sync [automation]'))
    .description('Sync an automation from the latest Git source release.')
    .option('--dir <dir>', 'Directory to inspect')
    .action(action(sync));

  const secret = agent.command('secret').description('Edit encrypted secrets.enc.yaml.');
  secret
    .command('set <name>')
    .description('Encrypt and set a secret value in secrets.enc.yaml.')
    .option('--dir <dir>', 'Directory to inspect')
    .option('--stdin', 'Read the secret value from stdin')
    .option('--value-file <path>', 'Read the secret value from a file')
    .option('--description <text>', 'Secret description')
    .action(action(setSecret));
  secret
    .command('unset <name>')
    .description('Remove a secret from secrets.enc.yaml.')
    .option('--dir <dir>', 'Directory to inspect')
    .action(action(async (name: string, opts: ContextOpts) => unsetSecret(name, opts)));
  secret
    .command('import <env-file>')
    .description('Import KEY=value entries from an env file into secrets.enc.yaml.')
    .option('--dir <dir>', 'Directory to inspect')
    .action(action(importSecrets));
}

export function registerGitCommands(program: Command): void {
  program
    .command('git')
    .description('Passthrough to git with organization remote auth and committer identity.')
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .argument('[gitArgs...]', 'Git arguments after --')
    .action(
      action(async (gitArgs: string[] | undefined, opts: BaseOpts) =>
        gitPassthrough(gitArgs ?? [], opts)
      )
    );
}
