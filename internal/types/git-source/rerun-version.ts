import {
  SOURCE_COMMIT_SHA_PATTERN,
  SourceVersionRefSchema,
  WorkflowRunVersionRefSchema,
  type SourceVersionRef,
} from './grammar';

export const RERUN_ORIGINAL_VERSION = 'original' as const;

export type RerunVersionKind = 'latest' | 'original' | 'explicit';

export type ParsedRerunVersion =
  | { kind: 'latest' }
  | { kind: 'original' }
  | { kind: 'explicit'; value: string };

export type AgentRunSourceProvenance = {
  requestedSourceRef?: string | null;
  resolvedGitRef?: string | null;
  resolvedCommitSha?: string | null;
};

export function parseWorkflowRerunVersion(
  raw: string | undefined
): { ok: true; parsed: ParsedRerunVersion } | { ok: false; message: string } {
  const value = raw?.trim() || 'latest';
  if (value === 'latest') return { ok: true, parsed: { kind: 'latest' } };
  if (value === RERUN_ORIGINAL_VERSION) return { ok: true, parsed: { kind: 'original' } };

  const result = WorkflowRunVersionRefSchema.safeParse(value);
  if (!result.success) {
    return {
      ok: false,
      message:
        'Use latest, original, an exact X.Y.Z version, or a workflow version/history id (wfv_*, version_*, wfh_*).',
    };
  }
  return { ok: true, parsed: { kind: 'explicit', value: result.data } };
}

export function parseAgentRerunVersion(
  raw: string | undefined
): { ok: true; parsed: ParsedRerunVersion } | { ok: false; message: string } {
  const value = raw?.trim() || 'latest';
  if (value === 'latest') return { ok: true, parsed: { kind: 'latest' } };
  if (value === RERUN_ORIGINAL_VERSION) return { ok: true, parsed: { kind: 'original' } };

  const result = SourceVersionRefSchema.safeParse(value);
  if (!result.success) {
    return {
      ok: false,
      message: 'Use latest, original, main, X.Y.Z, X.Y.x, X.x, or a 40-character commit SHA.',
    };
  }
  return { ok: true, parsed: { kind: 'explicit', value: result.data } };
}

/** Pin agent reruns to the exact source the prior run used. */
export function resolveAgentOriginalSourceRef(
  provenance: AgentRunSourceProvenance
): SourceVersionRef {
  if (
    provenance.resolvedCommitSha &&
    SOURCE_COMMIT_SHA_PATTERN.test(provenance.resolvedCommitSha)
  ) {
    return provenance.resolvedCommitSha;
  }
  const candidate = provenance.resolvedGitRef ?? provenance.requestedSourceRef;
  if (candidate) {
    const parsed = SourceVersionRefSchema.safeParse(candidate);
    if (parsed.success) return parsed.data;
  }
  return 'latest';
}
