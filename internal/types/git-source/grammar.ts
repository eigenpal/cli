import { z } from 'zod';

export const SOURCE_PACKAGE_SEGMENT_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
/**
 * Run-target segments are wider than git-source package segments: they also
 * accept database ids (`wf_…`, `awf_…`), which are mixed-case nanoids.
 * Git-source paths stay lowercase — this pattern is for run addressing only.
 */
export const RUN_TARGET_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
export const SOURCE_COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/;
export const SOURCE_SEMVER_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+$/;
export const SOURCE_VERSION_RANGE_PATTERN = /^[0-9]+(?:\.[0-9]+)?\.(?:x|\*)$/;

export const SourcePackageSegmentSchema = z
  .string()
  .regex(SOURCE_PACKAGE_SEGMENT_PATTERN, 'Use lowercase letters, numbers, dashes, and underscores');

export const SourcePackageTypeSchema = z.enum(['agents', 'workflows', 'resources', 'evaluators']);
export type SourcePackageType = z.infer<typeof SourcePackageTypeSchema>;

export const SourcePackagePathSchema = z.string().superRefine((value, ctx) => {
  const parts = value.split('/');
  if (parts.length < 2) {
    ctx.addIssue({
      code: 'custom',
      message: 'Package path must include a root and at least one segment',
    });
    return;
  }
  if (!SourcePackageTypeSchema.safeParse(parts[0]).success) {
    ctx.addIssue({ code: 'custom', message: `Invalid package root: ${parts[0]}` });
  }
  for (const segment of parts.slice(1)) {
    if (!SourcePackageSegmentSchema.safeParse(segment).success) {
      ctx.addIssue({ code: 'custom', message: `Invalid package segment: ${segment}` });
    }
  }
});
export type SourcePackagePath = z.infer<typeof SourcePackagePathSchema>;

export const DottedPackageNameSchema = z.string().superRefine((value, ctx) => {
  const parts = value.split('.');
  if (parts.length < 2) {
    ctx.addIssue({
      code: 'custom',
      message: 'Dotted package name must include a root and at least one segment',
    });
    return;
  }
  if (!SourcePackageTypeSchema.safeParse(parts[0]).success) {
    ctx.addIssue({ code: 'custom', message: `Invalid package root: ${parts[0]}` });
  }
  for (const segment of parts.slice(1)) {
    if (!SourcePackageSegmentSchema.safeParse(segment).success) {
      ctx.addIssue({ code: 'custom', message: `Invalid package segment: ${segment}` });
    }
  }
});
export type DottedPackageName = z.infer<typeof DottedPackageNameSchema>;

export const SourceVersionRefSchema = z.string().superRefine((value, ctx) => {
  if (
    value === 'latest' ||
    value === 'main' ||
    SOURCE_SEMVER_PATTERN.test(value) ||
    SOURCE_VERSION_RANGE_PATTERN.test(value) ||
    SOURCE_COMMIT_SHA_PATTERN.test(value)
  ) {
    return;
  }
  ctx.addIssue({
    code: 'custom',
    message: 'Use latest, main, X.Y.Z, X.Y.x, X.x, or a 40-character commit SHA',
  });
});
export type SourceVersionRef = z.infer<typeof SourceVersionRefSchema>;

export const WorkflowRunVersionRefSchema = z.string().superRefine((value, ctx) => {
  if (
    value === 'latest' ||
    SOURCE_SEMVER_PATTERN.test(value) ||
    value.startsWith('version_') ||
    value.startsWith('wfv_') ||
    value.startsWith('wfh_')
  ) {
    return;
  }
  ctx.addIssue({
    code: 'custom',
    message: 'Use latest, an exact X.Y.Z version, or a workflow version/history id',
  });
});
export type WorkflowRunVersionRef = z.infer<typeof WorkflowRunVersionRefSchema>;

