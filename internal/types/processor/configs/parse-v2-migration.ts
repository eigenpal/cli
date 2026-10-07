import { AiParseV2ConfigSchema } from './document-parser-v2';

export interface ParseV2Migration {
  definition: Record<string, unknown>;
  migratedSteps: string[];
  warnings: string[];
}
const LEGACY_FIELDS = new Set([
  'input',
  'parseMode',
  'nativeText',
  'ocrModel',
  'llmModel',
  'llmReasoningEffort',
  'figureModel',
  'figureReasoningEffort',
  'describeFigures',
  'figureInstructions',
  'maxConcurrency',
  'pagesPerBatch',
  'pdfRenderScale',
  'imageQuality',
  'prompt',
  'languages',
  'outputFormat',
  'cache',
]);

/** Pure, opt-in migration. Never mutates a saved definition or changes non-parser steps. */
export function migrateWorkflowParsers(
  definition: Record<string, unknown>,
  policy: 'preserve' | 'auto'
): ParseV2Migration {
  const warnings: string[] = [];
  const migratedSteps: string[] = [];
  function walk(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(walk);
    if (!value || typeof value !== 'object') return value;
    const record = value as Record<string, unknown>;
    // Only traverse workflow step containers, not arbitrary schema/data objects.
    const result = { ...record };
    for (const key of ['steps', 'then', 'else', 'branches', 'cases', 'default'])
      if (Array.isArray(record[key])) result[key] = walk(record[key]);
    if (record.type !== 'ai.parse') return result;
    const name = String(record.name ?? 'parse');
    const config = (record.with ?? {}) as Record<string, unknown>;
    const unknown = Object.keys(config).filter((k) => !LEGACY_FIELDS.has(k));
    if (unknown.length)
      throw new Error(
        `Cannot migrate '${name}': unsupported settings ${unknown.join(', ')}. Review them before migrating.`
      );
    const mode = config.parseMode;
    let native =
      mode === 'native'
        ? 'require'
        : mode === 'native-or-ocr' || config.nativeText === true
          ? 'prefer'
          : 'skip';
    if (mode !== undefined && !['native', 'ocr', 'vision', 'native-or-ocr'].includes(String(mode)))
      throw new Error(`Cannot migrate '${name}': unknown legacy parseMode '${String(mode)}'.`);
    let order =
      mode === 'vision' || (!mode && !config.ocrModel && config.llmModel) ? ['vision'] : ['ocr'];
    if (policy === 'auto') {
      if (native === 'require' || order.length === 1)
        warnings.push(
          `${name}: automatic policy broadens allowed image-reading backends; review egress and cost restrictions.`
        );
      native = 'prefer';
      order = ['ocr', 'vision'];
    }
    if (config.nativeText)
      warnings.push(
        `${name}: v2 checks every page; legacy document-wide nativeText success is intentionally not preserved.`
      );
    if (config.outputFormat === 'layout')
      warnings.push(
        `${name}: layout becomes plain text with spatial native whitespace. Image-reading pages use plain transcription without invented geometry.`
      );
    warnings.push(
      `${name}: completeness validation may expose unread content; compare downstream outputs before publishing.`
    );
    const next = {
      input: config.input,
      policy: { native, imageReading: { order } },
      providers: { ocr: config.ocrModel, vision: config.llmModel },
      output: {
        textFormat:
          config.outputFormat === 'layout' ? 'plain' : (config.outputFormat ?? 'markdown'),
        nativeWhitespace: config.outputFormat === 'layout' ? 'spatial' : 'reading-order',
      },
      enrichment: {
        figures: {
          enabled: config.describeFigures ?? false,
          provider: config.figureModel ?? (mode === 'vision' ? config.llmModel : undefined),
          instructions: config.figureInstructions,
          reasoningEffort: config.figureReasoningEffort,
        },
      },
      advanced: {
        cache: config.cache ?? false,
        languages: config.languages,
        vision: {
          maxConcurrency: config.maxConcurrency,
          pagesPerBatch: config.pagesPerBatch,
          renderScale: config.pdfRenderScale,
          imageQuality: config.imageQuality,
          instructions: config.prompt,
          reasoningEffort: config.llmReasoningEffort,
        },
      },
    };
    result.type = 'ai.parse-v2';
    result.with = AiParseV2ConfigSchema.parse(next);
    migratedSteps.push(name);
    return result;
  }
  return { definition: walk(definition) as Record<string, unknown>, migratedSteps, warnings };
}
