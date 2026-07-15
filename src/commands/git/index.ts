import {
  DottedPackageNameSchema,
  dottedPackageNameToPath,
  formatReleaseTag,
  parseReleaseTag,
  pathToDottedPackageName,
  ReleaseTagSchema,
  sourceLockfileInputHash,
  SourcePackagePathSchema,
  SourceVersionRefSchema,
  workspaceDependencyNameToPackagePath,
  type SourcePackagePath,
  type SourceVersionRef,
  type WorkspaceDependencyName,
} from '@eigenpal/types';
import { InvalidArgumentError, Option, type Command } from 'commander';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { ApiClient, ApiError } from '../../lib/client';
import { requireApiKey, resolveConfig, type CliConfig } from '../../lib/config';
import { action } from '../../lib/format-error';
import { addJsonFlag, dim, formatTimestamp, success, table, warn, withBaseUrl } from '../../lib/ui';
import { registerSourceInitCommand } from './init';
import { runGitPassthrough, type BaseOpts } from './passthrough';
import { registerSourceSecretCommands } from './secrets';
import {
  configureSourceGitRepo,
  parseSourceRepository,
  resolveGitAuthorEnv,
  runSourceGitCredentialHelper,
  sourceRepositoryFromRemoteUrl,
  type GitAuthorEnv,
  type SourceRepository,
} from './source-git';
import {
  checkoutOriginalBranch,
  checkRepoVersion,
  clean,
  commitSourceChanges,
  currentBranch,
  deps,
  doctor,
  gitOutput,
  isOrganizationSourceGitRoot,
  mergeCurrentBranchToMain,
  packageManifestExists,
  packageStatus,
  pushCurrentBranch,
  readPackageManifest,
  readRootManifest,
  requirePackageClean,
  requirePushedMain,
  resolveGitSourceContext,
  runGit,
  runGitStrict,
  validatePackage,
  type ContextOpts,
  type ResolvedPackageContext,
} from './source-state';

export { hasGitPassthroughSeparator, runGitPassthroughFromArgv } from './passthrough';
export { resolveGitSourceContext, validateSourcePackage } from './source-state';

type RuntimeInstallOpts = { remoteUrl?: string };
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
type AutomationDetailPayload = Record<string, unknown> & {
  id?: string;
  type?: string;
  slug?: string;
  name?: string | null;
  description?: string | null;
  status?: string;
  version?: string | null;
  implementationAvailable?: boolean;
  triggers?: {
    api?: boolean;
    email?: boolean;
    manual?: boolean;
    cron?: boolean;
  };
};

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

const INSTALL_LOCKFILE_NAME = 'eigenpal.lock';

