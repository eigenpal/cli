/**
 * Step Configuration Schemas
 *
 * Single source of truth for ALL step type configurations.
 * Used by:
 * - Frontend: Workflow builder validation + React Hook Form
 * - Worker: Runtime config validation before execution
 * - LLM: JSON Schema export for workflow generation
 *
 * Each step type has:
 * - configSchema: What goes in step.with (or step-level for control steps)
 * - outputSchema: What the step produces
 */

import { z } from 'zod';
import { toJsonSchema, type JsonSchema7Type } from '../core/common';
import type { StepType } from './steps';
import { STEP_TYPES } from './steps';

// ============================================================================
// AI Step Schemas
// ============================================================================

/**
 * ai.parse - Parse documents using OCR/LLM
 * Config goes in step.with
 */
export const AiParseConfigSchema = z.object({
  input: z.string().describe('Storage reference or template expression for the document'),
  ocrModel: z.string().optional().describe('OCR provider ID for PDF/image parsing'),
  llmModel: z.string().optional().describe('LLM provider ID for vision-based parsing'),
  maxConcurrency: z
    .number()
    .min(1)
    .max(10)
    .default(3)
    .optional()
    .describe('Max concurrent VLM batch requests'),
  pagesPerBatch: z
    .number()
    .min(1)
    .max(20)
    .default(5)
    .optional()
    .describe('Number of page images per VLM request'),
  prompt: z.string().optional().describe('Custom extraction prompt'),
  languages: z.array(z.string()).optional().describe('OCR language hints'),
  outputFormat: z
    .enum(['plain', 'markdown', 'djot', 'html'])
    .default('markdown')
    .optional()
    .describe(
      'Format for extracted text. `markdown` (default) keeps structure and is best for LLM extraction; `plain` is unstyled text; `djot`/`html` preserve more layout. Only the native (Kreuzberg) parser respects this — OCR/VLM always emit markdown.'
    ),
  nativeText: z
    .boolean()
    .default(false)
    .optional()
    .describe(
      'Extract native/embedded text from PDFs without OCR/VLM. Faster and uses no credits. Falls back to OCR/VLM if the PDF has no embedded text.'
    ),
});

