/**
 * Expand sections for `GET /api/v1/runs/{id}` — the single source of truth
 * shared by the API route, the CLI, the SDKs, and the in-app API docs.
 *
 * The contract: each token adds exactly one top-level nested object named
 * after the token. All four tokens are valid for both run types; the
 * *contents* of `execution` differ by run type (workflow: steps/expected;
 * agent: files/review/expected). Batch, retry, and annotation live under
 * `execution` (`expand=execution`). Unknown tokens are a 400.
 *
 * `output`, `files`, and `error` are NOT behind expand. They appear at the top
 * level once `finished` is true on detail responses (`GET /runs/{id}` and
 * sync-terminal `POST /runs`).
 */
export const RUN_EXPAND_SECTIONS = ['input', 'usage', 'execution', 'debug'] as const;

export type RunExpandSection = (typeof RUN_EXPAND_SECTIONS)[number];

const RUN_EXPAND_SECTION_SET = new Set<string>(RUN_EXPAND_SECTIONS);

export function isRunExpandSection(token: string): token is RunExpandSection {
  return RUN_EXPAND_SECTION_SET.has(token);
}

/**
 * Parse a comma-separated `expand` query value into valid sections and
 * invalid tokens (for 400 responses). Shared by the API route and CLI.
 */
export function parseRunExpand(raw: string | null | undefined): {
  sections: Set<RunExpandSection>;
  invalid: string[];
} {
  const sections = new Set<RunExpandSection>();
  const invalid: string[] = [];
  for (const part of (raw ?? '').split(',')) {
    const token = part.trim();
    if (!token) continue;
    if (isRunExpandSection(token)) {
      sections.add(token);
    } else {
      invalid.push(token);
    }
  }
  return { sections, invalid };
}

/** Comma-separated "expand everything" preset for dashboard run-detail fetches. */
export const RUN_DETAIL_EXPAND_PRESET = RUN_EXPAND_SECTIONS.join(',');

/**
 * Migration hints for the removed pre-grouped expand tokens. Surfaced in 400
 * error messages so old integrations learn the new path without reading docs.
 */
export const LEGACY_RUN_EXPAND_MIGRATION: Readonly<Record<string, string>> = {
  output: '`output` is not expandable; completed detail responses include top-level `output`',
  lineage: 'use `expand=execution` — batch, retry, and annotation live on `execution`',
  cost: 'use `expand=usage`',
  input: 'still `expand=input` — args now live at `input.args`',
  metadata: 'use `expand=input` — metadata now lives at `input.metadata`',
  observability: 'use `expand=debug`',
  review: 'use `expand=execution` — reviews live at `execution.review`',
  steps: 'use `expand=execution` — steps live at `execution.steps` (workflow runs)',
  definition:
    'use `expand=execution` — definitionSnapshot lives at `execution.definitionSnapshot` (workflow runs)',
  files:
    'downloadable output refs live at top-level `files` on completed detail responses; `expand=execution` adds `execution.files.output` metadata for agent runs',
  expected: 'use `expand=execution` — expected output lives at `execution.expected`',
  trace:
    'trace id: `expand=debug` (`debug.traceId`); trace files: `GET /api/v1/runs/{id}/artifacts`',
  issues: 'use `GET /api/v1/runs/{id}/artifacts` and look for `issues.md`',
  lockfile: 'use `GET /api/v1/runs/{id}/artifacts` and look for `eigenpal.lock`',
};

/**
 * Migration hints for the removed `include` query param on `GET /runs/{id}`.
 * Only `include=detail` is recognized for a targeted 400.
 */
export const LEGACY_RUN_INCLUDE_MIGRATION: Readonly<Record<string, string>> = {
  detail:
    'the grouped run detail is returned by default; use `expand=input,usage,execution,debug` for optional sections',
};

/** Build the 400 message for a legacy `include` value, or `null` when unknown. */
export function runIncludeErrorMessage(include: string): string | null {
  const hint = LEGACY_RUN_INCLUDE_MIGRATION[include];
  return hint ? `Legacy \`include=${include}\` is removed: ${hint}.` : null;
}

/** Build the 400 message for an invalid expand token, with migration hints. */
export function runExpandErrorMessage(invalid: readonly string[]): string {
  const hints = invalid
    .map((token) => {
      const hint = LEGACY_RUN_EXPAND_MIGRATION[token];
      return hint ? `\`${token}\`: ${hint}` : null;
    })
    .filter((line): line is string => line !== null);
  const base = `Unknown expand section(s): ${invalid.join(', ')}. Supported: ${RUN_EXPAND_SECTIONS.join(', ')}.`;
  return hints.length > 0 ? `${base} ${hints.join('; ')}.` : base;
}
