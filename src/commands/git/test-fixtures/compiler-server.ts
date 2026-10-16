// HTTP fixture for the CLI's trusted JSON-only test definitions. It never
// imports or executes submitted code. Real compilation is covered by the
// Git server's cross-process integration tests.
import { createHash } from 'node:crypto';
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  async fetch(request) {
    if (request.headers.get('authorization') !== 'Bearer eig_test_key')
      return new Response(null, { status: 401 });
    try {
      const source = await request.json();
      const text = source.files?.['agent.ts'];
      const match =
        typeof text === 'string' && /export default createAgent\(([\s\S]*)\);\s*$/.exec(text);
      if (!match) return Response.json({ error: 'Unknown test definition' }, { status: 422 });
      const { inputSchema, outputSchema, ...config } = JSON.parse(match[1]!);
      const digest = createHash('sha256').update(text).digest('hex');
      return Response.json({
        definition: {
          schemaVersion: 1,
          kind: 'agent',
          manifest: { schemaVersion: 1, ...config },
          ...(inputSchema === undefined ? {} : { inputSchema }),
          ...(outputSchema === undefined ? {} : { outputSchema }),
        },
        sourceSha256: digest,
        bundleSha256: digest,
        toolchain: { sdkVersion: '0.20.52', zodVersion: '4.4.3', bunVersion: Bun.version },
      });
    } catch {
      return Response.json({ error: 'Invalid test definition' }, { status: 422 });
    }
  },
});
console.log(server.port);
