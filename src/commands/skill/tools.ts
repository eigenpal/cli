/**
 * The curated set of AI coding tools the Eigenpal skill can install into.
 *
 * Kept in its own zero-dependency module (only `node:path`) so build-time
 * consumers — the docs generator in `apps/docs`, tests — can import the target
 * list without pulling in the interactive install machinery (`@clack/prompts`,
 * the UI layer) that lives in `./index.ts`.
 */

import { join } from 'node:path';

const SKILL_NAME = 'eigenpal';

export interface ToolTarget {
  /** Stable id used in `--tools` flag and tests. */
  id: string;
  /** Human-readable label shown in the picker. */
  label: string;
  /** Project-relative install path. */
  relativePath: string;
  /** Project-relative paths whose presence flags the tool as "in use". */
  detectPaths: string[];
}

// Each tool follows the same skill-folder convention
// `<.tool-root>/skills/<skill-name>/` so the install logic stays uniform; only
// the root differs. Path conventions cribbed from OpenSpec
// (https://github.com/Fission-AI/OpenSpec) which maintains the canonical
// per-tool mapping. Add new tools here as they gain traction.
export const TOOLS: ToolTarget[] = [
  {
    id: 'claude',
    label: 'Claude Code',
    relativePath: join('.claude', 'skills', SKILL_NAME),
    detectPaths: ['.claude', 'CLAUDE.md'],
  },
  {
    id: 'cursor',
    label: 'Cursor',
    relativePath: join('.cursor', 'skills', SKILL_NAME),
    detectPaths: ['.cursor', '.cursorrules'],
  },
  {
    id: 'codex',
    label: 'Codex',
    relativePath: join('.codex', 'skills', SKILL_NAME),
    detectPaths: ['.codex'],
  },
  {
    id: 'gemini',
    label: 'Gemini CLI',
    relativePath: join('.gemini', 'skills', SKILL_NAME),
    detectPaths: ['.gemini', 'GEMINI.md'],
  },
  {
    id: 'antigravity',
    label: 'Antigravity',
    relativePath: join('.agent', 'skills', SKILL_NAME),
    detectPaths: ['.agent'],
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    relativePath: join('.opencode', 'skills', SKILL_NAME),
    detectPaths: ['.opencode'],
  },
  {
    id: 'pi',
    label: 'Pi',
    relativePath: join('.pi', 'skills', SKILL_NAME),
    detectPaths: ['.pi'],
  },
  {
    id: 'windsurf',
    label: 'Windsurf',
    relativePath: join('.windsurf', 'skills', SKILL_NAME),
    detectPaths: ['.windsurf', '.windsurfrules'],
  },
  {
    id: 'github-copilot',
    label: 'GitHub Copilot',
    relativePath: join('.github', 'skills', SKILL_NAME),
    // Copilot config is sprawled across several `.github/...` locations
    // depending on which feature the user has adopted. Match any of them.
    // Mirrors OpenSpec's detection list to stay consistent.
    detectPaths: [
      join('.github', 'copilot-instructions.md'),
      join('.github', 'instructions'),
      join('.github', 'prompts'),
      join('.github', 'agents'),
      join('.github', 'skills'),
      join('.github', 'workflows', 'copilot-setup-steps.yml'),
      join('.github', '.mcp.json'),
    ],
  },
];

export { SKILL_NAME };
