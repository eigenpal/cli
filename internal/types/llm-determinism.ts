/**
 * Single source of truth for the LLM temperature Eigenpal uses on every
 * model call.
 *
 * Eigenpal is a deterministic framework: same input → same output. The
 * AIClient implementations (openai, anthropic, google) hardcode this value
 * on every SDK call; `ExtractOptions` deliberately does NOT expose a
 * temperature field, and workflow YAMLs cannot override it.
 *
 * Note: `temperature: 0` does not guarantee 100% determinism — providers
 * still have non-deterministic kernels and routing. The constant gives the
 * lowest variance the providers expose; further reproducibility comes from
 * passing a stable `seed` (OpenAI) per call.
 */
export const DETERMINISTIC_TEMPERATURE = 0;

/**
 * Reasoning models reject any temperature but 1, and gateways in front of them
 * (LiteLLM, vLLM) reject it on the model's behalf. Since we always send
 * `DETERMINISTIC_TEMPERATURE`, every caller needs the same "was this a
 * temperature rejection?" test so it can retry without the field.
 *
 * The wording differs per endpoint and drifts between versions:
 *   - OpenAI:  "Unsupported value: 'temperature' does not support 0 with this model…"
 *   - LiteLLM: "litellm.UnsupportedParamsError: gpt-5 models (including gpt-5-codex)
 *              don't support temperature=0. Only temperature=1 is supported."
 *
 * So match a rejection marker rather than one vendor's sentence shape — but
 * require it in the same clause as the word `temperature`. Testing the whole
 * message for each term independently is too loose in practice: gateways reject
 * some *other* parameter while listing temperature among the supported ones, or
 * echo the offending request body (`{"temperature":0}`) into an unrelated 400.
 * Both would otherwise read as a temperature rejection.
 *
 * Callers check the status code (400) themselves — SDKs disagree on where they
 * put it (`status` vs `statusCode`).
 */
const TEMPERATURE_REJECTION_MARKER =
  /unsupported|not\s+support|n['’]?t\s+support|only\s+the\s+default|only\s+temperature/i;

export function isTemperatureRejectionMessage(message: string): boolean {
  return message
    .split(/[.;\n]/)
    .some((clause) => /temperature/i.test(clause) && TEMPERATURE_REJECTION_MARKER.test(clause));
}
