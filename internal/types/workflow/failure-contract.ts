import {
  getInvokeExecutionMode,
  getInvokeWorkflowRef,
  isDynamicWorkflowRef,
} from './invoke-workflow-contract';
import type { Step } from './steps';

export interface WorkflowFailureOutcome {
  /** Step name returned in error.step. A waited child rejection names its invocation. */
  step: string;
  /** Location of the declaring Fail step, retaining distinct branches with the same code. */
  stepPath: string;
  statusCode: number;
  messageTemplate: string;
  description?: string;
  conditions: string[];
}

export interface WorkflowFailureContract {
  failures: WorkflowFailureOutcome[];
  /** Dynamic, missing, or cyclic calls cannot be enumerated statically. */
  unresolvedInvocations: Array<{ stepPath: string; target: string }>;
}

export interface WorkflowFailureReference {
  id: string;
  name: string;
  definition?: { steps?: Step[] };
  failureContract?: WorkflowFailureContract;
}

/** Conservative inventory of declared failures, never a closed list of runtime errors. */
export function collectWorkflowFailureContract(
  definition: { steps?: Step[] },
  references: readonly WorkflowFailureReference[] = []
): WorkflowFailureContract {
  const contract: WorkflowFailureContract = { failures: [], unresolvedInvocations: [] };
  const byId = new Map(references.map((reference) => [reference.id, reference]));
  const byName = new Map(references.map((reference) => [reference.name, reference]));
  let visited = 0;
  let limited = false;
  function walk(steps: Step[] | undefined, prefix: string, guards: string[], stack: Set<object>) {
    if (limited) return;
    for (const step of steps ?? []) {
      if (
        ++visited > 10_000 ||
        contract.failures.length >= 1_000 ||
        contract.unresolvedInvocations.length >= 1_000
      ) {
        limited = true;
        contract.unresolvedInvocations.push({
          stepPath: prefix || '(workflow)',
          target: '(documentation inventory limit reached)',
        });
        return;
      }
      const path = prefix ? `${prefix}.${step.name}` : step.name;
      const conditions = step.if ? [...guards, step.if] : guards;
      if (step.type === 'control.fail') {
        contract.failures.push({
          step: step.name,
          stepPath: path,
          statusCode: step.statusCode ?? 422,
          messageTemplate: step.message,
          ...(step.description ? { description: step.description } : {}),
          conditions: step.condition ? [...conditions, step.condition] : conditions,
        });
      } else if (step.type === 'control.if') {
        walk(step.then, `${path}.then`, [...conditions, step.condition], stack);
        walk(step.else, `${path}.else`, [...conditions, `not (${step.condition})`], stack);
      } else if (step.type === 'control.switch') {
        for (const [index, branch] of step.cases.entries())
          walk(
            branch.steps,
            `${path}.cases[${index}]`,
            [...conditions, `${step.on} equals ${JSON.stringify(branch.when)}`],
            stack
          );
        walk(
          step.default,
          `${path}.default`,
          [...conditions, `${step.on}: no case matches`],
          stack
        );
      } else if (step.type === 'control.parallel') {
        for (const branch of step.branches)
          walk(branch.steps, `${path}.${branch.name}`, conditions, stack);
      } else if (step.type === 'control.foreach' || step.type === 'control.parallel_map') {
        walk(step.steps, `${path}[]`, [...conditions, `for each item in ${step.items}`], stack);
      } else if (step.type === 'control.block') {
        contract.unresolvedInvocations.push({ stepPath: path, target: step.blockName });
      } else if (step.type === 'action.invoke-workflow') {
        const config = step.with as Record<string, unknown> | undefined;
        const mode = getInvokeExecutionMode(config);
        // Fire-and-forget child outcomes belong to the child run, not its parent.
        if (mode === 'child' && config?.wait === false) continue;
        const target = getInvokeWorkflowRef(config) ?? '(unspecified)';
        const reference = !isDynamicWorkflowRef(target)
          ? (byId.get(target) ?? byName.get(target))
          : undefined;
        const previous = contract.failures.length;
        if (reference?.definition && !stack.has(reference.definition)) {
          walk(
            reference.definition.steps,
            path,
            conditions,
            new Set([...stack, reference.definition])
          );
        } else if (reference?.failureContract) {
          for (const failure of reference.failureContract.failures) {
            if (contract.failures.length >= 1_000) {
              limited = true;
              contract.unresolvedInvocations.push({
                stepPath: path,
                target: '(documentation inventory limit reached)',
              });
              break;
            }
            contract.failures.push({
              ...failure,
              stepPath: `${path}.${failure.stepPath}`,
              conditions: [...conditions, ...failure.conditions],
            });
          }
          for (const unresolved of reference.failureContract.unresolvedInvocations.slice(
            0,
            Math.max(0, 1_000 - contract.unresolvedInvocations.length)
          ))
            contract.unresolvedInvocations.push({
              ...unresolved,
              stepPath: `${path}.${unresolved.stepPath}`,
            });
        } else {
          contract.unresolvedInvocations.push({ stepPath: path, target });
        }
        if (mode === 'child') {
          for (const failure of contract.failures.slice(previous)) failure.step = step.name;
        }
      }
    }
  }
  walk(definition.steps, '', [], new Set([definition]));
  return contract;
}

/** A response example uses the authored template, not fabricated resolved business values. */
export function workflowFailureRunExample(
  base: Record<string, unknown>,
  failure: WorkflowFailureOutcome
): Record<string, unknown> {
  const { output: _output, files: _files, ...rest } = base;
  return {
    ...rest,
    finished: true,
    execution: {
      ...(base.execution as Record<string, unknown> | undefined),
      status: 'failed',
      schemaValid: null,
    },
    error: {
      code: 'workflow_rejected',
      statusCode: failure.statusCode,
      message: failure.messageTemplate,
      step: failure.step,
      retryable: false,
    },
  };
}

export const WORKFLOW_FAILURE_FALLBACK_DESCRIPTION =
  'Configured business rejections use error.code workflow_rejected and error.statusCode; the HTTP response remains 200 when reporting a run. Input, provider, runtime, output, system failures and cancellation can produce other error.code values. Handle unknown codes with a fallback. Message templates are resolved at runtime.';

/** Shared text for Connect descriptions and Swagger, with authored Markdown escaped. */
export function describeWorkflowFailureContract(contract: WorkflowFailureContract): string {
  const quote = (value: string) =>
    JSON.stringify(value).replace(/[<>`|]/g, (char) => `&#${char.charCodeAt(0)};`);
  return [
    WORKFLOW_FAILURE_FALLBACK_DESCRIPTION,
    ...contract.failures.map(
      (failure) =>
        `- Business ${failure.statusCode}, step ${quote(failure.step)}, path ${quote(failure.stepPath)}. Conditions: ${failure.conditions.length ? failure.conditions.map(quote).join(' and ') : 'when reached'}. Message template: ${quote(failure.messageTemplate)}.${failure.description ? ` ${quote(failure.description)}` : ''}`
    ),
    ...contract.unresolvedInvocations.map(
      (call) =>
        `- Additional outcomes from ${quote(call.target)} at ${quote(call.stepPath)} could not be enumerated (dynamic, unavailable, recursive target, or documentation limit).`
    ),
  ].join('\n\n');
}
