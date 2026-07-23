/**
 * Canonical S3/R2 path grammar.
 *
 * Prefer direct calls with the full canonical template. This is the primary
 * API shape: one typed path builder, one readable path string, no helper name
 * to keep in sync with the storage layout.
 *
 *   rootS3Path('automations/:automationId/runs/:runId/output.json', {
 *     tenantId,
 *     automationId,
 *     runId,
 *   });
 *
 * Use `.at()` only when one local scope needs multiple children under the same
 * long prefix:
 *
 *   const runPath = rootS3Path.at('automations/:automationId/runs/:runId', {
 *     tenantId,
 *     automationId,
 *     runId,
 *   });
 *   runPath('output.json');
 *   runPath('output/:stepName/:fileArtifactName', {
 *     stepName: 'extract',
 *     fileArtifactName: s3FileArtifactName(fileId, filename),
 *   });
 *
 * Use `.tenant()` for package-local builders that always know the tenant from
 * context, e.g. an app auth wrapper:
 *
 *   const appS3Path = rootS3Path.tenant(auth.tenantId);
 *   appS3Path('automations/:automationId/runs/:runId/output.json', { automationId, runId });
 *
 * Do not recreate a helper-per-path API on top of this file. Avoid wrappers
 * like `executionPath(execution)('output.json')` when a direct full-template
 * call is clear enough.
 *
 * Every literal segment below is a canonical storage segment. Keys starting
 * with `$` are validated dynamic path parameters.
 */

const PATH_LEAF = null;
const PATH_REST = '*';

export const S3_PATH_GRAMMAR = {
  // Legacy/source-agent layout. Runtime artifacts are copied to
  // `automations/<automationId>/...`, but old agents, sessions, source files,
  // and migration fallbacks still read this tree.
  agents: {
    $agentSlug: {
      agent: {
        'AGENT.md': PATH_LEAF,
        'input-schema.json': PATH_LEAF,
        'output-schema.json': PATH_LEAF,
        'mistakes.md': PATH_LEAF,
        'requirements.txt': PATH_LEAF,
        'package.json': PATH_LEAF,
        'bun.lock': PATH_LEAF,
        skills: PATH_REST,
        knowledge: PATH_REST,
        rules: PATH_REST,
        env: PATH_REST,
        templates: PATH_REST,
      },
      dataset: {
        $exampleName: {
          input: PATH_REST,
          expected: PATH_REST,
          'input.json': PATH_LEAF,
          'expected.json': PATH_LEAF,
          'metadata.json': PATH_LEAF,
        },
      },
      executions: {
        $executionId: {
          input: PATH_REST,
          output: PATH_REST,
          expected: PATH_REST,
          evaluations: {
            $evaluatorId: PATH_REST,
          },
          'input.json': PATH_LEAF,
          'input-files.json': PATH_LEAF,
          'input-schema.json': PATH_LEAF,
          'output.json': PATH_LEAF,
          'expected.json': PATH_LEAF,
          'metadata.json': PATH_LEAF,
          'issues.md': PATH_LEAF,
          'trace.jsonl': PATH_LEAF,
        },
      },
      sessions: {
        $sessionId: {
          '.keep': PATH_LEAF,
          'messages.jsonl': PATH_LEAF,
          uploads: PATH_REST,
          '.pi-sessions': PATH_REST,
        },
      },
      evaluators: {
        $evaluatorId: PATH_REST,
      },
      versions: {
        $versionTag: PATH_REST,
      },
    },
  },
  // Canonical public runtime layout for workflows and agents.
  automations: {
    $automationId: {
      dataset: {
        examples: {
          $exampleName: {
            input: {
              $fieldName: {
                $fileId: {
                  $filename: PATH_LEAF,
                },
              },
            },
            expected: {
              $fileId: {
                $filename: PATH_LEAF,
              },
            },
            'input.json': PATH_LEAF,
            'expected.json': PATH_LEAF,
            'metadata.json': PATH_LEAF,
          },
        },
      },
      runs: {
        $runId: {
          input: {
            $fieldName: {
              $fileArtifactName: PATH_LEAF,
            },
          },
          output: {
            $stepName: {
              $fileArtifactName: PATH_LEAF,
            },
          },
          expected: PATH_REST,
          evaluations: {
            $evaluatorId: PATH_REST,
          },
          'input.json': PATH_LEAF,
          'input-files.json': PATH_LEAF,
          'input-schema.json': PATH_LEAF,
          'output.json': PATH_LEAF,
          'expected.json': PATH_LEAF,
          'metadata.json': PATH_LEAF,
          'issues.md': PATH_LEAF,
          'trace.jsonl': PATH_LEAF,
          'events.jsonl': PATH_LEAF,
          'usage.json': PATH_LEAF,
        },
      },
    },
  },
  // Legacy workflow file rows. Kept only for historical compatibility and
  // old routes while `0006_automation_storage_backfill` moves runtime data to
  // the automation-owned tree.
  workflows: {
    $workflowId: {
      runs: {
        $runId: {
          input: {
            $fileId: PATH_LEAF,
          },
          output: {
            $stepName: {
              $fileId: PATH_LEAF,
            },
          },
        },
      },
      evals: {
        $exampleId: {
          input: {
            $fileId: PATH_LEAF,
          },
          expected: {
            $fileId: PATH_LEAF,
          },
        },
      },
    },
  },
  shared: {
    skills: PATH_REST,
    rules: PATH_REST,
    templates: PATH_REST,
    knowledge: PATH_REST,
  },
} as const;

