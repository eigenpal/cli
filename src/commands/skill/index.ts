/**
 * `eigenpal skill {install,uninstall,list}` — install / remove / inspect
 * the bundled Eigenpal skill in one or more AI agent tool directories
 * (Claude Code, Cursor, …).
 *
 * `install` opens an interactive multiselect; the picker pre-selects
 * tools that already have an Eigenpal install or whose project directory
 * exists in the cwd. Toggle on to install, toggle off to uninstall — one
 * picker covers both directions in a single command.
 *
 * `uninstall` is the explicit single-tool remover (`skill uninstall claude`,
 * or `--all` to wipe every install).
 *
 * `list` reads each target's `.eigenpal-manifest.json` and prints a table
 * of where the skill is installed + which CLI version wrote it.
 *
 * Per-target install/uninstall primitives (`installSkill`, `uninstallSkill`)
 * stay stable so tests and `--target` power-user flows can call them
 * directly. File ownership is tracked in a per-target
 * `.eigenpal-manifest.json`. Re-install is idempotent: identical files are
 * silently overwritten; user-edited files trigger a 3-way prompt
 * (keep / overwrite / show diff) unless `--force` is given. Manifest paths
 * are resolved relative to the target root, with traversal (`..`)
 * explicitly rejected.
 */

import { cancel, confirm, isCancel, multiselect, select } from '@clack/prompts';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { sep as PATH_SEP, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isInteractiveStdout, nonInteractiveYesRequired } from '../../lib/non-interactive';
import { error, info, success, table, ui } from '../../lib/ui';
import { TOOLS, type ToolTarget } from './tools';

const MANIFEST_NAME = '.eigenpal-manifest.json';

interface ManifestEntry {
  /** Relative to the skill directory. */
  path: string;
  /** SHA-256 hex of the file at install time. */
  sha256: string;
}

interface Manifest {
  cliVersion: string;
  installedAt: string;
  files: ManifestEntry[];
}

function resolveSkillSource(): string {
  // src layout: __dirname is packages/cli/src/commands/skill/ → ../../skill/
  // dist layout: __dirname is dist/ → skill/
  const here = dirname(fileURLToPath(import.meta.url));
  const srcCandidate = resolve(here, '..', '..', 'skill');
  if (existsSync(srcCandidate)) return srcCandidate;
  const distCandidate = resolve(here, 'skill');
  if (existsSync(distCandidate)) return distCandidate;
  throw new Error(
    `Cannot locate bundled skill content. Looked in:\n  ${srcCandidate}\n  ${distCandidate}`
  );
}

function defaultClaudeTarget(): string {
  return join(process.cwd(), TOOLS[0]!.relativePath);
}

function resolveSkillTarget(opts: { target?: string }): string {
  return opts.target ?? defaultClaudeTarget();
}

function sha256(buffer: Buffer | string): string {
  return createHash('sha256').update(buffer).digest('hex');
}

const CLI_VERSION_PLACEHOLDER = '__CLI_VERSION__';

// Templating is scoped to SKILL.md so other files round-trip byte-for-byte.
// The manifest hashes the templated bytes, so re-install at the same CLI
// version is a no-op and a version bump is a clean manifest-tracked update.
function templateSourceFile(relativePath: string, bytes: Buffer, cliVersion: string): Buffer {
  if (relativePath !== 'SKILL.md') return bytes;
  const text = bytes.toString('utf-8').replaceAll(CLI_VERSION_PLACEHOLDER, cliVersion);
  return Buffer.from(text, 'utf-8');
}

interface InstallOptions {
  target?: string;
  force?: boolean;
  yes?: boolean;
  /** Internal: source override for tests. */
  source?: string;
}

/**
 * Install the bundled skill into a single target directory. `installSkillTools`
 * calls this once per selected tool; tests and `--target` power-user flows
 * call it directly.
 */
