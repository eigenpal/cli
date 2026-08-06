import { describe, expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'cli.ts');

function runCli(
  args: string[],
  opts: { baseUrl: string; cwd?: string }
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('bun', [CLI, ...args], {
      cwd: opts.cwd,
      env: {
        ...process.env,
        EIGENPAL_API_KEY: 'eig_test_key',
        EIGENPAL_BASE_URL: opts.baseUrl,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (status) => {
      resolvePromise({ status, stdout, stderr });
    });
  });
}

async function withAgentFileServer(fn: (baseUrl: string, calls: string[]) => Promise<void>) {
  const calls: string[] = [];
  const json = (body: unknown, init?: ResponseInit) =>
    new Response(JSON.stringify(body), {
      ...init,
      headers: { 'content-type': 'application/json', ...init?.headers },
    });
  const server = Bun.serve({
    port: 0,
    fetch: (request) => {
      const url = new URL(request.url);
      calls.push(`${request.method} ${url.pathname}${url.search}`);
      if (url.pathname.includes('/v1/agents/') && url.pathname.endsWith('/files')) {
        return json({ error: 'removed route called' }, { status: 410 });
      }
      if (request.method === 'GET' && url.pathname === '/v1/automations/agents.invoice-agent') {
        return json({ id: 'awf_1', type: 'agent', slug: 'invoice-agent', name: 'Invoice Agent' });
      }
      if (request.method === 'GET' && url.pathname === '/v1/source/tree') {
        expect(url.searchParams.get('packagePath')).toBe('agents/invoice-agent');
        return json({
          ref: 'main',
          packagePath: 'agents/invoice-agent',
          files: ['AGENT.md', 'knowledge/rules.md'],
        });
      }
      if (request.method === 'GET' && url.pathname === '/v1/source/raw') {
        expect(url.searchParams.get('path')).toBe('agents/invoice-agent/AGENT.md');
        return json({
          ref: 'main',
          path: 'agents/invoice-agent/AGENT.md',
          contentType: 'text/markdown',
          content: 'hello\n',
        });
      }
      return json({ error: `Unexpected ${request.method} ${url.pathname}` }, { status: 404 });
    },
  });
  try {
    await fn(`http://127.0.0.1:${server.port}`, calls);
  } finally {
    await server.stop(true);
  }
}

describe('agent file commands', () => {
  test('list reads from the internal source tree endpoint', async () => {
    await withAgentFileServer(async (baseUrl, calls) => {
      const result = await runCli(
        ['agents', 'file', 'list', 'invoice-agent', '--path', 'knowledge', '--json'],
        { baseUrl }
      );

      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        ref: 'main',
        packagePath: 'agents/invoice-agent',
        files: ['AGENT.md', 'knowledge/rules.md'],
      });
      expect(calls.some((call) => call.includes('/v1/agents/') && call.endsWith('/files'))).toBe(
        false
      );
      expect(calls).toContain(
        'GET /v1/source/tree?packagePath=agents%2Finvoice-agent&prefix=knowledge'
      );
    });
  });

  test('get and diff read single files from source raw', async () => {
    await withAgentFileServer(async (baseUrl, calls) => {
      const dir = mkdtempSync(join(tmpdir(), 'eigenpal-agent-files-'));
      const out = join(dir, 'AGENT.md');
      const local = join(dir, 'local.md');
      try {
        writeFileSync(local, 'hello\n');

        const getResult = await runCli(
          ['agents', 'file', 'get', 'invoice-agent', 'agent/AGENT.md', '--out', out],
          { baseUrl, cwd: dir }
        );
        expect(getResult.status).toBe(0);
        expect(readFileSync(out, 'utf8')).toBe('hello\n');

        const diffResult = await runCli(
          ['agents', 'file', 'diff', 'invoice-agent', 'AGENT.md', local, '--json'],
          { baseUrl, cwd: dir }
        );
        expect(diffResult.status).toBe(0);
        expect(JSON.parse(diffResult.stdout)).toMatchObject({
          agentId: 'invoice-agent',
          path: 'AGENT.md',
          status: 'match',
        });
        expect(calls.filter((call) => call.startsWith('GET /v1/source/raw'))).toHaveLength(2);
        expect(calls.some((call) => call.includes('/v1/agents/') && call.endsWith('/files'))).toBe(
          false
        );
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
