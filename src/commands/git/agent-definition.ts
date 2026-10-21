import {
  CompiledAgentSnapshotSchema,
  definitionAssetImports,
  definitionImportCandidates,
  definitionImports,
  isResourceAssetPath,
  resourceDefinitionSource,
  resourceDirectory,
  sourceFileText,
  type CapturedSourceFile,
  type CompiledAgentSnapshot,
} from '@eigenpal/types';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { ApiClient } from '../../lib/client';
import { resolveConfig, type CliConfig } from '../../lib/config';

/** Capture source only. The CLI never imports or executes the user's definition. */
export function captureAgentSource(
  root: string,
  filename = 'agent.ts'
): {
  entry: string;
  files: Record<string, CapturedSourceFile>;
} {
  for (const name of filename === 'resource.ts'
    ? ['eigenpal.yaml', 'eigenpal.yml']
    : ['eigenpal.yaml', 'eigenpal.yml', 'input-schema.json', 'output-schema.json'])
    if (existsSync(path.join(root, name)))
      throw new Error('Define the agent manifest and schemas exclusively in agent.ts');
  let project = root;
  while (
    !existsSync(path.join(project, 'eigenpal.yaml')) &&
    !existsSync(path.join(project, '.git')) &&
    path.dirname(project) !== project
  )
    project = path.dirname(project);
  if (path.dirname(project) === project) project = root;
  const entry = path.relative(project, path.join(root, filename)).split(path.sep).join('/');
  const scope = path.relative(project, root).split(path.sep).join('/');
  const files: Record<string, CapturedSourceFile> = Object.create(null);
  const regularFile = (relative: string) => {
    const components = relative.split('/');
    for (let n = 1; n <= components.length; n++)
      if (lstatSync(path.join(project, ...components.slice(0, n))).isSymbolicLink())
        throw new Error('Resource imports cannot follow symlinks');
    const stat = lstatSync(path.join(project, relative));
    if (!stat.isFile()) throw new Error('Definition imports must be regular files');
    return stat;
  };
  let bytes = 0;
  for (const name of [filename, ...(filename === 'agent.ts' ? ['AGENT.md'] : [])]) {
    const absolute = path.join(root, name);
    if (!existsSync(absolute)) continue;
    const relative = path.posix.join(scope, name);
    bytes += regularFile(relative).size + Buffer.byteLength(relative);
    if (bytes > 2 * 1024 * 1024) throw new Error('Agent source exceeds compilation limit');
    const data = readFileSync(absolute);
    if (bytes > 2 * 1024 * 1024) throw new Error('Agent source exceeds compilation limit');
    files[relative] = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data);
  }
  const queue = [entry];
  const queued = new Set(queue);
  for (let i = 0; i < queue.length; i++) {
    const importer = queue[i]!;
    if (!/\.(ts|js)$/.test(importer)) continue;
    const directory = resourceDirectory(importer);
    if (directory) {
      const walk = (folder: string) => {
        for (const item of readdirSync(path.join(project, directory, folder), {
          withFileTypes: true,
        })) {
          const local = path.posix.join(folder, item.name);
          if (!isResourceAssetPath(local)) continue;
          if (item.isSymbolicLink())
            throw new Error('Resource directories cannot contain symlinks');
          if (item.isDirectory()) {
            walk(local);
            continue;
          }
          const relative = path.posix.join(directory, local);
          if (Object.hasOwn(files, relative)) continue;
          const stat = regularFile(relative);
          bytes += Math.ceil(stat.size / 3) * 4 + Buffer.byteLength(relative);
          if (Object.keys(files).length >= 128 || bytes > 2 * 1024 * 1024)
            throw new Error('Agent source exceeds compilation limit');
          files[relative] = {
            encoding: 'base64',
            content: readFileSync(path.join(project, relative)).toString('base64'),
            ...(stat.mode & 0o111 ? { executable: true } : {}),
          };
        }
      };
      walk('');
    }

    for (const specifier of definitionImports(sourceFileText(files[importer]!))) {
      const candidates = definitionImportCandidates(importer, specifier);
      if (!candidates.length) continue;
      const selected = candidates.find((candidate) => existsSync(path.join(project, candidate)));
      if (!selected) throw new Error('Definition import not found');
      const assetMode = definitionAssetImports(sourceFileText(files[importer]!)).get(specifier);
      if (Object.hasOwn(files, selected)) {
        if (!assetMode && !queued.has(selected)) {
          queued.add(selected);
          queue.push(selected);
        }
        continue;
      }
      if (!selected.startsWith('resources/') && !(scope === '' || selected.startsWith(scope + '/')))
        throw new Error('Only this agent and shared resource imports are allowed');
      const absolute = path.join(project, selected);
      const size = regularFile(selected).size;
      bytes +=
        (assetMode === 'bytes' ? Math.ceil(size / 3) * 4 : size) + Buffer.byteLength(selected);
      if (Object.keys(files).length >= 128 || bytes > 2 * 1024 * 1024)
        throw new Error('Agent source exceeds compilation limit');
      const data = readFileSync(absolute);
      files[selected] =
        assetMode === 'bytes'
          ? { encoding: 'base64', content: data.toString('base64') }
          : new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data);
      if (!assetMode) {
        queued.add(selected);
        queue.push(selected);
      }
    }
  }
  if (!Object.hasOwn(files, entry)) throw new Error('Agent entry must be a regular agent.ts file');
  return { entry, files };
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

/** Resource source is validated in the same bounded, credential-free compiler. */
export async function compileLocalResource(root: string, config?: CliConfig) {
  const source = resourceDefinitionSource(captureAgentSource(root, 'resource.ts'));
  const snapshot = CompiledAgentSnapshotSchema.parse(
    await new ApiClient(config ?? resolveConfig({})).post('/v1/source/agent-definition', source)
  );
  const resource = snapshot.definition.resources?.resource;
  if (!resource) throw new Error('Invalid TypeScript resource definition');
  const kind = source.entry.split('/')[1]!;
  const kinds: Record<string, string> = {
    skills: 'skill',
    rules: 'rule',
    knowledge: 'knowledge',
    templates: 'template',
  };
  const expected = kinds[kind];
  if (expected && resource.kind !== expected)
    throw new Error('Resource kind does not match its folder');
  return resource;
}