type PathLeaf = typeof PATH_LEAF;
type PathRest = typeof PATH_REST;
type PathNode = PathLeaf | PathRest | { readonly [segment: string]: PathNode };
type PathObject = Exclude<PathNode, PathLeaf | PathRest>;
type StringKey<T> = Extract<keyof T, string>;
type DynamicKey<T> = Extract<StringKey<T>, `$${string}`>;
type DynamicChild<T> = DynamicKey<T> extends never ? never : T[DynamicKey<T>];
type DynamicSegment = string & Record<never, never>;
type TemplateSegment<Key extends string> = Key extends `$${infer Name}` ? `:${Name}` : Key;
type StripTrailingSlash<Template extends string> = Template extends `${infer Inner}/`
  ? Inner
  : Template;

export type S3PathGrammar = typeof S3_PATH_GRAMMAR;

type S3PathTemplates<Node extends PathNode = S3PathGrammar> = Node extends PathLeaf
  ? never
  : Node extends PathRest
    ? ':path'
    : {
        [Key in StringKey<Node>]: Extract<Node[Key], PathNode> extends infer Child
          ? Child extends PathLeaf
            ? TemplateSegment<Key>
            : Child extends PathRest
              ? TemplateSegment<Key> | `${TemplateSegment<Key>}/:path`
              : Child extends PathNode
                ? TemplateSegment<Key> | `${TemplateSegment<Key>}/${S3PathTemplates<Child>}`
                : never
          : never;
      }[StringKey<Node>];

type PlaceholderName<Part extends string> = Part extends `:${infer Name}` ? Name : never;
type TemplatePlaceholders<Template extends string> = Template extends `${infer Head}/${infer Tail}`
  ? PlaceholderName<Head> | TemplatePlaceholders<Tail>
  : PlaceholderName<Template>;
type TemplatePart<Part extends string> = Part extends `:${string}` ? DynamicSegment : Part;
type TemplateParts<Template extends string> = Template extends `${infer Head}/${infer Tail}`
  ? [TemplatePart<Head>, ...TemplateParts<Tail>]
  : [TemplatePart<Template>];

type S3PathTemplateInputFor<Node extends PathNode> =
  | S3PathTemplates<Node>
  | `${S3PathTemplates<Node>}/`;
type S3PathTemplateNodeFor<
  Node extends PathNode,
  Template extends S3PathTemplateInputFor<Node>,
> = S3PathNodeAfter<Node, TemplateParts<StripTrailingSlash<Template>>>;

export type S3PathTemplate = S3PathTemplates<S3PathGrammar>;
export type S3PathTemplateInput = S3PathTemplateInputFor<S3PathGrammar>;
export type S3PathTemplateParams<Template extends string> = {
  [Key in TemplatePlaceholders<StripTrailingSlash<Template>>]: string;
};
export type RootS3PathParams<Template extends S3PathTemplateInput> =
  S3PathTemplateParams<Template> & {
    tenantId: string;
  };
export type S3PathParams<Template extends S3PathTemplateInput> = S3PathTemplateParams<Template> & {
  tenantId?: string;
};
export type S3PathTemplateNode<Template extends S3PathTemplateInput> = S3PathNodeAfter<
  S3PathGrammar,
  TemplateParts<StripTrailingSlash<Template>>
>;

export type S3PathNodeAfter<
  Node extends PathNode,
  Parts extends readonly unknown[],
