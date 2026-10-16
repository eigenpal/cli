import { z } from 'zod';
import { AgentPackageManifestSchema } from './manifests';

/** Data only. Validation must not insert defaults into a captured definition. */
export const CompiledAgentDataSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('agent'),
  manifest: z
    .unknown()
    .refine(
      (value) => AgentPackageManifestSchema.safeParse(value).success,
      'Invalid agent manifest'
    ) as z.ZodType<z.input<typeof AgentPackageManifestSchema>>,
  inputSchema: z.record(z.string(), z.unknown()).optional(),
  outputSchema: z.record(z.string(), z.unknown()).optional(),
});
export type CompiledAgentData = z.infer<typeof CompiledAgentDataSchema>;

export const CompiledAgentSnapshotSchema = z.strictObject({
  definition: CompiledAgentDataSchema,
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  bundleSha256: z.string().regex(/^[a-f0-9]{64}$/),
  toolchain: z.strictObject({
    sdkVersion: z.string().min(1),
    zodVersion: z.string().min(1),
    bunVersion: z.string().min(1),
  }),
});
export type CompiledAgentSnapshot = z.infer<typeof CompiledAgentSnapshotSchema>;
