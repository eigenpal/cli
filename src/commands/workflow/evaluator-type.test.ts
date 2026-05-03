import { describe, expect, test } from 'bun:test';
import { Command } from 'commander';

import { registerEvaluatorTypeCommands } from './evaluator-type';

describe('registerEvaluatorTypeCommands', () => {
  test('registers `evaluator-type list` and `evaluator-type get`', () => {
    const root = new Command();
    registerEvaluatorTypeCommands(root);
    const ns = root.commands.find((c) => c.name() === 'evaluator-type');
    expect(ns).toBeDefined();
    const verbs = ns!.commands.map((c) => c.name()).sort();
    expect(verbs).toEqual(['get', 'list']);
  });

  test('list command has `--search` and the canonical `--json`/`--limit`/`--base-url` flags', () => {
    const root = new Command();
    registerEvaluatorTypeCommands(root);
    const ns = root.commands.find((c) => c.name() === 'evaluator-type')!;
    const listCmd = ns.commands.find((c) => c.name() === 'list')!;
    const flagNames = listCmd.options.map((o) => o.long ?? o.short);
    expect(flagNames).toContain('--search');
    expect(flagNames).toContain('--json');
    expect(flagNames).toContain('--limit');
    expect(flagNames).toContain('--offset');
    expect(flagNames).toContain('--base-url');
  });

  test('get command takes a positional <type> and `--out`', () => {
    const root = new Command();
    registerEvaluatorTypeCommands(root);
    const ns = root.commands.find((c) => c.name() === 'evaluator-type')!;
    const getCmd = ns.commands.find((c) => c.name() === 'get')!;
    expect(getCmd.usage()).toContain('<type>');
    const flagNames = getCmd.options.map((o) => o.long ?? o.short);
    expect(flagNames).toContain('--out');
  });
});