export const ReleaseTagSchema = z.string().superRefine((value, ctx) => {
  const [name, version, extra] = value.split('@');
  if (!name || !version || extra !== undefined) {
    ctx.addIssue({ code: 'custom', message: 'Release tags must be <package>@<X.Y.Z>' });
    return;
  }
  if (!DottedPackageNameSchema.safeParse(name).success) {
    ctx.addIssue({ code: 'custom', message: `Invalid package name: ${name}` });
  }
  if (!SOURCE_SEMVER_PATTERN.test(version)) {
    ctx.addIssue({ code: 'custom', message: `Invalid release version: ${version}` });
  }
});
export type ReleaseTag = z.infer<typeof ReleaseTagSchema>;

export const WorkspaceDependencySchema = z.string().superRefine((value, ctx) => {
  if (!value.startsWith('workspace:')) {
    ctx.addIssue({ code: 'custom', message: 'Workspace dependencies must start with workspace:' });
    return;
  }
  const ref = value.slice('workspace:'.length);
  const [name, version, extra] = ref.split('@');
  if (!name || !version || extra !== undefined) {
    ctx.addIssue({
      code: 'custom',
      message: 'Workspace dependencies must be workspace:<package>@<X.Y.Z>',
    });
    return;
  }
  if (!DottedPackageNameSchema.safeParse(name).success) {
    ctx.addIssue({ code: 'custom', message: `Invalid dependency package: ${name}` });
  }
  if (!SOURCE_SEMVER_PATTERN.test(version)) {
    ctx.addIssue({ code: 'custom', message: `Invalid dependency version: ${version}` });
  }
});
export type WorkspaceDependency = z.infer<typeof WorkspaceDependencySchema>;

export const AutomationTargetSchema = z.string().superRefine((value, ctx) => {
  const [target, ref, extra] = value.split('@');
  if (!target || extra !== undefined) {
    ctx.addIssue({ code: 'custom', message: 'Automation target must be <package>[@ref]' });
    return;
  }
  if (!DottedPackageNameSchema.safeParse(target).success) {
    ctx.addIssue({ code: 'custom', message: `Invalid automation target: ${target}` });
  }
  const root = target.split('.')[0];
  const refSchema =
    root === 'workflows'
      ? z.union([SourceVersionRefSchema, WorkflowRunVersionRefSchema])
      : SourceVersionRefSchema;
  if (ref && !refSchema.safeParse(ref).success) {
    ctx.addIssue({ code: 'custom', message: `Invalid automation ref: ${ref}` });
  }
});
export type AutomationTarget = z.infer<typeof AutomationTargetSchema>;

const RunTargetSegmentSchema = z
  .string()
  .regex(RUN_TARGET_SEGMENT_PATTERN, 'Use letters, numbers, dashes, and underscores');

/**
 * Run-target strings: `agents.<segments>[@version]` / `workflows.<segments>[@version]`.
 * Segments accept mixed-case ids (`wf_…`, `awf_…`) in addition to lowercase
 * slugs; the version ref is validated per root so error messages are
 * actionable at parse time instead of surfacing as raw ZodErrors later.
 */
export const RunTargetStringSchema = z.string().superRefine((value, ctx) => {
  const [name, ref, extra] = value.split('@');
  if (!name || extra !== undefined || (value.includes('@') && !ref)) {
    ctx.addIssue({ code: 'custom', message: 'Run target must be <target> or <target>@<version>' });
    return;
  }
  const parts = name.split('.');
  if (parts.length < 2) {
    ctx.addIssue({
      code: 'custom',
      message: 'Run target must start with agents. or workflows. followed by a slug or id',
    });
    return;
  }
  const root = parts[0];
  if (root !== 'agents' && root !== 'workflows') {
    ctx.addIssue({
      code: 'custom',
      message: `Run target must start with agents. or workflows., got "${root}."`,
    });
    return;
  }
  for (const segment of parts.slice(1)) {
    if (!RunTargetSegmentSchema.safeParse(segment).success) {
      ctx.addIssue({ code: 'custom', message: `Invalid run target segment: ${segment}` });
    }
  }
  if (ref) {
    const refSchema = root === 'workflows' ? WorkflowRunVersionRefSchema : SourceVersionRefSchema;
    if (!refSchema.safeParse(ref).success) {
      ctx.addIssue({ code: 'custom', message: `Invalid run target version: ${ref}` });
    }
  }
});

