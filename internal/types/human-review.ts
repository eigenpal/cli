import { z } from 'zod';
import { JsonSchemaSchema } from './core/common';
import { validateOutput, type ValidationResult } from './validation/output';

/**
 * Hard limits enforced when a review task is created or an agent continuation is
 * persisted. Values are chosen to keep Postgres rows, API payloads, and restored
 * Pi sessions bounded without requiring production distribution telemetry.
 *
 * | Limit | Value | Rationale |
 * | --- | --- | --- |
 * | `dataBytes` | 2 MiB | Matches the order of magnitude of other JSON snapshot caps in the repo (for example `packages/config` relay `maxPayloadBytes` at 1 MiB and headless multipart budgets near a few MiB). Large enough for structured extraction payloads, small enough to reject accidental whole-document dumps. |
 * | `scalarLeaves` | 10,000 | Aligns with other 10k collection ceilings (`openparser-lineage` output lists, workflow dashboard list caps). Bounds leaf enumeration before selection runs. |
 * | `metadataBytes` | 1 MiB | Same ceiling as relay `maxPayloadBytes`; metadata is display-only and should stay smaller than review data. |
 * | `requiredFields` | 2,000 | One fifth of `scalarLeaves`; forces authors to narrow selection instead of marking every leaf required in `all` mode or via low thresholds. |
 * | `selectionIncludePatterns` | 200 | One fiftieth of `scalarLeaves`; bounds include expansion before leaf scans (`patterns × leaves`). |
 * | `selectionExcludePatterns` | 200 | Same ceiling as include; exclude runs after include expansion. |
 * | `selectionFieldPolicies` | 500 | One tenth of `scalarLeaves`; caps per-field wildcard/exact policies without limiting matched leaves. |
 * | `selectionPatternChars` | 512 | Matches other short string caps (for example field labels at 500); rejects megabyte pointer strings. |
 * | `selectionPatternSegments` | 32 | Four times the workflow builder schema depth (8); allows nested array wildcards without unbounded paths. |
 * | `selectionBytes` | 256 KiB | UTF-8 JSON size of the normalized `selection` object; keeps YAML/tool payloads parseable. |
 * | `attachments` | 100 | Matches the practical upper bound of files a single run normally materializes; prevents runaway attachment expression lists. |
 * | `agentContinuationBytes` | 10 MiB | Below agent builder session archive caps (100 MiB) and step-progress result paths (50 MiB) while still fitting a resumable Pi session plus manifest. |
 * | `agentContinuationRetentionDays` | 30 | Same default retention window used for other durable run artifacts; long enough for business-day review queues without unbounded storage. |
 */
export const HUMAN_REVIEW_LIMITS = {
  /** UTF-8 JSON byte length of resolved review `data`. */
  dataBytes: 2 * 1024 * 1024,
  /** Maximum scalar/null leaves enumerated from review `data`. */
  scalarLeaves: 10_000,
  /** UTF-8 JSON byte length of normalized `fieldMetadata`. */
  metadataBytes: 1024 * 1024,
  /** Maximum selected or reviewer-edited required field paths per task. */
  requiredFields: 2_000,
  /** Maximum RFC 6901 include patterns in `selection.include`. */
  selectionIncludePatterns: 200,
  /** Maximum RFC 6901 exclude patterns in `selection.exclude`. */
  selectionExcludePatterns: 200,
  /** Maximum keys in `selection.fields`. */
  selectionFieldPolicies: 500,
  /** Maximum UTF-8 character length of a JSON Pointer pattern string. */
  selectionPatternChars: 512,
  /** Maximum segment count in a JSON Pointer pattern. */
  selectionPatternSegments: 32,
  /** UTF-8 JSON byte length of the normalized `selection` object. */
  selectionBytes: 256 * 1024,
  /** Maximum `files.attachments` entries per request. */
  attachments: 100,
  /** Total bytes persisted for an agent human-review continuation bundle. */
  agentContinuationBytes: 10 * 1024 * 1024,
  /** Days before an agent continuation object expires from tenant storage. */
  agentContinuationRetentionDays: 30,
} as const;

/** Outcome reason persisted when approval is refused because the continuation expired. */
export const HUMAN_REVIEW_CONTINUATION_EXPIRED_REASON = 'Agent continuation retention has expired';

export function continuationExpiresAt(
  createdAt: Date,
  retentionDays = HUMAN_REVIEW_LIMITS.agentContinuationRetentionDays
): Date {
  return new Date(createdAt.getTime() + retentionDays * 24 * 60 * 60 * 1000);
}

/** True at `expiresAt` and after. Matches pack/unpack (`expiresAt <= now`). */
export function isHumanReviewAgentContinuationExpired(
  createdAt: Date,
  now = new Date(),
  retentionDays = HUMAN_REVIEW_LIMITS.agentContinuationRetentionDays
): boolean {
  return continuationExpiresAt(createdAt, retentionDays).getTime() <= now.getTime();
}

function jsonByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export const HUMAN_REVIEW_AGENT_CREATION_FLAG = 'EIGENPAL_HUMAN_REVIEW_AGENT_CREATION';
export const HUMAN_REVIEW_WORKFLOW_CREATION_FLAG = 'EIGENPAL_HUMAN_REVIEW_WORKFLOW_CREATION';

const FEATURE_OFF_VALUES = new Set(['0', 'false', 'off', 'no']);

