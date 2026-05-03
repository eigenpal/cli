/**
 * LLM judge helpers.
 *
 * Two independent APIs:
 *
 * 1. JSON-first API (`judgeScoreJson`, `judgeLabelJson`) — for YAML workflow
 *    evaluators. The judge receives actual/expected output as JSON text blocks.
 *    Provider-agnostic: dispatches through the caller's `AIClient` so any
 *    configured LLM provider (OpenAI, Anthropic, Google, Azure, …) works.
 *
 * 2. File API (`compareWithOpenAiJudge`, `compareWithOpenAiJudgeLabel`) — legacy
 *    helpers used by the agent-workflow v1/eval route for document comparison
 *    (PDFs, spreadsheets, etc.). OpenAI-only, preserved as-is.
 */

import type { AIClient } from '../client/ai-client';

// ---------------------------------------------------------------------------
// Shared OpenAI Responses API plumbing (used only by the legacy file API below)
// ---------------------------------------------------------------------------

type ResponsesContent =
  | { type: 'input_text'; text: string }
  | { type: 'input_file'; filename: string; file_data: string };

async function callResponses(params: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userContent: ResponsesContent[];
  maxOutputTokens: number;
}): Promise<string> {
  const { apiKey, model, systemPrompt, userContent, maxOutputTokens } = params;
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: [
        { role: 'system', content: [{ type: 'input_text', text: systemPrompt }] },
        { role: 'user', content: userContent },
      ],
      temperature: 0,
      max_output_tokens: maxOutputTokens,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI judge request failed: HTTP ${res.status} ${body}`);
  }
  const json = (await res.json()) as unknown;
  return extractResponsesOutputText(json) ?? '';
}

function extractResponsesOutputText(json: unknown): string | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const root = json as { output?: unknown };
  if (!Array.isArray(root.output)) return null;
  const chunks: string[] = [];
  for (const item of root.output) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const c of content) {
      if (!c || typeof c !== 'object' || Array.isArray(c)) continue;
      const text = (c as { text?: unknown }).text;
      if (typeof text === 'string' && text.trim() !== '') chunks.push(text);
    }
  }
  return chunks.length > 0 ? chunks.join('\n').trim() : null;
}

/** Extract the last ```json … ``` block, or fall back to the first bare object. */
function extractLastJsonBlock(content: string): string {
  const trimmed = content?.trim() ?? '';
  const blocks = trimmed.match(/```json\s*([\s\S]*?)```/g);
  if (blocks?.length) {
    const inner = blocks[blocks.length - 1]
      .replace(/^```json\s*/, '')
      .replace(/\s*```$/, '')
      .trim();
    if (inner.startsWith('{')) return inner;
  }
  const bare = trimmed.match(/\{[\s\S]*\}/g);
  if (bare?.length) return bare[bare.length - 1];
  return '';
}

// ---------------------------------------------------------------------------
// JSON-first API
// ---------------------------------------------------------------------------

export interface JudgeFilePayload {
  dataUrl: string;
  filename: string;
}

/** Parameters shared by both JSON judge helpers. */
interface JudgeJsonBaseParams {
  /** AIClient used to dispatch the judge call. Any configured provider works. */
  client: AIClient;
  /** Optional model override; defaults to `client.defaultModel`. */
  model?: string;
  /** Free-form evaluation criteria injected into the system prompt. */
  promptExtension: string;
  /** Actual workflow execution result (any JSON-serialisable value). */
  actualJson: unknown;
  /** Expected output from the eval example, if set. */
  expectedJson?: unknown;
}

export interface JudgeScoreResult {
  score: number;
  rationale: string;
  rawOutput: string;
}

export interface JudgeLabelResult {
  label: string;
  rationale: string;
  rawOutput: string;
}

// --- Prompt builders (exported for testing) ---

export function buildContinuousJudgeSystemPrompt(promptExtension: string): string {
  const criteria = promptExtension.trim();
  const header =
    'You are a workflow output evaluator. ' +
    'Return a numeric `score` in [0, 1] (1.0 = fully passes, 0.0 = completely fails) ' +
    'and a one-sentence `rationale`.';

  if (criteria) {
    return `${header}\n\n--- Evaluation criteria ---\n${criteria}\n---`;
  }
  return header;
}

export function buildDiscreteJudgeSystemPrompt(promptExtension: string, labels: string[]): string {
  const criteria = promptExtension.trim();
  const labelList = labels.map((l) => `"${l}"`).join(', ');
  const header =
    'You are a workflow output evaluator. ' +
    `Pick exactly one \`label\` from: ${labelList}. ` +
    'Also return a one-sentence `rationale`.';

  if (criteria) {
    return `${header}\n\n--- Evaluation criteria ---\n${criteria}\n---`;
  }
  return header;
}

function buildJsonUserContent(actualJson: unknown, expectedJson: unknown | undefined): string {
  const sections: string[] = [
    `## Actual output\n\`\`\`json\n${JSON.stringify(actualJson, null, 2)}\n\`\`\``,
  ];
  if (expectedJson !== undefined && expectedJson !== null) {
    sections.push(
      `## Expected output\n\`\`\`json\n${JSON.stringify(expectedJson, null, 2)}\n\`\`\``
    );
  }
  return sections.join('\n\n');
}