> = Parts extends readonly []
  ? Node
  : Node extends PathLeaf
    ? never
    : Node extends PathRest
      ? PathRest
      : Parts extends readonly [infer Head, ...infer Tail]
        ? StripTrailingSlash<Extract<Head, string>> extends infer NormalizedHead
          ? NormalizedHead extends StringKey<Node>
            ? S3PathNodeAfter<Extract<Node[NormalizedHead], PathNode>, Tail>
            : DynamicChild<Node> extends infer Child
              ? Child extends PathNode
                ? S3PathNodeAfter<Child, Tail>
                : never
              : never
          : never
        : never;

type TenantParams<TenantBound extends boolean> = TenantBound extends true
  ? { tenantId?: string }
  : { tenantId: string };
type S3PathBuilderParams<
  Template extends string,
  TenantBound extends boolean,
> = S3PathTemplateParams<Template> & TenantParams<TenantBound>;
type RequiredKeys<T> = {
  [Key in keyof T]-?: Record<string, never> extends Pick<T, Key> ? never : Key;
}[keyof T];
type S3PathBuilderArgs<Template extends string, TenantBound extends boolean> =
  RequiredKeys<S3PathBuilderParams<Template, TenantBound>> extends never
    ? [params?: S3PathBuilderParams<Template, TenantBound>]
    : [params: S3PathBuilderParams<Template, TenantBound>];

export interface S3PathBuilder<
  Node extends PathNode = S3PathGrammar,
  TenantBound extends boolean = false,
> {
  <Template extends S3PathTemplateInputFor<Node>>(
    template: Template,
    ...args: S3PathBuilderArgs<Template, TenantBound>
  ): string;
  at<Template extends S3PathTemplateInputFor<Node>>(
    template: Template,
    ...args: S3PathBuilderArgs<Template, TenantBound>
  ): S3PathBuilder<S3PathTemplateNodeFor<Node, Template>, true>;
  tenant(tenantId: string): S3PathBuilder<Node, true>;
  readonly segments: readonly string[];
}

export type RootS3PathBuilder = S3PathBuilder<S3PathGrammar, false>;
export type TenantS3PathBuilder<Node extends PathNode = S3PathGrammar> = S3PathBuilder<Node, true>;

const SEGMENT_RX = /^[A-Za-z0-9_.-]+$/;
const SAFE_FILENAME_RX = /[^A-Za-z0-9_.-]+/g;
const TENANT_PREFIX_RX = /^tenants\/[A-Za-z0-9_.-]+\//;

function assertSegment(name: string, value: string): string {
  if (!value || !SEGMENT_RX.test(value)) {
    throw new Error(`Invalid S3 path segment for ${name}: ${JSON.stringify(value)}`);
  }
  return value;
}

export function assertS3PathSegment(name: string, value: string): string {
  return assertSegment(name, value);
}

export function s3PathFilename(value: string): string {
  const base = value.split(/[\\/]/).filter(Boolean).at(-1) ?? 'file';
  const safe = base.replace(SAFE_FILENAME_RX, '_').replace(/^_+|_+$/g, '');
  return assertSegment('filename', safe || 'file');
}

export function s3FileArtifactName(fileId: string, filename: string): string {
  return `${assertSegment('fileId', fileId)}-${s3PathFilename(filename)}`;
}

// Artifact names are `${fileId}-${filename}` where fileId is `file_<nanoid(21)>`
// (see `generateId` + `ID_PREFIXES.FILE` + `s3FileArtifactName`). The nanoid
// alphabet is URL-safe (`A-Za-z0-9_-`), so the leading `file_…-` segment is a
// fixed 5 + 21 + 1 shape we can strip unambiguously without knowing where the
// filename's own dashes fall.
const FILE_ARTIFACT_PREFIX_RX = /^file_[A-Za-z0-9_-]{21}-/;

/**
 * Reverse of {@link s3FileArtifactName} for display: take an artifact name
 * (`file_<id>-<filename>`) or a scoped `$file` path
 * (`input/<field>/<artifactName>`) and return just the human-facing filename.
 * Degrades to the last path segment when the input does not carry a fileId
 * prefix, so it is always safe to call.
 *
 * Display-only and best-effort: never use the result as a lookup key. A user
 * file literally named `file_<21 url-safe chars>-<rest>` would have its prefix
 * stripped too, which is why callers keep the raw artifact name for downloads.
 */