/** Default on outside production; explicit env wins. */
export function isHumanReviewFeatureEnabled(
  flag: string,
  env: Record<string, string | undefined>
): boolean {
  const value = env[flag];
  if (value === undefined) return env.NODE_ENV !== 'production';
  return !FEATURE_OFF_VALUES.has(value.toLowerCase());
}

const JSON_POINTER_ESCAPE = /~(?:0|1)/g;
const INVALID_JSON_POINTER_ESCAPE = /~(?![01])/;

export const HumanReviewJsonPointerSchema = z
  .string()
  .refine((value) => value.startsWith('/') && !INVALID_JSON_POINTER_ESCAPE.test(value), {
    message: 'Expected an RFC 6901 JSON Pointer beginning with "/"',
  });

function countJsonPointerPatternSegments(pointer: string): number {
  return pointer.length <= 1 ? 0 : pointer.slice(1).split('/').length;
}

function selectionPatternLimitMessage(limit: number, label: string, actual: number): string {
  return `${label} exceeds the ${limit} limit (${actual} provided)`;
}

export const HumanReviewJsonPointerPatternSchema = HumanReviewJsonPointerSchema.max(
  HUMAN_REVIEW_LIMITS.selectionPatternChars,
  {
    message: `JSON Pointer pattern exceeds the ${HUMAN_REVIEW_LIMITS.selectionPatternChars} character limit`,
  }
)
  .superRefine((value, ctx) => {
    const segmentCount = countJsonPointerPatternSegments(value);
    if (segmentCount > HUMAN_REVIEW_LIMITS.selectionPatternSegments) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: selectionPatternLimitMessage(
          HUMAN_REVIEW_LIMITS.selectionPatternSegments,
          'JSON Pointer pattern segment count',
          segmentCount
        ),
      });
    }
  })
  .refine(
    (value) =>
      value
        .slice(1)
        .split('/')
        .every((segment) => segment === '*' || !segment.includes('*')),
    { message: 'A wildcard must occupy an entire JSON Pointer segment' }
  );

export const HumanReviewCategoricalConfidenceSchema = z.enum(['low', 'medium', 'high']);
export const HumanReviewNumericConfidenceSchema = z.number().finite().min(0).max(1);
export const HumanReviewMetadataFromSchema = z
  .enum(['ai.extract'])
  .describe(
    'Producer adapter. `ai.extract` derives field confidence from `_grounding` and strips that reserved key from review data. Grounding is not stripped unless this is set.'
  );

const CATEGORICAL_CONFIDENCE_RANK: Record<'low' | 'medium' | 'high', number> = {
  low: 0,
  medium: 1,
  high: 2,
};

export function coerceHumanReviewConfidence(
  value: unknown
): number | 'low' | 'medium' | 'high' | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1) return value;
  if (value === 'low' || value === 'medium' || value === 'high') return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === 'low' || trimmed === 'medium' || trimmed === 'high') return trimmed;
    if (trimmed !== '') {
      const numeric = Number(trimmed);
      if (Number.isFinite(numeric) && numeric >= 0 && numeric <= 1) return numeric;
    }
  }
  return undefined;
}

export const HumanReviewResolvedConfidenceSchema = z.union([
  HumanReviewNumericConfidenceSchema,
  HumanReviewCategoricalConfidenceSchema,
  z.string().min(1),
]);

export const HumanReviewConfidenceValueSchema = z.union([
  HumanReviewNumericConfidenceSchema,
  HumanReviewCategoricalConfidenceSchema,
]);

export const HumanReviewFieldMetadataSchema = z
  .object({
    confidence: HumanReviewResolvedConfidenceSchema.optional().describe(
      'Producer-supplied confidence: 0–1 numeric (legacy) or categorical low|medium|high from ai.extract grounding. Not calibrated by Eigenpal.'
    ),
    label: z.string().max(500).optional().describe('Short label shown in the review UI'),
    description: z
      .string()
      .max(5_000)
      .optional()
      .describe('Longer reviewer guidance for this field'),
    review: z
      .enum(['auto', 'always', 'never'])
      .default('auto')
      .optional()
      .describe(
        'Legacy per-field override kept for existing tasks. Prefer selection.fields.review.'
      ),
    display: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Opaque display metadata preserved for the review UI'),
  })
  .strict();

export const HumanReviewFieldPolicySchema = z
  .object({
    review: z
      .enum(['always', 'never', 'skip'])
      .optional()
      .describe('Always require review, or never/skip review for matching paths'),
    threshold: HumanReviewResolvedConfidenceSchema.optional().describe(
      'Per-field confidence threshold; overrides the global threshold for matching paths'
    ),
  })
  .strict();

