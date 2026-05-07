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
