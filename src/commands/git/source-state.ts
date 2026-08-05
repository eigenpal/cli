import {
  formatReleaseTag,
  pathToDottedPackageName,
  RootSourceManifestSchema,
  SOURCE_SECRETS_FILENAME,
  SourceManifestFilenameSchema,
  SourcePackageManifestSchema,
  SourcePackagePathSchema,
  SourceSecretsFileSchema,
  validateSourcePackageRequiredFiles,
  workspaceDependencyNameToPackagePath,
  type SourcePackageManifest,
  type SourcePackagePath,
  type WorkspaceDependencyName,
} from '@eigenpal/types';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { getProcessEnv } from '../../env';
import { resolveConfig, type CliConfig } from '../../lib/config';
import { error, success, table, warn } from '../../lib/ui';
import {
  configureSourceGitRepo,
  gitBootstrapAuthEnv,
  resolveGitAuthorEnv,
  type GitAuthorEnv,
} from './source-git';

type BaseOpts = { baseUrl?: string; json?: boolean };
export type ContextOpts = { dir?: string };
export type PackageContext = {
  gitRoot: string | null;
  packageRoot: string | null;
  packagePath: SourcePackagePath | null;
};
export type ResolvedPackageContext = {
  gitRoot: string;
  packageRoot: string;
  packagePath: SourcePackagePath;
};

export function runGit(
  args: string[],
  opts: {
    cwd?: string;
    config?: CliConfig;
    env?: NodeJS.ProcessEnv;
    bootstrapRemoteUrl?: string;
  } = {}
): void {
  const env = opts.config
    ? gitBootstrapAuthEnv(opts.config, opts.env, opts.bootstrapRemoteUrl)
    : { ...getProcessEnv(), ...opts.env };
  const result = spawnSync('git', args, {
    cwd: opts.cwd,
    env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status && result.status !== 0) process.exit(result.status);
}

export function runGitStrict(
  args: string[],
  opts: {
    cwd?: string;
    config?: CliConfig;
    env?: NodeJS.ProcessEnv;
    bootstrapRemoteUrl?: string;
  } = {}
): void {
  const env = opts.config
    ? gitBootstrapAuthEnv(opts.config, opts.env, opts.bootstrapRemoteUrl)
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

export function gitOutput(
  args: string[],
  cwd?: string,
  config?: CliConfig,
  bootstrapRemoteUrl?: string
): string | null {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: config ? gitBootstrapAuthEnv(config, {}, bootstrapRemoteUrl) : undefined,
  });
  if (result.status !== 0) return null;
  return result.stdout.trim();
}

function sourcePathFromPackageRoot(gitRoot: string, packageRoot: string): SourcePackagePath | null {
  const relativePath = path.relative(gitRoot, packageRoot).replace(/\\/g, '/');
  const result = SourcePackagePathSchema.safeParse(relativePath);
  return result.success ? result.data : null;
}

export function resolveGitRoot(dir: string): string | null {
  return gitOutput(['rev-parse', '--show-toplevel'], dir);
}

