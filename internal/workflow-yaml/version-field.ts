/**
 * EIG-114: helpers for the top-level `version:` field in workflow YAML.
 *
 * The field is just a string in the user's YAML — anyone can write
 * `version: 99.0.0`. The platform's source of truth lives in
 * `workflow_history.version` (set only by tag/release flows). These helpers
 * keep the YAML coherent with that DB tag at write time:
 *
 *   - on release: splice the released semver into the YAML so exports +
 *     CLI re-imports stay consistent.
 *   - on plain save / import: strip whatever the user typed so we never
 *     persist a forgery that later gets read back as truth.
 *
 * Both are best-effort string surgery (vs. parse → re-stringify) so users
 * keep their comments, key ordering, and quoting style.
 */

// Matches any top-level `version:` line, regardless of value. We deliberately
// accept non-semver values here too (e.g. `version: my-branch`): otherwise
// `spliceWorkflowVersion` would skip the replace step and insert a *second*
// `version:` line, producing duplicate-key YAML that the parser then rejects.
const TOP_LEVEL_VERSION_LINE = /^version:.*$/m;
const TOP_LEVEL_NAME_LINE = /^(name:\s*\S.*)$/m;

/**
 * Replace the top-level `version:` line with `next`, or insert one near the
 * top if none exists. Idiomatic placement is right after `name:`.
 */
export function spliceWorkflowVersion(yaml: string, next: string): string {
  if (TOP_LEVEL_VERSION_LINE.test(yaml)) {
    return yaml.replace(TOP_LEVEL_VERSION_LINE, `version: ${next}`);
  }
  if (TOP_LEVEL_NAME_LINE.test(yaml)) {
    return yaml.replace(TOP_LEVEL_NAME_LINE, `$1\nversion: ${next}`);
  }
  return `version: ${next}\n${yaml}`;
}

/**
 * Drop a top-level `version:` line entirely. Used on plain save / import
 * paths so we don't persist a user-supplied version string the chip would
 * later treat as authoritative.
 */
export function stripWorkflowVersion(yaml: string): string {
  if (!TOP_LEVEL_VERSION_LINE.test(yaml)) return yaml;
  // Drop the line + its trailing newline so we don't leave a blank line
  // where the field used to be.
  return yaml.replace(/^version:.*(\r?\n)?/m, '');
}
