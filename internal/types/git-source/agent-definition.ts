import { z } from 'zod';
import { ExactDiffConfigSchema } from '../eval/evaluator-config';
import { AgentPackageManifestSchema } from './manifests';
import { AgentResourcesSchema } from './resources';

// No defaults or transforms: captured evaluator metadata must remain byte-for-byte data.
const compiledExactOptions = z
  .strictObject({
    rules: z
      .record(
        z.string(),
        z.strictObject({
          ignore: z.literal(true).optional(),
          order: z.enum(['ordered', 'unordered']).optional(),
          items: z.enum(['at-least', 'at-most', 'exactly']).optional(),
          matchBy: z.union([z.string(), z.array(z.string())]).optional(),
          allowExtraFields: z.boolean().optional(),
          numericTolerance: z.number().finite().nonnegative().optional(),
        })
      )
      .optional(),
    paths: z.array(z.string()).optional(),
    unorderedPaths: z.array(z.string()).optional(),
    numericTolerance: z.number().finite().nonnegative().optional(),
    allowExtraFields: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    const result = ExactDiffConfigSchema.safeParse(value);
    if (!result.success)
      for (const issue of result.error.issues)
        ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message });
  });

const evaluatorName = z
  .string()
  .regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/)
  .refine((name) => !['constructor', 'prototype', '__proto__'].includes(name));
export const CompiledAgentEvaluationSchema = z
  .strictObject({
    evaluators: z
      .record(
        evaluatorName,
        z.discriminatedUnion('kind', [
          z.strictObject({ kind: z.literal('custom') }),
          z.strictObject({
            kind: z.literal('exact-diff'),
            options: compiledExactOptions.optional(),
          }),
          z.strictObject({
            kind: z.literal('llm-judge'),
            prompt: z
              .string()
              .min(10)
              .max(128 * 1024),
            model: z.string().min(1).optional(),
          }),
        ])
      )
      .refine(
        (values) => Object.keys(values).length > 0 && Object.keys(values).length <= 32,
        'Define between 1 and 32 evaluators'
      ),
    pass: z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('callback') }),
      z.strictObject({
        kind: z.literal('weighted'),
        weights: z.record(evaluatorName, z.number().finite().nonnegative()),
        threshold: z.number().finite().min(0).max(1),
      }),
    ]),
  })
  .superRefine((evaluation, ctx) => {
    if (evaluation.pass.kind === 'weighted') {
      const entries = Object.entries(evaluation.pass.weights);
      if (
        !entries.length ||
        !Number.isFinite(entries.reduce((total, [, weight]) => total + weight, 0)) ||
        entries.reduce((total, [, weight]) => total + weight, 0) <= 0
      )
        ctx.addIssue({
          code: 'custom',
          path: ['pass', 'weights'],
          message: 'Weights must have a finite positive total',
        });
      if (entries.some(([name]) => !Object.hasOwn(evaluation.evaluators, name)))
        ctx.addIssue({
          code: 'custom',
          path: ['pass', 'weights'],
          message: 'Weight references an undefined evaluator',
        });
    }
  });
export type CompiledAgentEvaluation = z.infer<typeof CompiledAgentEvaluationSchema>;

/** Data only. Validation must not insert defaults into a captured definition. */
export const CompiledAgentDataSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal('agent'),
    manifest: z
      .unknown()
      .refine(
        (value) => AgentPackageManifestSchema.safeParse(value).success,
        'Invalid agent manifest'
      ) as z.ZodType<z.input<typeof AgentPackageManifestSchema>>,
    instructions: z
      .string()
      .min(1)
      .max(128 * 1024)
      .refine((v) => v.trim().length > 0)
      .optional(),
    resources: AgentResourcesSchema.optional(),
    evaluation: CompiledAgentEvaluationSchema.optional(),
    tools: z
      .record(
        z
          .string()
          .regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/)
          .refine(
            (name) =>
              ![
                '__proto__',
                'constructor',
                'prototype',
                'finish',
                'read',
                'write',
                'edit',
                'bash',
                'grep',
                'find',
                'ls',
                'request_human_review',
                'report_step_progress',
                'web_search',
                'fetch_url',
                'write_workflow_output_json',
                'write_workflow_output_file',
              ].includes(name)
          ),
        z.strictObject({
          description: z.string().min(1),
          inputSchema: z.record(z.string(), z.unknown()),
          outputSchema: z.record(z.string(), z.unknown()),
        })
      )
      .refine((v) => Object.keys(v).length <= 21)
      .optional(),
    executable: z
      .strictObject({
        code: z.string().max(2 * 1024 * 1024),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .optional(),
    inputSchema: z.record(z.string(), z.unknown()).optional(),
    outputSchema: z.record(z.string(), z.unknown()).optional(),
  })
  .refine(
    (definition) =>
      !Object.values(definition.resources ?? {}).some((resource) => resource.kind === 'skill') ||
      definition.manifest.filesystem === true,
    'Skills require .withFilesystem()'
  );
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