async function getSourceRepository(
  config: CliConfig,
  opts: RuntimeInstallOpts = {}
): Promise<SourceRepository> {
  const explicit = sourceRepositoryFromRemoteUrl(opts.remoteUrl);
  if (explicit) return explicit;
  const client = new ApiClient(config);
  return parseSourceRepository(await client.get('/api/v1/source/repository'));
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

function resolvePackagePath(target: string): SourcePackagePath {
  return target.includes('/')
    ? SourcePackagePathSchema.parse(target)
    : dottedPackageNameToPath(DottedPackageNameSchema.parse(target));
}

function resolveAgentPackagePath(target: string): SourcePackagePath {
  if (target.includes('/') || target.includes('.')) return resolvePackagePath(target);
  return SourcePackagePathSchema.parse(`agents/${target}`);
}

function publicAgentAutomationTarget(target: string): string {
  if (target.includes('/')) {
    return pathToDottedPackageName(SourcePackagePathSchema.parse(target));
  }
  if (target.startsWith('agents.')) return target;
  if (/^[a-z]+_[a-zA-Z0-9]/.test(target) || target.includes(' ') || target.includes('.')) {
    return target;
  }
  return `agents.${target}`;
}

function formatTriggerState(triggers: AutomationDetailPayload['triggers']): string {
  if (!triggers) return '';
  return (['api', 'email', 'manual', 'cron'] as const).filter((key) => triggers[key]).join(',');
}

async function findAgentAutomationBySearch(
  client: ApiClient,
  target: string
): Promise<AutomationDetailPayload | null> {
  const payload = (await client.get('/api/v1/automations', {
    type: 'agent',
    search: target,
    limit: '100',
  })) as { data?: AutomationDetailPayload[] };
  const candidates = payload.data ?? [];
  return (
    candidates.find(
      (automation) =>
        automation.id === target || automation.slug === target || automation.name === target
    ) ?? (candidates.length === 1 ? candidates[0] : null)
  );
}

async function getPublicAgentAutomation(
  client: ApiClient,
  target: string
): Promise<AutomationDetailPayload> {
  const publicTarget = publicAgentAutomationTarget(target);
  try {
    const automation = (await client.get(
      `/api/v1/automations/${encodeURIComponent(publicTarget)}`
    )) as AutomationDetailPayload;
    if (automation.type !== 'agent') {
      throw new Error(`Automation ${target} is not an agent.`);
    }
    return automation;
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 404) throw err;
  }

  const resolved = await findAgentAutomationBySearch(client, target);
  if (!resolved) {
    throw new Error(`Agent automation not found: ${target}`);
  }
  if (resolved.type !== 'agent') {
    throw new Error(`Automation ${target} is not an agent.`);
  }
  return resolved;
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

/** Gateway/unavailable statuses the sync endpoint uses for "try again". */
const RETRYABLE_SYNC_STATUSES = new Set([502, 503, 504]);

/**
 * Right after `agents release` pushes the tag, the git provider can be
 * momentarily behind and the server answers 503. Retry briefly before
 * surfacing the failure — the identical request succeeds seconds later.
 * Non-gateway statuses (auth, validation, plain 500s) are NOT retried.
 * Exported for tests.
 */
export async function retrySyncRequest(
  request: () => Promise<unknown>,
  opts: { attempts?: number; delayMs?: (attempt: number) => number } = {}
): Promise<void> {
  const attempts = opts.attempts ?? 4;
  const delayMs = opts.delayMs ?? ((attempt: number) => attempt * 1500);
  for (let attempt = 1; ; attempt++) {
    try {
      await request();
      return;
    } catch (err) {
      const retryable =
        err instanceof ApiError && RETRYABLE_SYNC_STATUSES.has(err.status) && attempt < attempts;
      if (!retryable) throw err;
      dim(`  sync attempt ${attempt} failed (HTTP ${(err as ApiError).status}), retrying...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs(attempt)));
    }
  }
}

async function syncLatestAutomation(
  client: ApiClient,
  packagePath: SourcePackagePath
): Promise<void> {
  const automation = pathToDottedPackageName(packagePath);
  await retrySyncRequest(() =>
    client.post(`/api/v1/automations/${encodeURIComponent(automation)}/sync`)
  );
  success(`Synced ${automation} to latest release.`);
}

async function cloneSource(opts: {
  out?: string;
  baseUrl?: string;
  tenantId?: string;
}): Promise<void> {
  const config = resolveConfig(opts);
  const repo = await getSourceRepository(config);
  const outDir = opts.out ?? path.basename(repo.gitRepositoryPath);
  runGit(['clone', repo.remoteUrl, outDir], {
    config,
    bootstrapRemoteUrl: repo.remoteUrl,
  });
  const clonedRoot = path.resolve(process.cwd(), outDir);
  await configureSourceGitRepo({
    gitRoot: clonedRoot,
    config,
    remoteUrl: repo.remoteUrl,
  });
  success(`Cloned ${repo.remoteUrl}`);
}

async function show(target: string, opts: BaseOpts): Promise<void> {
  const client = new ApiClient(resolveConfig(opts));
  const automation = await getPublicAgentAutomation(client, target);
  if (opts.json) console.log(JSON.stringify(automation, null, 2));
  else {
    const slug = automation.slug ?? target;
    console.log(
      table(
        [
          {
            type: 'agent',
            id: automation.id ?? '',
            slug,
            path: `agents/${slug}`,
            name: automation.name ?? '',
            status: automation.status ?? '',
            version: automation.version ?? '',
            triggers: formatTriggerState(automation.triggers),
            implementation: automation.implementationAvailable === false ? 'missing' : 'available',
          },
        ],
        [
          { key: 'type', header: 'type' },
          { key: 'id', header: 'id' },
          { key: 'slug', header: 'slug' },
          { key: 'path', header: 'path' },
          { key: 'name', header: 'name' },
          { key: 'status', header: 'status' },
          { key: 'version', header: 'version' },
          { key: 'triggers', header: 'triggers' },
          { key: 'implementation', header: 'implementation' },
        ]
      )
    );
    if (automation.description) console.log(`\ndescription: ${automation.description}`);
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
    await requirePushedMain(resolvedContext.gitRoot, config);
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
      await mergeCurrentBranchToMain({
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
  await configureSourceGitRepo({ gitRoot: input.context.gitRoot, config: input.config, remoteUrl });
  try {
    runGitStrict(['push', 'origin', tag], {
      cwd: input.context.gitRoot,
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

async function pullSource(opts: BaseOpts & { dir?: string }): Promise<void> {
  const config = resolveConfig(opts);
  const context = resolveGitSourceContext({ dir: opts.dir });
  if (!context.gitRoot) throw new Error('Not inside a Git repository.');
  const remoteUrl = gitOutput(['remote', 'get-url', 'origin'], context.gitRoot);
  await configureSourceGitRepo({ gitRoot: context.gitRoot, config, remoteUrl });
  runGit(['pull', '--ff-only', 'origin', 'main'], {
    cwd: context.gitRoot,
  });
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

async function pushSource(opts: BaseOpts & { dir?: string }): Promise<void> {
  const config = resolveConfig(opts);
  const context = resolveGitSourceContext({ dir: opts.dir });
  if (!context.gitRoot) throw new Error('Not inside a Git repository.');
  await pushCurrentBranch({ config, gitRoot: context.gitRoot });
}

async function upgradeSource(opts: { dir?: string; dryRun?: boolean }): Promise<void> {
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
  await doctor({
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

export function registerAgentSourceCommands(agent: Command): void {
  withBaseUrl(agent.command('clone'))
    .description('Clone the organization source repository.')
    .option('--out <dir>', 'Output directory')
    .option('--tenant-id <tenantId>', 'Target tenant id for admin-token source clones')
    .action(action(cloneSource));

  withBaseUrl(agent.command('install [packageRef]'))
    .description('Materialize a source package and its workspace dependencies.')
    .option('--out <dir>', 'Output directory for an explicit package ref')
    .option('--lockfile <path>', 'Lockfile path')
    .option('--frozen-lockfile', 'Install exactly from the existing lockfile')
    .option('--remote-url <url>', 'Use an explicit organization Git remote URL')
    .action(action(install));

  registerSourceInitCommand(agent);

  withBaseUrl(agent.command('pull'))
    .description(
      'Pull organization source from origin/main with --ff-only. For datasets use agents dataset pull; for run artifacts use runs artifacts fetch.'
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

  registerSourceSecretCommands(agent);
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
        runGitPassthrough(gitArgs ?? [], opts)
      )
    );

  const credentialHelper = program
    .command('git-credential-helper [operation]')
    .description('Git credential helper for Eigenpal organization remotes.')
    .action((operation: string | undefined) => runSourceGitCredentialHelper(operation));
  (credentialHelper as Command & { hidden: boolean }).hidden = true;
}