function refineHumanReviewSelectionSize(
  selection: Record<string, unknown>,
  ctx: z.RefinementCtx
): void {
  const selectionBytes = jsonByteLength(selection);
  if (selectionBytes > HUMAN_REVIEW_LIMITS.selectionBytes) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Review selection exceeds the ${HUMAN_REVIEW_LIMITS.selectionBytes} byte limit (${selectionBytes} bytes)`,
      path: [],
    });
  }
}

function createHumanReviewSelectionBaseSchema<TFieldPolicy extends z.ZodTypeAny>(
  fieldPolicySchema: TFieldPolicy
) {
  return z
    .object({
      include: z
        .array(HumanReviewJsonPointerPatternSchema)
        .default([])
        .superRefine((patterns, ctx) => {
          if (patterns.length > HUMAN_REVIEW_LIMITS.selectionIncludePatterns) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: selectionPatternLimitMessage(
                HUMAN_REVIEW_LIMITS.selectionIncludePatterns,
                'selection.include pattern count',
                patterns.length
              ),
            });
          }
        })
        .optional()
        .describe('RFC 6901 pointers or wildcard patterns (for example `/items/*/amount`)'),
      exclude: z
        .array(HumanReviewJsonPointerPatternSchema)
        .default([])
        .superRefine((patterns, ctx) => {
          if (patterns.length > HUMAN_REVIEW_LIMITS.selectionExcludePatterns) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: selectionPatternLimitMessage(
                HUMAN_REVIEW_LIMITS.selectionExcludePatterns,
                'selection.exclude pattern count',
                patterns.length
              ),
            });
          }
        })
        .optional()
        .describe('RFC 6901 pointers removed after include expansion'),
      fields: z
        .record(HumanReviewJsonPointerPatternSchema, fieldPolicySchema)
        .superRefine((fields, ctx) => {
          const count = Object.keys(fields).length;
          if (count > HUMAN_REVIEW_LIMITS.selectionFieldPolicies) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: selectionPatternLimitMessage(
                HUMAN_REVIEW_LIMITS.selectionFieldPolicies,
                'selection.fields policy count',
                count
              ),
            });
          }
        })
        .optional()
        .describe(
          'Per-field selection policy keyed by exact pointers or wildcard patterns. Exact beats the most specific wildcard; equally specific overlapping wildcards are rejected.'
        ),
    })
    .strict()
    .superRefine((selection, ctx) => {
      refineHumanReviewSelectionSize(selection, ctx);
    });
}

const HumanReviewSelectionBaseSchema = createHumanReviewSelectionBaseSchema(
  HumanReviewFieldPolicySchema
);

export const HumanReviewSelectionSchema = z.discriminatedUnion('mode', [
  HumanReviewSelectionBaseSchema.extend({
    mode: z.literal('confidence'),
    threshold: HumanReviewResolvedConfidenceSchema,
    missingConfidence: z.enum(['review', 'skip']).default('review').optional(),
  }),
  HumanReviewSelectionBaseSchema.extend({
    mode: z.literal('explicit'),
  }),
  HumanReviewSelectionBaseSchema.extend({
    mode: z.literal('all'),
  }),
]);

export const HumanReviewFilesSchema = z
  .object({
    includeRunInputs: z
      .boolean()
      .default(true)
      .optional()
      .describe('Attach every authorized run input file to the review task'),
    attachments: z
      .array(z.string().min(1))
      .max(HUMAN_REVIEW_LIMITS.attachments)
      .default([])
      .optional()
      .describe('Additional current-run file or artifact template expressions'),
  })
  .strict();

export const HumanReviewResolvedRequestSchema = z
  .object({
    data: z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())]),
    schema: JsonSchemaSchema.optional(),
    metadataFrom: HumanReviewMetadataFromSchema.optional(),
    fieldMetadata: z
      .record(HumanReviewJsonPointerSchema, HumanReviewFieldMetadataSchema)
      .default({})
      .optional(),
    selection: HumanReviewSelectionSchema,
    files: HumanReviewFilesSchema.default({ includeRunInputs: true, attachments: [] }).optional(),
    instructions: z.string().max(10_000).optional(),
  })
  .strict();

const HumanReviewFieldMetadataInputSchema = z
  .object({
    confidence: z
      .union([
        HumanReviewNumericConfidenceSchema,
        HumanReviewCategoricalConfidenceSchema,
        z.string().min(1),
      ])
      .optional(),
    label: z.string().max(500).optional(),
    description: z.string().max(5_000).optional(),
    review: z.enum(['auto', 'always', 'never']).default('auto').optional(),
    display: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const HumanReviewFieldPolicyInputSchema = z
  .object({
    review: z.enum(['always', 'never', 'skip']).optional(),
    threshold: z
      .union([
        HumanReviewNumericConfidenceSchema,
        HumanReviewCategoricalConfidenceSchema,
        z.string().min(1),
      ])
      .optional(),
  })
  .strict();

const HumanReviewSelectionInputBaseSchema = createHumanReviewSelectionBaseSchema(
  HumanReviewFieldPolicyInputSchema
);

export const HumanReviewSelectionInputSchema = z
  .discriminatedUnion('mode', [
    HumanReviewSelectionInputBaseSchema.extend({
      mode: z.literal('confidence').describe('Review fields below threshold or missing confidence'),
      threshold: z
        .union([
          HumanReviewNumericConfidenceSchema,
          HumanReviewCategoricalConfidenceSchema,
          z.string().min(1),
        ])
        .describe(
          'Fields with confidence strictly below this value require review. Equality auto-approves. Numeric 0–1 or categorical low|medium|high. Template strings are resolved at runtime.'
        ),
      missingConfidence: z
        .enum(['review', 'skip'])
        .default('review')
        .optional()
        .describe('Whether unscored or type-mismatched fields require review (default review)'),
    }),
    HumanReviewSelectionInputBaseSchema.extend({
      mode: z.literal('explicit').describe('Review only paths matched by include/exclude'),
    }),
    HumanReviewSelectionInputBaseSchema.extend({
      mode: z.literal('all').describe('Review every scalar leaf unless excluded or review: never'),
    }),
  ])
  .describe('Field selection policy resolved once when the task is created');

export const HumanReviewStepConfigSchema = z
  .object({
    data: z
      .union([z.string().min(1), z.record(z.string(), z.unknown()), z.array(z.unknown())])
      .describe('Structured data or a template expression resolving to an object or array'),
    schema: JsonSchemaSchema.optional().describe(
      'Optional JSON Schema for validating edits and exposing downstream autocomplete. When omitted with metadataFrom: ai.extract and a direct whole-output data expression, the extract step schema is reused.'
    ),
    metadataFrom: HumanReviewMetadataFromSchema.optional(),
    fieldMetadata: z
      .record(HumanReviewJsonPointerSchema, HumanReviewFieldMetadataInputSchema)
      .default({})
      .optional()
      .describe(
        'RFC 6901 pointer map of producer facts (labels, confidence, display). Selection policy belongs under selection.fields; fieldMetadata.review is a legacy alias.'
      ),
    selection: HumanReviewSelectionInputSchema,
    files: HumanReviewFilesSchema.default({ includeRunInputs: true, attachments: [] })
      .optional()
      .describe('Run input files and optional current-run attachments for reviewers'),
    instructions: z
      .string()
      .max(10_000)
      .optional()
      .describe('Free-form guidance shown above the review workspace'),
  })
  .strict();

/** Reasons that require human confirmation. Historical task values are preserved. */
export const HUMAN_REVIEW_REQUIRED_SELECTION_REASONS = [
  'always',
  'explicit',
  'low_confidence',
  'missing_confidence',
  'all',
  'reviewer_edit',
] as const;

/** Outcomes persisted for leaves that do not require review. */
export const HUMAN_REVIEW_SKIP_SELECTION_REASONS = [
  'threshold_met',
  'never',
  'excluded',
  'unmatched',
  'missing_confidence_skip',
] as const;

export const HumanReviewSelectionReasonSchema = z.enum([
  'always',
  'explicit',
  'low_confidence',
  'missing_confidence',
  'all',
  'reviewer_edit',
  'threshold_met',
  'never',
  'excluded',
  'unmatched',
  'missing_confidence_skip',
]);

export const HumanReviewTaskStatusSchema = z.enum(['pending', 'approved', 'rejected', 'cancelled']);
export const HumanReviewSourceKindSchema = z.enum(['workflow_step', 'agent_tool']);
export const HumanReviewScalarSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

export const HUMAN_REVIEW_FILE_ROLES = ['run_input', 'attachment'] as const;
export const HumanReviewFileRoleSchema = z.enum(HUMAN_REVIEW_FILE_ROLES);

export const HumanReviewFileSchema = z
  .object({
    fileId: z.string().min(1),
    filename: z.string().min(1),
    mimeType: z.string().optional(),
    size: z.number().int().nonnegative().optional(),
    fieldName: z.string().optional(),
    artifactPath: z.string().min(1),
    role: HumanReviewFileRoleSchema.optional().describe(
      'run_input for authorized run input files; attachment for extra current-run files. Omitted on historical tasks and inferred at read time.'
    ),
  })
  .strict();

export const HumanReviewInputProjectionSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('available'),
      data: z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())]),
    })
    .strict(),
  z
    .object({
      status: z.literal('omitted_too_large'),
    })
    .strict(),
]);

