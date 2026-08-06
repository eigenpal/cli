import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