export function isOrganizationSourceGitRoot(gitRoot: string | null): gitRoot is string {
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

export function readYamlFile(filePath: string): unknown {
  return YAML.parse(readFileSync(filePath, 'utf8'));
}

export function writeYamlFile(filePath: string, value: unknown): void {
  writeFileSync(filePath, YAML.stringify(value));
}

export function packageManifestExists(gitRoot: string, packagePath: SourcePackagePath): boolean {
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

export function readPackageManifest(packageRoot: string): SourcePackageManifest {
  return SourcePackageManifestSchema.parse(readYamlFile(path.join(packageRoot, 'eigenpal.yaml')));
}

export function requirePackageContext(opts: ContextOpts = {}): ResolvedPackageContext {
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

export function validatePackage(dir: string): {
  valid: boolean;
  errors: string[];
  packagePath?: string;
} {
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

export function readRootManifest(
  gitRoot: string
): { ok: true; version: string } | { ok: false; error: string } {
  const manifestPath = path.join(gitRoot, 'eigenpal.yaml');
  if (!existsSync(manifestPath)) return { ok: false, error: 'Root eigenpal.yaml is missing.' };
  const parsed = RootSourceManifestSchema.safeParse(readYamlFile(manifestPath));
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues.map((issue) => issue.message).join('; ') };
  return { ok: true, version: parsed.data.eigenpalVersion };
}

export function checkRepoVersion(gitRoot: string, mutation: boolean): void {
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

export function requirePackageClean(context: PackageContext): void {
  if (!context.gitRoot || !context.packagePath) throw new Error('No package context found.');
  const status = gitOutput(['status', '--short', '--', context.packagePath], context.gitRoot) ?? '';
  if (status.length > 0) {
    throw new Error(`Release requires a clean package working tree:\n${status}`);
  }
}

export function currentBranch(gitRoot: string): string {
  const branch = gitOutput(['rev-parse', '--abbrev-ref', 'HEAD'], gitRoot);
  if (!branch || branch === 'HEAD') {
    throw new Error('Cannot operate from detached HEAD; check out a branch first.');
  }
  return branch;
}

export async function requirePushedMain(gitRoot: string, config: CliConfig): Promise<void> {
  const branch = currentBranch(gitRoot);
  if (branch !== 'main') throw new Error('Release must be run from the main branch.');
  const remoteUrl = gitOutput(['remote', 'get-url', 'origin'], gitRoot);
  await configureSourceGitRepo({ gitRoot, config, remoteUrl });
  runGit(['fetch', 'origin', 'main'], {
    cwd: gitRoot,
  });
  const head = gitOutput(['rev-parse', 'HEAD'], gitRoot);
  const originMain = gitOutput(['rev-parse', 'origin/main'], gitRoot);
  if (!head || !originMain || head !== originMain) {
    throw new Error('Release requires local main to match pushed origin/main.');
  }
}

export function checkoutOriginalBranch(gitRoot: string, branch: string): void {
  if (gitOutput(['rev-parse', '--abbrev-ref', 'HEAD'], gitRoot) === branch) return;
  if (gitOutput(['rev-parse', '--verify', 'MERGE_HEAD'], gitRoot)) {
    runGit(['merge', '--abort'], { cwd: gitRoot });
  }
  runGitStrict(['checkout', branch], { cwd: gitRoot });
}

export async function mergeCurrentBranchToMain(input: {
  gitRoot: string;
  branch: string;
  config: CliConfig;
  authorEnv: GitAuthorEnv;
}): Promise<void> {
  const remoteUrl = gitOutput(['remote', 'get-url', 'origin'], input.gitRoot);
  await configureSourceGitRepo({ gitRoot: input.gitRoot, config: input.config, remoteUrl });
  runGitStrict(['fetch', 'origin', 'main'], {
    cwd: input.gitRoot,
  });
  const hasLocalMain = Boolean(
    gitOutput(['rev-parse', '--verify', 'refs/heads/main'], input.gitRoot)
  );
  runGitStrict(hasLocalMain ? ['checkout', 'main'] : ['checkout', '-b', 'main', 'origin/main'], {
    cwd: input.gitRoot,
  });
  runGitStrict(['pull', '--ff-only', 'origin', 'main'], {
    cwd: input.gitRoot,
  });
  runGitStrict(['merge', '--no-edit', input.branch], {
    cwd: input.gitRoot,
    env: input.authorEnv,
  });
  runGitStrict(['push', 'origin', 'main'], {
    cwd: input.gitRoot,
  });
}

export async function doctor(opts: BaseOpts & ContextOpts): Promise<void> {
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
        await configureSourceGitRepo({ gitRoot: context.gitRoot, config, remoteUrl });
        if (!gitOutput(['ls-remote', '--heads', 'origin'], context.gitRoot)) {
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

export function packageStatus(opts: BaseOpts & ContextOpts): void {
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

export function deps(opts: BaseOpts & ContextOpts): void {
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

export function clean(opts: BaseOpts & ContextOpts): void {
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

export async function commitSourceChanges(input: {
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

export async function pushCurrentBranch(input: {
  config: CliConfig;
  gitRoot: string;
}): Promise<void> {
  const branch = currentBranch(input.gitRoot);
  if (!branch) {
    throw new Error('Cannot push from detached HEAD; check out a branch first.');
  }
  const remoteUrl = gitOutput(['remote', 'get-url', 'origin'], input.gitRoot);
  await configureSourceGitRepo({ gitRoot: input.gitRoot, config: input.config, remoteUrl });
  runGit(['push', '-u', 'origin', 'HEAD', '--follow-tags'], {
    cwd: input.gitRoot,
  });
}
