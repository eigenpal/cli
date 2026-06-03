import { SourcePackagePathSchema, type SourcePackagePath } from '@eigenpal/types';
import { InvalidArgumentError, Option, type Command } from 'commander';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

import { action } from '../../lib/format-error';
import { success } from '../../lib/ui';
import { resolveGitRoot, runGit } from './source-state';

function slugifyPackageSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function packagePathForTemplate(template: string, name: string): SourcePackagePath {
  const slug = slugifyPackageSegment(name);
  if (!slug) throw new Error('Package name must include at least one letter or number.');
  const rootByTemplate: Record<string, string> = {
    agent: 'agents',
    workflow: 'workflows',
    skill: 'resources/skills',
    rule: 'resources/rules',
    knowledge: 'resources/knowledge',
    evaluator: 'evaluators',
  };
  const root = rootByTemplate[template];
  if (!root)
    throw new Error('Template must be agent, workflow, skill, rule, knowledge, or evaluator.');
  return SourcePackagePathSchema.parse(`${root}/${slug}`);
}

function writePackageScaffold(
  packageRoot: string,
  packagePath: SourcePackagePath,
  name: string
): void {
  const [root, resourceKind] = packagePath.split('/');
  mkdirSync(packageRoot, { recursive: true });
  const title = name.trim();
  writeFileSync(
    path.join(packageRoot, 'eigenpal.yaml'),
    YAML.stringify({ schemaVersion: 1, name: title || path.basename(packagePath) })
  );
  if (root === 'agents') writeFileSync(path.join(packageRoot, 'AGENT.md'), `# ${title}\n\n`);
  if (root === 'evaluators') {
    writeFileSync(
      path.join(packageRoot, 'evaluator.yaml'),
      YAML.stringify({ schemaVersion: 1, type: 'exact-diff', config: {} })
    );
  }
  if (root === 'resources' && resourceKind === 'skills') {
    writeFileSync(path.join(packageRoot, 'SKILL.md'), `# ${title}\n\n`);
  }
  if (root === 'resources' && (resourceKind === 'rules' || resourceKind === 'knowledge')) {
    writeFileSync(path.join(packageRoot, 'README.md'), `# ${title}\n\n`);
  }
}

function initPackage(name: string, opts: { template: string; dir?: string }): void {
  const startDir = path.resolve(opts.dir ?? process.cwd());
  const gitRoot = resolveGitRoot(startDir) ?? startDir;
  mkdirSync(gitRoot, { recursive: true });
  if (!existsSync(path.join(gitRoot, '.git'))) runGit(['init', '-b', 'main', gitRoot]);
  if (!existsSync(path.join(gitRoot, 'eigenpal.yaml'))) {
    writeFileSync(
      path.join(gitRoot, 'eigenpal.yaml'),
      'schemaVersion: 1\neigenpalVersion: 1.0.0\n'
    );
  }
  const gitignorePath = path.join(gitRoot, '.gitignore');
  const gitignore = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf8') : '';
  const additions = ['.eigenpal/', 'eigenpal_modules/'].filter(
    (entry) => !gitignore.includes(entry)
  );
  if (additions.length > 0)
    writeFileSync(
      gitignorePath,
      `${gitignore}${gitignore.endsWith('\n') || !gitignore ? '' : '\n'}${additions.join('\n')}\n`
    );
  const packagePath = packagePathForTemplate(opts.template, name);
  const packageRoot = path.join(gitRoot, packagePath);
  if (existsSync(packageRoot)) throw new Error(`Package already exists: ${packagePath}`);
  writePackageScaffold(packageRoot, packagePath, name);
  success(`Created ${packagePath}.`);
}

function parseTemplate(value: string): string {
  if (!['agent', 'workflow', 'skill', 'rule', 'knowledge', 'evaluator'].includes(value)) {
    throw new InvalidArgumentError(
      'template must be agent, workflow, skill, rule, knowledge, or evaluator'
    );
  }
  return value;
}

export function registerSourceInitCommand(agent: Command): void {
  agent
    .command('init <name>')
    .description('Create a new source package scaffold.')
    .addOption(
      new Option('--template <template>', 'Package template')
        .argParser(parseTemplate)
        .makeOptionMandatory()
    )
    .option('--dir <dir>', 'Repository directory')
    .action(
      action(async (name: string, opts: { template: string; dir?: string }) =>
        initPackage(name, opts)
      )
    );
}
