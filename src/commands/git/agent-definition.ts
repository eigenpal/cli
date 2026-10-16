import { CompiledAgentSnapshotSchema, type CompiledAgentSnapshot } from '@eigenpal/types';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ApiClient } from '../../lib/client';
import { resolveConfig, type CliConfig } from '../../lib/config';

/** Capture source only. The CLI never imports or executes the user's definition. */
export function captureAgentSource(root: string): {
  entry: 'agent.ts';
  files: Record<string, string>;
} {
  for (const name of ['eigenpal.yaml', 'eigenpal.yml', 'input-schema.json', 'output-schema.json'])
    if (existsSync(path.join(root, name)))
      throw new Error('Define the agent manifest and schemas exclusively in agent.ts');
  const files: Record<string, string> = {};
  let bytes = 0;
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (['.git', '.eigenpal', 'eigenpal_modules', 'node_modules'].includes(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join('/');
      const stat = lstatSync(absolute);
      if (stat.isDirectory()) {
        visit(absolute);
        continue;
      }
      if (!/\.(ts|js)$/.test(relative)) continue;
      if (!stat.isFile() || !/^[a-zA-Z0-9_./-]+\.(ts|js)$/.test(relative))
        throw new Error('Agent modules must be regular package-local files');
      bytes += stat.size + Buffer.byteLength(relative);
      if (Object.keys(files).length >= 32 || bytes > 256 * 1024)
        throw new Error('Agent source exceeds the compilation limit');
      files[relative] = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
        readFileSync(absolute)
      );
    }
  };
  visit(root);
  if (!Object.hasOwn(files, 'agent.ts'))
    throw new Error('Agent entry must be a regular agent.ts file');
  return { entry: 'agent.ts', files };
}

export async function compileLocalAgent(
  root: string,
  config?: CliConfig
): Promise<CompiledAgentSnapshot> {
  const source = captureAgentSource(root);
  return CompiledAgentSnapshotSchema.parse(
    await new ApiClient(config ?? resolveConfig({})).post('/v1/source/agent-definition', source)
  );
}