const SCORE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    score: { type: 'number', minimum: 0, maximum: 1 },
    rationale: { type: 'string' },
  },
  required: ['score', 'rationale'],
};

function buildLabelSchema(labels: string[]): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      label: { type: 'string', enum: labels },
      rationale: { type: 'string' },
    },
    required: ['label', 'rationale'],
  };
}

/** Prefer the provider's raw response string for tracing; fall back to the parsed payload. */
function serializeJudgeResponse(response: {
  data: Record<string, unknown>;
  outputResponse?: string;
}): string {
  return response.outputResponse ?? JSON.stringify(response.data);
}

/**
 * Continuous-mode judge: evaluates actual output and returns a score in [0, 1].
 *
 * The judge reads `actualJson` (and optional `expectedJson`) as JSON text blocks,
 * applies `promptExtension` as its evaluation criteria, and emits a structured
 * score + rationale.
 *
 * Throws on network / parse failures — callers should retry or record an error result.
 */
export async function judgeScoreJson(params: JudgeJsonBaseParams): Promise<JudgeScoreResult> {
  const { client, model, promptExtension, actualJson, expectedJson } = params;

  const systemPrompt = buildContinuousJudgeSystemPrompt(promptExtension);
  const userContent = buildJsonUserContent(actualJson, expectedJson);

  const response = await client.extract(userContent, {
    schema: SCORE_SCHEMA,
    prompt: systemPrompt,
    model,
    temperature: 0,
  });

  const rawScore = response.data.score;
  const score =
    typeof rawScore === 'number'
      ? rawScore
      : typeof rawScore === 'string'
        ? parseFloat(rawScore)
        : NaN;

  if (!Number.isFinite(score) || score < 0 || score > 1) {
    throw new Error(`judge returned invalid score: ${JSON.stringify(rawScore)}`);
  }

  return {
    score,
    rationale: typeof response.data.rationale === 'string' ? response.data.rationale.trim() : '',
    rawOutput: serializeJudgeResponse(response),
  };
}

/**
 * Discrete-mode judge: evaluates actual output and returns one of the declared labels.
 *
 * Throws if the judge emits an unrecognised label — callers typically retry once
 * before recording an error result.
 */
export async function judgeLabelJson(
  params: JudgeJsonBaseParams & { labels: string[] }
): Promise<JudgeLabelResult> {
  const { client, model, promptExtension, labels, actualJson, expectedJson } = params;

  const systemPrompt = buildDiscreteJudgeSystemPrompt(promptExtension, labels);
  const userContent = buildJsonUserContent(actualJson, expectedJson);

  const response = await client.extract(userContent, {
    schema: buildLabelSchema(labels),
    prompt: systemPrompt,
    model,
    temperature: 0,
  });

  const label = typeof response.data.label === 'string' ? response.data.label.trim() : '';
  if (!labels.includes(label)) {
    throw new Error(`judge returned unknown label: "${label}" (allowed: ${labels.join(', ')})`);
  }

  return {
    label,
    rationale: typeof response.data.rationale === 'string' ? response.data.rationale.trim() : '',
    rawOutput: serializeJudgeResponse(response),
  };
}

// ---------------------------------------------------------------------------
// Legacy file API — used by agent-workflow v1/eval route
// ---------------------------------------------------------------------------

const DEFAULT_JUDGE_MODEL = 'gpt-5.2';

export type Severity = 'high' | 'medium' | 'low';

export interface JudgeIssue {
  description: string;
  severity: Severity;
  fatal: boolean;
}

const DEFAULT_JUDGE_SYSTEM_PROMPT = `You compare two documents (expected vs actual) and list differences.

Be extra detailed: mark every difference in signs, values, texts, formatting, and anything else. The goal is for the files to be identical.

First, in 1-2 sentences each, summarize what you see in the expected file and what you see in the actual file (so we can confirm you received both). Then list any differences.

Follow any workflow-specific rules given below. End your response with only this JSON in a fenced code block:
\`\`\`json
{"issues":[{"description":"string","severity":"high|medium|low","fatal":true|false}]}
\`\`\`
Use {"issues":[]} only if there are no differences at all.`;

function normalizeSeverity(value: unknown): Severity {
  if (value === 'high' || value === 'medium' || value === 'low') return value;
  return 'medium';
}

function extractIssuesJsonFromJudgeResponse(content: string): string {
  const trimmed = content?.trim() ?? '';
  const jsonBlockMatch = trimmed.match(/```json\s*([\s\S]*?)```/g);
  if (jsonBlockMatch && jsonBlockMatch.length > 0) {
    const lastBlock = jsonBlockMatch[jsonBlockMatch.length - 1];
    const inner = lastBlock
      .replace(/^```json\s*/, '')
      .replace(/\s*```$/, '')
      .trim();
    if (inner.startsWith('{')) return inner;
  }
  const objectMatch = trimmed.match(/\{"issues":\s*\[[\s\S]*\]\s*\}/g);
  if (objectMatch && objectMatch.length > 0) return objectMatch[objectMatch.length - 1];
  if (trimmed.startsWith('{')) return trimmed;
  return '{"issues":[]}';
}

