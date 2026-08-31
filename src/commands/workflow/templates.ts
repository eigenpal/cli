import { TemplateIdSchema } from '@eigenpal/types';
import type { Command } from 'commander';
import { existsSync, promises as fs } from 'node:fs';
import { basename, resolve } from 'node:path';

import { ApiClient as Client } from '../../lib/client';
import { requireApiKey, resolveConfig } from '../../lib/config';
import { action } from '../../lib/format-error';
import {
  compareTemplateDataKeys,
  inspectOfficeTemplateBytes,
  renderLocalOfficeTemplate,
} from '../../lib/office-template';
import {
  deleteWorkspaceTemplate,
  downloadTemplateBytes,
  getPublicTemplate,
  listPublicTemplates,
  replaceWorkspaceTemplate,
  summarizeTemplate,
  uploadWorkspaceTemplate,
  type PublicTemplate,
} from '../../lib/templates-api';
import {
  addJsonFlag,
  dim,
  formatTimestamp,
  success,
  table,
  ui,
  warn,
  withBaseUrl,
  withPagination,
  type PaginationOpts,
} from '../../lib/ui';

interface TemplatesCommandConfig {
  baseUrl?: string;
}

function buildClient(opts: TemplatesCommandConfig): Client {
  const config = resolveConfig(opts);
  requireApiKey(config);
  return new Client(config);
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

export async function readJsonFixtureFile(fixturePath: string): Promise<Record<string, unknown>> {
  let raw: string;
  try {
    raw = await fs.readFile(resolve(fixturePath), 'utf8');
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? String(err.code) : '';
    if (code === 'ENOENT') {
      throw new Error(`JSON fixture file not found: ${resolve(fixturePath)}`);
    }
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`--data must be a JSON fixture file containing an object (${fixturePath})`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('--data must be a JSON object (template data keys)');
  }
  return parsed as Record<string, unknown>;
}

function printTemplateHuman(template: PublicTemplate): void {
  const summary = summarizeTemplate(template);
  const tokenNames = summary.tokens.map((token) => token.name);
  console.log(`${ui.bold(summary.id)}  ${summary.name}`);
  console.log(
    `  revision  ${summary.currentRevisionId ?? '-'}  format  ${summary.format}  file  ${summary.filename}`
  );
  console.log(`  sha256    ${summary.sha256 ?? '-'}`);
  console.log(`  grammar   ${summary.grammar.syntax}`);
  console.log(`  caps      ${summary.grammar.capabilities.join(', ') || '-'}`);
  console.log(`  tokens    ${tokenNames.length === 0 ? '(none)' : tokenNames.join(', ')}`);
}

const TEMPLATES_EXAMPLES = `
Examples:
  $ eigenpal workflow templates upload ./templates/roster.xlsx --json
  $ eigenpal workflow templates list --json
  $ eigenpal workflow templates get tmpl_... --json
  $ eigenpal workflow templates download tmpl_... --out roster.xlsx
  $ eigenpal workflow templates replace tmpl_... ./templates/roster.xlsx
  $ eigenpal workflow templates delete tmpl_... --yes
  $ eigenpal workflow templates smoke ./templates/roster.xlsx --data ./fixture.json --out ./filled.xlsx

XLSX dynamic rows use {table:subjects.first_name} in the spreadsheet. YAML data
mapping still uses {{ steps.extract.output.subjects }} — do not put {{ }} in the
Office file.

Local files are inspected and filled on this machine (Office ZIP bounds and
formula-safety apply). tmpl_ ids download current bytes through GET /v1/templates/:id/content
and then fill locally. There is no private remote-render route.
`;

export function registerTemplateCommands(parent: Command): void {
  const templates = parent
    .command('templates')
    .description(
      'Manage workspace DOCX/XLSX templates (tmpl_…): upload, list, inspect, download, replace, delete, and smoke-fill.'
    )
    .addHelpText('after', TEMPLATES_EXAMPLES);

  const uploadCmd = templates
    .command('upload <file>')
    .description(
      'Upload a DOCX or XLSX file as a new tmpl_… resource with an immutable tmpr_… revision.'
    )
    .option('--name <name>', 'Display name (defaults to the filename without extension)')
    .option('--description <text>', 'Optional description');
  addJsonFlag(withBaseUrl(uploadCmd)).action(
    action(
      async (
        file: string,
        opts: TemplatesCommandConfig & { name?: string; description?: string; json?: boolean }
      ) => {
        const filePath = resolve(file);
        const bytes = await fs.readFile(filePath);
        const client = buildClient(opts);
        const template = await uploadWorkspaceTemplate(client, {
          bytes,
          filename: basename(filePath),
          name: opts.name,
          description: opts.description,
        });
        if (opts.json) {
          printJson(template);
          return;
        }
        success(
          `Uploaded ${ui.bold(template.id)} revision ${ui.bold(template.currentRevision?.id ?? '-')} (${template.format})`
        );
        printTemplateHuman(template);
      }
    )
  );

  const listCmd = templates.command('list').description('List workspace templates.');
  addJsonFlag(withBaseUrl(withPagination(listCmd))).action(
    action(async (opts: TemplatesCommandConfig & PaginationOpts & { json?: boolean }) => {
      const client = buildClient(opts);
      const result = await listPublicTemplates(client, { limit: opts.limit, offset: opts.offset });
      if (opts.json) {
        printJson(result);
        return;
      }
      console.log(
        table(
          result.items.map((row) => ({
            id: row.id,
            revision: row.currentRevision?.id ?? '-',
            format: row.format,
            name: row.name,
            sha256: (row.currentRevision?.sha256 ?? row.sha256 ?? '-').slice(0, 12),
            updatedAt: row.updatedAt ?? row.createdAt,
          })),
          [
            { key: 'id', header: 'id' },
            { key: 'revision', header: 'revision' },
            { key: 'format', header: 'format' },
            { key: 'name', header: 'name' },
            { key: 'sha256', header: 'sha256' },
            { key: 'updatedAt', header: 'updatedAt', format: formatTimestamp },
          ]
        )
      );
      if (result.items.length > 0) {
        process.stderr.write(
          `${ui.dim(`${result.items.length} of ${result.total} template${result.total === 1 ? '' : 's'}`)}\n`
        );
      }
    })
  );

  const getCmd = templates
    .command('get <template-id>')
    .alias('inspect')
    .description('Inspect a tmpl_… resource: current tmpr_…, format, checksum, tokens, grammar.');
  addJsonFlag(withBaseUrl(getCmd)).action(
    action(async (templateId: string, opts: TemplatesCommandConfig & { json?: boolean }) => {
      const client = buildClient(opts);
      const template = await getPublicTemplate(client, templateId);
      if (opts.json) {
        printJson(template);
        return;
      }
      printTemplateHuman(template);
    })
  );

  const downloadCmd = templates
    .command('download <template-id>')
    .description('Download current (or pinned) template bytes.')
    .option('--out <path>', 'Write to this file (required)')
    .option('--revision-id <tmpr>', 'Pin an immutable tmpr_… revision');
  withBaseUrl(downloadCmd).action(
    action(
      async (
        templateId: string,
        opts: TemplatesCommandConfig & { out?: string; revisionId?: string }
      ) => {
        if (!opts.out) throw new Error('Missing --out <path>.');
        const client = buildClient(opts);
        const downloaded = await downloadTemplateBytes(client, templateId, opts.revisionId);
        await fs.writeFile(opts.out, downloaded.bytes);
        success(`Wrote ${ui.bold(opts.out)} ${ui.dim(`(${downloaded.bytes.byteLength} bytes)`)}`);
      }
    )
  );

  const replaceCmd = templates
    .command('replace <template-id> <file>')
    .description('Append an immutable revision and advance the tmpl_… pointer.');
  addJsonFlag(withBaseUrl(replaceCmd)).action(
    action(
      async (
        templateId: string,
        file: string,
        opts: TemplatesCommandConfig & { json?: boolean }
      ) => {
        const filePath = resolve(file);
        const bytes = await fs.readFile(filePath);
        const client = buildClient(opts);
        const current = await getPublicTemplate(client, templateId);
        const nextInspection = inspectOfficeTemplateBytes(bytes, basename(filePath));
        if (
          current.currentRevision?.sha256 === nextInspection.sha256 ||
          current.sha256 === nextInspection.sha256
        ) {
          if (opts.json) {
            printJson({ ...current, reused: true });
            return;
          }
          success(
            `Checksum matches current revision ${ui.bold(current.currentRevision?.id ?? '-')} — skipped upload`
          );
          printTemplateHuman(current);
          return;
        }
        const template = await replaceWorkspaceTemplate(client, templateId, {
          bytes,
          filename: basename(filePath),
        });
        if (opts.json) {
          printJson(template);
          return;
        }
        success(
          `Replaced ${ui.bold(template.id)} → revision ${ui.bold(template.currentRevision?.id ?? '-')}`
        );
        printTemplateHuman(template);
      }
    )
  );

  const deleteCmd = templates
    .command('delete <template-id>')
    .description(
      'Delete the mutable tmpl_… pointer. Pinned tmpr_… revisions remain so workflows that set templateRevisionId still run.'
    )
    .option('--yes', 'Required for non-TTY shells', false);
  addJsonFlag(withBaseUrl(deleteCmd)).action(
    action(
      async (
        templateId: string,
        opts: TemplatesCommandConfig & { yes: boolean; json?: boolean }
      ) => {
        if (!opts.yes && !process.stdout.isTTY) {
          throw new Error(
            'templates delete is destructive and requires --yes when run non-interactively'
          );
        }
        const client = buildClient(opts);
        const result = await deleteWorkspaceTemplate(client, templateId);
        if (opts.json) {
          printJson(result);
          return;
        }
        success(`Deleted ${ui.bold(templateId)}`);
        dim('Pinned templateRevisionId workflows keep using stored tmpr_… bytes.');
      }
    )
  );

  const smokeCmd = templates
    .command('smoke <template>')
    .description(
      'Fill a local Office file or a tmpl_… resource with a JSON fixture and write the result. Local files never contact the server.'
    )
    .requiredOption('--data <file>', 'Path to a JSON fixture file (object with template data keys)')
    .requiredOption('--out <path>', 'Filled DOCX/XLSX output path')
    .option('--revision-id <tmpr>', 'When <template> is a tmpl_… id, pin this revision');
  addJsonFlag(withBaseUrl(smokeCmd)).action(
    action(
      async (
        templateArg: string,
        opts: TemplatesCommandConfig & {
          data: string;
          out: string;
          revisionId?: string;
          json?: boolean;
        }
      ) => {
        const data = await readJsonFixtureFile(opts.data);

        let bytes: Buffer;
        let filename: string;
        const isTmpl = TemplateIdSchema.safeParse(templateArg).success;
        if (isTmpl) {
          const client = buildClient(opts);
          const downloaded = await downloadTemplateBytes(client, templateArg, opts.revisionId);
          bytes = downloaded.bytes;
          filename = downloaded.filename;
        } else {
          const filePath = resolve(templateArg);
          if (!existsSync(filePath)) {
            throw new Error(
              `Template file not found: ${filePath}. Pass a local .docx/.xlsx path or a tmpl_… id.`
            );
          }
          bytes = await fs.readFile(filePath);
          filename = basename(filePath);
        }

        const rendered = renderLocalOfficeTemplate(bytes, filename, data);
        const { unresolved, unusedDataKeys } = compareTemplateDataKeys(
          rendered.inspection.tokens,
          Object.keys(data)
        );
        await fs.writeFile(opts.out, rendered.output);

        const payload = {
          format: rendered.inspection.format,
          sha256: rendered.inspection.sha256,
          tokens: rendered.inspection.tokens.map((token) => token.name),
          unresolved,
          unusedDataKeys,
          missingFields: rendered.missingFields,
          warnings: rendered.inspection.warnings,
          doubleBracePlaceholders: rendered.inspection.doubleBracePlaceholders,
          out: opts.out,
          bytes: rendered.output.byteLength,
        };
        if (opts.json) {
          printJson(payload);
          return;
        }
        success(
          `Wrote ${ui.bold(opts.out)} (${rendered.inspection.format}, ${rendered.output.byteLength} bytes)`
        );
        if (unresolved.length > 0) {
          warn(`Unresolved template tokens (no matching data key): ${unresolved.join(', ')}`);
        }
        if (rendered.missingFields.length > 0) {
          warn(`Missing fields during fill: ${rendered.missingFields.join(', ')}`);
        }
        for (const warning of rendered.inspection.warnings) warn(warning);
        if (unusedDataKeys.length > 0) {
          dim(`Unused data keys: ${unusedDataKeys.join(', ')}`);
        }
      }
    )
  );
}