export const HumanReviewFieldDecisionSchema = z
  .object({
    id: z.string().min(1),
    path: HumanReviewJsonPointerSchema,
    originalValue: HumanReviewScalarSchema,
    currentValue: HumanReviewScalarSchema,
    required: z.boolean(),
    reason: HumanReviewSelectionReasonSchema,
    confirmedBy: z.string().nullable(),
    confirmedAt: z.string().nullable(),
    version: z.number().int().positive(),
  })
  .strict();

export const HumanReviewTaskSummarySchema = z
  .object({
    id: z.string().min(1),
    executionId: z.string().min(1),
    automationId: z.string().min(1),
    automationName: z.string().min(1),
    sourceKind: HumanReviewSourceKindSchema,
    sourceLabel: z.string().min(1),
    status: HumanReviewTaskStatusSchema,
    requiredCount: z.number().int().nonnegative(),
    confirmedCount: z.number().int().nonnegative(),
    version: z.number().int().positive(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();

export const HumanReviewTaskListResponseSchema = z
  .object({
    tasks: z.array(HumanReviewTaskSummarySchema),
    nextCursor: z.string().nullable(),
  })
  .strict();

export const HumanReviewConflictSchema = z
  .object({
    error: z.string(),
    currentVersion: z.number().int().positive().optional(),
    status: HumanReviewTaskStatusSchema.optional(),
  })
  .strict();

export const HumanReviewLineageSourceSchema = z
  .object({
    stepExecutionId: z.string().min(1),
    stepName: z.string().min(1),
    lineageArtifactKey: z.string().min(1).nullable(),
    parsedDocumentArtifactKey: z.string().min(1).nullable(),
  })
  .strict();

const HumanReviewMutationBaseSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    idempotencyKey: z.string().min(1).max(200),
  })
  .strict();

export const HumanReviewConfirmFieldSchema = HumanReviewMutationBaseSchema.extend({
  path: HumanReviewJsonPointerSchema,
  value: HumanReviewScalarSchema,
  /**
   * When true (default), persist the value and attest it. When false, persist a
   * durable draft edit without confirmation so a previously confirmed field
   * must be confirmed again before approval.
   */
  confirmed: z.boolean().default(true).optional(),
});
export const HumanReviewApproveSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
  })
  .strict();