export async function installSkill(opts: InstallOptions): Promise<void> {
  const source = opts.source ?? resolveSkillSource();
  const target = resolveSkillTarget(opts);
  const cliVersion = readCliVersion();

  const sourceFiles = listFiles(source);
  if (sourceFiles.length === 0) {
    throw new Error(`Skill source ${source} is empty.`);
  }

  const existingManifest = readManifest(target);

  let written = 0;
  let skipped = 0;
  let prompted = 0;

  for (const relativePath of sourceFiles) {
    const sourcePath = join(source, relativePath);
    const targetPath = join(target, relativePath);
    const sourceBytes = templateSourceFile(relativePath, readFileSync(sourcePath), cliVersion);
    const sourceHash = sha256(sourceBytes);

    if (!existsSync(targetPath)) {
      mkdirSync(dirname(targetPath), { recursive: true });
      writeFileSync(targetPath, sourceBytes);
      written += 1;
      continue;
    }

    const targetBytes = readFileSync(targetPath);
    const targetHash = sha256(targetBytes);

    if (targetHash === sourceHash) {
      skipped += 1;
      continue;
    }

    // The target is different from the bundled source. Two sub-cases:
    //   1. It matches the previous manifest's recorded hash → it's an old
    //      version of OUR file; safe to overwrite.
    //   2. It does NOT match the manifest hash → user edited it; prompt.
    const previousEntry = existingManifest?.files.find((f) => f.path === relativePath);
    const userEdited = previousEntry ? previousEntry.sha256 !== targetHash : true;

    if (!userEdited || opts.force) {
      writeFileSync(targetPath, sourceBytes);
      written += 1;
      continue;
    }

    if (opts.yes) {
      // Non-interactive: keep user edits.
      skipped += 1;
      continue;
    }
    if (!isInteractiveStdout()) {
      throw new Error(
        `${relativePath} has local edits. Pass --yes to keep them or --force to overwrite them in non-interactive mode.`
      );
    }

    prompted += 1;
    const choice = await promptThreeWay(targetPath, sourceBytes, targetBytes);
    if (choice === 'overwrite') {
      writeFileSync(targetPath, sourceBytes);
      written += 1;
    } else {
      skipped += 1;
    }
  }

  // Write the new manifest. List every file we own at the end of this run.
  const manifestEntries: ManifestEntry[] = [];
  for (const relativePath of sourceFiles) {
    const targetPath = join(target, relativePath);
    if (!existsSync(targetPath)) continue;
    manifestEntries.push({ path: relativePath, sha256: sha256(readFileSync(targetPath)) });
  }
  const manifest: Manifest = {
    cliVersion,
    installedAt: new Date().toISOString(),
    files: manifestEntries,
  };
  writeFileSync(join(target, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`);

  const displayTarget = relative(process.cwd(), target) || target;
  success(
    `Installed skill at ${ui.bold(displayTarget)} — ${written} written, ${skipped} unchanged${
      prompted > 0 ? `, ${prompted} prompted` : ''
    }.`
  );
}

interface UninstallOptions {
  target?: string;
  yes?: boolean;
}

export async function uninstallSkill(opts: UninstallOptions): Promise<void> {
  const target = resolveSkillTarget(opts);
  const manifest = readManifest(target);
  if (!manifest) {
    error(`No manifest found at ${join(target, MANIFEST_NAME)}; nothing to uninstall.`);
    process.exit(1);
  }

  if (!opts.yes && isInteractiveStdout()) {
    const proceed = await confirm({
      message: `Remove ${manifest.files.length} files from ${relative(process.cwd(), target) || target}?`,
      initialValue: false,
    });
    if (isCancel(proceed) || !proceed) {
      cancel('Aborted.');
      return;
    }
  } else if (!opts.yes) {
    throw new Error(nonInteractiveYesRequired('Uninstall skill from custom --target path'));
  }

  // Manifest entries are user-controllable on disk; resolve every path back
  // through the target root and reject anything that escapes it. Defends
  // against a tampered manifest with `entry.path = "../../.ssh/...".
  const targetReal = resolve(target);
  const safeBase = targetReal + PATH_SEP;
  let removed = 0;
  let kept = 0;
  for (const entry of manifest.files) {
    const path = resolve(targetReal, entry.path);
    if (path !== targetReal && !path.startsWith(safeBase)) {
      console.error(`Refusing to touch ${path}: manifest path escapes ${targetReal}`);
      continue;
    }
    if (!existsSync(path)) continue;
    const currentHash = sha256(readFileSync(path));
    if (currentHash !== entry.sha256 && !opts.yes) {
      kept += 1;
      continue;
    }
    unlinkSync(path);
    removed += 1;
  }

  rmSync(join(target, MANIFEST_NAME), { force: true });
  pruneEmptyDirs(target);

  const displayTarget = relative(process.cwd(), target) || target;
  success(
    `Uninstalled skill from ${ui.bold(displayTarget)} — ${removed} removed${
      kept > 0 ? `, ${kept} user-edited kept` : ''
    }.`
  );
}

interface InstallToolsOptions {
  /** Comma-separated tool ids (e.g. "claude,cursor"). Skips the picker. */
  tools?: string;
  /** Power-user override: install a SINGLE tool to a custom path. */
  target?: string;
  /** Forwarded to per-target installs. */
  force?: boolean;
  /** Non-interactive. */
  yes?: boolean;
  /** Internal: source override for tests. */
  source?: string;
}

/**
 * `eigenpal skill install` — top-level orchestrator. Detects which tools
 * the user already has installed and which their project uses, opens a
 * multiselect picker (or honors `--tools`), then installs newly-selected
 * tools and uninstalls any that were toggled off in the same picker.
 */
export async function installSkillTools(opts: InstallToolsOptions): Promise<void> {
  // `--target` opts out of the multi-tool picker entirely: it's a power-user
  // override aimed at a single custom path. Fall through to the legacy
  // single-target install.
  if (opts.target) {
    await installSkill({
      source: opts.source,
      target: opts.target,
      force: opts.force,
      yes: opts.yes,
    });
    info('Restart any running agent session for the skill to load.');
    return;
  }

  const cwd = process.cwd();
  const installed = new Set(TOOLS.filter((t) => isInstalled(cwd, t)).map((t) => t.id));
  const detected = new Set(TOOLS.filter((t) => isProjectUsing(cwd, t)).map((t) => t.id));

  let selectedIds: string[];

  if (opts.tools !== undefined) {
    selectedIds = parseToolsFlag(opts.tools);
  } else if (opts.yes || !isInteractiveStdout()) {
    // Non-interactive default: keep currently installed tools as-is. If
    // none are installed yet, fall back to Claude Code (matches the
    // historical default so existing scripts keep working).
    selectedIds = installed.size > 0 ? [...installed] : [TOOLS[0]!.id];
  } else {
    let initial: string[] = [];
    if (installed.size > 0) initial = [...installed];
    else if (detected.size > 0) initial = [...detected];

    // Surface installed tools first, then detected, then the rest. Filtering
    // into three buckets preserves TOOLS' declared order within each bucket.
    const ranked = [
      ...TOOLS.filter((t) => installed.has(t.id)),
      ...TOOLS.filter((t) => detected.has(t.id) && !installed.has(t.id)),
      ...TOOLS.filter((t) => !installed.has(t.id) && !detected.has(t.id)),
    ];
    const picked = await multiselect<string>({
      message: 'Select agent tools to install the Eigenpal skill into',
      options: ranked.map((t) => ({
        value: t.id,
        label: t.label,
        hint: hintFor(t, installed, detected),
      })),
      initialValues: initial,
      required: false,
    });
    if (isCancel(picked)) {
      cancel('Aborted.');
      return;
    }
    selectedIds = picked;
  }

  const selected = new Set(selectedIds);
  const toInstall = TOOLS.filter((t) => selected.has(t.id));
  const toUninstall = TOOLS.filter((t) => !selected.has(t.id) && installed.has(t.id));

  if (toInstall.length === 0 && toUninstall.length === 0) {
    info('No changes — skill is already in the requested state.');
    return;
  }

  for (const tool of toInstall) {
    await installSkill({
      source: opts.source,
      target: join(cwd, tool.relativePath),
      force: opts.force,
      yes: opts.yes,
    });
  }

  for (const tool of toUninstall) {
    await uninstallSkill({
      target: join(cwd, tool.relativePath),
      yes: true,
    });
  }

  info('Restart any running agent session for the skill to load.');
}

interface UninstallToolsOptions {
  /** Tool ids to uninstall (positional from CLI). */
  toolIds?: string[];
  /** Remove every installed tool. Mutually exclusive with toolIds. */
  all?: boolean;
  /** Power-user override: uninstall a SINGLE custom path. */
  target?: string;
  /** Skip confirmation in TTY. Required in non-TTY. */
  yes?: boolean;
}

/**
 * `eigenpal skill uninstall` — explicit removal. Three input shapes:
 *
 *   - `--target <path>` → remove that one path, no detection.
 *   - `--all`           → remove every tool that has an Eigenpal manifest.
 *   - `[toolIds...]`    → remove the named tools (e.g. `claude cursor`).
 *   - none of the above → in TTY, picker shows ONLY currently installed
 *     tools so you don't accidentally uninstall something never installed.
 */
export async function uninstallSkillTools(opts: UninstallToolsOptions): Promise<void> {
  // Reject mutually-exclusive flag combinations explicitly so scripts that
  // build up flags dynamically fail loud instead of silently picking one.
  // `--target` is the power-user single-path override; pairing it with
  // `--all` or named tool ids is incoherent.
  const hasToolIds = (opts.toolIds?.length ?? 0) > 0;
  if (opts.target && (opts.all || hasToolIds)) {
    throw new Error(
      '`--target` is a single-path override; combine it with neither `--all` nor positional tool ids.'
    );
  }
  if (opts.all && hasToolIds) {
    throw new Error('`--all` removes every installed tool; pass tool ids OR `--all`, not both.');
  }
  if (opts.toolIds && opts.toolIds.length > 0) {
    assertKnownToolIds(opts.toolIds);
  }

  if (opts.target) {
    await uninstallSkill({ target: opts.target, yes: opts.yes });
    return;
  }

  const cwd = process.cwd();
  const installedTools = TOOLS.filter((t) => isInstalled(cwd, t));

  if (installedTools.length === 0) {
    info('No installed tools found in the current directory.');
    return;
  }

  let targets: ToolTarget[];

  if (opts.all) {
    targets = installedTools;
  } else if (opts.toolIds && opts.toolIds.length > 0) {
    const ids = opts.toolIds;
    const installedIds = new Set(installedTools.map((t) => t.id));
    targets = TOOLS.filter((t) => ids.includes(t.id));
    const notInstalled = ids.filter((id) => !installedIds.has(id));
    if (notInstalled.length > 0) {
      info(`Not installed (skipping): ${notInstalled.join(', ')}`);
      targets = targets.filter((t) => installedIds.has(t.id));
    }
  } else if (opts.yes || !isInteractiveStdout()) {
    throw new Error('Non-interactive: pass tool ids (e.g. `skill uninstall claude`) or `--all`.');
  } else {
    const picked = await multiselect<string>({
      message: 'Select tools to uninstall (only installed tools shown)',
      options: installedTools.map((t) => ({
        value: t.id,
        label: t.label,
        hint: t.relativePath,
      })),
      required: false,
    });
    if (isCancel(picked)) {
      cancel('Aborted.');
      return;
    }
    targets = TOOLS.filter((t) => (picked as string[]).includes(t.id));
  }

  if (targets.length === 0) {
    info('Nothing to uninstall.');
    return;
  }

  for (const tool of targets) {
    await uninstallSkill({
      target: join(cwd, tool.relativePath),
      yes: true,
    });
  }
}

interface ListToolsOptions {
  json?: boolean;
}

/**
 * `eigenpal skill list` — show every tool that has an Eigenpal skill
 * installed in the cwd, with the CLI version that wrote it and the
 * install timestamp. `--json` for scripting.
 */
export function listSkillTools(opts: ListToolsOptions = {}): void {
  const cwd = process.cwd();
  const rows = TOOLS.flatMap((tool) => {
    const targetDir = join(cwd, tool.relativePath);
    const manifest = readManifest(targetDir);
    if (!manifest) return [];
    return [
      {
        tool: tool.id,
        label: tool.label,
        path: tool.relativePath,
        cliVersion: manifest.cliVersion,
        installedAt: manifest.installedAt,
        files: manifest.files.length,
      },
    ];
  });

  if (opts.json) {
    console.log(JSON.stringify({ data: rows, total: rows.length }, null, 2));
    return;
  }

  if (rows.length === 0) {
    info('No Eigenpal skill installed in the current directory.');
    info('Run `eigenpal skill install` to add one.');
    return;
  }

  console.log(
    table(rows, [
      { key: 'tool', header: 'tool' },
      { key: 'label', header: 'label' },
      { key: 'path', header: 'path' },
      { key: 'cliVersion', header: 'cli version' },
      { key: 'installedAt', header: 'installed at' },
      { key: 'files', header: 'files', align: 'right' },
    ])
  );
}

function parseToolsFlag(raw: string): string[] {
  const requested = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  assertKnownToolIds(requested);
  return requested;
}

/**
 * Throw a friendly error if any id isn't in the curated `TOOLS` table. Used by
 * both `--tools claude,cursor` (install) and the positional `[toolIds...]`
 * (uninstall) paths so the error message stays uniform.
 */
function assertKnownToolIds(ids: readonly string[]): void {
  const valid = new Set(TOOLS.map((t) => t.id));
  const unknown = ids.filter((id) => !valid.has(id));
  if (unknown.length === 0) return;
  throw new Error(
    `Unknown tool id${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}. Supported: ${TOOLS.map((t) => t.id).join(', ')}.`
  );
}

function hintFor(tool: ToolTarget, installed: Set<string>, detected: Set<string>): string {
  if (installed.has(tool.id)) return 'installed';
  if (detected.has(tool.id)) return 'detected';
  return tool.relativePath;
}

function isInstalled(cwd: string, tool: ToolTarget): boolean {
  return existsSync(join(cwd, tool.relativePath, MANIFEST_NAME));
}

function isProjectUsing(cwd: string, tool: ToolTarget): boolean {
  return tool.detectPaths.some((p) => existsSync(join(cwd, p)));
}

function listFiles(root: string): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const rel = relative(root, full);
      // lstatSync (not statSync) so we don't follow symlinks out of the
      // skill source tree. Symlinked files are skipped silently.
      const stats = lstatSync(full);
      if (stats.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!stats.isFile()) continue;
      out.push(rel);
    }
  }
  return out.sort();
}

