/**
 * LLM judge helpers for YAML workflow evaluators (`llm-judge`).
 *
 * `judgeScoreJson` / `judgeLabelJson` send actual/expected output as JSON text blocks and use the
 * caller's `AIClient` — any configured LLM provider works.
 */

import type { AIClient } from '../client/ai-client';

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