export const RunTargetObjectSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('agent'),
      id: z.string().min(1).optional(),
      slug: z.string().min(1).optional(),
      version: SourceVersionRefSchema.optional(),
    })
    .superRefine((value, ctx) => {
      if (!value.id && !value.slug) {
        ctx.addIssue({ code: 'custom', message: 'Agent target requires id or slug' });
      }
    }),
  z
    .object({
      type: z.literal('workflow'),
      id: z.string().min(1).optional(),
      slug: z.string().min(1).optional(),
      version: WorkflowRunVersionRefSchema.optional(),
    })
    .superRefine((value, ctx) => {
      if (!value.id && !value.slug) {
        ctx.addIssue({ code: 'custom', message: 'Workflow target requires id or slug' });
      }
    }),
]);
export type RunTargetObject = z.infer<typeof RunTargetObjectSchema>;

export const RunTargetSchema = z.union([RunTargetStringSchema, RunTargetObjectSchema]);
export type RunTarget = z.infer<typeof RunTargetSchema>;

export type NormalizedRunTarget =
  | {
      type: 'agent';
      packageName: DottedPackageName;
      packagePath: SourcePackagePath;
      slug: string;
      idOrSlug: string;
      requestedVersion: SourceVersionRef;
    }
  | {
      type: 'workflow';
      idOrSlug: string;
      requestedVersion: WorkflowRunVersionRef;
    };

export function parseAutomationTarget(target: AutomationTarget): {
  packageName: DottedPackageName;
  packagePath: SourcePackagePath;
  type: SourcePackageType;
  slug: string;
  ref: SourceVersionRef | WorkflowRunVersionRef;
} {
  const parsed = AutomationTargetSchema.parse(target);
  const [rawPackageName, rawRef] = parsed.split('@') as [DottedPackageName, string | undefined];
  const packagePath = dottedPackageNameToPath(rawPackageName);
  const [type, ...slugParts] = packagePath.split('/') as [SourcePackageType, ...string[]];
  const ref = rawRef ?? 'latest';
  return {
    packageName: DottedPackageNameSchema.parse(rawPackageName),
    packagePath,
    type,
    slug: slugParts.join('/'),
    ref:
      type === 'workflows'
        ? WorkflowRunVersionRefSchema.parse(ref)
        : SourceVersionRefSchema.parse(ref),
  };
}

export function parseRunTarget(target: RunTarget): NormalizedRunTarget {
  const parsed = RunTargetSchema.parse(target);
  if (typeof parsed === 'string') {
    const [name, rawRef] = parsed.split('@') as [string, string | undefined];
    const [root, ...segments] = name.split('.');
    const slug = segments.join('/');
    if (root === 'agents') {
      return {
        type: 'agent',
        packageName: name,
        packagePath: name.split('.').join('/'),
        slug,
        idOrSlug: slug,
        requestedVersion: SourceVersionRefSchema.parse(rawRef ?? 'latest'),
      };
    }
    return {
      type: 'workflow',
      idOrSlug: slug,
      requestedVersion: WorkflowRunVersionRefSchema.parse(rawRef ?? 'latest'),
    };
  }

  if (parsed.type === 'agent') {
    const idOrSlug = parsed.slug ?? parsed.id;
    if (!idOrSlug) throw new Error('Agent target requires id or slug');
    const packageName = idOrSlug.includes('.')
      ? idOrSlug
      : `agents.${idOrSlug.split('/').join('.')}`;
    const [root, ...segments] = packageName.split('.');
    if (root !== 'agents') {
      throw new Error(`Agent target must be rooted at "agents.", got "${idOrSlug}"`);
    }
    for (const segment of segments) {
      RunTargetSegmentSchema.parse(segment);
    }
    const packagePath = packageName.split('.').join('/');
    const [, ...slugParts] = packagePath.split('/');
    const slug = slugParts.join('/');
    return {
      type: 'agent',
      packageName,
      packagePath,
      slug,
      idOrSlug,
      requestedVersion: SourceVersionRefSchema.parse(parsed.version ?? 'latest'),
    };
  }

  const idOrSlug = parsed.slug ?? parsed.id;
  if (!idOrSlug) throw new Error('Workflow target requires id or slug');
  return {
    type: 'workflow',
    idOrSlug,
    requestedVersion: WorkflowRunVersionRefSchema.parse(parsed.version ?? 'latest'),
  };
}