export function buildJudgeSystemPrompt(workflowPromptExtension: string): string {
  const extension = workflowPromptExtension.trim();
  if (!extension) return DEFAULT_JUDGE_SYSTEM_PROMPT;
  return `${DEFAULT_JUDGE_SYSTEM_PROMPT}\n\n--- Workflow-specific rules (what to check, severity, exceptions) ---\n\n${extension}`;
}

export async function compareWithOpenAiJudge(params: {
  apiKey: string;
  model?: string;
  systemPrompt: string;
  docLabel: string;
  expected: JudgeFilePayload[];
  actual: JudgeFilePayload[];
}): Promise<{ issues: JudgeIssue[]; rawOutput: string }> {
  const { apiKey, model = DEFAULT_JUDGE_MODEL, systemPrompt, docLabel, expected, actual } = params;

  const userContent: ResponsesContent[] = [
    {
      type: 'input_text',
      text: `Expected = first file(s). Actual = next file(s). Key: ${docLabel}.`,
    },
    ...expected.map((p) => ({
      type: 'input_file' as const,
      filename: p.filename,
      file_data: p.dataUrl,
    })),
    ...actual.map((p) => ({
      type: 'input_file' as const,
      filename: p.filename,
      file_data: p.dataUrl,
    })),
  ];

  const fullContent = await callResponses({
    apiKey,
    model,
    systemPrompt,
    userContent,
    maxOutputTokens: 3000,
  });

  const raw = fullContent ? extractIssuesJsonFromJudgeResponse(fullContent) : '{"issues":[]}';

  let parsed: { issues?: unknown };
  try {
    parsed = JSON.parse(raw) as { issues?: unknown };
  } catch {
    return { issues: [], rawOutput: fullContent };
  }
  if (!Array.isArray(parsed.issues)) return { issues: [], rawOutput: fullContent };

  const out: JudgeIssue[] = [];
  for (const issue of parsed.issues) {
    if (!issue || typeof issue !== 'object') continue;
    const obj = issue as { description?: unknown; severity?: unknown; fatal?: unknown };
    if (typeof obj.description !== 'string' || obj.description.trim() === '') continue;
    out.push({
      description: obj.description.trim(),
      severity: normalizeSeverity(obj.severity),
      fatal: obj.fatal === true,
    });
  }
  return { issues: out, rawOutput: fullContent };
}

/**
 * Label-constrained judge prompt for discrete-mode eval (legacy file-based path).
 */
export function buildLabelConstrainedJudgePrompt(params: {
  basePrompt: string;
  labels: string[];
}): string {
  const labelList = params.labels.map((l) => `"${l}"`).join(', ');
  return `${params.basePrompt}

IMPORTANT: Instead of listing individual issues, your task is to pick exactly one label
that describes the overall quality of the actual output relative to the expected output.

Available labels: ${labelList}

End your response with only this JSON in a fenced code block (use one of the labels above, verbatim):
\`\`\`json
{"label":"<one-of-the-labels>","rationale":"<brief explanation>"}
\`\`\``;
}

export async function compareWithOpenAiJudgeLabel(params: {
  apiKey: string;
  model?: string;
  systemPrompt: string;
  docLabel: string;
  expected: JudgeFilePayload[];
  actual: JudgeFilePayload[];
  allowedLabels: string[];
}): Promise<JudgeLabelResult> {
  const {
    apiKey,
    model = DEFAULT_JUDGE_MODEL,
    systemPrompt,
    docLabel,
    expected,
    actual,
    allowedLabels,
  } = params;

  const userContent: ResponsesContent[] = [
    {
      type: 'input_text',
      text: `Expected = first file(s). Actual = next file(s). Key: ${docLabel}.`,
    },
    ...expected.map((p) => ({
      type: 'input_file' as const,
      filename: p.filename,
      file_data: p.dataUrl,
    })),
    ...actual.map((p) => ({
      type: 'input_file' as const,
      filename: p.filename,
      file_data: p.dataUrl,
    })),
  ];

  const fullContent = await callResponses({
    apiKey,
    model,
    systemPrompt,
    userContent,
    maxOutputTokens: 1000,
  });

  const raw = fullContent ? extractLastJsonBlock(fullContent) : '';
  if (!raw) {
    throw new Error(
      `judge returned no parseable label JSON (raw: ${fullContent.slice(0, 200)}...)`
    );
  }

  let parsed: { label?: unknown; rationale?: unknown };
  try {
    parsed = JSON.parse(raw) as { label?: unknown; rationale?: unknown };
  } catch {
    throw new Error(`judge JSON parse failed: ${raw}`);
  }

  const label = typeof parsed.label === 'string' ? parsed.label.trim() : '';
  if (!allowedLabels.includes(label)) {
    throw new Error(
      `judge returned unknown label: ${label} (allowed: ${allowedLabels.join(', ')})`
    );
  }

  const rationale = typeof parsed.rationale === 'string' ? parsed.rationale.trim() : '';
  return { label, rationale, rawOutput: fullContent };
}
