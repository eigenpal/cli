import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  configureSourceGitRepo,
  gitAuthorEnv,
  gitBootstrapAuthEnv,
  resolveGitAuthorIdentity,
  sourceRepositoryFromRemoteUrl,
} from './source-git';

function git(args: string[], cwd?: string): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

function makeSourceRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'eigenpal-source-git-'));
  git(['init', '-b', 'main', root]);
  mkdirSync(join(root, 'agents', 'invoice-agent'), { recursive: true });
  writeFileSync(join(root, 'eigenpal.yaml'), 'schemaVersion: 1\neigenpalVersion: 1.0.0\n');
  writeFileSync(
    join(root, 'agents', 'invoice-agent', 'eigenpal.yaml'),
    'schemaVersion: 1\nname: Invoice Agent\ndescription: Extract invoices\n'
  );
  writeFileSync(join(root, 'agents', 'invoice-agent', 'AGENT.md'), 'Extract invoices.\n');
  git(['config', 'user.email', 'test@example.com'], root);
  git(['config', 'user.name', 'Test User'], root);
  git(['add', '.'], root);
  git(['commit', '-m', 'Initial source'], root);
  git(['config', '--local', '--unset', 'user.email'], root);
  git(['config', '--local', '--unset', 'user.name'], root);
  return root;
}

