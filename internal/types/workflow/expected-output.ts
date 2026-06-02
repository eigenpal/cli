import { z } from 'zod';
import { ExpectedErrorSchema } from '../eval/expected-error';

/**
 * Reference to an expected document for eval/judge.
 * - string: key into example's expectedOutputFiles map, or path (CLI resolves path to _inline).
 * - fileId: stored file in DB (or "__any__" in data for flexible match).
 * - _file: path to file (CLI resolves to _inline when building payload).
 * - _inline: base64 content when passing docs inline (per-example).
 */
export const ExpectedDocumentRefSchema = z.union([
  z.string().min(1),
  z.object({ fileId: z.string().min(1) }),
  z.object({ _file: z.string().min(1) }),
  z.object({
    _inline: z.string(),
    filename: z.string().optional(),
    mimeType: z.string().optional(),
  }),
]);

export type ExpectedDocumentRef = z.infer<typeof ExpectedDocumentRefSchema>;

/** Recursive structure for expectedDocuments: nested objects and arrays with refs at leaves. */
export interface ExpectedDocumentsValueArray extends Array<
  ExpectedDocumentRef | ExpectedDocumentsValueRecord | ExpectedDocumentsValueArray
> {}
export interface ExpectedDocumentsValueRecord {
  [key: string]: ExpectedDocumentRef | ExpectedDocumentsValueArray | ExpectedDocumentsValueRecord;
}
export type ExpectedDocumentsValue =
  | ExpectedDocumentRef
  | ExpectedDocumentsValueArray
  | ExpectedDocumentsValueRecord;

/**
 * Schema for expectedDocuments values (ref, array of same, or nested record).
 * Enables e.g. "generated_documents_prevod": ["expected/Prevod.docx", "expected/Prevod2.docx"].
 */
export const ExpectedDocumentsValueSchema: z.ZodType<ExpectedDocumentsValue> = z.lazy(() =>
  z.union([
    ExpectedDocumentRefSchema,
    z.array(ExpectedDocumentsValueSchema),
    z.record(z.string(), ExpectedDocumentsValueSchema),
  ])
);

/**
 * Expected output for one eval example.
 * - data: output data shape (e.g. scenario, generated_document_* with fileId "__any__" for comparison).
 * - expectedDocuments: recursive map of paths to refs (e.g. flat keys or nested/array like generated_documents_prevod: [ref, ref]).
 * - error: failure-expected assertion. Mutually exclusive with `data` and
 *   `expectedDocuments` (enforced by the schema refinement below). When
 *   set, the exact-diff scorer matches against the typed `control.fail`
 *   envelope persisted to `executions.error` instead of diffing output.
 */
export const ExpectedOutputSchema = z
  .object({
    data: z.record(z.string(), z.unknown()).optional(),
    expectedDocuments: z.record(z.string(), ExpectedDocumentsValueSchema).optional(),
    error: ExpectedErrorSchema.optional(),
  })
  .refine((v) => !(v.error && (v.data || v.expectedDocuments)), {
    message:
      'expectedOutput.error is mutually exclusive with data / expectedDocuments — a failure-expected example asserts the workflow should fail, so there is no output to diff.',
    path: ['error'],
  });

export type ExpectedOutput = z.infer<typeof ExpectedOutputSchema>;

/**
 * Per-example map of doc key to inline content when passing expected docs in the payload.
 * Keys must match expectedOutput.expectedDocuments keys.
 */
export const ExpectedOutputFilesSchema = z
  .record(
    z.string(),
    z.union([
      z.string(), // base64 content
      z.object({
        content: z.string(),
        filename: z.string().optional(),
        mimeType: z.string().optional(),
      }),
    ])
  )
  .optional();

export type ExpectedOutputFiles = z.infer<typeof ExpectedOutputFilesSchema>;
