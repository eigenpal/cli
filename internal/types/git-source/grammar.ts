import { z } from 'zod';

export const SOURCE_PACKAGE_SEGMENT_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
export const SOURCE_COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/;
export const SOURCE_SEMVER_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+$/;
export const SOURCE_VERSION_RANGE_PATTERN = /^[0-9]+(?:\.[0-9]+)?\.(?:x|\*)$/;

export const SourcePackageSegmentSchema = z
  .string()
  .regex(SOURCE_PACKAGE_SEGMENT_PATTERN, 'Use lowercase letters, numbers, and dashes');

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

export const SourceVersionRefSchema = z.union([
  z.literal('latest'),
  z.literal('main'),
  z.string().regex(SOURCE_SEMVER_PATTERN),
  z.string().regex(SOURCE_VERSION_RANGE_PATTERN),
  z.string().regex(SOURCE_COMMIT_SHA_PATTERN),
]);
export type SourceVersionRef = z.infer<typeof SourceVersionRefSchema>;

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
  if (ref && !SourceVersionRefSchema.safeParse(ref).success) {
    ctx.addIssue({ code: 'custom', message: `Invalid automation ref: ${ref}` });
  }
});
export type AutomationTarget = z.infer<typeof AutomationTargetSchema>;

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
