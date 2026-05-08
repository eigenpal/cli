/**
 * `eigenpal workflow evaluator-type {list,get}` — parallel namespace to
 * `step-type` for evaluator schemas. Evaluators have a different shape from
 * regular workflow steps (no input/output flow, no `with`-key convention),
 * so they live in their own catalog rather than confusing the step-type
 * registry.
 *
 * Both commands read from the static `EVALUATOR_REGISTRY` below — pure
 * schema introspection, no server round-trip needed (matches `step-type`).
 */

import {
  CustomScriptConfigSchema,
  EvaluatorBaseEntrySchema,
  EvaluatorTypeSchema,
  ExactDiffConfigSchema,
  LlmJudgeConfigSchema,
} from '@eigenpal/types';
import type { Command } from 'commander';
import { promises as fs } from 'node:fs';
import type { ZodType } from 'zod';

import {
  addJsonFlag,
  error,
  renderListResult,
  ui,
  withBaseUrl,
  withPagination,
  type PaginationOpts,
} from '../../lib/ui';

interface EvaluatorTypeDef {
  type: string;
  name: string;
  description: string;
  configSchema: ZodType;
}

/**
 * Authoritative catalog of evaluator types. Names + descriptions are the same
 * prose the dashboard uses — keep these aligned with the eval docs.
 *
 * To add a new evaluator type:
 *   1. Add the schema to `packages/types/src/eval/evaluator-config.ts`
 *   2. Append it to `EvaluatorTypeSchema` (the discriminator)
 *   3. Add an entry below
 */
const EVALUATOR_REGISTRY: Record<string, EvaluatorTypeDef> = {
  'exact-diff': {
    type: 'exact-diff',
    name: 'Exact Diff',
    description:
      'Deterministic deep-equal between actual and expected with numeric tolerance and optional path-scoping.',
    configSchema: ExactDiffConfigSchema,
  },
  'llm-judge': {
    type: 'llm-judge',
    name: 'LLM Judge',
    description:
      'Score the workflow output with an LLM. Continuous (free-form score in [0,1]) or discrete (pick one of your labels).',
    configSchema: LlmJudgeConfigSchema,
  },
  'custom-script': {
    type: 'custom-script',
    name: 'Custom Script',
    description:
      'Score the workflow output with sandboxed JavaScript. Authors a `function scoreScript(expected, actual) { ... }` declaration that returns a number in [0, 1].',
    configSchema: CustomScriptConfigSchema,
  },
};

// Sanity check at module load: every type from the discriminator MUST appear
// in the registry. This catches the common drift where someone widens the
// Zod enum without updating the CLI catalog.
for (const t of EvaluatorTypeSchema.options) {
  if (!(t in EVALUATOR_REGISTRY)) {
    throw new Error(
      `evaluator-type registry drift: "${t}" is in EvaluatorTypeSchema but missing from EVALUATOR_REGISTRY`
    );
  }
}

interface CommandConfig {
  baseUrl?: string;
}

export function registerEvaluatorTypeCommands(parent: Command): void {
  const evaluatorType = parent
    .command('evaluator-type')
    .description(
      'Catalog of evaluator types — list and inspect their schemas. Mirrors `step-type` for the eval registry.'
    );

  const listCmd = evaluatorType
    .command('list')
    .description('List every evaluator type with a one-line description.')
    .option('--search <q>', 'Filter by type, name, or description');
  // Pagination + base-url + json wrap matches every other catalog command.
  // Pagination is a courtesy here — the catalog is tiny — but keeping the
  // surface uniform means the agent doesn't have to special-case this one.
  addJsonFlag(withBaseUrl(withPagination(listCmd))).action(
    async (
      opts: CommandConfig &
        PaginationOpts & {
          search?: string;
          json?: boolean;
        }
    ) => {
      const filtered = Object.values(EVALUATOR_REGISTRY)
        .map((entry) => ({
          type: entry.type,
          name: entry.name,
          description: entry.description,
        }))
        .filter((entry) => {
          if (!opts.search) return true;
          const needle = opts.search.toLowerCase();
          return (
            entry.type.toLowerCase().includes(needle) ||
            entry.name.toLowerCase().includes(needle) ||
            entry.description.toLowerCase().includes(needle)
          );
        });
      const items = filtered.slice(opts.offset, opts.offset + opts.limit);
      renderListResult(
        { data: items, total: filtered.length },
        [
          { key: 'type', header: 'type' },
          { key: 'name', header: 'name' },
        ],
        { json: opts.json, entityLabel: 'evaluator type' }
      );
    }
  );

  evaluatorType
    .command('get <type>')
    .description(
      'Fetch the JSON Schema for one evaluator type. Pipe through `jq` to inspect specific fields.'
    )
    .option('--out <path>', 'Write to file', undefined)
    .action(async (type: string, opts: { out?: string }) => {
      const def = EVALUATOR_REGISTRY[type];
      if (!def) {
        error(`Evaluator type not found: ${ui.bold(type)}`);
        process.stderr.write(
          `  ${ui.dim('Known types:')} ${Object.keys(EVALUATOR_REGISTRY).join(', ')}\n`
        );
        process.exit(1);
      }
      const { z } = await import('zod');
      const result = {
        type: def.type,
        name: def.name,
        description: def.description,
        // Shared entry-level fields (`name`, `description`, `weight`) so an agent
        // introspecting one type sees the full entry shape, not just `config`.
        entrySchema: z.toJSONSchema(EvaluatorBaseEntrySchema, { target: 'draft-7' }),
        configSchema: z.toJSONSchema(def.configSchema, { target: 'draft-7' }),
      };
      const text = JSON.stringify(result, null, 2);
      if (opts.out) {
        await fs.writeFile(opts.out, text);
        process.stderr.write(`${ui.ok('✓')} Wrote ${ui.bold(opts.out)}\n`);
      } else {
        console.log(text);
      }
    });
}