function readManifest(target: string): Manifest | null {
  const path = join(target, MANIFEST_NAME);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as Manifest;
  } catch {
    return null;
  }
}

function readCliVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // src layout: ../../../package.json from src/commands/skill/
    const candidates = [
      resolve(here, '..', '..', '..', 'package.json'),
      resolve(here, '..', '..', 'package.json'),
      resolve(here, '..', 'package.json'),
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        const pkg = JSON.parse(readFileSync(candidate, 'utf-8')) as {
          name?: string;
          version?: string;
        };
        if (pkg.name && pkg.name !== '@eigenpal/cli') continue;
        if (pkg.version) return pkg.version;
      }
    }
  } catch {
    // fall through
  }
  return 'unknown';
}

function pruneEmptyDirs(root: string): void {
  if (!existsSync(root)) return;
  const stack: string[] = [];
  const collect = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (lstatSync(full).isDirectory()) collect(full);
    }
    stack.push(dir);
  };
  collect(root);
  // `rmdirSync` (not `rmSync`) is the right API for empty dirs — `rmSync`
  // with `recursive: false` rejects directories with EISDIR, silently
  // failing under the catch and leaving the whole subtree behind.
  for (const dir of stack) {
    try {
      if (readdirSync(dir).length === 0) rmdirSync(dir);
    } catch {
      // best-effort
    }
  }
}

