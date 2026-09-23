import { describe, expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'cli.ts');

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
}

// Template-free workflow (no local `template:` paths), so the push gate can
// compare bytes without staging anything.
const YAML = `name: demo
version: 1.0.0
description: Duplicate-push fixture.
triggerMethods:
  - type: api
inputs:
  - name: text
    type: string
    description: Free-form text to process
steps:
  - name: passthrough
    type: transform.script
    with:
      inputs:
        text: '{{ input.text }}'
      function: |
        function script(text: string): { length: number; original: string } {
          return { length: text.length, original: text };
        }
output:
  length: '{{ steps.passthrough.output.length }}'
  original: '{{ steps.passthrough.output.original }}'
`;

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

function runCli(
  args: string[],
  baseUrl: string
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('bun', [CLI, ...args], {
      env: {
        ...process.env,
        EIGENPAL_API_KEY: 'eig_test_key',
        EIGENPAL_BASE_URL: baseUrl,
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

describe('workflow push duplicate version', () => {
  test('byte-identical re-push with --json reports { unchanged: true } and stays silent on stderr', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eig-push-duplicate-'));
    const calls: string[] = [];
    try {
      const yamlPath = join(dir, 'workflow.yaml');
      writeFileSync(yamlPath, YAML);
      await withApiServer(
        (request) => {
          const url = new URL(request.url);
          calls.push(`${request.method} ${url.pathname}`);
          if (request.method === 'GET' && url.pathname === '/api/workflows/wf_dup1') {
            return jsonResponse({
              id: 'wf_dup1',
              currentVersion: { version: '1.0.0', yamlContent: YAML },
            });
          }
          if (request.method === 'POST' && url.pathname === '/api/workflows/validate') {
            return jsonResponse({ valid: true, issues: [] });
          }
          if (request.method === 'GET' && url.pathname === '/api/workflows/wf_dup1/versions') {
            return jsonResponse({ data: [{ version: '1.0.0' }], total: 1 });
          }
          return jsonResponse({ error: 'not found' }, { status: 404 });
        },
        async (baseUrl) => {
          const result = await runCli(
            ['workflow', 'push', '--file', yamlPath, '--workflow-id', 'wf_dup1', '--json'],
            baseUrl
          );
          expect(result.status).toBe(0);
          // The whole point: stdout stays parseable JSON on a no-op.
          expect(JSON.parse(result.stdout)).toEqual({
            unchanged: true,
            workflowId: 'wf_dup1',
            version: '1.0.0',
          });
          // ... and nothing leaks to stderr, so `2>&1 | jq` parses too.
          expect(result.stderr).toBe('');
          // No version was created — the gate absorbed the push.
          expect(calls).not.toContain('POST /api/workflows/wf_dup1/versions');
        }
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('same version with different content stays a loud version-conflict error', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eig-push-conflict-'));
    try {
      const yamlPath = join(dir, 'workflow.yaml');
      writeFileSync(yamlPath, YAML);
      await withApiServer(
        (request) => {
          const url = new URL(request.url);
          if (request.method === 'GET' && url.pathname === '/api/workflows/wf_dup1') {
            return jsonResponse({
              id: 'wf_dup1',
              currentVersion: { version: '1.0.0', yamlContent: 'name: something-else-entirely' },
            });
          }
          if (request.method === 'POST' && url.pathname === '/api/workflows/validate') {
            return jsonResponse({ valid: true, issues: [] });
          }
          if (request.method === 'GET' && url.pathname === '/api/workflows/wf_dup1/versions') {
            return jsonResponse({ data: [{ version: '1.0.0' }], total: 1 });
          }
          return jsonResponse({ error: 'not found' }, { status: 404 });
        },
        async (baseUrl) => {
          const result = await runCli(
            ['workflow', 'push', '--file', yamlPath, '--workflow-id', 'wf_dup1', '--json'],
            baseUrl
          );
          expect(result.status).not.toBe(0);
          expect(result.stderr).toMatch(/already exists/);
        }
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
