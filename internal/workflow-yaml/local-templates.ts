import { isLocalTemplatePath, type Step } from '@eigenpal/types';

import type { ValidationIssue } from './parser';

export interface LocalTemplateRef {
  stepName: string;
  fieldPath: string;
  templatePath: string;
  outputFilename?: string;
  dataKeys: string[];
}

/**
 * Walk transform.template steps (including nested control containers) and
 * collect source-controlled `template:` paths. Used by CLI push/validate.
 */
export function collectLocalTemplateRefs(
  steps: unknown,
  pathPrefix: Array<string | number> = ['steps']
): LocalTemplateRef[] {
  if (!Array.isArray(steps)) return [];
  const refs: LocalTemplateRef[] = [];
  for (let i = 0; i < steps.length; i++) {
    const entry = steps[i];
    if (!entry || typeof entry !== 'object') continue;
    const step = entry as Step & {
      name?: string;
      type?: string;
      with?: Record<string, unknown>;
      then?: unknown;
      else?: unknown;
      steps?: unknown;
      default?: unknown;
      branches?: Array<{ steps?: unknown }>;
      cases?: Array<{ steps?: unknown }>;
    };
    const stepPath = [...pathPrefix, i];
    if (step.type === 'transform.template') {
      const templatePath = step.with?.template;
      if (typeof templatePath === 'string' && isLocalTemplatePath(templatePath)) {
        const data = step.with?.data;
        refs.push({
          stepName: typeof step.name === 'string' ? step.name : `steps[${i}]`,
          fieldPath: [...stepPath, 'with', 'template'].join('.'),
          templatePath,
          outputFilename:
            typeof step.with?.outputFilename === 'string' ? step.with.outputFilename : undefined,
          dataKeys:
            data && typeof data === 'object' && !Array.isArray(data) ? Object.keys(data) : [],
        });
      }
    }
    refs.push(...collectLocalTemplateRefs(step.steps, [...stepPath, 'steps']));
    refs.push(...collectLocalTemplateRefs(step.then, [...stepPath, 'then']));
    refs.push(...collectLocalTemplateRefs(step.else, [...stepPath, 'else']));
    refs.push(...collectLocalTemplateRefs(step.default, [...stepPath, 'default']));
    if (Array.isArray(step.branches)) {
      for (let b = 0; b < step.branches.length; b++) {
        refs.push(
          ...collectLocalTemplateRefs(step.branches[b]?.steps, [
            ...stepPath,
            'branches',
            b,
            'steps',
          ])
        );
      }
    }
    if (Array.isArray(step.cases)) {
      for (let c = 0; c < step.cases.length; c++) {
        refs.push(
          ...collectLocalTemplateRefs(step.cases[c]?.steps, [...stepPath, 'cases', c, 'steps'])
        );
      }
    }
  }
  return refs;
}

/**
 * Collect pinned `templateRevisionId` values so publish can consume unpublished
 * staging proofs for those revisions. Local `template:` paths are ignored.
 */
export function collectPinnedTemplateRevisionIds(steps: unknown): string[] {
  if (!Array.isArray(steps)) return [];
  const ids = new Set<string>();
  for (const entry of steps) {
    if (!entry || typeof entry !== 'object') continue;
    const step = entry as Step & {
      type?: string;
      with?: Record<string, unknown>;
      then?: unknown;
      else?: unknown;
      steps?: unknown;
      default?: unknown;
      branches?: Array<{ steps?: unknown }>;
      cases?: Array<{ steps?: unknown }>;
    };
    if (step.type === 'transform.template') {
      const revisionId = step.with?.templateRevisionId;
      if (typeof revisionId === 'string' && revisionId.startsWith('tmpr_')) {
        ids.add(revisionId);
      }
    }
    for (const nested of collectPinnedTemplateRevisionIds(step.steps)) ids.add(nested);
    for (const nested of collectPinnedTemplateRevisionIds(step.then)) ids.add(nested);
    for (const nested of collectPinnedTemplateRevisionIds(step.else)) ids.add(nested);
    for (const nested of collectPinnedTemplateRevisionIds(step.default)) ids.add(nested);
    if (Array.isArray(step.branches)) {
      for (const branch of step.branches) {
        for (const nested of collectPinnedTemplateRevisionIds(branch?.steps)) ids.add(nested);
      }
    }
    if (Array.isArray(step.cases)) {
      for (const branch of step.cases) {
        for (const nested of collectPinnedTemplateRevisionIds(branch?.steps)) ids.add(nested);
      }
    }
  }
  return [...ids];
}

/**
 * Publish/API path: local `template:` files are CLI-only. The server never
 * reads the caller's disk, so a leftover path would fail at runtime.
 */
export function collectPublishLocalTemplateIssues(steps: unknown): ValidationIssue[] {
  return collectLocalTemplateRefs(steps).map((ref) => ({
    path: ref.fieldPath.split('.'),
    message:
      'Local template paths are resolved by `eigenpal workflow push`. Publish with templateId (tmpl_…) and templateRevisionId (tmpr_…), or push through the CLI.',
    code: 'local_template_path',
  }));
}
