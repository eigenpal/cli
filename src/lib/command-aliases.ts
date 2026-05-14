import type { Command } from 'commander';

const CONVENTION_ALIASES = new Map([
  ['artifacts', 'artifact'],
  ['execution', 'exec'],
  ['experiment', 'exp'],
  ['feedback', 'fb'],
  ['list', 'ls'],
  ['compare', 'diff'],
]);

export function applyCommandAliasConventions(root: Command): void {
  for (const command of root.commands) {
    applySiblingAliases(command.parent ?? root);
    applyCommandAliasConventions(command);
  }
}

function applySiblingAliases(parent: Command): void {
  const reserved = new Set<string>();
  for (const sibling of parent.commands) {
    reserved.add(sibling.name());
    for (const alias of sibling.aliases()) reserved.add(alias);
  }

  for (const command of parent.commands) {
    const alias = CONVENTION_ALIASES.get(command.name());
    if (!alias || command.aliases().includes(alias)) continue;
    if (reserved.has(alias)) continue;
    command.aliases([...command.aliases(), alias]);
    reserved.add(alias);
  }
}
