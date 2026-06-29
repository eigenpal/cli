export const LEGACY_FILE_REF_COMPATIBILITY = [
  {
    id: 'legacy-workflow-execution-routes',
    description:
      'Old workflow execution list/detail routes may hydrate historical { fileId } trigger inputs for display only.',
  },
  {
    id: 'rerun-old-immutable-runs',
    description:
      'Rerun may remap historical immutable { fileId } trigger inputs while copying those bytes into the new run.',
  },
  {
    id: 'processor-adapter-runtime-handles',
    description:
      'Executor/headless/CLI adapters may normalize local, S3, inline, or fileId runtime handles into private ResolvedProcessorFile objects before processor invocation.',
  },
] as const;

export type LegacyFileRefCompatibilityId = (typeof LEGACY_FILE_REF_COMPATIBILITY)[number]['id'];