/**
 * Format a {@link RunTarget} as its canonical dotted string, e.g.
 * `workflows.extract-invoice` or `agents.finance.invoice-agent@1.2.3`.
 * `latest` versions are omitted. Inverse of {@link parseRunTarget} for the
 * string form — the single owner of target-string syntax, so callers never
 * hand-roll `agents.${slug.split('/').join('.')}`.
 */
export function formatRunTarget(target: RunTarget): string {
  const { pathTarget, version } = runTargetToPathParts(target);
  return version ? `${pathTarget}@${version}` : pathTarget;
}

/**
 * Split a {@link RunTarget} into the version-less path segment used by
 * `POST /api/v1/run/{target}` plus the optional `version` query value.
 * `latest` is normalized to "no version".
 */
export function runTargetToPathParts(target: RunTarget): {
  pathTarget: string;
  version?: string;
} {
  const normalized = parseRunTarget(target);
  if (normalized.type === 'agent') {
    return {
      pathTarget: normalized.packageName,
      version:
        normalized.requestedVersion !== 'latest' ? String(normalized.requestedVersion) : undefined,
    };
  }
  return {
    pathTarget: `workflows.${normalized.idOrSlug.split('/').join('.')}`,
    version:
      normalized.requestedVersion !== 'latest' ? String(normalized.requestedVersion) : undefined,
  };
}

/**
 * Full request path for `POST /api/v1/run/{target}` — version-less target in
 * the path, version (when not `latest`) in the `version` query parameter.
 * Single owner of this URL shape for app + CLI callers.
 */
export function runTargetApiPath(target: RunTarget): string {
  const { pathTarget, version } = runTargetToPathParts(target);
  const query = version ? `?${new URLSearchParams({ version }).toString()}` : '';
  return `/api/v1/run/${encodeURIComponent(pathTarget)}${query}`;
}

export function pathToDottedPackageName(path: SourcePackagePath): DottedPackageName {
  const parsed = SourcePackagePathSchema.parse(path);
  return DottedPackageNameSchema.parse(parsed.split('/').join('.'));
}

export function dottedPackageNameToPath(name: DottedPackageName): SourcePackagePath {
  const parsed = DottedPackageNameSchema.parse(name);
  return SourcePackagePathSchema.parse(parsed.split('.').join('/'));
}

export function formatReleaseTag(name: DottedPackageName, version: string): ReleaseTag {
  return ReleaseTagSchema.parse(`${DottedPackageNameSchema.parse(name)}@${version}`);
}

export function parseReleaseTag(tag: ReleaseTag): {
  packageName: DottedPackageName;
  packagePath: SourcePackagePath;
  version: string;
} {
  const parsed = ReleaseTagSchema.parse(tag);
  const [packageName, version] = parsed.split('@') as [DottedPackageName, string];
  return {
    packageName: DottedPackageNameSchema.parse(packageName),
    packagePath: dottedPackageNameToPath(packageName),
    version,
  };
}

export type HostedSourceExportPathInput = {
  gitRepositoryPath: string;
  ref: string;
  packagePath: SourcePackagePath;
};

export function formatHostedSourceExportPath({
  gitRepositoryPath,
  ref,
  packagePath,
}: HostedSourceExportPathInput): string {
  const parsedPackagePath = SourcePackagePathSchema.parse(packagePath);
  if (!gitRepositoryPath.trim()) {
    throw new Error('gitRepositoryPath is required');
  }
  if (!ref.trim()) {
    throw new Error('ref is required');
  }
  return `/export/orgs/${encodeURIComponent(gitRepositoryPath)}/${encodeURIComponent(ref)}/${parsedPackagePath}`;
}
