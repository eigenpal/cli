/**
 * Extract-input text normalization, shared between the worker's ai.extract
 * processor and the app's grounding viewer.
 *
 * The grounding pass records character offsets (`_grounding.<field>.
 * source_span.start/end`) into the exact string this module produces. The
 * execution view re-derives that same string client-side from the step's
 * persisted `resolvedConfig` to highlight spans, so worker and app MUST share
 * one implementation — any drift silently misplaces every highlight.
 */

/**
 * Convert an extract step's input to the text the LLM sees.
 *
 * Handles the shapes the step runner produces:
 * - Direct string content
 * - `{ content: string }` / `{ text: string }` wrappers
 * - Raw objects (e.g. split items) — serialized to JSON
 */
export function normalizeExtractInputToText(input: unknown): string {
  if (typeof input === 'string') {
    return input;
  }

  if (input && typeof input === 'object') {
    const obj = input as Record<string, unknown>;
    // The step runner wraps a resolved string input as { content } — unwrap it
    // so extraction (and grounding offsets) run on the raw text, not on a
    // JSON-stringified wrapper.
    if (typeof obj.content === 'string') {
      return obj.content;
    }
    if (typeof obj.text === 'string') {
      return obj.text;
    }
    // Otherwise, serialize the object to JSON for AI processing.
    // This handles split items and other structured data.
    return JSON.stringify(input, null, 2);
  }

  return String(input ?? '');
}

/**
 * Re-derive the extract source text from a step execution's persisted
 * `resolvedConfig`, mirroring the step runner's input construction
 * (`buildProcessorInput('extract', …)`: `content` → `text` → string `input`
 * → object `input`) followed by {@link normalizeExtractInputToText}.
 *
 * Returns null when the config carries no resolvable input (e.g. runs
 * persisted before resolvedConfig capture).
 */
export function extractSourceTextFromResolvedConfig(
  config: Record<string, unknown> | null | undefined
): string | null {
  if (!config || typeof config !== 'object') return null;

  if (typeof config.content === 'string') {
    return normalizeExtractInputToText({ content: config.content });
  }
  if (typeof config.text === 'string') {
    return normalizeExtractInputToText({ text: config.text });
  }
  if (typeof config.input === 'string') {
    return normalizeExtractInputToText({ content: config.input });
  }
  if (config.input !== null && config.input !== undefined) {
    return normalizeExtractInputToText(config.input);
  }
  return null;
}