export const HumanReviewRejectSchema = HumanReviewMutationBaseSchema.extend({
  reason: z.string().trim().min(1).max(5_000),
});

export type HumanReviewFieldMetadata = z.infer<typeof HumanReviewFieldMetadataSchema>;
export type HumanReviewFieldPolicy = z.infer<typeof HumanReviewFieldPolicySchema>;
export type HumanReviewSelection = z.infer<typeof HumanReviewSelectionSchema>;
export type HumanReviewResolvedRequest = z.infer<typeof HumanReviewResolvedRequestSchema>;
export type HumanReviewStepConfig = z.infer<typeof HumanReviewStepConfigSchema>;
export type HumanReviewTaskStatus = z.infer<typeof HumanReviewTaskStatusSchema>;
export type HumanReviewTaskListResponse = z.infer<typeof HumanReviewTaskListResponseSchema>;
export type HumanReviewConflict = z.infer<typeof HumanReviewConflictSchema>;
export type HumanReviewSourceKind = z.infer<typeof HumanReviewSourceKindSchema>;
export type HumanReviewFile = z.infer<typeof HumanReviewFileSchema>;
export type HumanReviewFileRole = z.infer<typeof HumanReviewFileRoleSchema>;
export type HumanReviewInputProjection = z.infer<typeof HumanReviewInputProjectionSchema>;
export type HumanReviewFieldDecision = z.infer<typeof HumanReviewFieldDecisionSchema>;
export type HumanReviewTaskSummary = z.infer<typeof HumanReviewTaskSummarySchema>;
export type HumanReviewLineageSource = z.infer<typeof HumanReviewLineageSourceSchema>;
export type HumanReviewConfirmField = z.infer<typeof HumanReviewConfirmFieldSchema>;
export type HumanReviewApprove = z.infer<typeof HumanReviewApproveSchema>;
export type HumanReviewReject = z.infer<typeof HumanReviewRejectSchema>;
export type HumanReviewSelectionReason = z.infer<typeof HumanReviewSelectionReasonSchema>;
export type HumanReviewScalar = string | number | boolean | null;
export type HumanReviewConfidence = number | 'low' | 'medium' | 'high';
export type HumanReviewMetadataFrom = z.infer<typeof HumanReviewMetadataFromSchema>;

