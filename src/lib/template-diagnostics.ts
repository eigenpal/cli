import { isLocalTemplatePath, TemplateIdSchema, TemplateRevisionIdSchema } from '@eigenpal/types';
import { existsSync, readFileSync } from 'node:fs';

import type { ApiClient } from './client';
import { ApiError } from './client';
import { resolveWorkflowTemplatePath } from './local-templates';
import {
  compareTemplateDataKeys,
  inspectOfficeTemplateBytes,
  type TemplateToken,
} from './office-template';
import { downloadTemplateBytes, getPublicTemplate, isNotFoundApiError } from './templates-api';

export type TemplateDiagnostic = {
  field: string;
  message: string;
  severity: 'error' | 'warning';
};

type TemplateStepInfo = {
  fieldPath: string;
  stepName: string;
  templateId?: string;
  templatePath?: string;
  templateRevisionId?: string;
  outputFilename?: string;
  dataKeys: string[];
};

function walkSteps(
  steps: unknown,
  pathPrefix: Array<string | number>,
  visit: (info: TemplateStepInfo) => void
): void {
  if (!Array.isArray(steps)) return;
  for (let i = 0; i < steps.length; i++) {
    const entry = steps[i];
    if (!entry || typeof entry !== 'object') continue;
    const step = entry as Record<string, unknown>;
    const stepPath = [...pathPrefix, i];
    if (step.type === 'transform.template') {
      const withBlock = (step.with && typeof step.with === 'object' ? step.with : {}) as Record<
        string,
        unknown
      >;
      const data = withBlock.data;
      visit({
        fieldPath: [...stepPath, 'with'].join('.'),
        stepName: typeof step.name === 'string' ? step.name : `steps[${i}]`,
        templateId: typeof withBlock.templateId === 'string' ? withBlock.templateId : undefined,
        templatePath: typeof withBlock.template === 'string' ? withBlock.template : undefined,
        templateRevisionId:
          typeof withBlock.templateRevisionId === 'string'
            ? withBlock.templateRevisionId
            : undefined,
        outputFilename:
          typeof withBlock.outputFilename === 'string' ? withBlock.outputFilename : undefined,
        dataKeys: data && typeof data === 'object' && !Array.isArray(data) ? Object.keys(data) : [],
      });
    }
    walkSteps(step.steps, [...stepPath, 'steps'], visit);
    walkSteps(step.then, [...stepPath, 'then'], visit);
    walkSteps(step.else, [...stepPath, 'else'], visit);
    walkSteps(step.default, [...stepPath, 'default'], visit);
    if (Array.isArray(step.branches)) {
      for (let b = 0; b < step.branches.length; b++) {
        const branch = step.branches[b] as { steps?: unknown } | undefined;
        walkSteps(branch?.steps, [...stepPath, 'branches', b, 'steps'], visit);
      }
    }
    if (Array.isArray(step.cases)) {
      for (let c = 0; c < step.cases.length; c++) {
        const branch = step.cases[c] as { steps?: unknown } | undefined;
        walkSteps(branch?.steps, [...stepPath, 'cases', c, 'steps'], visit);
      }
    }
  }
}

function staticOutputExtension(filename: string | undefined): 'docx' | 'xlsx' | null {
  if (!filename) return null;
  if (/\.xlsx\s*$/i.test(filename)) return 'xlsx';
  if (/\.docx\s*$/i.test(filename)) return 'docx';
  return null;
}

function formatDiagnostics(
  info: TemplateStepInfo,
  inspection: {
    format: 'docx' | 'xlsx';
    tokens: TemplateToken[];
    warnings: string[];
    doubleBracePlaceholders?: string[];
  }
): TemplateDiagnostic[] {
  const out: TemplateDiagnostic[] = [];
  const prefix = `${info.fieldPath}`;
  if (inspection.doubleBracePlaceholders && inspection.doubleBracePlaceholders.length > 0) {
    const examples = inspection.doubleBracePlaceholders.slice(0, 5).map((name) => `{{${name}}}`);
    out.push({
      field: `${prefix}.template`,
      message: `XLSX templates use {placeholder}, not {{placeholder}}. Found ${examples.join(', ')}. Extra braces are left in the filled spreadsheet; {{ }} is only for workflow YAML data mapping.`,
      severity: 'error',
    });
  }
  for (const warning of inspection.warnings) {
    if (warning.includes('{{')) continue;
    out.push({ field: `${prefix}.template`, message: warning, severity: 'warning' });
  }
  const outputExt = staticOutputExtension(info.outputFilename);
  if (outputExt && outputExt !== inspection.format) {
    out.push({
      field: `${prefix}.outputFilename`,
      message: `outputFilename ends in .${outputExt} but the template is ${inspection.format}`,
      severity: 'error',
    });
  }
  const { unresolved, unusedDataKeys } = compareTemplateDataKeys(inspection.tokens, info.dataKeys);
  if (unresolved.length > 0) {
    out.push({
      field: `${prefix}.data`,
      message: `Template tokens ${unresolved.join(', ')} have no matching data key. Add them under data: or the fill will leave those placeholders empty.`,
      severity: 'warning',
    });
  }
  if (unusedDataKeys.length > 0) {
    out.push({
      field: `${prefix}.data`,
      message: `data keys ${unusedDataKeys.join(', ')} are not referenced by discovered template tokens`,
      severity: 'warning',
    });
  }
  return out;
}

