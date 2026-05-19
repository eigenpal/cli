import { z } from 'zod';
import { SourcePackageSegmentSchema, WorkspaceDependencySchema } from './grammar';

export const SourceManifestSchemaVersionSchema = z.literal(1);

const DependencyMapSchema = z.record(SourcePackageSegmentSchema, WorkspaceDependencySchema);

const TriggerConfigSchema = z
  .object({
    api: z.boolean().optional(),
    email: z
      .object({
        enabled: z.boolean().default(true),
        aliases: z.array(z.string().email()).default([]),
      })
      .strict()
      .optional(),
  })
  .strict();

const CommonPackageManifestFields = {
  schemaVersion: SourceManifestSchemaVersionSchema,
  name: z.string().min(1),
  description: z.string().optional(),
} as const;

export const RootSourceManifestSchema = z
  .object({
    schemaVersion: SourceManifestSchemaVersionSchema,
    eigenpalVersion: z.string().min(1),
  })
  .strict();
export type RootSourceManifest = z.infer<typeof RootSourceManifestSchema>;

export const AgentPackageManifestSchema = z
  .object({
    ...CommonPackageManifestFields,
    model: z.string().optional(),
    triggers: TriggerConfigSchema.optional(),
    dependencies: DependencyMapSchema.optional(),
    evaluators: z.array(z.string().min(1)).optional(),
  })
  .strict();
export type AgentPackageManifest = z.infer<typeof AgentPackageManifestSchema>;

export const WorkflowPackageManifestSchema = z
  .object({
    ...CommonPackageManifestFields,
    triggers: TriggerConfigSchema.optional(),
    dependencies: DependencyMapSchema.optional(),
    evaluators: z.array(z.string().min(1)).optional(),
  })
  .strict();
export type WorkflowPackageManifest = z.infer<typeof WorkflowPackageManifestSchema>;

export const SharedResourcePackageManifestSchema = z.object(CommonPackageManifestFields).strict();
export type SharedResourcePackageManifest = z.infer<typeof SharedResourcePackageManifestSchema>;

export const EvaluatorPackageManifestSchema = z.object(CommonPackageManifestFields).strict();
export type EvaluatorPackageManifest = z.infer<typeof EvaluatorPackageManifestSchema>;

export const SourcePackageManifestSchema = z.union([
  AgentPackageManifestSchema,
  WorkflowPackageManifestSchema,
  SharedResourcePackageManifestSchema,
  EvaluatorPackageManifestSchema,
]);
export type SourcePackageManifest = z.infer<typeof SourcePackageManifestSchema>;
