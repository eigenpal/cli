import { afterEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { captureAgentSource } from './agent-definition';

const directories: string[] = [];
afterEach(async () => {
  for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true });
});
async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), 'agent-authoring-'));
  directories.push(dir);
  await writeFile(path.join(dir, 'agent.ts'), "export default {name:'Fixture'};");
  return dir;
}

test('captures local modules without reading package config or resources', async () => {
  const dir = await fixture();
  await mkdir(path.join(dir, 'knowledge'));
  await writeFile(path.join(dir, 'knowledge/policy.md'), 'Resource');
  await writeFile(path.join(dir, 'package.json'), 'not a package config');
  await writeFile(path.join(dir, 'helper.ts'), 'export const name="Fixture";');
  expect(Object.keys(captureAgentSource(dir).files).sort()).toEqual(['agent.ts', 'helper.ts']);
});
test('refuses mixed definitions before contacting the compiler', async () => {
  const dir = await fixture();
  await writeFile(path.join(dir, 'output-schema.json'), '{}');
  expect(() => captureAgentSource(dir)).toThrow('exclusively in agent.ts');
});
test('does not follow symlink source modules', async () => {
  const dir = await fixture();
  await writeFile(path.join(dir, 'target.txt'), 'Fixture');
  await symlink('target.txt', path.join(dir, 'helper.ts'));
  expect(() => captureAgentSource(dir)).toThrow('regular');
});
test('bounds source bytes and file count before HTTP submission', async () => {
  const dir = await fixture();
  for (let index = 0; index < 32; index++)
    await writeFile(path.join(dir, `helper${index}.ts`), 'export {};');
  expect(() => captureAgentSource(dir)).toThrow('compilation limit');
  const large = await fixture();
  await writeFile(path.join(large, 'agent.ts'), 'x'.repeat(256 * 1024));
  expect(() => captureAgentSource(large)).toThrow('compilation limit');
});
