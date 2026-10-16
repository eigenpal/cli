import { createHash } from 'node:crypto';
import { z } from 'zod';
import { CompiledAgentSnapshotSchema, type CompiledAgentSnapshot } from './agent-definition';
import {
  DottedPackageNameSchema,
  SOURCE_COMMIT_SHA_PATTERN,
  SourcePackagePathSchema,
  SourceVersionRefSchema,
  dottedPackageNameToPath,
} from './grammar';

export const SourceLockPackageSchema: z.ZodType<SourceLockPackage> = z.lazy(() =>
  z.object({
    packagePath: SourcePackagePathSchema,
    requestedRef: SourceVersionRefSchema,
    resolvedRef: z.string().min(1),
    resolvedTag: z.string().min(1).optional(),
    commit: z.string().regex(SOURCE_COMMIT_SHA_PATTERN),
    dependencies: z.array(SourceLockPackageSchema),
    compiledAgent: CompiledAgentSnapshotSchema.optional(),
    agentRuntimeConfig: z.record(z.string(), z.unknown()).optional(),
  })
);

export type SourceLockPackage = {
  packagePath: z.infer<typeof SourcePackagePathSchema>;
  requestedRef: z.infer<typeof SourceVersionRefSchema>;
  resolvedRef: string;
  resolvedTag?: string;
  commit: string;
  dependencies: SourceLockPackage[];
  compiledAgent?: CompiledAgentSnapshot;
  agentRuntimeConfig?: Record<string, unknown>;
};

export const SourceLockfileSchema = z.object({
  lockfileVersion: z.literal(1),
  eigenpalVersion: z.string().min(1),
  inputHash: z.string().min(1),
  root: SourceLockPackageSchema,
});

export type SourceLockfile = z.infer<typeof SourceLockfileSchema>;

export function parseSourcePackageRef(input: string): {
  packagePath: z.infer<typeof SourcePackagePathSchema>;
  ref: z.infer<typeof SourceVersionRefSchema>;
} {
  const [rawPackage, rawRef, extra] = input.split('@');
  if (!rawPackage || extra !== undefined) {
    throw new Error('Package ref must be <package>[@latest|main|version|range|commit].');
  }
  const packagePath = rawPackage.includes('/')
    ? SourcePackagePathSchema.parse(rawPackage)
    : dottedPackageNameToPath(DottedPackageNameSchema.parse(rawPackage));
  return {
    packagePath,
    ref: SourceVersionRefSchema.parse(rawRef || 'latest'),
  };
}

export function sourceLockfileInputHash(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}