export function countTemplateSteps(steps: unknown): number {
  let count = 0;
  walkSteps(steps, ['steps'], () => {
    count += 1;
  });
  return count;
}

export async function diagnoseTemplateSteps(args: {
  workflowFile: string;
  steps: unknown;
  client?: ApiClient;
  allowExternal?: boolean;
}): Promise<TemplateDiagnostic[]> {
  const diagnostics: TemplateDiagnostic[] = [];
  const visits: TemplateStepInfo[] = [];
  walkSteps(args.steps, ['steps'], (info) => visits.push(info));

  for (const info of visits) {
    if (info.templatePath) {
      if (!isLocalTemplatePath(info.templatePath)) {
        diagnostics.push({
          field: `${info.fieldPath}.template`,
          message: `Invalid local template path "${info.templatePath}"`,
          severity: 'error',
        });
        continue;
      }
      let absolute: string;
      try {
        absolute = resolveWorkflowTemplatePath(args.workflowFile, info.templatePath, {
          allowExternal: args.allowExternal,
        });
      } catch (err) {
        diagnostics.push({
          field: `${info.fieldPath}.template`,
          message: err instanceof Error ? err.message : String(err),
          severity: 'error',
        });
        continue;
      }
      if (!existsSync(absolute)) {
        diagnostics.push({
          field: `${info.fieldPath}.template`,
          message: `File not found: ${absolute}`,
          severity: 'error',
        });
        continue;
      }
      try {
        const bytes = readFileSync(absolute);
        const inspection = inspectOfficeTemplateBytes(bytes, absolute);
        diagnostics.push(...formatDiagnostics(info, inspection));
      } catch (err) {
        diagnostics.push({
          field: `${info.fieldPath}.template`,
          message: err instanceof Error ? err.message : String(err),
          severity: 'error',
        });
      }
      continue;
    }

    if (!info.templateId) continue;
    if (!TemplateIdSchema.safeParse(info.templateId).success) {
      diagnostics.push({
        field: `${info.fieldPath}.templateId`,
        message: 'templateId must be a tmpl_… workspace template id',
        severity: 'error',
      });
      continue;
    }
    if (
      info.templateRevisionId &&
      !TemplateRevisionIdSchema.safeParse(info.templateRevisionId).success
    ) {
      diagnostics.push({
        field: `${info.fieldPath}.templateRevisionId`,
        message: 'templateRevisionId must be a tmpr_… revision id',
        severity: 'error',
      });
      continue;
    }
    if (!args.client) continue;

    let liveFilename: string | undefined;
    try {
      const live = await getPublicTemplate(args.client, info.templateId);
      liveFilename = live.filename;
      if (
        info.templateRevisionId &&
        live.currentRevision?.id &&
        live.currentRevision.id !== info.templateRevisionId
      ) {
        diagnostics.push({
          field: `${info.fieldPath}.templateRevisionId`,
          message: `Pinned revision ${info.templateRevisionId} is not the current pointer (${live.currentRevision.id}). That is valid; fill uses the pinned bytes.`,
          severity: 'warning',
        });
      }
    } catch (err) {
      if (isNotFoundApiError(err) || (err instanceof ApiError && err.status === 404)) {
        if (!info.templateRevisionId) {
          diagnostics.push({
            field: `${info.fieldPath}.templateId`,
            message: `Template ${info.templateId} was not found in this tenant`,
            severity: 'error',
          });
          continue;
        }
        diagnostics.push({
          field: `${info.fieldPath}.templateId`,
          message: `Logical template ${info.templateId} is gone; checking pinned revision ${info.templateRevisionId}`,
          severity: 'warning',
        });
      } else {
        diagnostics.push({
          field: `${info.fieldPath}.templateId`,
          message: err instanceof Error ? err.message : String(err),
          severity: 'error',
        });
        continue;
      }
    }

    try {
      const downloaded = await downloadTemplateBytes(
        args.client,
        info.templateId,
        info.templateRevisionId
      );
      const inspection = inspectOfficeTemplateBytes(
        downloaded.bytes,
        downloaded.filename || liveFilename || `${info.templateId}.bin`
      );
      diagnostics.push(...formatDiagnostics(info, inspection));
    } catch (err) {
      if (isNotFoundApiError(err) || (err instanceof ApiError && err.status === 404)) {
        diagnostics.push({
          field: info.templateRevisionId
            ? `${info.fieldPath}.templateRevisionId`
            : `${info.fieldPath}.templateId`,
          message: info.templateRevisionId
            ? `Revision ${info.templateRevisionId} was not found for ${info.templateId}`
            : `Template content for ${info.templateId} was not found`,
          severity: 'error',
        });
        continue;
      }
      diagnostics.push({
        field: `${info.fieldPath}.templateId`,
        message: err instanceof Error ? err.message : String(err),
        severity: 'error',
      });
    }
  }

  return diagnostics;
}