describe('source git setup', () => {
  test('source-mode helper survives a Homebrew runtime upgrade', async () => {
    const root = makeSourceRepo();
    const prefix = join(root, "brew's prefix");
    const runtime = join(prefix, 'Cellar', 'bun', '1.0', 'bin', 'bun');
    const stable = join(prefix, 'bin', 'bun');
    const remoteUrl = 'https://git.eigenpal.com/orgs/repo_1.git';
    const originalArgv = process.argv;
    const originalOverride = process.env.EIGENPAL_CLI_HELPER_COMMAND;
    const originalName = process.env.GIT_AUTHOR_NAME;
    const originalEmail = process.env.GIT_AUTHOR_EMAIL;
    const installRuntime = (file: string) => {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, '#!/bin/sh\nprintf "username=fixture\\npassword=fixture\\n\\n"\n');
      chmodSync(file, 0o755);
    };
    try {
      installRuntime(runtime);
      mkdirSync(dirname(stable), { recursive: true });
      process.argv = [runtime, join(root, 'packages/cli/src/cli.ts')];
      delete process.env.EIGENPAL_CLI_HELPER_COMMAND;
      process.env.GIT_AUTHOR_NAME = 'Fixture';
      process.env.GIT_AUTHOR_EMAIL = 'fixture@example.com';
      const configure = () =>
        configureSourceGitRepo({
          gitRoot: root,
          remoteUrl,
          config: { baseUrl: 'http://127.0.0.1:1', apiKey: 'fixture', dir: '.' },
        });
      const helper = () =>
        git(['config', '--local', '--get', `credential.${remoteUrl}.helper`], root);

      // A missing or unrelated prefix binary must not replace the working runtime.
      await configure();
      expect(helper()).toContain('/Cellar/bun/1.0/bin/bun');
      const unrelated = join(prefix, 'unrelated-bun');
      installRuntime(unrelated);
      symlinkSync(unrelated, stable);
      await configure();
      expect(helper()).toContain('/Cellar/bun/1.0/bin/bun');
      rmSync(stable);
      symlinkSync(runtime, stable);
      await configure();
      expect(helper()).not.toContain('/Cellar/');

      process.env.EIGENPAL_CLI_HELPER_COMMAND = 'custom-helper get';
      await configure();
      expect(helper()).toBe('!custom-helper get');
      delete process.env.EIGENPAL_CLI_HELPER_COMMAND;
      process.argv = [runtime, join(root, 'dist/cli.js')];
      await configure();
      expect(helper()).toBe('!eigenpal git-credential-helper');
      process.argv = [runtime, join(root, 'packages/cli/src/cli.ts')];
      await configure();

      // A Homebrew upgrade removes the old Cellar binary and retargets the stable symlink.
      rmSync(runtime);
      rmSync(stable);
      const upgraded = join(prefix, 'Cellar', 'bun', '2.0', 'bin', 'bun');
      installRuntime(upgraded);
      symlinkSync(upgraded, stable);
      const result = spawnSync('git', ['credential', 'fill'], {
        cwd: root,
        encoding: 'utf8',
        input: `url=${remoteUrl}\n\n`,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('password=fixture');
    } finally {
      process.argv = originalArgv;
      for (const [name, value] of Object.entries({
        EIGENPAL_CLI_HELPER_COMMAND: originalOverride,
        GIT_AUTHOR_NAME: originalName,
        GIT_AUTHOR_EMAIL: originalEmail,
      })) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('recognizes Eigenpal organization remotes only', () => {
    expect(sourceRepositoryFromRemoteUrl('https://git.eigenpal.com/orgs/org_123.git')).toEqual({
      gitRepositoryPath: 'org_123',
      remoteUrl: 'https://git.eigenpal.com/orgs/org_123.git',
    });
    expect(sourceRepositoryFromRemoteUrl('https://github.com/eigenpal/eigenpal.git')).toBeNull();
  });

  test('bootstrap env uses Basic auth only for Eigenpal Git remotes', () => {
    const config = { baseUrl: 'https://studio.eigenpal.com', apiKey: 'eig_test_key', dir: '.' };
    const env = gitBootstrapAuthEnv(config, {}, 'https://git.eigenpal.com/orgs/org_123.git');
    expect(env.GIT_CONFIG_KEY_0).toBe('http.https://git.eigenpal.com/orgs/org_123.git.extraHeader');
    expect(env.GIT_CONFIG_VALUE_0).toStartWith('Authorization: Basic ');

    const githubEnv = gitBootstrapAuthEnv(config, {}, 'https://github.com/eigenpal/eigenpal.git');
    expect(githubEnv.GIT_CONFIG_KEY_0).toBeUndefined();
  });

  test('resolves author identity and commit env from auth check', async () => {
    const server = Bun.serve({
      port: 0,
      fetch(request) {
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
    });
    try {
      const identity = await resolveGitAuthorIdentity({
        baseUrl: `http://127.0.0.1:${server.port}`,
        apiKey: 'eig_test_key',
        dir: '.',
      });
      expect(identity).toEqual({ name: 'Source Author', email: 'author@example.com' });
      expect(gitAuthorEnv(identity)).toMatchObject({
        GIT_AUTHOR_NAME: 'Source Author',
        GIT_AUTHOR_EMAIL: 'author@example.com',
        GIT_COMMITTER_NAME: 'Source Author',
        GIT_COMMITTER_EMAIL: 'author@example.com',
      });
    } finally {
      await server.stop(true);
    }
  });

  test('configures helper, path scoping, and local author without writing secrets', async () => {
    const root = makeSourceRepo();
    const remoteUrl = 'https://git.eigenpal.com/orgs/repo_1.git';
    const server = Bun.serve({
      port: 0,
      fetch(request) {
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
    });
    try {
      git(['remote', 'add', 'origin', remoteUrl], root);
      await configureSourceGitRepo({
        gitRoot: root,
        remoteUrl,
        config: {
          baseUrl: `http://127.0.0.1:${server.port}`,
          apiKey: 'eig_test_key',
          dir: '.',
        },
      });

      expect(git(['config', '--local', '--get', 'credential.useHttpPath'], root)).toBe('true');
      expect(
        git(['config', '--local', '--get-all', `credential.${remoteUrl}.helper`], root)
      ).toContain('git-credential-helper');
      expect(git(['config', '--local', '--get', 'user.name'], root)).toBe('Source Author');
      expect(git(['config', '--local', '--get', 'user.email'], root)).toBe('author@example.com');
      expect(git(['config', '--local', '--list'], root)).not.toContain('eig_test_key');
    } finally {
      await server.stop(true);
      rmSync(root, { recursive: true, force: true });
    }
  });
});
