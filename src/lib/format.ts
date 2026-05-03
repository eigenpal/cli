import { readFileSync, writeFileSync } from 'fs';
import { extname, resolve } from 'path';
import { env } from '../env';

const PRETTIER_EXTENSIONS = new Set(['.json', '.yaml', '.yml']);

/**
 * Format a file with Prettier if Prettier is available in the repo.
 * Reads the file, formats (using project config via filepath), and writes back.
 * No-op for non-JSON/YAML files or if Prettier is not installed.
 */
export async function formatFileIfAvailable(filepath: string): Promise<void> {
  if (!PRETTIER_EXTENSIONS.has(extname(filepath))) return;
  try {
    const content = readFileSync(filepath, 'utf-8');
    const prettier = await import('prettier');
    const formatted = await prettier.format(content, {
      filepath: resolve(filepath),
    });
    if (formatted !== content) {
      writeFileSync(filepath, formatted, 'utf-8');
    }
  } catch (err) {
    // Prettier not available or format failed — leave file unchanged
    if (env.DEBUG?.includes('prettier')) {
      console.debug('[format] Prettier unavailable or format failed:', err);
    }
  }
}
