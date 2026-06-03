import { parseAutomationTarget } from '@eigenpal/types';

export function parseAgentTarget(target: string): {
  packageName: string;
  slug: string;
  sourceRef?: string;
} {
  const [rawTarget, rawRef, extra] = target.split('@');
  if (extra !== undefined) throw new Error('Agent target must be <slug>[@ref].');
  const normalizedTarget = rawTarget.includes('.')
    ? target
    : `agents.${rawTarget}${rawRef !== undefined ? `@${rawRef}` : ''}`;
  const parsed = parseAutomationTarget(normalizedTarget);
  if (parsed.type !== 'agents') {
    throw new Error('Only agent targets are supported in this release. Use agents.<slug>[@ref].');
  }
  return {
    packageName: parsed.packageName,
    slug: parsed.slug,
    sourceRef: rawRef !== undefined ? parsed.ref : undefined,
  };
}
