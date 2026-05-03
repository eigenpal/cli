import { z } from 'zod';

/**
 * Schema for workflows/<slug>/meta.json.
 * ID is set by the server on create.
 */
export const WorkflowMetaSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
});
export type WorkflowMeta = z.infer<typeof WorkflowMetaSchema>;

/**
 * Schema for workflows/<slug>/eval/<example>/meta.json.
 * rowId is used for sync with server eval table rows.
 */
export const EvalExampleMetaSchema = z.object({
  rowId: z.string().optional(),
  name: z.string().optional(),
  annotation: z.string().nullable().optional(),
});
export type EvalExampleMeta = z.infer<typeof EvalExampleMetaSchema>;

/**
 * Schema for templates/<path>/meta.json.
 */
export const TemplateMetaSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  folderId: z.string().optional(),
  placeholders: z.array(z.unknown()).optional().nullable(),
  downloadError: z.boolean().optional(),
});
export type TemplateMeta = z.infer<typeof TemplateMetaSchema>;

/**
 * Schema for workflows/<slug>/eval/<example>/overrides.json.
 * Step names (or dot paths for nested steps, e.g. "my-block.fetch") map to that step's output object.
 */
export const EvalOverridesSchema = z.object({
  steps: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
});
export type EvalOverrides = z.infer<typeof EvalOverridesSchema>;