export function isRequiredHumanReviewSelectionReason(reason: HumanReviewSelectionReason): boolean {
  return (HUMAN_REVIEW_REQUIRED_SELECTION_REASONS as readonly string[]).includes(reason);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Normalize the Pi tool's snake_case arguments onto {@link HumanReviewResolvedRequestSchema}.
 * CamelCase keys are also accepted so worker tests and the workflow step share one parser.
 */
export function parseHumanReviewAgentToolArgs(args: unknown): HumanReviewResolvedRequest {
  const raw = asRecord(args);
  if (!raw) throw new Error('request_human_review arguments must be an object');
  const files = asRecord(raw.files);
  const selection = asRecord(raw.selection);
  const missingConfidence = selection?.missingConfidence ?? selection?.missing_confidence;
  const fields = selection?.fields;
  return HumanReviewResolvedRequestSchema.parse({
    data: raw.data,
    schema: raw.schema,
    metadataFrom: raw.metadataFrom ?? raw.metadata_from,
    fieldMetadata: raw.fieldMetadata ?? raw.field_metadata,
    selection: selection
      ? {
          mode: selection.mode,
          ...(selection.threshold !== undefined ? { threshold: selection.threshold } : {}),
          ...(selection.include !== undefined ? { include: selection.include } : {}),
          ...(selection.exclude !== undefined ? { exclude: selection.exclude } : {}),
          ...(fields !== undefined ? { fields } : {}),
          ...(missingConfidence !== undefined ? { missingConfidence } : {}),
        }
      : raw.selection,
    instructions: raw.instructions,
    files: files
      ? {
          includeRunInputs: files.includeRunInputs ?? files.include_run_inputs,
          attachments: files.attachments,
        }
      : raw.files,
  });
}

export const HumanReviewAgentContinuationManifestSchema = z
  .object({
    version: z.literal(1),
    toolCallId: z.string().min(1),
    taskId: z.string().min(1),
    executionId: z.string().min(1),
    createdAt: z.string().min(1),
    expiresAt: z.string().min(1),
    cost: z
      .object({
        totalInputTokens: z.number().nonnegative(),
        totalOutputTokens: z.number().nonnegative(),
        totalCacheReadTokens: z.number().nonnegative(),
        totalCacheWriteTokens: z.number().nonnegative(),
        agentTurns: z.number().nonnegative(),
        durationMs: z.number().nonnegative().optional(),
        e2bCostUsd: z.number().nonnegative().nullable().optional(),
      })
      .optional(),
    /** Byte length of `trace.jsonl` at this pause; resume truncates extras from a retried segment. */
    traceByteLength: z.number().int().nonnegative().optional(),
    artifacts: z.array(z.object({ name: z.string().min(1) })).default([]),
    reconstruction: z
      .object({
        requestedSourceRef: z.string().optional(),
        resolvedGitRef: z.string().optional(),
        resolvedCommitSha: z.string().optional(),
      })
      .optional(),
  })
  .strict();

export type HumanReviewAgentContinuationManifest = z.infer<
  typeof HumanReviewAgentContinuationManifestSchema
>;

export interface HumanReviewLeaf {
  path: string;
  value: HumanReviewScalar;
}

export interface HumanReviewSelectionResult {
  leaves: HumanReviewLeaf[];
  requiredPaths: string[];
  reasons: Record<string, HumanReviewSelectionReason>;
  metadata: Record<string, HumanReviewFieldMetadata>;
  /** Per-leaf threshold used in confidence mode; omitted for other modes/paths. */
  effectiveThresholds: Record<string, HumanReviewConfidence | undefined>;
}

/** Reserved pointer for task-level selection snapshot stored in fieldMetadata JSONB. */
export const HUMAN_REVIEW_TASK_SELECTION_POINTER = '/__task/selection';

interface HumanReviewLeafIndex {
  byExactPath: Map<string, HumanReviewLeaf>;
  bySegmentCount: Map<number, HumanReviewLeaf[]>;
}

function buildHumanReviewLeafIndex(leaves: HumanReviewLeaf[]): HumanReviewLeafIndex {
  const byExactPath = new Map<string, HumanReviewLeaf>();
  const bySegmentCount = new Map<number, HumanReviewLeaf[]>();
  for (const leaf of leaves) {
    byExactPath.set(leaf.path, leaf);
    const segmentCount = decodeHumanReviewJsonPointer(leaf.path).length;
    const bucket = bySegmentCount.get(segmentCount);
    if (bucket) bucket.push(leaf);
    else bySegmentCount.set(segmentCount, [leaf]);
  }
  return { byExactPath, bySegmentCount };
}

function leavesMatchingPattern(pattern: string, index: HumanReviewLeafIndex): HumanReviewLeaf[] {
  const patternSegments = decodeHumanReviewJsonPointer(pattern);
  if (!patternSegments.includes('*')) {
    const leaf = index.byExactPath.get(pattern);
    return leaf ? [leaf] : [];
  }
  const candidates = index.bySegmentCount.get(patternSegments.length) ?? [];
  return candidates.filter((leaf) => patternMatches(pattern, leaf.path));
}

function assertPatternsMatchLeaves(
  patterns: string[],
  index: HumanReviewLeafIndex,
  label: string
): void {
  for (const pattern of patterns) {
    if (leavesMatchingPattern(pattern, index).length === 0) {
      throw new Error(`${label} path "${pattern}" matches no review field`);
    }
  }
}

export function encodeJsonPointerSegment(segment: string): string {
  return segment.replaceAll('~', '~0').replaceAll('/', '~1');
}

export function decodeJsonPointerSegment(segment: string): string {
  if (INVALID_JSON_POINTER_ESCAPE.test(segment)) {
    throw new Error(`Invalid JSON Pointer escape in segment "${segment}"`);
  }
  return segment.replace(JSON_POINTER_ESCAPE, (escape) => (escape === '~1' ? '/' : '~'));
}

export function decodeHumanReviewJsonPointer(pointer: string): string[] {
  const parsed = HumanReviewJsonPointerSchema.safeParse(pointer);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Invalid JSON Pointer');
  return pointer.slice(1).split('/').map(decodeJsonPointerSegment);
}

export function enumerateHumanReviewLeaves(
  data: Record<string, unknown> | unknown[],
  maxLeaves = HUMAN_REVIEW_LIMITS.scalarLeaves
): HumanReviewLeaf[] {
  const leaves: HumanReviewLeaf[] = [];

  const visit = (value: unknown, segments: string[]) => {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
      leaves.push({ path: `/${segments.map(encodeJsonPointerSegment).join('/')}`, value });
    } else if (typeof value === 'number') {
      if (!Number.isFinite(value))
        throw new Error('Review data may not contain non-finite numbers');
      leaves.push({ path: `/${segments.map(encodeJsonPointerSegment).join('/')}`, value });
    } else if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, [...segments, String(index)]));
    } else if (typeof value === 'object' && value !== undefined) {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        visit(child, [...segments, key]);
      }
    } else {
      throw new Error(`Review data contains a non-JSON value at /${segments.join('/')}`);
    }

    if (leaves.length > maxLeaves) {
      throw new Error(`Review data exceeds the ${maxLeaves} scalar field limit`);
    }
  };

  visit(data, []);
  return leaves;
}

function patternMatches(pattern: string, concretePath: string): boolean {
  const patternSegments = decodeHumanReviewJsonPointer(pattern);
  const pathSegments = decodeHumanReviewJsonPointer(concretePath);
  return (
    patternSegments.length === pathSegments.length &&
    patternSegments.every((segment, index) => segment === '*' || segment === pathSegments[index])
  );
}

function expandPatterns(
  patterns: string[],
  index: HumanReviewLeafIndex,
  label: string
): Set<string> {
  const expanded = new Set<string>();
  for (const pattern of patterns) {
    const matches = leavesMatchingPattern(pattern, index);
    if (matches.length === 0) throw new Error(`${label} path "${pattern}" matches no review field`);
    matches.forEach((leaf) => expanded.add(leaf.path));
  }
  return expanded;
}

function exactSegmentCount(pattern: string): number {
  return decodeHumanReviewJsonPointer(pattern).filter((segment) => segment !== '*').length;
}

function isWildcardPattern(pattern: string): boolean {
  return decodeHumanReviewJsonPointer(pattern).includes('*');
}

