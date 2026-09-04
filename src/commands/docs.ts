import { type Command } from 'commander';
import { existsSync, readFileSync } from 'node:fs';
import { action } from '../lib/format-error';
import { addJsonFlag, intArg, table } from '../lib/ui';
import { printJson } from './agents/shared';

export interface BundledDoc {
  topic: string;
  title: string;
  description: string;
  source: 'public' | 'agent-reference' | 'api';
  content: string;
  [key: string]: unknown;
}

let docsCache: BundledDoc[] | null = null;

function bundledDocs(): BundledDoc[] {
  if (docsCache) return docsCache;
  const candidates = [
    new URL('./docs-bundle.json', import.meta.url),
    new URL('../docs-bundle.json', import.meta.url),
  ];
  const bundleUrl = candidates.find((candidate) => existsSync(candidate));
  if (!bundleUrl) {
    throw new Error('Bundled documentation asset is missing. Reinstall the Eigenpal CLI.');
  }
  const parsed = JSON.parse(readFileSync(bundleUrl, 'utf8')) as { entries?: BundledDoc[] };
  if (!Array.isArray(parsed.entries)) {
    throw new Error('Bundled documentation asset is invalid. Reinstall the Eigenpal CLI.');
  }
  docsCache = parsed.entries;
  return docsCache;
}

export function listDocs(prefix?: string, source?: string): BundledDoc[] {
  const docs = bundledDocs();
  const normalizedPrefix = normalizeTopic(prefix ?? '');
  return docs.filter(
    (doc) =>
      (!normalizedPrefix || doc.topic.startsWith(normalizedPrefix)) &&
      (!source || doc.source === source)
  );
}

export function resolveDoc(topic: string): BundledDoc {
  const docs = bundledDocs();
  const normalized = normalizeTopic(topic);
  const exact = docs.find((doc) => doc.topic === normalized);
  if (exact) return exact;

  const suffixMatches = docs.filter(
    (doc) => doc.topic.endsWith(`/${normalized}`) || doc.topic === normalized
  );
  if (suffixMatches.length === 1) return suffixMatches[0];
  if (suffixMatches.length > 1) {
    throw new Error(
      `Documentation topic "${topic}" is ambiguous. Use one of: ${suffixMatches
        .map((doc) => doc.topic)
        .join(', ')}`
    );
  }
  throw new Error(
    `Unknown documentation topic "${topic}". Run \`eigenpal docs search ${JSON.stringify(
      topic
    )}\` or \`eigenpal docs list\`.`
  );
}

export function searchDocs(query: string, limit = 20): Array<BundledDoc & { snippet: string }> {
  const docs = bundledDocs();
  const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) throw new Error('Search query must not be empty.');

  return docs
    .map((doc) => {
      const title = `${doc.topic}\n${doc.title}\n${doc.description}`.toLocaleLowerCase();
      const content = doc.content.toLocaleLowerCase();
      if (!terms.every((term) => title.includes(term) || content.includes(term))) return null;
      const score = terms.reduce(
        (sum, term) => sum + (title.includes(term) ? 10 : 0) + occurrences(content, term),
        0
      );
      return { ...doc, snippet: matchingSnippet(doc.content, terms), score };
    })
    .filter((doc): doc is BundledDoc & { snippet: string; score: number } => doc !== null)
    .sort((a, b) => b.score - a.score || a.topic.localeCompare(b.topic))
    .slice(0, Math.max(1, limit))
    .map(({ score: _score, ...doc }) => doc);
}

export function registerDocsCommands(program: Command): void {
  const command = program
    .command('docs')
    .description(
      'List, search, and read the complete release-matched Eigenpal documentation offline.'
    )
    .action(() => {
      process.stderr.write(
        '`eigenpal docs` requires a subcommand: `list`, `search`, or `read`.\nRun `eigenpal docs --help` to see examples.\n'
      );
      process.exit(2);
    });

  addJsonFlag(command.command('list [prefix]'))
    .description('List bundled documentation topics, optionally under a path prefix.')
    .option('--source <source>', 'Filter by public, agent-reference, or api')
    .action(
      action(async (prefix: string | undefined, opts: { json?: boolean; source?: string }) => {
        const results = listDocs(prefix, opts.source);
        if (opts.json) {
          printJson(results.map(({ content: _content, ...doc }) => doc));
          return;
        }
        console.log(
          table(results, [
            { key: 'topic', header: 'TOPIC' },
            { key: 'source', header: 'SOURCE' },
            { key: 'title', header: 'TITLE' },
          ])
        );
      })
    );

  addJsonFlag(command.command('search <query>'))
    .description('Search every public page and detailed agent reference.')
    .option('--limit <n>', 'Maximum matches', intArg, 20)
    .action(
      action(async (query: string, opts: { json?: boolean; limit: number }) => {
        const results = searchDocs(query, opts.limit);
        if (opts.json) {
          printJson(results.map(({ content: _content, ...doc }) => doc));
          return;
        }
        console.log(
          table(
            results.map((doc) => ({ ...doc, match: doc.snippet || doc.description })),
            [
              { key: 'topic', header: 'TOPIC' },
              { key: 'source', header: 'SOURCE' },
              { key: 'match', header: 'MATCH' },
            ]
          )
        );
      })
    );

  addJsonFlag(command.command('read <topic>'))
    .description('Print one bundled documentation topic to stdout.')
    .action(
      action(async (topic: string, opts: { json?: boolean }) => {
        const doc = resolveDoc(topic);
        if (opts.json) {
          printJson(doc);
          return;
        }
        process.stdout.write(doc.content.endsWith('\n') ? doc.content : `${doc.content}\n`);
      })
    );

  command.addHelpText(
    'after',
    `
Examples:
  $ eigenpal docs search "evaluator path syntax"
  $ eigenpal docs read reference/evaluators
  $ eigenpal docs read steps/transform/script
  $ eigenpal docs list api-reference --json

The bundle contains every public docs page, the OpenAPI specification, and the
detailed agent references generated from Eigenpal's real schemas and CLI help.
It ships with the CLI, needs no authentication, and matches that CLI release.
`
  );
}

function normalizeTopic(value: string): string {
  let topic = value.trim();
  try {
    const url = new URL(topic);
    topic = url.pathname;
  } catch {
    // A normal topic, not a URL.
  }
  return topic
    .replace(/^\/+/, '')
    .replace(/^docs\//, '')
    .replace(/\.(md|mdx|json)$/, '')
    .replace(/\/+$/, '');
}

function occurrences(content: string, term: string): number {
  let count = 0;
  let index = 0;
  while ((index = content.indexOf(term, index)) >= 0) {
    count += 1;
    index += term.length;
  }
  return Math.min(count, 20);
}

function matchingSnippet(content: string, terms: string[]): string {
  const lines = content.split(/\r?\n/);
  const line =
    lines.find((candidate) => {
      const lower = candidate.toLocaleLowerCase();
      return terms.some((term) => lower.includes(term));
    }) ?? '';
  return line
    .replace(/^[#>*\s-]+/, '')
    .replace(/[`[\]{}]/g, '')
    .trim()
    .slice(0, 140);
}
