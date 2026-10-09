import pkg from '../../package.json' with { type: 'json' };

/**
 * Client identity headers sent on every API request, in the same shape as the
 * TypeScript SDK (`X-Eigenpal-Sdk-*` plus a matching `User-Agent`). The server
 * logs them per request, and the `User-Agent` lets request logs tell CLI
 * traffic apart from SDK, browser and bot traffic, including failed requests.
 */

// `0.0.0-placeholder` is the source value; release rewrites it to the real semver.
export const CLI_VERSION = pkg.version === '0.0.0-placeholder' ? 'dev' : pkg.version;

function detectRuntime(): string {
  const bun = (globalThis as { Bun?: { version: string } }).Bun;
  if (bun?.version) return `bun-${bun.version}`;
  return `node-${process.versions.node}`;
}

export function buildCliTelemetryHeaders(): Record<string, string> {
  const runtime = detectRuntime();
  const os = `${process.platform}-${process.arch}`;
  return {
    'X-Eigenpal-Sdk': 'cli',
    'X-Eigenpal-Sdk-Version': CLI_VERSION,
    'X-Eigenpal-Sdk-Runtime': runtime,
    'X-Eigenpal-Sdk-Os': os,
    'User-Agent': `eigenpal-cli/${CLI_VERSION} (${runtime}; ${os})`,
  };
}
