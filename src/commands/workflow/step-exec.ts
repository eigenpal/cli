/**
 * `eigenpal workflow step exec <type>` — placeholder during the server-side
 * redesign tracked in EIG-104.
 *
 * The previous implementation ran every step LOCALLY in the CLI process
 * (`transform.script` via a CLI-side QuickJS sandbox, `ai.extract` via direct
 * OpenAI SDK calls). Both paths diverged from production worker behavior and
 * assumed shell env state (`WORKER_LLM_*`) that real CLI users don't have.
 *
 * EIG-104 replaces them with a single `POST /api/v1/workflows/step-exec`
 * endpoint that runs the same code path executions take. Until that lands,
 * `step exec` exits 2 with a redirect to the workflow run / experiment run
 * commands.
 */

import type { Command } from 'commander';

import { listStepTypes, type StepType } from '@eigenpal/types';

import { action } from '../../lib/format-error';
import { error } from '../../lib/ui';

const UNSUPPORTED_TYPE_EXIT = 2;

function exitUnsupported(type: string): never {
  error(
    `\`workflow step exec ${type}\` is currently disabled.\n` +
      `   The previous local-runner implementation ran every step in the CLI process,\n` +
      `   which diverged from production worker behavior. Tracking the server-side\n` +
      `   redesign in EIG-104.\n\n` +
      `   To run a single step today, push the workflow and run it via:\n` +
      `     $ eigenpal workflow run <workflow-id>\n` +
      `     $ eigenpal workflow experiment run <workflow-id> --example-id <name>`
  );
  process.exit(UNSUPPORTED_TYPE_EXIT);
}

export function registerStepExecCommands(workflow: Command): void {
  const step = workflow
    .command('step')
    .description('Run a single workflow step (placeholder; see EIG-104).');

  step
    .command('exec <type>')
    .description(
      'DISABLED — local mimic runners removed pending server-side redesign (EIG-104). ' +
        'Use `workflow run` or `workflow experiment run` instead.'
    )
    .option('--config-json <json>', '(unused; kept for back-compat parsing)')
    .option('--config-file <path>', '(unused)')
    .option('--inputs <pairs...>', '(unused)')
    .option('--output-schema <path>', '(unused)')
    .action(
      action(async (rawType: string) => {
        const known = listStepTypes() as StepType[];
        if (!known.includes(rawType as StepType)) {
          error(`Unknown step type: ${rawType}. Run \`eigenpal workflow step-type list\`.`);
          process.exit(UNSUPPORTED_TYPE_EXIT);
        }
        exitUnsupported(rawType);
      })
    );
}
