#!/usr/bin/env bun
/**
 * Bundle every public docs page plus the detailed agent references into the
 * published CLI. The CLI can then list, search, and read release-matched docs
 * without a browser or network connection.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface DocEntry {
  topic: string;
  title: string;
  description: string;
  source: 'public' | 'agent-reference' | 'api';
  content: string;
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const cliDir = resolve(scriptDir, '..');
const repoRoot = resolve(cliDir, '..', '..');
const publicDocsDir = join(repoRoot, 'apps', 'docs');
const referenceDir = join(cliDir, 'src', 'skill', 'reference');
const outputPath = join(cliDir, 'src', 'docs-bundle.json');
const check = process.argv.includes('--check');

function walk(root: string, extension: string): string[] {
  const files: string[] = [];
  const visit = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) visit(path);
      else if (extname(name) === extension) files.push(path);
    }
  };
  visit(root);
  return files;
}

function frontmatter(content: string): { title?: string; description?: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!match) return {};
  const value = (name: string) => {
    const field = match[1].match(new RegExp(`^${name}:\\s*(.+)$`, 'm'))?.[1]?.trim();
    if (!field) return undefined;
    return field.replace(/^(['"])(.*)\1$/, '$2');
  };
  return { title: value('title'), description: value('description') };
}

function firstHeading(content: string): string | undefined {
  return content.match(/^#\s+(.+)$/m)?.[1]?.trim();
}

function topicFor(root: string, path: string): string {
  return relative(root, path)
    .replaceAll('\\', '/')
    .replace(/\.(md|mdx)$/, '');
}

function buildEntries(): DocEntry[] {
  const entries: DocEntry[] = [];
  for (const path of walk(publicDocsDir, '.mdx')) {
    const content = readFileSync(path, 'utf8');
    const metadata = frontmatter(content);
    const topic = topicFor(publicDocsDir, path);
    entries.push({
      topic,
      title: metadata.title ?? firstHeading(content) ?? topic,
      description: metadata.description ?? '',
      source: 'public',
      content,
    });
  }

  for (const path of walk(referenceDir, '.md')) {
    const content = readFileSync(path, 'utf8');
    const topic = `reference/${topicFor(referenceDir, path)}`;
    entries.push({
      topic,
      title: firstHeading(content) ?? topic,
      description: 'Detailed agent reference bundled with the Eigenpal CLI.',
      source: 'agent-reference',
      content,
    });
  }

  const openapiPath = join(publicDocsDir, 'api-reference', 'openapi.json');
  entries.push({
    topic: 'api-reference/openapi',
    title: 'Eigenpal OpenAPI specification',
    description: 'Complete machine-readable Public API contract.',
    source: 'api',
    content: readFileSync(openapiPath, 'utf8'),
  });

  return entries.sort((a, b) => a.topic.localeCompare(b.topic));
}

if (!existsSync(publicDocsDir)) {
  throw new Error(
    `Public docs source not found at ${publicDocsDir}. Run this generator from the Eigenpal monorepo.`
  );
}

const rendered = `${JSON.stringify({ version: 1, entries: buildEntries() }, null, 2)}\n`;
const current = existsSync(outputPath) ? readFileSync(outputPath, 'utf8') : null;
if (current === rendered) {
  console.log(`✓ ${relative(repoRoot, outputPath)} is up to date`);
  process.exit(0);
}
if (check) {
  console.error(`✗ ${relative(repoRoot, outputPath)} is out of date`);
  console.error('  Run: bun run --cwd packages/cli generate:docs');
  process.exit(1);
}

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, rendered);
console.log(`✓ wrote ${relative(repoRoot, outputPath)}`);