function resolveOverlappingPattern(
  patterns: string[],
  path: string,
  label: string
): string | undefined {
  const matches = patterns.filter((pattern) => patternMatches(pattern, path));
  if (matches.length === 0) return undefined;
  const exact = matches.filter((pattern) => !isWildcardPattern(pattern));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    throw new Error(`${label} path "${path}" matches multiple exact policies: ${exact.join(', ')}`);
  }

  const scored = matches.map((pattern) => ({ pattern, exactCount: exactSegmentCount(pattern) }));
  const max = Math.max(...scored.map((item) => item.exactCount));
  const top = scored.filter((item) => item.exactCount === max);
  if (top.length > 1) {
    throw new Error(
      `${label} path "${path}" matches equally specific wildcards: ${top
        .map((item) => item.pattern)
        .join(', ')}`
    );
  }
  return top[0]?.pattern;
}

function confidenceKind(value: HumanReviewConfidence): 'numeric' | 'categorical' {
  return typeof value === 'number' ? 'numeric' : 'categorical';
}

function confidenceBelowThreshold(
  fieldConfidence: HumanReviewConfidence,
  threshold: HumanReviewConfidence
): 'below' | 'met' | 'mismatch' {
  if (confidenceKind(fieldConfidence) !== confidenceKind(threshold)) return 'mismatch';
  if (typeof fieldConfidence === 'number' && typeof threshold === 'number') {
    return fieldConfidence < threshold ? 'below' : 'met';
  }
  if (typeof fieldConfidence === 'string' && typeof threshold === 'string') {
    return CATEGORICAL_CONFIDENCE_RANK[fieldConfidence] < CATEGORICAL_CONFIDENCE_RANK[threshold]
      ? 'below'
      : 'met';
  }
  return 'mismatch';
}

function normalizedReviewPolicy(
  value: 'auto' | 'always' | 'never' | 'skip' | undefined
): 'always' | 'never' | undefined {
  if (value === 'always') return 'always';
  if (value === 'never' || value === 'skip') return 'never';
  return undefined;
}

export function resolveHumanReviewSelection(
  requestInput: HumanReviewResolvedRequest
): HumanReviewSelectionResult {
  const request = HumanReviewResolvedRequestSchema.parse(requestInput);
  const selectionBytes = jsonByteLength(request.selection);
  if (selectionBytes > HUMAN_REVIEW_LIMITS.selectionBytes) {
    throw new Error(
      `Review selection exceeds the ${HUMAN_REVIEW_LIMITS.selectionBytes} byte limit (${selectionBytes} bytes)`
    );
  }

  const dataBytes = jsonByteLength(request.data);
  if (dataBytes > HUMAN_REVIEW_LIMITS.dataBytes) {
    throw new Error(`Review data exceeds the ${HUMAN_REVIEW_LIMITS.dataBytes} byte limit`);
  }

  const metadata = request.fieldMetadata ?? {};
  const metadataBytes = jsonByteLength(metadata);
  if (metadataBytes > HUMAN_REVIEW_LIMITS.metadataBytes) {
    throw new Error(`Review metadata exceeds the ${HUMAN_REVIEW_LIMITS.metadataBytes} byte limit`);
  }

  const leaves = enumerateHumanReviewLeaves(request.data);
  const leafIndex = buildHumanReviewLeafIndex(leaves);
  const leafPaths = new Set(leaves.map((leaf) => leaf.path));
  for (const path of Object.keys(metadata)) {
    if (!leafPaths.has(path)) throw new Error(`Field metadata path "${path}" does not exist`);
  }

  const include = expandPatterns(request.selection.include ?? [], leafIndex, 'Include');
  const exclude = expandPatterns(request.selection.exclude ?? [], leafIndex, 'Exclude');
  for (const path of include) {
    if (exclude.has(path)) throw new Error(`Review field "${path}" is both included and excluded`);
  }

  const fieldPolicies = request.selection.fields ?? {};
  const fieldPatterns = Object.keys(fieldPolicies);
  assertPatternsMatchLeaves(fieldPatterns, leafIndex, 'Field policy');

  const fieldPolicyKeyByPath = new Map<string, string>();
  if (fieldPatterns.length > 0) {
    for (const leaf of leaves) {
      const policyKey = resolveOverlappingPattern(fieldPatterns, leaf.path, 'Field policy');
      if (policyKey) fieldPolicyKeyByPath.set(leaf.path, policyKey);
    }
  }

  const reasons: Record<string, HumanReviewSelectionReason> = {};
  const effectiveThresholds: Record<string, HumanReviewConfidence | undefined> = {};
  for (const leaf of leaves) {
    const field = metadata[leaf.path];
    const policyKey = fieldPolicyKeyByPath.get(leaf.path);
    const policy = policyKey ? fieldPolicies[policyKey] : undefined;
    const reviewOverride =
      normalizedReviewPolicy(policy?.review) ?? normalizedReviewPolicy(field?.review);

    if (reviewOverride === 'always') {
      reasons[leaf.path] = 'always';
      continue;
    }
    if (reviewOverride === 'never') {
      reasons[leaf.path] = 'never';
      continue;
    }
    if (include.has(leaf.path)) {
      reasons[leaf.path] = 'explicit';
      continue;
    }
    if (exclude.has(leaf.path)) {
      reasons[leaf.path] = 'excluded';
      continue;
    }

    if (request.selection.mode === 'all') {
      reasons[leaf.path] = 'all';
    } else if (request.selection.mode === 'confidence') {
      const threshold = coerceHumanReviewConfidence(
        policy?.threshold ?? request.selection.threshold
      );
      if (threshold === undefined) {
        throw new Error(
          `Invalid confidence threshold ${JSON.stringify(policy?.threshold ?? request.selection.threshold)}`
        );
      }
      effectiveThresholds[leaf.path] = threshold;
      const fieldConfidence = coerceHumanReviewConfidence(field?.confidence);
      if (fieldConfidence === undefined) {
        reasons[leaf.path] =
          (request.selection.missingConfidence ?? 'review') === 'review'
            ? 'missing_confidence'
            : 'missing_confidence_skip';
      } else {
        const comparison = confidenceBelowThreshold(fieldConfidence, threshold);
        if (comparison === 'mismatch') {
          reasons[leaf.path] =
            (request.selection.missingConfidence ?? 'review') === 'review'
              ? 'missing_confidence'
              : 'missing_confidence_skip';
        } else if (comparison === 'below') {
          reasons[leaf.path] = 'low_confidence';
        } else {
          reasons[leaf.path] = 'threshold_met';
        }
      }
    } else {
      reasons[leaf.path] = 'unmatched';
    }
  }

  const requiredPaths = leaves
    .map((leaf) => leaf.path)
    .filter((path) => isRequiredHumanReviewSelectionReason(reasons[path]!));
  if (requiredPaths.length > HUMAN_REVIEW_LIMITS.requiredFields) {
    throw new Error(
      `Review request selects ${requiredPaths.length} fields, exceeding the ${HUMAN_REVIEW_LIMITS.requiredFields} field limit`
    );
  }

  return { leaves, requiredPaths, reasons, metadata, effectiveThresholds };
}