export function filenameFromArtifactName(nameOrPath: string): string {
  const base = nameOrPath.split('/').filter(Boolean).at(-1) ?? nameOrPath;
  return base.replace(FILE_ARTIFACT_PREFIX_RX, '') || base;
}

function getDynamicEntry(node: PathObject): readonly [string, PathNode] | undefined {
  const key = Object.keys(node).find((candidate) => candidate.startsWith('$'));
  return key ? [key, node[key]] : undefined;
}

function normalizeTemplatePart(
  part: string,
  isLast: boolean
): { segment: string; trailingSlash: boolean } {
  const trailingSlash = part.endsWith('/');
  if (!trailingSlash) return { segment: part, trailingSlash: false };
  if (!isLast) {
    throw new Error(
      `S3 path segment can only have a trailing slash at the end: ${JSON.stringify(part)}`
    );
  }
  return { segment: part.slice(0, -1), trailingSlash: true };
}

function normalizeTemplateParts(parts: readonly string[]): {
  segments: string[];
  trailingSlash: boolean;
} {
  let trailingSlash = false;
  const segments = parts.map((part, index) => {
    const normalized = normalizeTemplatePart(part, index === parts.length - 1);
    trailingSlash = normalized.trailingSlash;
    return normalized.segment;
  });
  return { segments, trailingSlash };
}

function walkGrammar(node: PathNode, parts: readonly string[]): PathNode {
  let current = node;
  const { segments, trailingSlash } = normalizeTemplateParts(parts);

  for (const part of segments) {
    if (current === PATH_LEAF) {
      throw new Error(`S3 path cannot be extended past leaf segment: ${JSON.stringify(part)}`);
    }

    if (current === PATH_REST) {
      assertSegment('path', part);
      continue;
    }

    if (part in current) {
      current = current[part];
      continue;
    }

    const dynamicEntry = getDynamicEntry(current);
    if (!dynamicEntry) {
      throw new Error(`Invalid S3 path segment: ${JSON.stringify(part)}`);
    }

    assertSegment(dynamicEntry[0].slice(1), part);
    current = dynamicEntry[1];
  }

  if (trailingSlash && current === PATH_LEAF) {
    throw new Error(`S3 path leaf cannot have a trailing slash: ${JSON.stringify(parts.at(-1))}`);
  }

  return current;
}

function normalizeTemplate<Template extends string>(
  template: Template
): StripTrailingSlash<Template> {
  return (
    template.endsWith('/') ? template.slice(0, -1) : template
  ) as StripTrailingSlash<Template>;
}

function renderTemplate<Template extends string>(
  template: Template,
  params: S3PathTemplateParams<Template>
): string[] {
  return normalizeTemplate(template)
    .split('/')
    .flatMap((part) => {
      if (!part.startsWith(':')) {
        return [part];
      }

      const name = part.slice(1) as TemplatePlaceholders<StripTrailingSlash<Template>>;
      const value = params[name];
      if (typeof value !== 'string') {
        throw new Error(`Missing S3 path parameter: ${part}`);
      }

      if (name === 'path') {
        return value.split('/').map((segment) => assertSegment('path', segment));
      }

      return [assertSegment(String(name), value)];
    });
}

export function buildS3Path<Template extends S3PathTemplateInput>(
  tenantId: string,
  template: Template,
  params: S3PathTemplateParams<Template>
): string {
  const tenant = assertSegment('tenantId', tenantId);
  const parts = renderTemplate(template, params);
  const node = walkGrammar(S3_PATH_GRAMMAR, parts);
  if (template.endsWith('/') && node === PATH_LEAF) {
    throw new Error(`S3 path leaf cannot have a trailing slash: ${JSON.stringify(template)}`);
  }
  const path = ['tenants', tenant, ...parts].join('/');
  return template.endsWith('/') ? `${path}/` : path;
}

/**
 * Build a canonical key without the `tenants/<tenantId>/` prefix. Use this
 * only at tenant-scoped storage boundaries, where `TenantScopedStorage` adds
 * the prefix. Prefer `rootS3Path` for raw bucket operations.
 */
export function buildS3PathSuffix<Template extends S3PathTemplateInput>(
  template: Template,
  params: S3PathTemplateParams<Template>
): string {
  const parts = renderTemplate(template, params);
  const node = walkGrammar(S3_PATH_GRAMMAR, parts);
  if (template.endsWith('/') && node === PATH_LEAF) {
    throw new Error(`S3 path leaf cannot have a trailing slash: ${JSON.stringify(template)}`);
  }
  const path = parts.join('/');
  return template.endsWith('/') ? `${path}/` : path;
}

