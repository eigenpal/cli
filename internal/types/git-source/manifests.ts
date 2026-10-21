import { z } from 'zod';
import {
  CustomScriptConfigSchema,
  ExactDiffConfigSchema,
  LlmJudgeConfigSchema,
} from '../eval/evaluator-config';
import {
  DottedPackageNameSchema,
  SOURCE_SEMVER_PATTERN,
  SourcePackagePathSchema,
  dottedPackageNameToPath,
  type SourcePackagePath,
} from './grammar';

export const SOURCE_MANIFEST_FILENAME = 'eigenpal.yaml';
export const UNSUPPORTED_SOURCE_MANIFEST_FILENAME = 'eigenpal.yml';

export const SourceManifestSchemaVersionSchema = z.literal(1);

export const SourceManifestFilenameSchema = z.string().superRefine((value, ctx) => {
  const filename = value.split(/[\\/]/).pop() ?? value;
  if (filename === UNSUPPORTED_SOURCE_MANIFEST_FILENAME) {
    ctx.addIssue({
      code: 'custom',
      message: 'Use eigenpal.yaml; eigenpal.yml package manifests are not supported',
    });
    return;
  }
  if (filename !== SOURCE_MANIFEST_FILENAME) {
    ctx.addIssue({
      code: 'custom',
      message: 'Source manifests must be named eigenpal.yaml',
    });
  }
});
export type SourceManifestFilename = z.infer<typeof SourceManifestFilenameSchema>;

export const LocalAgentResourceDirectorySchema = z.enum([
  'skills',
  'templates',
  'rules',
  'knowledge',
]);
export type LocalAgentResourceDirectory = z.infer<typeof LocalAgentResourceDirectorySchema>;

export const WorkspaceDependencyNameSchema = z.string().superRefine((value, ctx) => {
  if (!value.startsWith('workspace:')) {
    ctx.addIssue({ code: 'custom', message: 'Dependency names must start with workspace:' });
    return;
  }
  const packageName = value.slice('workspace:'.length);
  if (!DottedPackageNameSchema.safeParse(packageName).success) {
    ctx.addIssue({ code: 'custom', message: `Invalid dependency package: ${packageName}` });
  }
});
export type WorkspaceDependencyName = z.infer<typeof WorkspaceDependencyNameSchema>;

export const WorkspaceDependencyVersionSchema = z.string().regex(SOURCE_SEMVER_PATTERN, {
  message: 'Dependency versions must be exact X.Y.Z versions in v0',
});
export type WorkspaceDependencyVersion = z.infer<typeof WorkspaceDependencyVersionSchema>;

const ScoreInUnitIntervalSchema = z.number().min(0).max(1);

export const LocalEvaluatorReferenceSchema = z.string().superRefine((value, ctx) => {
  if (!value.startsWith('./evaluators/')) {
    ctx.addIssue({
      code: 'custom',
      message: 'Local evaluator refs must start with ./evaluators/',
    });
  }
  if (!value.endsWith('.yaml')) {
    ctx.addIssue({ code: 'custom', message: 'Local evaluator refs must point to .yaml files' });
  }
  if (value.includes('..') || value.includes('\\')) {
    ctx.addIssue({ code: 'custom', message: 'Local evaluator refs must stay inside evaluators/' });
  }
});
export type LocalEvaluatorReference = z.infer<typeof LocalEvaluatorReferenceSchema>;

export const SharedEvaluatorReferenceSchema = z.string().superRefine((value, ctx) => {
  const nameResult = WorkspaceDependencyNameSchema.safeParse(value);
  if (!nameResult.success) {
    for (const issue of nameResult.error.issues) {
      ctx.addIssue({ code: 'custom', message: issue.message });
    }
    return;
  }
  const packagePath = workspaceDependencyNameToPackagePath(nameResult.data);
  const [root] = packagePath.split('/');
  if (root !== 'evaluators') {
    ctx.addIssue({
      code: 'custom',
      message: 'Shared evaluator refs must use workspace:evaluators.*',
    });
  }
});
export type SharedEvaluatorReference = z.infer<typeof SharedEvaluatorReferenceSchema>;

const EvaluatorCompositionItemBaseSchema = z.object({
  weight: z.number().min(0).default(1),
});

export const LocalEvaluatorCompositionItemSchema = EvaluatorCompositionItemBaseSchema.extend({
  use: LocalEvaluatorReferenceSchema,
}).strict();
export type LocalEvaluatorCompositionItem = z.infer<typeof LocalEvaluatorCompositionItemSchema>;

export const SharedEvaluatorCompositionItemSchema = EvaluatorCompositionItemBaseSchema.extend({
  use: SharedEvaluatorReferenceSchema,
  version: WorkspaceDependencyVersionSchema,
}).strict();
export type SharedEvaluatorCompositionItem = z.infer<typeof SharedEvaluatorCompositionItemSchema>;

export const EvaluatorCompositionItemSchema = z.union([
  LocalEvaluatorCompositionItemSchema,
  SharedEvaluatorCompositionItemSchema,
]);
export type EvaluatorCompositionItem = z.infer<typeof EvaluatorCompositionItemSchema>;