export function enrichHumanReviewFieldMetadata(
  metadata: Record<string, HumanReviewFieldMetadata>,
  selection: HumanReviewSelectionResult,
  request: HumanReviewResolvedRequest
): Record<string, HumanReviewFieldMetadata> {
  const next: Record<string, HumanReviewFieldMetadata> = { ...metadata };
  for (const [path, threshold] of Object.entries(selection.effectiveThresholds)) {
    if (threshold === undefined) continue;
    next[path] = {
      ...next[path],
      display: {
        ...(next[path]?.display ?? {}),
        effectiveThreshold: threshold,
      },
    };
  }
  next[HUMAN_REVIEW_TASK_SELECTION_POINTER] = {
    display: {
      mode: request.selection.mode,
      ...(request.selection.mode === 'confidence'
        ? {
            threshold: request.selection.threshold,
            missingConfidence: request.selection.missingConfidence ?? 'review',
          }
        : {}),
    },
  };
  return next;
}

export function readHumanReviewEffectiveThreshold(
  metadata: HumanReviewFieldMetadata | undefined
): HumanReviewConfidence | undefined {
  return coerceHumanReviewConfidence(metadata?.display?.effectiveThreshold);
}

export function valueAtHumanReviewPointer(data: unknown, pointer: string): unknown {
  return decodeHumanReviewJsonPointer(pointer).reduce<unknown>((value, segment) => {
    if (Array.isArray(value)) {
      if (!/^(0|[1-9]\d*)$/.test(segment) || Number(segment) >= value.length) {
        throw new Error(`JSON Pointer "${pointer}" does not exist`);
      }
      return value[Number(segment)];
    }
    if (value !== null && typeof value === 'object' && segment in value) {
      return (value as Record<string, unknown>)[segment];
    }
    throw new Error(`JSON Pointer "${pointer}" does not exist`);
  }, data);
}

function isHumanReviewScalar(value: unknown): value is HumanReviewScalar {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}

/**
 * Captured JSON null is absence, not a closed scalar type. Null may become a
 * string/number/boolean (and vice versa); the effective schema decides whether
 * that edit is valid. Other scalar type changes stay rejected here so a number
 * cannot silently become a string before schema validation runs.
 */
function sameRuntimeScalarType(
  original: HumanReviewScalar,
  next: unknown
): next is HumanReviewScalar {
  if (!isHumanReviewScalar(next)) return false;
  if (original === null || next === null) return true;
  return typeof next === typeof original;
}

export function validateHumanReviewEffectiveSchema(
  draftData: unknown,
  effectiveSchema: Record<string, unknown> | undefined
): ValidationResult {
  if (!effectiveSchema) {
    return { valid: true, errors: [] };
  }
  return validateOutput(draftData, effectiveSchema);
}

export function applyHumanReviewEdits(
  machineData: Record<string, unknown> | unknown[],
  edits: Record<string, HumanReviewScalar>
): Record<string, unknown> | unknown[] {
  const result = structuredClone(machineData);
  for (const [pointer, next] of Object.entries(edits)) {
    const segments = decodeHumanReviewJsonPointer(pointer);
    const original = valueAtHumanReviewPointer(machineData, pointer);
    if (
      !(
        original === null ||
        typeof original === 'string' ||
        typeof original === 'number' ||
        typeof original === 'boolean'
      )
    ) {
      throw new Error(`JSON Pointer "${pointer}" does not reference a scalar field`);
    }
    if (!sameRuntimeScalarType(original, next)) {
      throw new Error(`Edit for "${pointer}" changes the captured scalar type`);
    }

    const key = segments.pop();
    let parent: unknown = result;
    for (const segment of segments) {
      parent = Array.isArray(parent)
        ? parent[Number(segment)]
        : (parent as Record<string, unknown>)[segment];
    }
    if (key === undefined) throw new Error('The review root cannot be replaced');
    if (Array.isArray(parent)) parent[Number(key)] = next;
    else (parent as Record<string, unknown>)[key] = next;
  }
  return result;
}