/** Strip the leading `tenants/<tenantId>/` prefix; pass-through if absent. */
export function stripTenantPrefix(key: string): string {
  return key.replace(TENANT_PREFIX_RX, '');
}

/**
 * Match a suffix-only or tenant-prefixed key against one grammar template.
 * Returns the dynamic params when it matches, otherwise null.
 */
export function matchS3Path<Template extends S3PathTemplateInput>(
  template: Template,
  key: string
): S3PathTemplateParams<Template> | null {
  const keyParts = stripTenantPrefix(key).split('/');
  const templateParts = normalizeTemplate(template).split('/');
  const params: Record<string, string> = {};
  let keyIndex = 0;

  for (let templateIndex = 0; templateIndex < templateParts.length; templateIndex += 1) {
    const templatePart = templateParts[templateIndex];
    if (!templatePart.startsWith(':')) {
      if (keyParts[keyIndex] !== templatePart) return null;
      keyIndex += 1;
      continue;
    }

    const name = templatePart.slice(1);
    if (name === 'path') {
      if (templateIndex !== templateParts.length - 1) return null;
      const rest = keyParts.slice(keyIndex);
      if (rest.length === 0) return null;
      try {
        params.path = rest.map((segment) => assertSegment('path', segment)).join('/');
        walkGrammar(S3_PATH_GRAMMAR, keyParts);
      } catch {
        return null;
      }
      return params as S3PathTemplateParams<Template>;
    }

    const value = keyParts[keyIndex];
    if (value == null) return null;
    try {
      params[name] = assertSegment(name, value);
    } catch {
      return null;
    }
    keyIndex += 1;
  }

  if (keyIndex !== keyParts.length) return null;
  try {
    walkGrammar(S3_PATH_GRAMMAR, keyParts);
  } catch {
    return null;
  }
  return params as S3PathTemplateParams<Template>;
}

function createBuilder<Node extends PathNode>(
  grammarNode: Node,
  prefixSegments: readonly string[],
  boundTenantId?: string
): S3PathBuilder<Node, boolean> {
  const resolveTenantId = (params?: { tenantId?: string }) => {
    const tenantId = params?.tenantId ?? boundTenantId;
    if (!tenantId) {
      throw new Error('Missing tenantId for S3 path');
    }

    return assertSegment('tenantId', tenantId);
  };

  const build = <Template extends S3PathTemplateInputFor<Node>>(
    template: Template,
    params?: S3PathTemplateParams<Template> & { tenantId?: string }
  ) => {
    const tenant = resolveTenantId(params);
    const parts = renderTemplate(template, (params ?? {}) as S3PathTemplateParams<Template>);
    const node = walkGrammar(grammarNode, parts);
    if (template.endsWith('/') && node === PATH_LEAF) {
      throw new Error(`S3 path leaf cannot have a trailing slash: ${JSON.stringify(template)}`);
    }
    const path = ['tenants', tenant, ...prefixSegments, ...parts].join('/');
    return template.endsWith('/') ? `${path}/` : path;
  };

  const builder = build as S3PathBuilder<Node, boolean>;

  builder.at = (<Template extends S3PathTemplateInputFor<Node>>(
    template: Template,
    params?: S3PathTemplateParams<Template> & { tenantId?: string }
  ) => {
    const tenant = resolveTenantId(params);
    const parts = renderTemplate(template, (params ?? {}) as S3PathTemplateParams<Template>);
    const nextNode = walkGrammar(grammarNode, parts);
    if (template.endsWith('/') && nextNode === PATH_LEAF) {
      throw new Error(`S3 path leaf cannot have a trailing slash: ${JSON.stringify(template)}`);
    }
    return createBuilder(nextNode, [...prefixSegments, ...parts], tenant) as S3PathBuilder<
      S3PathTemplateNodeFor<Node, Template>,
      true
    >;
  }) as S3PathBuilder<Node, boolean>['at'];

  builder.tenant = (tenantId: string) =>
    createBuilder(
      grammarNode,
      prefixSegments,
      assertSegment('tenantId', tenantId)
    ) as S3PathBuilder<Node, true>;

  Object.defineProperty(builder, 'segments', {
    enumerable: true,
    value: Object.freeze([...prefixSegments]),
  });

  return builder;
}

export const rootS3Path = createBuilder(S3_PATH_GRAMMAR, []) as RootS3PathBuilder;