export const EvaluatorCompositionSchema = z
  .object({
    passThreshold: ScoreInUnitIntervalSchema.default(0.7),
    items: z.array(EvaluatorCompositionItemSchema).default([]),
  })
  .strict();
export type EvaluatorComposition = z.infer<typeof EvaluatorCompositionSchema>;

export type EvaluatorCompositionScoreInput = {
  score: number;
  weight?: number;
};

export type EvaluatorCompositionScore = {
  score: number | null;
  passed: boolean;
};

export function aggregateEvaluatorCompositionScore(
  results: readonly EvaluatorCompositionScoreInput[],
  passThreshold = 0.7
): EvaluatorCompositionScore {
  const threshold = ScoreInUnitIntervalSchema.parse(passThreshold);
  let numerator = 0;
  let denominator = 0;

  for (const result of results) {
    const score = ScoreInUnitIntervalSchema.parse(result.score);
    const weight = z
      .number()
      .min(0)
      .parse(result.weight ?? 1);
    if (weight === 0) {
      continue;
    }
    numerator += score * weight;
    denominator += weight;
  }

  if (denominator === 0) {
    return { score: null, passed: false };
  }

  const score = numerator / denominator;
  return { score, passed: score >= threshold };
}

const DependencyMapSchema = z.record(
  WorkspaceDependencyNameSchema,
  WorkspaceDependencyVersionSchema
);

