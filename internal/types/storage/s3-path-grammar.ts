/**
 * Canonical S3/R2 path grammar.
 *
 * Prefer direct calls with the full canonical template. This is the primary
 * API shape: one typed path builder, one readable path string, no helper name
 * to keep in sync with the storage layout.
 *
 *   rootS3Path('agents/:agentSlug/agent/SOP.md', { tenantId, agentSlug });
 *   rootS3Path('agents/:agentSlug/executions/:executionId/output.json', {
 *     tenantId,
 *     agentSlug,
 *     executionId,
 *   });
 *
 * Use `.at()` only when one local scope needs multiple children under the same
 * long prefix:
 *
 *   const sessionPath = rootS3Path.at('agents/:agentSlug/sessions/:sessionId', {
 *     tenantId,
 *     agentSlug,
 *     sessionId,
 *   });
 *   sessionPath('messages.jsonl');
 *   sessionPath('.keep');
 *
 * Use `.tenant()` for package-local builders that always know the tenant from
 * context, e.g. an app auth wrapper:
 *
 *   const appS3Path = rootS3Path.tenant(auth.tenantId);
 *   appS3Path('agents/:agentSlug/agent/SOP.md', { agentSlug });
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
  agents: {
    $agentSlug: {
      agent: {
        'SOP.md': PATH_LEAF,
        'input-schema.json': PATH_LEAF,
        'output-schema.json': PATH_LEAF,
        'linked.json': PATH_LEAF,
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
          'feedback.md': PATH_LEAF,
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
          'output.json': PATH_LEAF,
          'expected.json': PATH_LEAF,
          'metadata.json': PATH_LEAF,
          'feedback.md': PATH_LEAF,
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

function assertSegment(name: string, value: string): string {
  if (!value || !SEGMENT_RX.test(value)) {
    throw new Error(`Invalid S3 path segment for ${name}: ${JSON.stringify(value)}`);
  }
  return value;
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
