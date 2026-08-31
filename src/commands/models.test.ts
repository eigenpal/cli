import { describe, expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'cli.ts');

function json(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
}

async function withServer(
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
  opts: { baseUrl?: string } = {}
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('bun', [CLI, ...args], {
      env: {
        ...process.env,
        EIGENPAL_API_KEY: 'eig_test_key',
        ...(opts.baseUrl ? { EIGENPAL_BASE_URL: opts.baseUrl } : {}),
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

describe('eigenpal models list', () => {
  test('prints JSON catalog without inventing health=healthy', async () => {
    let capturedPath = '';
    await withServer(
      async (request) => {
        capturedPath = new URL(request.url).pathname + new URL(request.url).search;
        return json({
          data: [
            {
              id: 'anthropic/claude-sonnet-4-6',
              kind: 'llm',
              provider: 'anthropic',
              capabilities: ['text', 'vision'],
              configured: true,
              available: true,
              health: 'configured',
              defaultFor: ['text', 'vision'],
              location: 'hosted',
              aliases: [],
              tags: [],
            },
          ],
          total: 1,
        });
      },
      async (baseUrl) => {
        const result = await runCli(['models', 'list', '--json', '--base-url', baseUrl], {
          baseUrl,
        });
        expect(result.status).toBe(0);
        expect(capturedPath).toBe('/v1/models');
        const body = JSON.parse(result.stdout) as {
          data: Array<{ health: string; id: string }>;
        };
        expect(body.data[0]?.id).toBe('anthropic/claude-sonnet-4-6');
        expect(body.data[0]?.health).toBe('configured');
        expect(result.stdout).not.toContain('healthy');
        expect(result.stdout).not.toContain('apiKey');
      }
    );
  });

  test('forwards --capability to the API', async () => {
    let capturedPath = '';
    await withServer(
      async (request) => {
        capturedPath = new URL(request.url).pathname + new URL(request.url).search;
        return json({ data: [], total: 0 });
      },
      async (baseUrl) => {
        const result = await runCli(
          ['models', 'list', '--capability', 'ocr', '--json', '--base-url', baseUrl],
          { baseUrl }
        );
        expect(result.status).toBe(0);
        expect(capturedPath).toBe('/v1/models?capability=ocr');
      }
    );
  });
});