async function promptThreeWay(
  path: string,
  source: Buffer,
  current: Buffer
): Promise<'keep' | 'overwrite'> {
  const display = relative(process.cwd(), path) || path;
  while (true) {
    const choice = await select({
      message: `${display} has been edited locally`,
      initialValue: 'keep' as 'keep' | 'overwrite' | 'diff',
      options: [
        { value: 'keep' as const, label: 'Keep my edits' },
        { value: 'overwrite' as const, label: 'Overwrite with bundled version' },
        { value: 'diff' as const, label: 'Show diff' },
      ],
    });
    if (isCancel(choice)) {
      // Treat Ctrl-C in the conflict prompt as "keep" — same as the
      // non-interactive fallback. Don't abort the whole install.
      return 'keep';
    }
    if (choice === 'diff') {
      runDiff(source, current);
      continue;
    }
    return choice as 'keep' | 'overwrite';
  }
}

function runDiff(source: Buffer, current: Buffer): void {
  console.log(`  source: ${source.length} bytes; current: ${current.length} bytes.`);
  const commonLen = Math.min(source.length, current.length);
  for (let i = 0; i < commonLen; i++) {
    if (source[i] !== current[i]) {
      const before = source.slice(Math.max(0, i - 30), i).toString('utf-8');
      const sourceTail = source.slice(i, Math.min(source.length, i + 30)).toString('utf-8');
      const currentTail = current.slice(i, Math.min(current.length, i + 30)).toString('utf-8');
      console.log(`  first diff at byte ${i}:`);
      console.log(`    context : ${JSON.stringify(before)}`);
      console.log(`    source  : ${JSON.stringify(sourceTail)}`);
      console.log(`    current : ${JSON.stringify(currentTail)}`);
      return;
    }
  }
}

/** Test-only exports. */
export const __testing = {
  resolveSkillSource,
  defaultClaudeTarget,
  sha256,
  listFiles,
  readManifest,
  TOOLS,
  MANIFEST_NAME,
};
