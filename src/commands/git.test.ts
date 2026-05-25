import { describe, expect, test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bumpReleaseVersion, resolveGitSourceContext, sortReleasesNewestFirst } from './git';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'cli.ts');

function git(args: string[], cwd?: string): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
}

function makeSourceRepo(packagePath = 'agents/invoice-agent'): {
  root: string;
  packageDir: string;
} {
  const root = mkdtempSync(join(tmpdir(), 'eigenpal-source-'));
  const packageDir = join(root, packagePath);
  git(['init', '-b', 'main', root]);
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(join(root, 'eigenpal.yaml'), 'schemaVersion: 1\neigenpalVersion: 1.0.0\n');
  writeFileSync(join(root, '.gitignore'), '.eigenpal/\neigenpal_modules/\n');
  writeFileSync(
    join(packageDir, 'eigenpal.yaml'),
    'schemaVersion: 1\nname: Invoice Agent\ndescription: Extract invoices\n'
  );
  const bodyFilename = packagePath.startsWith('agents/') ? 'AGENT.md' : 'README.md';
  writeFileSync(join(packageDir, bodyFilename), 'Extract invoices.\n');
  return { root, packageDir };
}

function makePublishedSourceRepo(packagePath = 'agents/invoice-agent'): {
  root: string;
  packageDir: string;
  remote: string;
} {
  const { root, packageDir } = makeSourceRepo(packagePath);
  const remote = mkdtempSync(join(tmpdir(), 'eigenpal-source-remote-'));
  git(['init', '--bare', remote]);
  git(['--git-dir', remote, 'symbolic-ref', 'HEAD', 'refs/heads/main']);
  git(['config', 'user.email', 'test@example.com'], root);
  git(['config', 'user.name', 'Test User'], root);
  git(['add', '.'], root);
  git(['commit', '-m', 'Initial source'], root);
  git(['remote', 'add', 'origin', remote], root);
  git(['push', '-u', 'origin', 'main'], root);
  return {
    root: realpathSync(root),
    packageDir: realpathSync(packageDir),
    remote: realpathSync(remote),
  };
}

function cli(args: string[], opts: { cwd?: string; baseUrl?: string } = {}) {
  return spawnSync('bun', [CLI, ...args], {
    cwd: opts.cwd,
    encoding: 'utf8',
    timeout: 3_000,
    env: {
      ...process.env,
      EIGENPAL_API_KEY: 'eig_test_key',
      ...(opts.baseUrl ? { EIGENPAL_BASE_URL: opts.baseUrl } : {}),
    },
  });
}

function cliAsync(
  args: string[],
  opts: { cwd?: string; baseUrl?: string } = {}
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('bun', [CLI, ...args], {
      cwd: opts.cwd,
      env: {
        ...process.env,
        EIGENPAL_API_KEY: 'eig_test_key',
        ...(opts.baseUrl ? { EIGENPAL_BASE_URL: opts.baseUrl } : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`CLI timed out: eigenpal ${args.join(' ')}`));
    }, 10_000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    child.on('close', (status) => {
      clearTimeout(timeout);
      resolvePromise({ status, stdout, stderr });
    });
  });
}

async function withApiServer(
  handler: (request: Request) => Response | Promise<Response>,
  fn: (baseUrl: string) => void | Promise<void>
): Promise<void> {
  const server = Bun.serve({ port: 0, fetch: handler });
  try {
    await fn(`http://127.0.0.1:${server.port}`);
  } finally {
    await server.stop(true);
  }
}

