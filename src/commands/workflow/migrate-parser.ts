import { migrateWorkflowParsers } from '@eigenpal/types';
import type { Command } from 'commander';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse, stringify } from 'yaml';
import { action } from '../../lib/format-error';

export function registerParserMigrationCommand(workflow: Command): void {
  workflow
    .command('migrate-parser <file>')
    .description(
      'Write a reviewable ai.parse-v2 workflow migration to a new file. Never pushes or changes the source.'
    )
    .requiredOption(
      '--policy <policy>',
      'preserve backend restrictions, or auto to adopt automatic native/OCR/vision parsing'
    )
    .requiredOption('--out <file>', 'New YAML output file (must not already exist)')
    .option('--json', 'Emit migration summary as JSON')
    .action(
      action(async (file: string, options: { policy: string; out: string; json?: boolean }) => {
        if (options.policy !== 'preserve' && options.policy !== 'auto')
          throw new Error('--policy must be preserve or auto');
        if (resolve(file) === resolve(options.out))
          throw new Error('Migration output must differ from the source');
        const source = parse(await readFile(file, 'utf8'));
        if (!source || typeof source !== 'object' || Array.isArray(source))
          throw new Error('Expected a workflow YAML object');
        const migration = migrateWorkflowParsers(source, options.policy);
        await writeFile(options.out, stringify(migration.definition), { flag: 'wx' });
        const summary = {
          out: resolve(options.out),
          migratedSteps: migration.migratedSteps,
          warnings: migration.warnings,
        };
        if (options.json) console.log(JSON.stringify(summary));
        else {
          console.log(
            `Wrote ${summary.out}; migrated ${summary.migratedSteps.length} parser step(s). Review and test before publishing.`
          );
          for (const warning of summary.warnings) console.error(warning);
        }
      })
    );
}
