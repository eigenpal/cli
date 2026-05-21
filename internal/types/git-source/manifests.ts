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
    evaluators: EvaluatorCompositionSchema.optional(),
  })
  .strict()
  .superRefine((manifest, ctx) => {
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

const SOURCE_TEMPLATE_FILE_PATTERN = /\.(?:docx|xlsx)$/i;

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

function hasMatchingFile(files: readonly string[], predicate: (file: string) => boolean): boolean {
  return files.some((file) => !file.startsWith('../') && !file.startsWith('/') && predicate(file));
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

  if (root === 'agents' && !hasFile(files, 'AGENT.md')) {
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

  if (root !== 'resources') {
    return issues;
  }

  if (resourceKind === 'skills') {
    if (!hasFile(files, 'SKILL.md')) {
      issues.push({
        code: 'missing-required-file',
        path: 'SKILL.md',
        message: 'Shared skill packages must include SKILL.md',
      });
    }
    return issues;
  }

  if (resourceKind === 'templates') {
    if (!hasMatchingFile(files, (file) => SOURCE_TEMPLATE_FILE_PATTERN.test(file))) {
      issues.push({
        code: 'missing-content-file',
        message: 'Template packages must include at least one .docx or .xlsx file',
      });
    }
    return issues;
  }

  if (resourceKind === 'rules' || resourceKind === 'knowledge') {
    if (!hasMatchingFile(files, (file) => file.toLowerCase().endsWith('.md'))) {
      issues.push({
        code: 'missing-content-file',
        message: `${resourceKind === 'rules' ? 'Rule' : 'Knowledge'} packages must include at least one markdown file`,
      });
    }
    return issues;
  }

  issues.push({
    code: 'unsupported-resource-kind',
    message: `Unsupported resource package kind: ${resourceKind ?? '(missing)'}`,
  });

  return issues;
}
