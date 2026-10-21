import { parse } from '@babel/parser';
import { posix } from 'node:path';

/** Static imports only. Resolution never consults host packages or filesystem paths. */
export function definitionImports(source: string): string[] {
  const ast = parse(source, { sourceType: 'module', plugins: ['typescript'] });
  return ast.program.body.flatMap((node) =>
    node.type === 'ImportDeclaration' ||
    node.type === 'ExportAllDeclaration' ||
    node.type === 'ExportNamedDeclaration'
      ? node.source
        ? [node.source.value]
        : []
      : []
  );
}
export function definitionImportCandidates(importer: string, specifier: string): string[] {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return [];
  const name = posix.normalize(posix.join(posix.dirname(importer), specifier));
  if (name.startsWith('../') || name.startsWith('/') || name.includes('\\'))
    throw new Error('Import escapes the source project');
  return [
    name,
    `${name}.ts`,
    `${name}.js`,
    ...(name.endsWith('.js') ? [name.slice(0, -3) + '.ts'] : []),
  ];
}
export const DEFINITION_BINARY_EXTENSION = /\.(docx|xlsx|pdf|png|jpg|jpeg|bin)$/i;
export const DEFINITION_ASSET_EXTENSION = /\.(md|txt|csv|json|py|docx|xlsx|pdf|png|jpg|jpeg|bin)$/i;

/** Reuse the isolated agent compiler to validate a resource without a second evaluator. */
export function resourceDefinitionSource(source: {
  entry: string;
  files: Record<string, CapturedSourceFile>;
}): { entry: string; files: Record<string, CapturedSourceFile> } {
  const entry = posix.join(posix.dirname(source.entry), 'agent.ts');
  if (Object.hasOwn(source.files, entry))
    throw new Error('Resource packages cannot contain agent.ts');
  return {
    entry,
    files: {
      ...source.files,
      [entry]: `import resource from './resource.ts';import {createAgent} from '@eigenpal/automations';
const agent=createAgent({name:resource.name,...(resource.description?{description:resource.description}:{}),resources:resource.kind==='skill'?{}:{resource}});
export default agent.withFilesystem(resource.kind==='skill'?{skills:{resource}}:{});`,
    },
  };
}

export function definitionAssetImports(source: string): Map<string, 'text' | 'bytes'> {
  const ast = parse(source, { sourceType: 'module', plugins: ['typescript'] });
  const imports = new Map<string, 'text' | 'bytes'>();
  for (const node of ast.program.body)
    if (node.type === 'ImportDeclaration') {
      const mode = node.attributes?.find(
        (attribute) =>
          (attribute.key.type === 'Identifier' ? attribute.key.name : attribute.key.value) ===
          'type'
      )?.value.value;
      if (mode === 'text' || mode === 'bytes') imports.set(node.source.value, mode);
    }
  return imports;
}

/** Source modules are UTF-8; explicit byte imports preserve arbitrary file formats. */
export type CapturedSourceFile =
  | string
  | { encoding: 'base64'; content: string; executable?: boolean };
export function sourceFileText(file: CapturedSourceFile): string {
  return typeof file === 'string'
    ? file
    : new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
        Buffer.from(file.content, 'base64')
      );
}

/** Directory payload excludes source definitions, caches and secret-bearing files. */
export function isResourceAssetPath(path: string): boolean {
  return (
    !path
      .split('/')
      .some(
        (part) =>
          part.startsWith('.') ||
          [
            'node_modules',
            'eigenpal_modules',
            'resource.ts',
            'package.json',
            'bun.lock',
            'package-lock.json',
            'secrets.enc.yaml',
            'secrets.yaml',
            'secrets.yml',
            'secrets.json',
            'credentials.json',
            'id_rsa',
            'id_ed25519',
            'id_ecdsa',
          ].includes(part)
      ) && !/\.(pem|key|p12|pfx)$/i.test(path)
  );
}
export function resourceDirectory(path: string): string | undefined {
  return path.endsWith('/resource.ts') ? path.slice(0, -'/resource.ts'.length) : undefined;
}