const TriggerConfigSchema = z
  .object({
    api: z.boolean().optional(),
    email: z
      .object({
        enabled: z.boolean().default(true),
        aliases: z
          .array(
            z.union([
              z.string().includes('@'),
              z
                .object({
                  address: z.string().includes('@'),
                  /**
                   * Omitted means "git does not manage the sender allowlist for
                   * this alias", NOT "allow nobody". It must stay `.optional()`
                   * with no default.
                   *
                   * An empty allowlist used to mean "accepts mail from anyone"
                   * and now means "accepts no mail". Defaulting the omitted
                   * case to `[]` made every source sync write that deny-all
                   * value over whatever the dashboard (or the grandfather
                   * migration) had put there, so an agent whose manifest simply
                   * does not mention an allowlist lost inbound mail on its next
                   * release and could never get it back. The string shorthand
                   * (`aliases: [invoices@...]`) cannot express an allowlist at
                   * all, so it is always this case.
                   */
                  allowlist: z.array(z.string()).optional(),
                  replyConfig: z.record(z.string(), z.unknown()).default({}),
                  requireSenderAuth: z.boolean().default(true),
                  enabled: z.boolean().optional(),
                })
                .strict(),
            ])
          )
          .default([]),
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

const agentFilesystemOptionsSchema = z
  .strictObject({
    cwd: z
      .string()
      .max(512)
      .refine(
        (value) => value === '.' || safePath(value),
        'Use a repository-relative directory without traversal'
      )
      .nullable()
      .optional(),
    files: z
      .record(z.string().refine(safePath, 'Use a safe relative file path'), z.string())
      .optional(),
    packages: z
      .strictObject({
        python: z
          .record(
            z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/),
            z.string().regex(/^[0-9]+(?:\.[0-9]+){1,3}$/)
          )
          .optional(),
        npm: z
          .record(
            z.string().regex(/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/),
            z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/)
          )
          .optional(),
      })
      .optional(),
  })
  .superRefine((value, context) => {
    const files = Object.entries(value.files ?? {});
    if (
      files.length > 100 ||
      files.reduce((total, [path, text]) => total + utf8Length(path + text), 0) > 256 * 1024
    )
      context.addIssue({
        code: 'custom',
        message: 'Workspace files allow at most 100 files and 256 KiB total',
      });
    if (
      Object.keys(value.packages?.python ?? {}).length +
        Object.keys(value.packages?.npm ?? {}).length >
      32
    )
      context.addIssue({
        code: 'custom',
        message: 'Workspace allows at most 32 additional packages',
      });
  });

// No host globals: the public SDK also runs inside the isolated source compiler.
function utf8Length(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const code = character.codePointAt(0)!;
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }
  return bytes;
}

function safePath(value: string): boolean {
  return (
    value.length <= 512 &&
    /^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(value) &&
    !value
      .split('/')
      .some((part) =>
        ['.', '..', '.git', '.eigenpal', 'node_modules', 'eigenpal_modules'].includes(part)
      )
  );
}

export const AgentPackageManifestSchema = z
  .object({
    ...CommonPackageManifestFields,
    model: z.string().optional(),
    instructions: z
      .string()
      .min(1)
      .max(128 * 1024)
      .optional(),
    filesystem: z.boolean().optional(),
    workspace: agentFilesystemOptionsSchema.optional(),
    guards: z
      .array(
        z.discriminatedUnion('kind', [
          z.strictObject({ kind: z.literal('turns'), value: z.number().int().positive().safe() }),
          z.strictObject({ kind: z.literal('timeMs'), value: z.number().int().positive().safe() }),
          z.strictObject({ kind: z.literal('credits'), value: z.number().positive().finite() }),
        ])
      )
      .max(32)
      .optional(),
    triggers: TriggerConfigSchema.optional(),
    dependencies: DependencyMapSchema.optional(),
    evaluators: EvaluatorCompositionSchema.optional(),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    if (manifest.workspace?.cwd === null && Object.keys(manifest.dependencies ?? {}).length)
      ctx.addIssue({
        code: 'custom',
        path: ['dependencies'],
        message:
          'Shared file dependencies require a repository working directory; use files with cwd: null',
      });
    if (manifest.workspace !== undefined && manifest.filesystem !== true)
      ctx.addIssue({
        code: 'custom',
        path: ['workspace'],
        message: 'Workspace requires filesystem capability',
      });
    for (const dependencyName of Object.keys(manifest.dependencies ?? {})) {
      const nameResult = WorkspaceDependencyNameSchema.safeParse(dependencyName);
      if (!nameResult.success) {
        continue;
      }
      const packagePath = workspaceDependencyNameToPackagePath(nameResult.data);
      const [root] = packagePath.split('/');
      if (root !== 'agents' && root !== 'resources') {
        ctx.addIssue({
          code: 'custom',
          path: ['dependencies', dependencyName],
          message: 'Agent dependencies may only reference agents or shared resources in v0',
        });
      }
    }
  });
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

export const EvaluatorDefinitionSchema = z.discriminatedUnion('type', [
  z
    .object({
      schemaVersion: SourceManifestSchemaVersionSchema,
      type: z.literal('exact-diff'),
      config: ExactDiffConfigSchema,
    })
    .strict(),
  z
    .object({
      schemaVersion: SourceManifestSchemaVersionSchema,
      type: z.literal('llm-judge'),
      config: LlmJudgeConfigSchema,
    })
    .strict(),
  z
    .object({
      schemaVersion: SourceManifestSchemaVersionSchema,
      type: z.literal('custom-script'),
      config: CustomScriptConfigSchema,
    })
    .strict(),
]);
export type EvaluatorDefinition = z.infer<typeof EvaluatorDefinitionSchema>;

export const SourcePackageManifestSchema = z.union([
  AgentPackageManifestSchema,
  WorkflowPackageManifestSchema,
  SharedResourcePackageManifestSchema,
  EvaluatorPackageManifestSchema,
]);
export type SourcePackageManifest = z.infer<typeof SourcePackageManifestSchema>;

export type SourcePackageRequiredFileIssueCode =
  | 'missing-required-file'
  | 'missing-content-file'
  | 'unsupported-resource-kind';

export type SourcePackageRequiredFileIssue = {
  code: SourcePackageRequiredFileIssueCode;
  message: string;
  path?: string;
};

export type SourcePackageFileSetValidationInput = {
  packagePath: SourcePackagePath;
  files: readonly string[];
};

export type LocalAgentResourcePathInput = {
  packagePath: SourcePackagePath;
  relativePath: string;
};

export function workspaceDependencyNameToPackagePath(
  name: WorkspaceDependencyName
): SourcePackagePath {
  const parsedName = WorkspaceDependencyNameSchema.parse(name);
  return dottedPackageNameToPath(
    DottedPackageNameSchema.parse(parsedName.slice('workspace:'.length))
  );
}

function hasFile(files: readonly string[], file: string): boolean {
  return files.includes(file);
}

export function isLocalAgentResourcePath({
  packagePath,
  relativePath,
}: LocalAgentResourcePathInput): boolean {
  const parsedPath = SourcePackagePathSchema.parse(packagePath);
  const [root] = parsedPath.split('/');
  if (root !== 'agents') {
    return false;
  }
  const [directory] = relativePath.split('/');
  return LocalAgentResourceDirectorySchema.safeParse(directory).success;
}

export function validateSourcePackageRequiredFiles({
  packagePath,
  files,
}: SourcePackageFileSetValidationInput): SourcePackageRequiredFileIssue[] {
  const parsedPath = SourcePackagePathSchema.parse(packagePath);
  const [root, resourceKind] = parsedPath.split('/');
  const issues: SourcePackageRequiredFileIssue[] = [];

  if (root === 'agents' && !hasFile(files, 'agent.ts') && !hasFile(files, 'AGENT.md')) {
    issues.push({
      code: 'missing-required-file',
      path: 'AGENT.md',
      message: 'Agent packages must include AGENT.md',
    });
  }

  if (root === 'evaluators' && !hasFile(files, 'evaluator.yaml')) {
    issues.push({
      code: 'missing-required-file',
      path: 'evaluator.yaml',
      message: 'Shared evaluator packages must include evaluator.yaml',
    });
  }

  if (root === 'resources') {
    if (!['skills', 'rules', 'knowledge', 'templates'].includes(resourceKind))
      issues.push({
        code: 'missing-required-file',
        path: 'resource.ts',
        message: 'Unknown shared resource kind',
      });
    if (!hasFile(files, 'resource.ts'))
      issues.push({
        code: 'missing-required-file',
        path: 'resource.ts',
        message: 'Shared resources must export their TypeScript definition from resource.ts',
      });
  }
  return issues;
}
