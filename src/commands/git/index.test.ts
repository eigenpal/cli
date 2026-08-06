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
import { ApiError } from '../../lib/client';
import {
  bumpReleaseVersion,
  resolveGitSourceContext,
  retrySyncRequest,
  sortReleasesNewestFirst,
} from './index';
import { checkoutOriginalBranch } from './source-state';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'cli.ts');

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

describe('git passthrough and agents source commands', () => {
  test('git help describes passthrough; source subcommands live under agents', () => {
    const gitHelp = spawnSync('bun', [CLI, 'git', '--help'], { encoding: 'utf8' });
    expect(gitHelp.status).toBe(0);
    expect(gitHelp.stdout).toContain('Passthrough');

    const agentsHelp = spawnSync('bun', [CLI, 'agents', '--help'], { encoding: 'utf8' });
    expect(agentsHelp.status).toBe(0);
    expect(agentsHelp.stdout).toContain('save');
    expect(agentsHelp.stdout).toContain('versions');
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
      const validate = spawnSync('bun', [CLI, 'agents', 'validate', packageDir, '--json'], {
        encoding: 'utf8',
      });
      expect(validate.status).toBe(0);
      expect(JSON.parse(validate.stdout)).toMatchObject({
        valid: true,
        packagePath: 'agents/invoice-agent',
      });

      const doctor = spawnSync('bun', [CLI, 'agents', 'doctor', '--dir', packageDir, '--json'], {
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

  test('agents secret commands mutate source files locally', async () => {
    const { root, packageDir } = makeSourceRepo();
    try {
      const valueFile = join(root, 'secret-value.txt');
      writeFileSync(valueFile, 'sk-plaintext');
      await withApiServer(
        async (request) => {
          const url = new URL(request.url);
          if (request.method !== 'POST' || url.pathname !== '/v1/source/secrets/encrypt') {
            return new Response('not found', { status: 404 });
          }
          const body = (await request.json()) as {
            secrets?: Array<{ secretName: string; plaintext: string }>;
          };
          const secretName = body.secrets?.[0]?.secretName ?? 'OPENAI_API_KEY';
          return Response.json({
            secrets: {
              [secretName]: {
                algorithm: 'aes-256-gcm',
                keyId: 'org-key-1',
                nonce: 'abc',
                ciphertext: 'def',
                tag: 'ghi',
              },
            },
          });
        },
        async (baseUrl) => {
          const secret = await cliAsync(
            ['agents', 'secret', 'set', 'OPENAI_API_KEY', '--value-file', valueFile],
            { cwd: packageDir, baseUrl }
          );
          expect(secret.status).toBe(0);
          const secrets = readFileSync(join(packageDir, 'secrets.enc.yaml'), 'utf8');
          expect(secrets).toContain('OPENAI_API_KEY');
          expect(secrets).not.toContain('sk-plaintext');
        }
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('secret set rejects malformed existing secrets file', async () => {
    const { root, packageDir } = makeSourceRepo();
    try {
      writeFileSync(
        join(packageDir, 'secrets.enc.yaml'),
        [
          'schemaVersion: 1',
          'secrets:',
          '  OPENAI_API_KEY:',
          '    encrypted:',
          '      algorithm: aes-256-gcm',
          '      keyId: org-key-1',
          '      nonce: abc',
          '      ciphertext: def',
          '      tag: ghi',
          '    plaintextHint: should-not-be-preserved',
          '',
        ].join('\n')
      );
      const valueFile = join(root, 'secret-value.txt');
      writeFileSync(valueFile, 'sentinel-secret-value');

      await withApiServer(
        async (request) => {
          const url = new URL(request.url);
          if (request.method !== 'POST' || url.pathname !== '/v1/source/secrets/encrypt') {
            return new Response('not found', { status: 404 });
          }
          return Response.json({
            secrets: {
              OTHER_SECRET: {
                algorithm: 'aes-256-gcm',
                keyId: 'org-key-1',
                nonce: 'abc',
                ciphertext: 'def',
                tag: 'ghi',
              },
            },
          });
        },
        async (baseUrl) => {
          const secret = await cliAsync(
            ['agents', 'secret', 'set', 'OTHER_SECRET', '--value-file', valueFile],
            { cwd: packageDir, baseUrl }
          );

          expect(secret.status).not.toBe(0);
          const secrets = readFileSync(join(packageDir, 'secrets.enc.yaml'), 'utf8');
          expect(secrets).toContain('plaintextHint: should-not-be-preserved');
          expect(secrets).not.toContain('OTHER_SECRET');
          expect(secrets).not.toContain('sentinel-secret-value');
        }
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('validate rejects plaintext secrets file', () => {
    const { root, packageDir } = makeSourceRepo();
    try {
      writeFileSync(
        join(packageDir, 'secrets.enc.yaml'),
        ['schemaVersion: 1', 'secrets:', '  OPENAI_API_KEY:', '    value: sk-plaintext', ''].join(
          '\n'
        )
      );

      const result = cli(['agents', 'validate'], { cwd: packageDir });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('secrets.enc.yaml must not contain plaintext secret values');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('status from repo root reports repository state without package validation errors', () => {
    const { root } = makeSourceRepo();
    try {
      const result = cli(['agents', 'status', '--dir', root, '--json']);

      expect(result.status).toBe(0);
      const body = JSON.parse(result.stdout);
      expect(body).toMatchObject({
        gitRoot: realpathSync(root),
        packagePath: null,
        branch: null,
        head: null,
        clean: false,
        valid: null,
        errors: [],
      });
      expect(body.dirtyCount).toBeGreaterThan(0);
      expect(body.packages).toContainEqual(
        expect.objectContaining({
          packagePath: 'agents/invoice-agent',
          clean: false,
          valid: true,
        })
      );
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

      const result = cli(['agents', 'status', '--dir', invalidPackage, '--json']);
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

      const result = spawnSync('bun', [CLI, 'agents', 'validate', packageDir, '--json'], {
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
      const doctor = cli(['agents', 'doctor', '--dir', packageDir, '--json'], { cwd: packageDir });
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
          if (url.pathname === '/v1/auth/check') {
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
          if (url.pathname === '/v1/auth/check') {
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

  test('git passthrough configures raw git credential helper for Eigenpal remotes', async () => {
    const { root } = makeSourceRepo();
    const remoteUrl = 'https://git.eigenpal.com/orgs/repo_1.git';
    try {
      git(['remote', 'add', 'origin', remoteUrl], root);

      await withApiServer(
        (request) => {
          const url = new URL(request.url);
          if (url.pathname === '/v1/auth/check') {
            return Response.json({
              ok: true,
              email: 'author@example.com',
              name: 'Source Author',
              keyId: 'ak_test',
            });
          }
          return Response.json({ error: 'not found' }, { status: 404 });
        },
        async (baseUrl) => {
          const result = await cliAsync(['git', '--', '-C', root, 'status', '--short'], {
            baseUrl,
          });
          expect(result.status).toBe(0);
        }
      );

      const helper = spawnSync(
        'git',
        ['config', '--local', '--get-all', `credential.${remoteUrl}.helper`],
        { cwd: root, encoding: 'utf8' }
      );
      expect(helper.status).toBe(0);
      expect(helper.stdout).toContain('git-credential-helper');
      expect(
        spawnSync('git', ['config', '--local', '--get', 'credential.useHttpPath'], {
          cwd: root,
          encoding: 'utf8',
        }).stdout.trim()
      ).toBe('true');
      expect(
        spawnSync('git', ['config', '--local', '--get', 'eigenpal.gitRemoteUrl'], {
          cwd: root,
          encoding: 'utf8',
        }).stdout.trim()
      ).toBe(remoteUrl);
      expect(
        spawnSync('git', ['config', '--local', '--get', 'user.name'], {
          cwd: root,
          encoding: 'utf8',
        }).stdout.trim()
      ).toBe('Source Author');
      expect(
        spawnSync('git', ['config', '--local', '--get', 'user.email'], {
          cwd: root,
          encoding: 'utf8',
        }).stdout.trim()
      ).toBe('author@example.com');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('git credential helper returns env credentials only for matching Eigenpal remote', () => {
    const { root } = makeSourceRepo();
    const remoteUrl = 'https://git.eigenpal.com/orgs/repo_1.git';
    try {
      git(['remote', 'add', 'origin', remoteUrl], root);
      git(['config', '--local', 'eigenpal.gitRemoteUrl', remoteUrl], root);

      const matching = spawnSync('bun', [CLI, 'git-credential-helper', 'get'], {
        cwd: root,
        input: 'protocol=https\nhost=git.eigenpal.com\npath=orgs/repo_1.git\n\n',
        encoding: 'utf8',
        env: { ...process.env, EIGENPAL_API_KEY: 'eig_test_key' },
      });
      expect(matching.status).toBe(0);
      expect(matching.stdout).toContain('username=eigenpal');
      expect(matching.stdout).toContain('password=eig_test_key');

      const mismatch = spawnSync('bun', [CLI, 'git-credential-helper', 'get'], {
        cwd: root,
        input: 'protocol=https\nhost=git.eigenpal.com\npath=orgs/other.git\n\n',
        encoding: 'utf8',
        env: { ...process.env, EIGENPAL_API_KEY: 'eig_test_key' },
      });
      expect(mismatch.status).toBe(0);
      expect(mismatch.stdout).toBe('');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('clone fetches the organization repository URL and rejects top-level clone alias', async () => {
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
          const clone = await cliAsync(['agents', 'clone', '--out', join(out, 'repo')], {
            baseUrl,
          });
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
        if (url.pathname === '/v1/automations' && url.searchParams.get('type') === 'agent') {
          return Response.json({
            data: [
              {
                id: 'awf_invoice',
                type: 'agent',
                slug: 'invoice-agent',
                name: 'Invoice Agent',
                description: 'Extract invoices',
                status: 'active',
                version: null,
                implementationAvailable: true,
                triggers: { api: true, email: false, manual: true, cron: false },
                createdAt: '2026-01-01T00:00:00Z',
                updatedAt: '2026-01-02T00:00:00Z',
              },
              {
                id: 'awf_unregistered',
                type: 'agent',
                slug: 'unregistered-agent',
                name: 'unregistered-agent',
                status: 'unregistered',
                version: null,
                implementationAvailable: false,
                createdAt: '2026-01-01T00:00:00Z',
              },
            ],
            total: 2,
          });
        }
        if (url.pathname === '/v1/automations/agents.invoice-agent') {
          return Response.json({
            id: 'awf_invoice',
            type: 'agent',
            slug: 'invoice-agent',
            name: 'Invoice Agent',
            description: 'Extract invoices',
            status: 'active',
            version: null,
            implementationAvailable: true,
            triggers: { api: true, email: false, manual: true, cron: false },
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-02T00:00:00Z',
          });
        }
        if (url.pathname === '/v1/source/releases') {
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
        const list = await cliAsync(['agents', 'list', '--search', 'invoice'], { baseUrl });
        expect(list.status).toBe(0);
        expect(list.stdout).toContain('invoice-agent');

        expect(list.stdout).toContain('unregistered');

        const show = await cliAsync(['agents', 'show', 'agents.invoice-agent'], { baseUrl });
        expect(show.status).toBe(0);
        expect(show.stdout).toContain('Extract invoices');
        expect(show.stdout).toContain('api,manual');

        const showBySlug = await cliAsync(['agents', 'show', 'invoice-agent', '--json'], {
          baseUrl,
        });
        expect(showBySlug.status).toBe(0);
        expect(JSON.parse(showBySlug.stdout).slug).toBe('invoice-agent');

        const showByName = await cliAsync(['agents', 'show', 'Invoice Agent', '--json'], {
          baseUrl,
        });
        expect(showByName.status).toBe(0);
        expect(JSON.parse(showByName.stdout).id).toBe('awf_invoice');

        const versions = await cliAsync(['agents', 'versions', 'agents.invoice-agent', '--json'], {
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
          if (url.pathname === '/v1/auth/check') {
            return Response.json({
              ok: true,
              email: 'releaser@example.com',
              name: 'Release User',
              keyId: 'ak_release',
            });
          }
          if (url.pathname === '/v1/source/releases' && !url.searchParams.get('version')) {
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
          if (url.pathname === '/v1/source/releases') {
            return Response.json({ packagePath: 'agents/invoice-agent', releases: [] });
          }
          if (
            request.method === 'POST' &&
            url.pathname === '/v1/automations/agents.invoice-agent/sync'
          ) {
            syncCalls.push(url.pathname);
            return Response.json({ ok: true });
          }
          return Response.json({ error: 'not found' }, { status: 404 });
        },
        async (baseUrl) => {
          const result = await cliAsync(
            ['agents', 'release', 'minor', packageDir, '-m', 'Release minor'],
            {
              baseUrl,
              cwd: packageDir,
            }
          );
          expect(result.status).toBe(0);
          expect(syncCalls).toEqual(['/v1/automations/agents.invoice-agent/sync']);

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

  test('release from builder branch saves, lands main, tags, syncs, and restores branch', async () => {
    const { root, packageDir, remote } = makePublishedSourceRepo();
    const syncCalls: string[] = [];
    try {
      git(['checkout', '-b', 'builder/invoice-agent/release-session'], root);
      writeFileSync(join(packageDir, 'AGENT.md'), 'Release-ready instructions.\n');
      await withApiServer(
        (request) => {
          const url = new URL(request.url);
          if (url.pathname === '/v1/auth/check') {
            return Response.json({
              ok: true,
              email: 'releaser@example.com',
              name: 'Release User',
              keyId: 'ak_release',
            });
          }
          if (url.pathname === '/v1/source/releases' && !url.searchParams.get('version')) {
            return Response.json({
              packagePath: 'agents/invoice-agent',
              releases: [
                {
                  version: '1.0.0',
                  tag: 'agents.invoice-agent@1.0.0',
                  commit: '111111111111',
                },
              ],
            });
          }
          if (url.pathname === '/v1/source/releases') {
            return Response.json({ packagePath: 'agents/invoice-agent', releases: [] });
          }
          if (
            request.method === 'POST' &&
            url.pathname === '/v1/automations/agents.invoice-agent/sync'
          ) {
            syncCalls.push(url.pathname);
            return Response.json({ ok: true });
          }
          return Response.json({ error: 'not found' }, { status: 404 });
        },
        async (baseUrl) => {
          const result = await cliAsync(
            ['agents', 'release', 'patch', packageDir, '-m', 'Release builder branch'],
            {
              baseUrl,
              cwd: packageDir,
            }
          );
          expect(result.status).toBe(0);
          expect(syncCalls).toEqual(['/v1/automations/agents.invoice-agent/sync']);

          const currentBranch = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
            cwd: root,
            encoding: 'utf8',
          }).stdout.trim();
          expect(currentBranch).toBe('builder/invoice-agent/release-session');

          const remoteBranch = spawnSync(
            'git',
            ['--git-dir', remote, 'rev-parse', 'builder/invoice-agent/release-session'],
            { encoding: 'utf8' }
          ).stdout.trim();
          const remoteMain = spawnSync('git', ['--git-dir', remote, 'rev-parse', 'main'], {
            encoding: 'utf8',
          }).stdout.trim();
          const tagCommit = spawnSync(
            'git',
            ['--git-dir', remote, 'rev-list', '-n', '1', 'agents.invoice-agent@1.0.1'],
            { encoding: 'utf8' }
          ).stdout.trim();
          expect(remoteMain).toBe(remoteBranch);
          expect(tagCommit).toBe(remoteMain);
        }
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(remote, { recursive: true, force: true });
    }
  });

  test('restores the builder branch after a release merge conflict', () => {
    const { root } = makeSourceRepo();
    try {
      git(['config', 'user.email', 'test@example.com'], root);
      git(['config', 'user.name', 'Test User'], root);
      git(['add', '.'], root);
      git(['commit', '-m', 'Initial source'], root);

      git(['checkout', '-b', 'builder/invoice-agent/conflict-session'], root);
      writeFileSync(join(root, 'agents/invoice-agent/new-file.txt'), 'builder draft\n');
      git(['add', '.'], root);
      git(['commit', '-m', 'Add builder draft'], root);

      git(['checkout', 'main'], root);
      writeFileSync(join(root, 'agents/invoice-agent/new-file.txt'), 'main repair\n');
      git(['add', '.'], root);
      git(['commit', '-m', 'Repair source on main'], root);

      const merge = spawnSync(
        'git',
        ['merge', '--no-edit', 'builder/invoice-agent/conflict-session'],
        { cwd: root, encoding: 'utf8' }
      );
      expect(merge.status).not.toBe(0);

      checkoutOriginalBranch(root, 'builder/invoice-agent/conflict-session');

      expect(
        spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
          cwd: root,
          encoding: 'utf8',
        }).stdout.trim()
      ).toBe('builder/invoice-agent/conflict-session');
      expect(
        spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).stdout
      ).toBe('');
      expect(readFileSync(join(root, 'agents/invoice-agent/new-file.txt'), 'utf8')).toBe(
        'builder draft\n'
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('sync accepts bare agent slugs as shorthand', async () => {
    const { root } = makePublishedSourceRepo();
    const syncCalls: string[] = [];
    try {
      await withApiServer(
        (request) => {
          const url = new URL(request.url);
          if (
            request.method === 'POST' &&
            url.pathname === '/v1/automations/agents.invoice-agent/sync'
          ) {
            syncCalls.push(url.pathname);
            return Response.json({ ok: true });
          }
          return Response.json({ error: 'not found' }, { status: 404 });
        },
        async (baseUrl) => {
          const result = await cliAsync(['agents', 'sync', 'invoice-agent', '--dir', root], {
            baseUrl,
          });
          expect(result.status).toBe(0);
          expect(syncCalls).toEqual(['/v1/automations/agents.invoice-agent/sync']);
        }
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('release skips automation sync for resource packages', async () => {
    const { root, packageDir, remote } = makePublishedSourceRepo('resources/knowledge/facts');
    const syncCalls: string[] = [];
    try {
      await withApiServer(
        (request) => {
          const url = new URL(request.url);
          if (url.pathname === '/v1/auth/check') {
            return Response.json({
              ok: true,
              email: 'releaser@example.com',
              name: 'Release User',
              keyId: 'ak_release',
            });
          }
          if (url.pathname === '/v1/source/releases') {
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
            ['agents', 'release', '1.0.0', packageDir, '-m', 'Release facts'],
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

  test('release uses a default tag message when -m is omitted', async () => {
    const { root, packageDir, remote } = makePublishedSourceRepo('resources/knowledge/facts');
    try {
      await withApiServer(
        (request) => {
          const url = new URL(request.url);
          if (url.pathname === '/v1/auth/check') {
            return Response.json({
              ok: true,
              email: 'releaser@example.com',
              name: 'Release User',
              keyId: 'ak_release',
            });
          }
          if (url.pathname === '/v1/source/releases') {
            return Response.json({ packagePath: 'resources/knowledge/facts', releases: [] });
          }
          return Response.json({ error: 'not found' }, { status: 404 });
        },
        async (baseUrl) => {
          const result = await cliAsync(['agents', 'release', '1.0.0', packageDir], {
            baseUrl,
            cwd: packageDir,
          });
          expect(result.status).toBe(0);

          const tagMessage = spawnSync(
            'git',
            [
              '--git-dir',
              remote,
              'tag',
              '-l',
              '--format=%(contents)',
              'resources.knowledge.facts@1.0.0',
            ],
            { encoding: 'utf8' }
          ).stdout.trim();
          expect(tagMessage).toBe('Release resources/knowledge/facts');
        }
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(remote, { recursive: true, force: true });
    }
  });

  test('sync fails when the server sync endpoint is unavailable', async () => {
    await withApiServer(
      () =>
        new Response('<!doctype html><title>404</title>', {
          status: 404,
          headers: { 'content-type': 'text/html' },
        }),
      async (baseUrl) => {
        const result = await cliAsync(['agents', 'sync', 'agents.invoice-agent'], { baseUrl });
        expect(result.status).not.toBe(0);
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
            ['agents', 'release', '1.0.0', dirty.packageDir, '-m', 'Release'],
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
            ['agents', 'release', '1.0.0', unpushed.packageDir, '-m', 'Release'],
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
      const result = cli(['agents', 'validate', compatible.packageDir, '--json']);
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
      const result = cli(['agents', 'release', '1.0.0', incompatible.packageDir, '-m', 'Release'], {
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

      const result = cli(['agents', 'install'], { cwd: packageDir });
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

      const frozen = cli(['agents', 'install', '--frozen-lockfile'], { cwd: packageDir });
      expect(frozen.status).toBe(0);

      const lockfilePath = join(packageDir, '.eigenpal', 'eigenpal.lock');
      const validLockfile = readFileSync(lockfilePath, 'utf8');
      writeFileSync(
        join(packageDir, 'eigenpal.yaml'),
        [
          'schemaVersion: 1',
          'name: Invoice Agent',
          'description: Extract invoices',
          'dependencies:',
          '  workspace:resources.knowledge.jokes: 2.0.0',
          '',
        ].join('\n')
      );
      const frozenMismatch = cli(['agents', 'install', '--frozen-lockfile'], { cwd: packageDir });
      expect(frozenMismatch.status).toBe(1);
      expect(frozenMismatch.stderr).toContain('does not match current package inputs');
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

      const invalidLockfile = JSON.parse(validLockfile);
      invalidLockfile.root.dependencies[0].packagePath = '../escape';
      writeFileSync(lockfilePath, `${JSON.stringify(invalidLockfile, null, 2)}\n`);
      const invalidFrozen = cli(['agents', 'install', '--frozen-lockfile'], { cwd: packageDir });
      expect(invalidFrozen.status).toBe(1);
      expect(invalidFrozen.stderr).toContain('Invalid lockfile');
      writeFileSync(lockfilePath, validLockfile);

      const out = mkdtempSync(join(tmpdir(), 'eigenpal-install-out-'));
      const packageRef = cli(
        ['agents', 'install', 'resources.knowledge.jokes@1.0.0', '--out', out],
        {
          cwd: packageDir,
        }
      );
      expect(packageRef.status).toBe(0);
      expect(existsSync(join(out, 'README.md'))).toBe(true);
      rmSync(join(out, 'README.md'), { force: true });
      const frozenPackageRef = cli(
        ['agents', 'install', 'resources.knowledge.jokes@1.0.0', '--out', out, '--frozen-lockfile'],
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
      const mismatch = cli(['agents', 'install'], { cwd: packageDir });
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
        ['agents', 'init', 'Dad Joke Generator', '--template', 'agent', '--dir', root],
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

  test('save validates, commits, and pushes current branch to origin', async () => {
    const { root, packageDir, remote } = makePublishedSourceRepo();
    try {
      git(['checkout', '-b', 'builder/invoice-agent/test-session'], root);
      writeFileSync(join(packageDir, 'AGENT.md'), 'Changed instructions.\n');
      await withApiServer(
        (request) => {
          const url = new URL(request.url);
          if (url.pathname === '/v1/auth/check') {
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
          const save = await cliAsync(['agents', 'save', '-m', 'Update agent'], {
            baseUrl,
            cwd: root,
          });
          expect(save.status).toBe(0);
          expect(
            spawnSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' }).stdout
          ).toBe('');

          const remoteBranch = spawnSync(
            'git',
            ['--git-dir', remote, 'rev-parse', 'builder/invoice-agent/test-session'],
            {
              encoding: 'utf8',
            }
          ).stdout.trim();
          const localHead = spawnSync('git', ['rev-parse', 'HEAD'], {
            cwd: root,
            encoding: 'utf8',
          }).stdout.trim();
          const remoteMain = spawnSync('git', ['--git-dir', remote, 'rev-parse', 'main'], {
            encoding: 'utf8',
          }).stdout.trim();
          const localMain = spawnSync('git', ['rev-parse', 'main'], {
            cwd: root,
            encoding: 'utf8',
          }).stdout.trim();
          expect(remoteBranch).toBe(localHead);
          expect(remoteMain).toBe(localMain);
        }
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(remote, { recursive: true, force: true });
    }
  });

  test('commit includes dirty shared resources', async () => {
    const { root, packageDir, remote } = makePublishedSourceRepo();
    try {
      mkdirSync(join(root, 'resources', 'knowledge'), { recursive: true });
      writeFileSync(join(root, 'resources', 'knowledge', 'tone.md'), 'Prefer concise answers.\n');
      await withApiServer(
        (request) => {
          const url = new URL(request.url);
          if (url.pathname === '/v1/auth/check') {
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
          const commit = await cliAsync(['agents', 'commit', '-m', 'Update shared resource'], {
            baseUrl,
            cwd: packageDir,
          });
          expect(commit.status).toBe(0);
          expect(
            spawnSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' }).stdout
          ).toBe('');
          expect(
            spawnSync('git', ['show', '--name-only', '--format=', 'HEAD'], {
              cwd: root,
              encoding: 'utf8',
            }).stdout
          ).toContain('resources/knowledge/tone.md');
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
      const result = cli(['agents', 'upgrade'], { cwd: packageDir });
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

describe('retrySyncRequest', () => {
  const zeroDelay = { delayMs: () => 0 };

  test('retries gateway 503s and resolves once the request succeeds', async () => {
    let calls = 0;
    await retrySyncRequest(async () => {
      calls++;
      if (calls <= 2) throw new ApiError(503, { error: 'unavailable' });
    }, zeroDelay);

    expect(calls).toBe(3);
  });

  test('does not retry a non-gateway status like 401', async () => {
    let calls = 0;
    await expect(
      retrySyncRequest(async () => {
        calls++;
        throw new ApiError(401, { error: 'unauthorized' });
      }, zeroDelay)
    ).rejects.toMatchObject({ status: 401 });

    expect(calls).toBe(1);
  });

  test('does not retry a plain 500 — only 502/503/504 are gateway statuses', async () => {
    let calls = 0;
    await expect(
      retrySyncRequest(async () => {
        calls++;
        throw new ApiError(500, { error: 'boom' });
      }, zeroDelay)
    ).rejects.toMatchObject({ status: 500 });

    expect(calls).toBe(1);
  });

  test('gives up after the default attempt budget when 503s never stop', async () => {
    let calls = 0;
    await expect(
      retrySyncRequest(async () => {
        calls++;
        throw new ApiError(503, { error: 'unavailable' });
      }, zeroDelay)
    ).rejects.toMatchObject({ status: 503 });

    // Default budget is 4 attempts: 3 retries after the first failure.
    expect(calls).toBe(4);
  });
});