export const AiParseOutputSchema = z.object({
  text: z.string().describe('Extracted text content (combined from all pages)'),
  pages: z
    .array(
      z.object({
        pageIndex: z.number().describe('0-based page index'),
        content: z.string().describe('Extracted content for this page'),
        pageName: z.string().optional().describe('Page/sheet name (e.g., Excel sheet name)'),
        confidence: z.number().optional().describe('Overall page confidence'),
      })
    )
    .optional()
    .describe('Per-page content'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Document metadata'),
});

/**
 * ai.extract - Extract structured data using LLM
 * Config goes in step.with
 *
 * For per-page extraction, use control.parallel_map to iterate over pages
 * and apply ai.extract to each page individually.
 */
export const AiExtractConfigSchema = z.object({
  input: z.string().describe('Text content or template expression'),
  schema: z
    .object({
      type: z.literal('object'),
      properties: z.record(z.string(), z.unknown()),
      required: z.array(z.string()).optional(),
    })
    .refine((schema) => Object.keys(schema.properties).length > 0, {
      message: 'Extraction schema must define at least one field',
    })
    .describe('JSON Schema defining the structure to extract'),
  prompt: z.string().optional().describe('Custom prompt template for extraction'),
  provider: z.string().optional().describe('Provider ID (e.g., "openai-gpt4o")'),
  model: z.string().optional().describe('Model override'),
  temperature: z
    .number()
    .min(0)
    .max(2)
    .default(0)
    .optional()
    .describe('Model temperature (0 = deterministic)'),
  maxInputTokens: z
    .number()
    .int()
    .optional()
    .describe(
      'Max input tokens. Truncates input text and logs a warning when exceeded. Omit for no limit.'
    ),
});

export const AiExtractOutputSchema = z
  .record(z.string(), z.unknown())
  .describe('Extracted structured data matching the provided schema');

// ============================================================================
// Transform Step Schemas
// ============================================================================

/**
 * transform.set - Set key-value pairs in output
 * Config goes in step.with
 */
export const TransformSetConfigSchema = z.object({
  fields: z
    .record(z.string(), z.unknown())
    .refine((obj) => Object.keys(obj).length > 0, {
      message: 'At least one field must be defined',
    })
    .describe('Key-value pairs to set in output'),
  input: z.record(z.string(), z.unknown()).optional().describe('Base object to extend'),
});

export const TransformSetOutputSchema = z
  .record(z.string(), z.unknown())
  .describe('Object with all fields set');

/**
 * transform.remove - Remove fields from object
 * Config goes in step.with
 */
export const TransformRemoveConfigSchema = z.object({
  input: z.record(z.string(), z.unknown()).optional().describe('Object to remove fields from'),
  fields: z
    .array(z.string())
    .min(1, 'At least one field to remove is required')
    .describe('Field names to remove'),
});

export const TransformRemoveOutputSchema = z
  .record(z.string(), z.unknown())
  .describe('Object with fields removed');

/**
 * transform.combine - Merge multiple objects or arrays
 * Config goes in step.with
 */
export const TransformCombineConfigSchema = z.object({
  sources: z
    .array(z.string())
    .min(1, 'At least one source is required')
    .describe('Template expressions for sources to combine'),
  target: z.string().min(1, 'Target path is required').describe('Target path in output'),
  mode: z.enum(['merge', 'concat', 'deep']).default('merge').optional(),
});

export const TransformCombineOutputSchema = z
  .union([z.record(z.string(), z.unknown()), z.array(z.unknown())])
  .describe('Combined result');

/**
 * transform.split - Split string or object
 * Config goes in step.with
 */
export const TransformSplitConfigSchema = z.object({
  input: z
    .union([z.string(), z.record(z.string(), z.unknown())])
    .optional()
    .describe('String or object to split'),
  source: z.string().optional().describe('Template expression for source'),
  by: z.string().default(',').optional().describe('Delimiter for string splitting'),
  delimiter: z.string().optional().describe('Alias for by'),
  limit: z.number().optional().describe('Max number of splits'),
  keys: z.array(z.string()).optional().describe('Keys to extract from object'),
});

export const TransformSplitOutputSchema = z
  .union([
    z.array(z.string()),
    z.object({
      extracted: z.record(z.string(), z.unknown()),
      remaining: z.record(z.string(), z.unknown()),
    }),
  ])
  .describe('Split result - array or extracted/remaining object');

/**
 * transform.merge - Merge multiple named inputs
 * Config goes in step.with
 */
export const TransformMergeConfigSchema = z.object({
  preservePortNames: z.boolean().default(true).optional(),
  outputKey: z.string().optional(),
});

export const TransformMergeOutputSchema = z.object({
  items: z.array(z.unknown()),
  count: z.number(),
  merged: z.record(z.string(), z.unknown()).optional(),
});

/**
 * transform.template - Fill DOCX template with data
 * Config goes in step.with
 */
export const TransformTemplateConfigSchema = z.object({
  templateId: z
    .string()
    .min(1, 'Template is required')
    .describe('ID of the template from templates table'),
  data: z
    .record(z.string(), z.unknown())
    .describe(
      'Data object to merge into template. Each key must be explicitly defined - cannot pass a whole object as single expression'
    ),
  outputFilename: z.string().optional().describe('Output filename - supports {{field}} syntax'),
  highlightNotFound: z
    .boolean()
    .default(true)
    .optional()
    .describe('Highlight missing variables with red-colored text in the output document'),
  notFoundText: z
    .string()
    .default('NOT FOUND')
    .optional()
    .describe('Text to display for missing variables when highlightNotFound is enabled'),
});

export const TransformTemplateOutputSchema = z.object({
  fileId: z.string().describe('File ID from files table'),
});

/**
 * transform.pdf-embed - Embed text layer into scanned PDFs/images
 * Requires ai.parse step to run first to get word positions
 * Config goes in step.with
 */
export const TransformPdfEmbedConfigSchema = z.object({
  // Source file (from workflow input)
  input: z.string().describe('File input - template expression e.g. {{input.document}}'),
  // Parse result from ai.parse step
  parseResult: z
    .string()
    .describe('Parse result - template expression e.g. {{steps.parse.output}}'),
  // Output options
  outputFilename: z.string().optional().describe('Output filename - supports {{filename}} syntax'),
  confidenceThreshold: z
    .number()
    .min(0)
    .max(1)
    .default(0.7)
    .optional()
    .describe('Minimum OCR confidence (0-1) to include a word'),
});

export const TransformPdfEmbedOutputSchema = z.object({
  fileId: z.string().describe('File ID from files table'),
  pageCount: z.number().describe('Number of pages in the output PDF'),
  wordCount: z.number().describe('Number of words embedded'),
  text: z.string().describe('Extracted text from the document'),
});

/**
 * transform.xlsx-to-json - Convert XLSX spreadsheet to JSON (array of row objects)
 * Config goes in step.with
 */
export const TransformXlsxToJsonConfigSchema = z.object({
  input: z
    .string()
    .min(1, 'Input is required')
    .describe(
      'File input - template expression e.g. {{input.document}} resolving to fileId or file path descriptor'
    ),
  sheet: z
    .union([z.number().int().min(0), z.string()])
    .optional()
    .describe('Sheet to read: 0-based index or sheet name. Omit for first sheet.'),
  outputCsv: z
    .boolean()
    .default(false)
    .describe('If true, also write CSV to storage and include fileId in output'),
  outputFilename: z
    .string()
    .optional()
    .describe(
      'Output CSV filename when outputCsv is true - supports LiquidJS e.g. {{filename}}.csv'
    ),
});

export const TransformXlsxToJsonOutputSchema = z.object({
  rows: z
    .array(z.record(z.string(), z.unknown()))
    .describe('Array of row objects (first row = headers as keys)'),
  fileId: z.string().optional().describe('File ID of stored CSV when outputCsv is true'),
});

/**
 * JSON Schema for output validation (subset of JSON Schema)
 */
const JsonSchemaSchema = z
  .object({
    type: z.enum(['object', 'array', 'string', 'number', 'boolean', 'null']),
    properties: z.record(z.string(), z.unknown()).optional(),
    items: z.unknown().optional(),
    required: z.array(z.string()).optional(),
    description: z.string().optional(),
  })
  .passthrough();

/**
 * transform.script - Execute JavaScript in sandbox
 * Config goes in step.with
 *
 * IMPORTANT: Each key in `inputs` becomes a TOP-LEVEL variable in the code.
 * If you have `inputs: { items: "..." }`, use `items` directly in code, NOT `inputs.items`.
 */
export const TransformScriptConfigSchema = z.object({
  inputs: z
    .record(z.string(), z.string())
    .optional()
    .describe(
      'Named inputs mapped from template expressions. IMPORTANT: Keys become TOP-LEVEL variables in code (e.g., if key is "items", use "items" not "inputs.items").'
    ),

  code: z
    .string()
    .min(1, 'Script code is required')
    .describe(
      'JavaScript code. Input keys are available as top-level variables (NOT as inputs.key). Must return a value.'
    ),

  outputSchema: JsonSchemaSchema.optional().describe(
    'JSON Schema describing the expected return value. Used for validation and type hints.'
  ),

  timeout: z
    .number()
    .positive()
    .default(5000)
    .optional()
    .describe('Max execution time in milliseconds (default: 5000)'),

  memoryLimit: z
    .number()
    .positive()
    .default(10 * 1024 * 1024)
    .optional()
    .describe('Max memory in bytes (default: 10MB)'),
});

export const TransformScriptOutputSchema = z
  .unknown()
  .describe('Value returned from script (validated against outputSchema if provided)');

// ============================================================================
// Action Step Schemas
// ============================================================================

/**
 * action.http - Make HTTP request
 * Config goes in step.with
 */
export const ActionHttpConfigSchema = z.object({
  url: z.string().min(1, 'URL is required').describe('Request URL (supports template expressions)'),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('GET').optional(),
  headers: z.record(z.string(), z.string()).optional().describe('HTTP headers'),
  body: z.unknown().optional().describe('Request body (JSON or string)'),
  timeout: z.number().positive().default(30000).optional().describe('Timeout in milliseconds'),
  insecureSkipTlsVerify: z
    .boolean()
    .default(false)
    .optional()
    .describe(
      'If true, skip TLS certificate verification (use only for read-only public endpoints with bad/expired certs)'
    ),
});

export const ActionHttpOutputSchema = z.object({
  status: z.number().describe('HTTP status code'),
  statusText: z.string(),
  headers: z.record(z.string(), z.string()),
  body: z.unknown().describe('Response body (parsed JSON or string)'),
  responseCharset: z
    .string()
    .describe('Charset used to decode the response body (e.g. utf-8, windows-1250)'),
});

/**
 * action.invoke-workflow - Invoke another workflow
 * Config goes in step.with
 */
export const ActionInvokeWorkflowConfigSchema = z.object({
  workflowId: z.string().min(1, 'Workflow ID is required').describe('ID of workflow to invoke'),
  input: z.record(z.string(), z.unknown()).optional().describe('Input to pass to workflow'),
});

export const ActionInvokeWorkflowOutputSchema = z
  .record(z.string(), z.unknown())
  .describe('Output from invoked workflow');

/**
 * action.website-reader - Fetch and parse website content to markdown
 * Config goes in step.with
 */
export const ActionWebsiteReaderConfigSchema = z.object({
  url: z
    .string()
    .min(1, 'URL is required')
    .describe('Website URL to fetch (supports template expressions)'),
  timeout: z.number().positive().default(30000).optional().describe('Timeout in milliseconds'),
  encoding: z
    .enum(['auto', 'utf-8', 'latin1', 'windows-1250', 'windows-1252', 'iso-8859-2'])
    .default('auto')
    .optional()
    .describe('Response encoding. Auto detects from Content-Type header and HTML meta tags.'),
});

export const ActionWebsiteReaderOutputSchema = z.object({
  markdown: z.string().describe('Page content converted to markdown'),
  title: z.string().nullable().describe('Page title'),
  excerpt: z.string().nullable().describe('Page excerpt/description'),
  byline: z.string().nullable().describe('Author information'),
  siteName: z.string().nullable().describe('Site name'),
  length: z.number().describe('Content length in characters'),
  url: z.string().describe('Final URL after redirects'),
});

// ============================================================================
// Control Step Schemas
// ============================================================================

/**
 * control.if - Conditional branching
 * Config is step-level (condition), not in step.with
 */
export const ControlIfConfigSchema = z.object({
  condition: z
    .string()
    .min(1, 'Condition is required')
    .describe('LiquidJS expression that evaluates to boolean'),
});

export const ControlIfOutputSchema = z.object({
  condition: z.boolean().describe('Evaluated condition result'),
  branch: z.enum(['then', 'else']).describe('Which branch was executed'),
  result: z.unknown().describe('Output from executed branch'),
});

/**
 * control.foreach - Loop over array
 * Config is step-level (items, as, indexAs), not in step.with
 */
export const ControlForeachConfigSchema = z.object({
  items: z
    .string()
    .min(1, 'Items expression is required')
    .describe('Expression resolving to array'),
  as: z.string().min(1, 'Variable name is required').describe('Variable name for current item'),
  indexAs: z.string().optional().describe('Variable name for current index'),
});

export const ControlForeachOutputSchema = z.object({
  items: z.array(z.unknown()).describe('Results from each iteration'),
  count: z.number().describe('Number of completed iterations'),
  totalIterations: z.number().describe('Total iterations'),
});

/**
 * control.parallel_map - Concurrent iteration with limited parallelism
 * Config is step-level (items, as, indexAs, concurrency), not in step.with
 */
export const ControlParallelMapConfigSchema = z.object({
  items: z
    .string()
    .min(1, 'Items expression is required')
    .describe('Expression resolving to array'),
  as: z.string().min(1, 'Variable name is required').describe('Variable name for current item'),
  indexAs: z.string().optional().describe('Variable name for current index'),
  concurrency: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(5)
    .optional()
    .describe('Maximum concurrent executions (1-50, default 5)'),
});

export const ControlParallelMapOutputSchema = z.object({
  items: z.array(z.unknown()).describe('Results from each iteration (maintains original order)'),
  count: z.number().describe('Number of completed iterations'),
  totalIterations: z.number().describe('Total iterations'),
});

/**
 * control.parallel - Parallel branch execution
 * Config is step-level (branches), not in step.with
 */
export const ControlParallelConfigSchema = z.object({
  // branches is handled separately as it contains nested steps
});

export const ControlParallelOutputSchema = z
  .record(z.string(), z.unknown())
  .describe('Results keyed by branch name');

/**
 * control.wait - Pause for duration
 * Config is step-level (duration), not in step.with
 */
export const ControlWaitConfigSchema = z.object({
  duration: z.number().positive().describe('Duration in milliseconds'),
});

export const ControlWaitOutputSchema = z.object({
  waited: z.number().describe('Actual milliseconds waited'),
});

/**
 * control.approval - Pause for human approval
 * Config is step-level (message), not in step.with
 */
export const ControlApprovalConfigSchema = z.object({
  message: z.string().optional().describe('Message to display for approval'),
  timeoutMinutes: z
    .number()
    .default(60 * 24)
    .optional()
    .describe('Auto-reject after timeout'),
  notifyEmail: z.string().email().optional().describe('Email to notify'),
});

export const ControlApprovalOutputSchema = z.object({
  approved: z.boolean().describe('Whether the request was approved'),
  approvedBy: z.string().optional().describe('Who approved'),
  approvedAt: z.string().optional().describe('When approved'),
  comment: z.string().optional().describe('Approver comment'),
});

/**
 * control.block - Execute a reusable block workflow inline
 * Config is step-level (blockName, inputs), not in step.with
 */
export const ControlBlockConfigSchema = z.object({
  blockName: z.string().min(1, 'Block name is required').describe('Name of the block to execute'),
  inputs: z.record(z.string(), z.unknown()).optional().describe('Input mapping for the block'),
});

export const ControlBlockOutputSchema = z
  .record(z.string(), z.unknown())
  .describe("Output from block's declared output mapping");

// ============================================================================
// Step Schema Registry
// ============================================================================

export type StepCategory = 'ai' | 'transform' | 'action' | 'control';

export interface StepSchemaDefinition {
  type: StepType;
  category: StepCategory;
  name: string;
  description: string;
  configSchema: z.ZodType;
  outputSchema: z.ZodType;
  /** Whether config goes in step.with (true) or step-level properties (false) */
  configInWith: boolean;
}

export const STEP_SCHEMAS: Record<StepType, StepSchemaDefinition> = {
  // AI Steps
  'ai.parse': {
    type: 'ai.parse',
    category: 'ai',
    name: 'Parse Document',
    description: 'Extract text from documents (PDF, DOCX, images) using OCR or vision models',
    configSchema: AiParseConfigSchema,
    outputSchema: AiParseOutputSchema,
    configInWith: true,
  },
  'ai.extract': {
    type: 'ai.extract',
    category: 'ai',
    name: 'Extract Data',
    description: 'Extract structured data from text using AI with a JSON schema',
    configSchema: AiExtractConfigSchema,
    outputSchema: AiExtractOutputSchema,
    configInWith: true,
  },

  // Transform Steps
  'transform.set': {
    type: 'transform.set',
    category: 'transform',
    name: 'Set Value',
    description: 'Set key-value pairs in the output object',
    configSchema: TransformSetConfigSchema,
    outputSchema: TransformSetOutputSchema,
    configInWith: true,
  },
  'transform.remove': {
    type: 'transform.remove',
    category: 'transform',
    name: 'Remove Fields',
    description: 'Remove specified fields from an object',
    configSchema: TransformRemoveConfigSchema,
    outputSchema: TransformRemoveOutputSchema,
    configInWith: true,
  },
  'transform.combine': {
    type: 'transform.combine',
    category: 'transform',
    name: 'Combine Data',
    description: 'Merge multiple objects or concatenate arrays',
    configSchema: TransformCombineConfigSchema,
    outputSchema: TransformCombineOutputSchema,
    configInWith: true,
  },
  'transform.split': {
    type: 'transform.split',
    category: 'transform',
    name: 'Split Data',
    description: 'Split a string by delimiter or extract keys from an object',
    configSchema: TransformSplitConfigSchema,
    outputSchema: TransformSplitOutputSchema,
    configInWith: true,
  },
  'transform.merge': {
    type: 'transform.merge',
    category: 'transform',
    name: 'Merge Inputs',
    description: 'Merge multiple named inputs into a single output',
    configSchema: TransformMergeConfigSchema,
    outputSchema: TransformMergeOutputSchema,
    configInWith: true,
  },
  'transform.template': {
    type: 'transform.template',
    category: 'transform',
    name: 'Fill Template',
    description:
      'Fill a DOCX template with data. Use list_templates tool to get template IDs and their placeholder schemas.',
    configSchema: TransformTemplateConfigSchema,
    outputSchema: TransformTemplateOutputSchema,
    configInWith: true,
  },
  'transform.pdf-embed': {
    type: 'transform.pdf-embed',
    category: 'transform',
    name: 'Embed PDF Text',
    description: 'Embed OCR text layer into scanned PDFs/images to make them searchable',
    configSchema: TransformPdfEmbedConfigSchema,
    outputSchema: TransformPdfEmbedOutputSchema,
    configInWith: true,
  },
  'transform.xlsx-to-json': {
    type: 'transform.xlsx-to-json',
    category: 'transform',
    name: 'XLSX to JSON',
    description:
      'Convert XLSX spreadsheet to JSON array of row objects for use in scripts or downstream steps',
    configSchema: TransformXlsxToJsonConfigSchema,
    outputSchema: TransformXlsxToJsonOutputSchema,
    configInWith: true,
  },
  'transform.script': {
    type: 'transform.script',
    category: 'transform',
    name: 'Script',
    description:
      'Execute JavaScript code in a secure sandbox. Input keys become TOP-LEVEL variables (use "items" not "inputs.items"). Must return a value.',
    configSchema: TransformScriptConfigSchema,
    outputSchema: TransformScriptOutputSchema,
    configInWith: true,
  },

  // Action Steps
  'action.http': {
    type: 'action.http',
    category: 'action',
    name: 'HTTP Request',
    description: 'Make an HTTP request to an external API',
    configSchema: ActionHttpConfigSchema,
    outputSchema: ActionHttpOutputSchema,
    configInWith: true,
  },
  'action.invoke-workflow': {
    type: 'action.invoke-workflow',
    category: 'action',
    name: 'Invoke Workflow',
    description: 'Execute another workflow and return its output',
    configSchema: ActionInvokeWorkflowConfigSchema,
    outputSchema: ActionInvokeWorkflowOutputSchema,
    configInWith: true,
  },
  'action.website-reader': {
    type: 'action.website-reader',
    category: 'action',
    name: 'Website Reader',
    description: 'Fetch a webpage and convert content to markdown',
    configSchema: ActionWebsiteReaderConfigSchema,
    outputSchema: ActionWebsiteReaderOutputSchema,
    configInWith: true,
  },

  // Control Steps
  'control.if': {
    type: 'control.if',
    category: 'control',
    name: 'Condition',
    description: 'Branch execution based on a condition expression',
    configSchema: ControlIfConfigSchema,
    outputSchema: ControlIfOutputSchema,
    configInWith: false,
  },
  'control.foreach': {
    type: 'control.foreach',
    category: 'control',
    name: 'For Each',
    description: 'Loop over an array and execute steps for each item',
    configSchema: ControlForeachConfigSchema,
    outputSchema: ControlForeachOutputSchema,
    configInWith: false,
  },
  'control.parallel_map': {
    type: 'control.parallel_map',
    category: 'control',
    name: 'Parallel Map',
    description: 'Iterate over an array with concurrent execution up to a limit',
    configSchema: ControlParallelMapConfigSchema,
    outputSchema: ControlParallelMapOutputSchema,
    configInWith: false,
  },
  'control.parallel': {
    type: 'control.parallel',
    category: 'control',
    name: 'Parallel',
    description: 'Execute multiple branches concurrently',
    configSchema: ControlParallelConfigSchema,
    outputSchema: ControlParallelOutputSchema,
    configInWith: false,
  },
  'control.wait': {
    type: 'control.wait',
    category: 'control',
    name: 'Wait',
    description: 'Pause workflow execution for a specified duration',
    configSchema: ControlWaitConfigSchema,
    outputSchema: ControlWaitOutputSchema,
    configInWith: false,
  },
  'control.approval': {
    type: 'control.approval',
    category: 'control',
    name: 'Approval',
    description: 'Pause workflow for human approval before continuing',
    configSchema: ControlApprovalConfigSchema,
    outputSchema: ControlApprovalOutputSchema,
    configInWith: false,
  },
  'control.block': {
    type: 'control.block',
    category: 'control',
    name: 'Block',
    description: 'Execute a reusable block workflow inline with input/output mapping',
    configSchema: ControlBlockConfigSchema,
    outputSchema: ControlBlockOutputSchema,
    configInWith: false,
  },
};

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get the complete schema definition for a step type
 */
export function getStepSchema(stepType: StepType): StepSchemaDefinition | undefined {
  return STEP_SCHEMAS[stepType];
}

/**
 * Get just the config schema for a step type (for validation)
 */
export function getStepConfigSchema(stepType: StepType): z.ZodType | undefined {
  return STEP_SCHEMAS[stepType]?.configSchema;
}

/**
 * Get just the output schema for a step type
 */
export function getStepOutputSchema(stepType: StepType): z.ZodType | undefined {
  return STEP_SCHEMAS[stepType]?.outputSchema;
}

/**
 * List all available step types
 */
export function listStepTypes(): StepType[] {
  return [...STEP_TYPES];
}

/**
 * List step types by category
 */
export function listStepTypesByCategory(category: StepCategory): StepType[] {
  return Object.values(STEP_SCHEMAS)
    .filter((s) => s.category === category)
    .map((s) => s.type);
}

/**
 * Get all step schemas as JSON Schema (for LLM consumption)
 */
export function getAllStepJsonSchemas(): Array<{
  type: StepType;
  category: StepCategory;
  name: string;
  description: string;
  configSchema: JsonSchema7Type;
  outputSchema: JsonSchema7Type;
  configInWith: boolean;
}> {
  return Object.values(STEP_SCHEMAS).map((def) => ({
    type: def.type,
    category: def.category,
    name: def.name,
    description: def.description,
    configSchema: toJsonSchema(def.configSchema),
    outputSchema: toJsonSchema(def.outputSchema),
    configInWith: def.configInWith,
  }));
}

/**
 * Validate a step config against its schema
 * Returns { success: true, data } or { success: false, error }
 */
export function validateStepConfig(
  stepType: StepType,
  config: unknown
): { success: true; data: unknown } | { success: false; error: z.ZodError } {
  const schema = getStepConfigSchema(stepType);
  if (!schema) {
    return { success: true, data: config };
  }

  const result = schema.safeParse(config);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}

function isZodOptional(schema: unknown): boolean {
  return schema instanceof z.ZodOptional;
}

/**
 * Get the top-level required keys for a step type's output schema.
 * Returns null if the output schema is unknown (e.g. transform.script) or not an object.
 * Used to decide if an override has "all" outputs: if override has all required keys and
 * passes validation, the step can be skipped.
 */
export function getRequiredOutputKeys(stepType: StepType): string[] | null {
  const schema = getStepOutputSchema(stepType);
  if (!schema) return null;

  // Unwrap ZodOptional/ZodNullable to get to the inner type
  let current: z.ZodType = schema;
  while (true) {
    const def = (current as { _def?: { typeName?: string; innerType?: z.ZodType } })._def;
    if (def?.typeName === 'ZodOptional' || def?.typeName === 'ZodNullable') {
      current = def.innerType ?? current;
    } else {
      break;
    }
  }

  // Record schemas (e.g. control.block: z.record(z.string(), z.unknown())) accept any object;
  // there are no fixed required keys, so we return [] to signal this. The caller decides how to handle:
  // - resolveStepOverride treats [] as partial override (can't know runtime keys without expectedOutputKeys)
  if (current instanceof z.ZodRecord) return [];

  if (!(current instanceof z.ZodObject)) return null;
  const shape = (current as z.ZodObject<z.ZodRawShape>).shape;
  const required: string[] = [];
  for (const key of Object.keys(shape)) {
    if (!isZodOptional(shape[key])) required.push(key);
  }
  return required;
}

/**
 * True if the step type's output schema is z.unknown() (e.g. transform.script).
 * For such steps we cannot validate "all outputs" so overrides are always partial (run step + merge).
 */
export function isOutputSchemaUnknown(stepType: StepType): boolean {
  const schema = getStepOutputSchema(stepType);
  if (!schema) return true;
  const def = (schema as { _def?: { typeName?: string } })._def;
  return def?.typeName === 'ZodUnknown';
}

// ============================================================================
// Type exports
// ============================================================================

export type AiParseConfig = z.infer<typeof AiParseConfigSchema>;
export type AiParseOutput = z.infer<typeof AiParseOutputSchema>;
export type AiExtractConfig = z.infer<typeof AiExtractConfigSchema>;
export type AiExtractOutput = z.infer<typeof AiExtractOutputSchema>;
export type TransformSetConfig = z.infer<typeof TransformSetConfigSchema>;
export type TransformRemoveConfig = z.infer<typeof TransformRemoveConfigSchema>;
export type TransformCombineConfig = z.infer<typeof TransformCombineConfigSchema>;
export type TransformSplitConfig = z.infer<typeof TransformSplitConfigSchema>;
export type TransformMergeConfig = z.infer<typeof TransformMergeConfigSchema>;
export type TransformTemplateConfig = z.infer<typeof TransformTemplateConfigSchema>;
export type TransformPdfEmbedConfig = z.infer<typeof TransformPdfEmbedConfigSchema>;
export type TransformPdfEmbedOutput = z.infer<typeof TransformPdfEmbedOutputSchema>;
export type TransformScriptConfig = z.infer<typeof TransformScriptConfigSchema>;
export type ActionHttpConfig = z.infer<typeof ActionHttpConfigSchema>;
export type ActionInvokeWorkflowConfig = z.infer<typeof ActionInvokeWorkflowConfigSchema>;
export type ActionWebsiteReaderConfig = z.infer<typeof ActionWebsiteReaderConfigSchema>;
export type ActionWebsiteReaderOutput = z.infer<typeof ActionWebsiteReaderOutputSchema>;
export type ControlIfConfig = z.infer<typeof ControlIfConfigSchema>;
export type ControlForeachConfig = z.infer<typeof ControlForeachConfigSchema>;
export type ControlParallelMapConfig = z.infer<typeof ControlParallelMapConfigSchema>;
export type ControlParallelConfig = z.infer<typeof ControlParallelConfigSchema>;
export type ControlWaitConfig = z.infer<typeof ControlWaitConfigSchema>;
export type ControlApprovalConfig = z.infer<typeof ControlApprovalConfigSchema>;
export type ControlBlockConfig = z.infer<typeof ControlBlockConfigSchema>;