describe('hidden git source commands', () => {
  test('top-level help hides git namespace while direct help works', () => {
    const top = spawnSync('bun', [CLI, '--help'], { encoding: 'utf8' });
    expect(top.status).toBe(0);
    expect(top.stdout).not.toContain('git [options]');

    const hidden = spawnSync('bun', [CLI, 'git', '--help'], { encoding: 'utf8' });
    expect(hidden.status).toBe(0);
    expect(hidden.stdout).toContain('Experimental Git-backed source commands');
    expect(hidden.stdout).toContain('validate');
    expect(hidden.stdout).toContain('versions');
  });

  test('resolves package context from a source package subdirectory', () => {
    const { root, packageDir } = makeSourceRepo();
    try {
      const nested = join(packageDir, 'notes');
      mkdirSync(nested);
      const context = resolveGitSourceContext({ dir: nested });
      expect(context.gitRoot).toBe(realpathSync(root));
      expect(context.packageRoot).toBe(realpathSync(packageDir));
      expect(context.packagePath).toBe('agents/invoice-agent');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('validate and doctor inspect source package structure', () => {
    const { root, packageDir } = makeSourceRepo();
    try {
      const validate = spawnSync('bun', [CLI, 'git', 'validate', packageDir, '--json'], {
        encoding: 'utf8',
      });
      expect(validate.status).toBe(0);
      expect(JSON.parse(validate.stdout)).toMatchObject({
        valid: true,
        packagePath: 'agents/invoice-agent',
      });

      const doctor = spawnSync('bun', [CLI, 'git', 'doctor', '--dir', packageDir, '--json'], {
        encoding: 'utf8',
      });
      expect(doctor.status).toBe(1);
      const checks = JSON.parse(doctor.stdout).checks;
      expect(checks).toContainEqual(
        expect.objectContaining({ check: 'package structure', status: 'pass' })
      );
      expect(checks).toContainEqual(
        expect.objectContaining({ check: 'remote origin', status: 'fail' })
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('status from repo root reports repository state without package validation errors', () => {
    const { root } = makeSourceRepo();
    try {
      const result = cli(['git', 'status', '--dir', root, '--json']);

      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        gitRoot: realpathSync(root),
        packagePath: null,
        clean: false,
        valid: null,
        errors: [],
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('status validates nested manifests outside package roots', () => {
    const { root } = makeSourceRepo();
    try {
      const invalidPackage = join(root, 'misc', 'invoice-agent');
      mkdirSync(invalidPackage, { recursive: true });
      writeFileSync(join(invalidPackage, 'eigenpal.yaml'), 'schemaVersion: 1\nname: Invalid\n');

      const result = cli(['git', 'status', '--dir', invalidPackage, '--json']);
      const body = JSON.parse(result.stdout);

      expect(result.status).toBe(0);
      expect(body).toMatchObject({
        packageRoot: realpathSync(invalidPackage),
        packagePath: null,
        valid: false,
      });
      expect(body.errors).toContain(
        'Package must live under agents/, workflows/, resources/, or evaluators/.'
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('validate checks dependency and evaluator references against repo contents and tags', () => {
    const { root, packageDir } = makeSourceRepo();
    try {
      writeFileSync(
        join(packageDir, 'eigenpal.yaml'),
        [
          'schemaVersion: 1',
          'name: Invoice Agent',
          'dependencies:',
          '  workspace:resources.skills.parser: 1.0.0',
          'evaluators:',
          '  items:',
          '    - use: ./evaluators/exact-fields.yaml',
          '    - use: workspace:evaluators.invoice-quality',
          '      version: 1.0.0',
          '',
        ].join('\n')
      );

      const result = spawnSync('bun', [CLI, 'git', 'validate', packageDir, '--json'], {
        encoding: 'utf8',
      });
      const body = JSON.parse(result.stdout);

      expect(result.status).toBe(1);
      expect(body.errors).toEqual(
        expect.arrayContaining([
          expect.stringContaining('Dependency workspace:resources.skills.parser@1.0.0'),
          expect.stringContaining('Local evaluator ./evaluators/exact-fields.yaml does not exist'),
          expect.stringContaining('Shared evaluator workspace:evaluators.invoice-quality@1.0.0'),
        ])
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('doctor checks configured remote and git auth reachability', () => {
    const { root, packageDir, remote } = makePublishedSourceRepo();
    try {
      const doctor = cli(['git', 'doctor', '--dir', packageDir, '--json'], { cwd: packageDir });
      expect(doctor.status).toBe(0);
      const checks = JSON.parse(doctor.stdout).checks;
      expect(checks).toContainEqual(
        expect.objectContaining({ check: 'remote origin', status: 'pass' })
      );
      expect(checks).toContainEqual(
        expect.objectContaining({ check: 'remote auth', status: 'pass' })
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(remote, { recursive: true, force: true });
    }
  });

  test('git passthrough honors separator and does not route to source status', () => {
    const { root } = makeSourceRepo();
    try {
      const result = spawnSync('bun', [CLI, 'git', '--', '-C', root, 'status', '--short'], {
        encoding: 'utf8',
        env: { ...process.env, EIGENPAL_API_KEY: 'eig_test_key' },
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('?? .gitignore');
      expect(result.stdout).not.toContain('package  clean  valid');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('git passthrough uses API key identity for commits', async () => {
    const { root } = makeSourceRepo();
    try {
      await withApiServer(
        (request) => {
          const url = new URL(request.url);
          if (url.pathname === '/api/v1/auth/check') {
            return Response.json({
              ok: true,
              email: 'dev@example.com',
              name: 'Dev User',
              keyId: 'ak_123',
            });
          }
          return Response.json({ error: 'not found' }, { status: 404 });
        },
        async (baseUrl) => {
          const result = await cliAsync(
            ['git', '--', '-C', root, 'commit', '--allow-empty', '-m', 'Authored commit'],
            { baseUrl }
          );
          expect(result.status).toBe(0);

          const author = spawnSync('git', ['show', '-s', '--format=%an <%ae>|%cn <%ce>'], {
            cwd: root,
            encoding: 'utf8',
          });
          expect(author.stdout.trim()).toBe(
            'Dev User <dev@example.com>|Dev User <dev@example.com>'
          );
        }
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('git passthrough does not fetch identity for read-only tag listing', async () => {
    const { root } = makePublishedSourceRepo();
    let authChecks = 0;
    try {
      await withApiServer(
        (request) => {
          const url = new URL(request.url);
          if (url.pathname === '/api/v1/auth/check') {
            authChecks += 1;
            return Response.json({ error: 'auth should not be called' }, { status: 500 });
          }
          return Response.json({ error: 'not found' }, { status: 404 });
        },
        async (baseUrl) => {
          const result = await cliAsync(['git', '--', '-C', root, 'tag', '--list'], { baseUrl });
          expect(result.status).toBe(0);
          expect(authChecks).toBe(0);
        }
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('clone fetches the organization repository URL and keeps git hidden from public aliases', async () => {
    const { root, remote } = makePublishedSourceRepo();
    const out = mkdtempSync(join(tmpdir(), 'eigenpal-clone-out-'));
    try {
      await withApiServer(
        () =>
          Response.json({
            gitRepositoryPath: 'repo_1',
            remoteUrl: `file://${remote}`,
          }),
        async (baseUrl) => {
          const clone = await cliAsync(['git', 'clone', '--out', join(out, 'repo')], { baseUrl });
          expect(clone.status).toBe(0);

          const topLevelClone = await cliAsync(['clone'], { baseUrl });
          expect(topLevelClone.status).not.toBe(0);
          expect(existsSync(join(out, 'repo', 'agents', 'invoice-agent', 'AGENT.md'))).toBe(true);
        }
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(remote, { recursive: true, force: true });
      rmSync(out, { recursive: true, force: true });
    }
  });

  test('list, show, and versions render API-backed source metadata', async () => {
    await withApiServer(
      (request) => {
        const url = new URL(request.url);
        if (url.pathname === '/api/v1/agents') {
          return Response.json({
            data: [
              {
                slug: 'invoice-agent',
                name: 'Invoice Agent',
                status: 'active',
                sourceIntegrity: 'healthy',
                latestVersion: '1.2.3',
              },
              {
                slug: 'unregistered-agent',
                name: 'unregistered-agent',
                status: 'unregistered',
                sourceIntegrity: 'unregistered',
                latestVersion: null,
              },
            ],
            total: 2,
          });
        }
        if (url.pathname === '/api/v1/agents/invoice-agent') {
          return Response.json({
            agent: {
              slug: 'invoice-agent',
              name: 'Invoice Agent',
              description: 'Extract invoices',
              status: 'active',
              sourceIntegrity: 'healthy',
              latestVersion: '1.2.3',
              latestCommit: 'abcdef1234567890',
              recentRuns: [
                {
                  id: 'exec_1',
                  createdAt: '2026-01-01T00:00:00Z',
                  durationMs: 1200,
                  triggeredBy: 'api',
                  requestedVersion: 'latest',
                  resolvedVersion: '1.2.3',
                  status: 'completed',
                },
              ],
            },
          });
        }
        if (url.pathname === '/api/v1/source/releases') {
          return Response.json({
            packagePath: 'agents/invoice-agent',
            releases: [
              { version: '1.0.0', tag: 'agents.invoice-agent@1.0.0', commit: '111111111111' },
              { version: '1.2.3', tag: 'agents.invoice-agent@1.2.3', commit: '222222222222' },
            ],
          });
        }
        return Response.json({ error: 'not found' }, { status: 404 });
      },
      async (baseUrl) => {
        const list = await cliAsync(['git', 'list', '--search', 'invoice'], { baseUrl });
        expect(list.status).toBe(0);
        expect(list.stdout).toContain('inconsistency');
        expect(list.stdout).toContain('unregistered');

        const show = await cliAsync(['git', 'show', 'agents.invoice-agent'], { baseUrl });
        expect(show.status).toBe(0);
        expect(show.stdout).toContain('Extract invoices');
        expect(show.stdout).toContain('recent runs');
        expect(show.stdout).toContain('exec_1');

        const versions = await cliAsync(['git', 'versions', 'agents.invoice-agent', '--json'], {
          baseUrl,
        });
        expect(versions.status).toBe(0);
        expect(
          JSON.parse(versions.stdout).releases.map(
            (release: { version: string }) => release.version
          )
        ).toEqual(['1.2.3', '1.0.0']);
      }
    );
  });

  test('release bump enforces pushed main, pushes tag, and syncs latest automation', async () => {
    const { root, packageDir, remote } = makePublishedSourceRepo();
    const syncCalls: string[] = [];
    try {
      await withApiServer(
        (request) => {
          const url = new URL(request.url);
          if (url.pathname === '/api/v1/auth/check') {
            return Response.json({
              ok: true,
              email: 'releaser@example.com',
              name: 'Release User',
              keyId: 'ak_release',
            });
          }
          if (url.pathname === '/api/v1/source/releases' && !url.searchParams.get('version')) {
            return Response.json({
              packagePath: 'agents/invoice-agent',
              releases: [
                {
                  version: '1.2.3',
                  tag: 'agents.invoice-agent@1.2.3',
                  commit: '111111111111',
                },
              ],
            });
          }
          if (url.pathname === '/api/v1/source/releases') {
            return Response.json({ packagePath: 'agents/invoice-agent', releases: [] });
          }
          if (
            request.method === 'POST' &&
            url.pathname === '/api/automations/agents.invoice-agent/sync'
          ) {
            syncCalls.push(url.pathname);
            return Response.json({ ok: true });
          }
          return Response.json({ error: 'not found' }, { status: 404 });
        },
        async (baseUrl) => {
          const result = await cliAsync(
            ['git', 'release', 'minor', packageDir, '-m', 'Release minor'],
            {
              baseUrl,
              cwd: packageDir,
            }
          );
          expect(result.status).toBe(0);
          expect(syncCalls).toEqual(['/api/automations/agents.invoice-agent/sync']);

          const tags = spawnSync('git', ['--git-dir', remote, 'tag'], { encoding: 'utf8' });
          expect(tags.stdout).toContain('agents.invoice-agent@1.3.0');
          const tagger = spawnSync(
            'git',
            [
              '--git-dir',
              remote,
              'for-each-ref',
              'refs/tags/agents.invoice-agent@1.3.0',
              '--format=%(taggername) %(taggeremail)',
            ],
            { encoding: 'utf8' }
          );
          expect(tagger.stdout.trim()).toBe('Release User <releaser@example.com>');
        }
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(remote, { recursive: true, force: true });
    }
  });

  test('release skips automation sync for resource packages', async () => {
    const { root, packageDir, remote } = makePublishedSourceRepo('resources/knowledge/facts');
    const syncCalls: string[] = [];
    try {
      await withApiServer(
        (request) => {
          const url = new URL(request.url);
          if (url.pathname === '/api/v1/auth/check') {
            return Response.json({
              ok: true,
              email: 'releaser@example.com',
              name: 'Release User',
              keyId: 'ak_release',
            });
          }
          if (url.pathname === '/api/v1/source/releases') {
            return Response.json({ packagePath: 'resources/knowledge/facts', releases: [] });
          }
          if (url.pathname.includes('/sync')) {
            syncCalls.push(url.pathname);
            return Response.json({ error: 'sync should not be called' }, { status: 500 });
          }
          return Response.json({ error: 'not found' }, { status: 404 });
        },
        async (baseUrl) => {
          const result = await cliAsync(
            ['git', 'release', '1.0.0', packageDir, '-m', 'Release facts'],
            {
              baseUrl,
              cwd: packageDir,
            }
          );
          expect(result.status).toBe(0);
          expect(syncCalls).toEqual([]);

          const tags = spawnSync('git', ['--git-dir', remote, 'tag'], { encoding: 'utf8' });
          expect(tags.stdout).toContain('resources.knowledge.facts@1.0.0');
        }
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(remote, { recursive: true, force: true });
    }
  });

  test('sync warns when the server sync endpoint is not available yet', async () => {
    await withApiServer(
      () =>
        new Response('<!doctype html><title>404</title>', {
          status: 404,
          headers: { 'content-type': 'text/html' },
        }),
      async (baseUrl) => {
        const result = await cliAsync(['git', 'sync', 'agents.invoice-agent'], { baseUrl });
        expect(result.status).toBe(0);
        expect(result.stderr).toContain('sync endpoint is not available yet');
      }
    );
  });

  test('release rejects dirty package and unpushed main', async () => {
    const dirty = makePublishedSourceRepo();
    try {
      writeFileSync(join(dirty.packageDir, 'AGENT.md'), 'changed\n');
      await withApiServer(
        () => Response.json({ packagePath: 'agents/invoice-agent', releases: [] }),
        async (baseUrl) => {
          const result = await cliAsync(
            ['git', 'release', '1.0.0', dirty.packageDir, '-m', 'Release'],
            {
              baseUrl,
              cwd: dirty.packageDir,
            }
          );
          expect(result.status).toBe(1);
          expect(result.stderr).toContain('clean package working tree');
        }
      );
    } finally {
      rmSync(dirty.root, { recursive: true, force: true });
      rmSync(dirty.remote, { recursive: true, force: true });
    }

    const unpushed = makePublishedSourceRepo();
    try {
      writeFileSync(join(unpushed.root, 'README.md'), 'local only\n');
      git(['add', 'README.md'], unpushed.root);
      git(['commit', '-m', 'Local only'], unpushed.root);
      await withApiServer(
        () => Response.json({ packagePath: 'agents/invoice-agent', releases: [] }),
        async (baseUrl) => {
          const result = await cliAsync(
            ['git', 'release', '1.0.0', unpushed.packageDir, '-m', 'Release'],
            {
              baseUrl,
              cwd: unpushed.packageDir,
            }
          );
          expect(result.status).toBe(1);
          expect(result.stderr).toContain('local main to match pushed origin/main');
        }
      );
    } finally {
      rmSync(unpushed.root, { recursive: true, force: true });
      rmSync(unpushed.remote, { recursive: true, force: true });
    }
  });

  test('repository version checks warn for compatible reads and block incompatible releases', () => {
    const compatible = makeSourceRepo();
    try {
      writeFileSync(
        join(compatible.root, 'eigenpal.yaml'),
        'schemaVersion: 1\neigenpalVersion: 1.1.0\n'
      );
      const result = cli(['git', 'validate', compatible.packageDir, '--json']);
      expect(result.status).toBe(0);
      expect(result.stderr).not.toContain('dev-compatible');
    } finally {
      rmSync(compatible.root, { recursive: true, force: true });
    }

    const incompatible = makePublishedSourceRepo();
    try {
      writeFileSync(
        join(incompatible.root, 'eigenpal.yaml'),
        'schemaVersion: 1\neigenpalVersion: 2.0.0\n'
      );
      git(['add', 'eigenpal.yaml'], incompatible.root);
      git(['commit', '-m', 'Bump repo format'], incompatible.root);
      git(['push', 'origin', 'main'], incompatible.root);
      const result = cli(['git', 'release', '1.0.0', incompatible.packageDir, '-m', 'Release'], {
        cwd: incompatible.packageDir,
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('incompatible');
    } finally {
      rmSync(incompatible.root, { recursive: true, force: true });
      rmSync(incompatible.remote, { recursive: true, force: true });
    }
  });

  test('install materializes workspace dependencies and writes a lockfile', () => {
    const { root, packageDir } = makeSourceRepo();
    try {
      const dependencyDir = join(root, 'resources', 'knowledge', 'jokes');
      mkdirSync(dependencyDir, { recursive: true });
      writeFileSync(
        join(dependencyDir, 'eigenpal.yaml'),
        'schemaVersion: 1\nname: Jokes Knowledge\n'
      );
      writeFileSync(join(dependencyDir, 'README.md'), '# Jokes\n\n');
      writeFileSync(
        join(packageDir, 'eigenpal.yaml'),
        [
          'schemaVersion: 1',
          'name: Invoice Agent',
          'description: Extract invoices',
          'dependencies:',
          '  workspace:resources.knowledge.jokes: 1.0.0',
          '',
        ].join('\n')
      );
      git(['config', 'user.email', 'test@example.com'], root);
      git(['config', 'user.name', 'Test User'], root);
      git(['add', '.'], root);
      git(['commit', '-m', 'Add packages'], root);
      git(['tag', '-a', 'resources.knowledge.jokes@1.0.0', '-m', 'Release jokes'], root);

      const result = cli(['git', 'install'], { cwd: packageDir });
      expect(result.status).toBe(0);
      expect(
        existsSync(
          join(packageDir, 'eigenpal_modules', 'resources', 'knowledge', 'jokes', 'README.md')
        )
      ).toBe(true);
      const lockfile = JSON.parse(
        readFileSync(join(packageDir, '.eigenpal', 'eigenpal.lock'), 'utf8')
      );
      expect(lockfile.root.dependencies[0]).toMatchObject({
        packagePath: 'resources/knowledge/jokes',
        resolvedRef: '1.0.0',
      });

      const frozen = cli(['git', 'install', '--frozen-lockfile'], { cwd: packageDir });
      expect(frozen.status).toBe(0);

      const lockfilePath = join(packageDir, '.eigenpal', 'eigenpal.lock');
      const validLockfile = readFileSync(lockfilePath, 'utf8');
      const invalidLockfile = JSON.parse(validLockfile);
      invalidLockfile.root.dependencies[0].packagePath = '../escape';
      writeFileSync(lockfilePath, `${JSON.stringify(invalidLockfile, null, 2)}\n`);
      const invalidFrozen = cli(['git', 'install', '--frozen-lockfile'], { cwd: packageDir });
      expect(invalidFrozen.status).toBe(1);
      expect(invalidFrozen.stderr).toContain('Invalid lockfile');
      writeFileSync(lockfilePath, validLockfile);

      const out = mkdtempSync(join(tmpdir(), 'eigenpal-install-out-'));
      const packageRef = cli(['git', 'install', 'resources.knowledge.jokes@1.0.0', '--out', out], {
        cwd: packageDir,
      });
      expect(packageRef.status).toBe(0);
      expect(existsSync(join(out, 'README.md'))).toBe(true);
      rmSync(join(out, 'README.md'), { force: true });
      const frozenPackageRef = cli(
        ['git', 'install', 'resources.knowledge.jokes@1.0.0', '--out', out, '--frozen-lockfile'],
        { cwd: packageDir }
      );
      expect(frozenPackageRef.status).toBe(0);
      expect(existsSync(join(out, 'README.md'))).toBe(true);
      rmSync(out, { recursive: true, force: true });

      writeFileSync(
        join(packageDir, 'eigenpal.yaml'),
        [
          'schemaVersion: 1',
          'name: Invoice Agent',
          'dependencies:',
          '  workspace:resources.knowledge.jokes: 2.0.0',
          '',
        ].join('\n')
      );
      const mismatch = cli(['git', 'install'], { cwd: packageDir });
      expect(mismatch.status).toBe(1);
      expect(mismatch.stderr).toContain('does not match current package inputs');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('init creates scoped package scaffolds without exposing root aliases', () => {
    const root = mkdtempSync(join(tmpdir(), 'eigenpal-init-'));
    try {
      const result = cli(
        ['git', 'init', 'Dad Joke Generator', '--template', 'agent', '--dir', root],
        {
          cwd: root,
        }
      );
      expect(result.status).toBe(0);
      expect(existsSync(join(root, 'agents', 'dad-joke-generator', 'AGENT.md'))).toBe(true);
      expect(readFileSync(join(root, '.gitignore'), 'utf8')).toContain('eigenpal_modules/');

      const topLevelInit = cli(['init', 'Dad Joke Generator', '--template', 'agent'], {
        cwd: root,
      });
      expect(topLevelInit.status).not.toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('commit validates changed packages and push sends main to origin', async () => {
    const { root, packageDir, remote } = makePublishedSourceRepo();
    try {
      writeFileSync(join(packageDir, 'AGENT.md'), 'Changed instructions.\n');
      await withApiServer(
        (request) => {
          const url = new URL(request.url);
          if (url.pathname === '/api/v1/auth/check') {
            return Response.json({
              ok: true,
              email: 'author@example.com',
              name: 'Source Author',
              keyId: 'ak_source',
            });
          }
          return Response.json({ error: 'not found' }, { status: 404 });
        },
        async (baseUrl) => {
          const commit = await cliAsync(['git', 'commit', '-m', 'Update agent'], {
            baseUrl,
            cwd: packageDir,
          });
          expect(commit.status).toBe(0);
          expect(
            spawnSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' }).stdout
          ).toBe('');

          const push = await cliAsync(['git', 'push'], { baseUrl, cwd: packageDir });
          expect(push.status).toBe(0);
          const remoteMain = spawnSync('git', ['--git-dir', remote, 'rev-parse', 'main'], {
            encoding: 'utf8',
          }).stdout.trim();
          const localMain = spawnSync('git', ['rev-parse', 'main'], {
            cwd: root,
            encoding: 'utf8',
          }).stdout.trim();
          expect(remoteMain).toBe(localMain);
        }
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(remote, { recursive: true, force: true });
    }
  });

  test('upgrade bumps root manifest and runs doctor checks', () => {
    const { root, packageDir, remote } = makePublishedSourceRepo();
    try {
      writeFileSync(join(root, 'eigenpal.yaml'), 'schemaVersion: 1\neigenpalVersion: 0.9.0\n');
      const result = cli(['git', 'upgrade'], { cwd: packageDir });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Source repository changelog');
      expect(readFileSync(join(root, 'eigenpal.yaml'), 'utf8')).toContain('eigenpalVersion: 1.0.0');
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(remote, { recursive: true, force: true });
    }
  });

  test('pure release helpers sort versions and compute bumps', () => {
    const releases = [
      { version: '1.9.9', tag: 'pkg@1.9.9', commit: 'a' },
      { version: '2.0.0', tag: 'pkg@2.0.0', commit: 'b' },
      { version: '1.10.0', tag: 'pkg@1.10.0', commit: 'c' },
    ];

    expect(sortReleasesNewestFirst(releases).map((release) => release.version)).toEqual([
      '2.0.0',
      '1.10.0',
      '1.9.9',
    ]);
    expect(bumpReleaseVersion(releases, 'patch')).toBe('2.0.1');
    expect(bumpReleaseVersion(releases, 'minor')).toBe('2.1.0');
    expect(bumpReleaseVersion(releases, 'major')).toBe('3.0.0');
  });
});
