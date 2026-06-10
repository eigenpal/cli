import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { ApiClient } from './client';
import { formatFileIfAvailable } from './format';

/** Payload shape returned by server (GET executions?includeSteps=true, execute output, eval example_completed output) */
export interface ExecutionArtifactPayload {
  executionId: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
  error: string | null;
  overrides: Record<string, unknown> | null;
  /** Final workflow output (`output` on the runs detail wire shape). */
  output: unknown;
  stepExecutions: Array<{
    stepName: string;
    stepType: string;
    status: string;
    inputData: unknown;
    outputData: unknown;
    overrideMode?: string | null;
    scopeStack?: unknown;
    [key: string]: unknown;
  }>;
}

function isWorkflowResult(
  value: unknown
): value is { files: Array<{ fileId: string; stepName?: string }> } {
  return (
    value != null &&
    typeof value === 'object' &&
    'files' in value &&
    Array.isArray((value as { files: unknown }).files)
  );
}

/** Parse filename from Content-Disposition header (e.g. attachment; filename="report.docx") */
function filenameFromContentDisposition(header: string | null): string | null {
  if (!header) return null;
  const match = /filename\*?=(?:UTF-8'')?"?([^";\n]+)"?/i.exec(header);
  if (match) return decodeURIComponent(match[1].trim());
  const simple = /filename="?([^";\n]+)"?/i.exec(header);
  return simple ? simple[1].trim() : null;
}

/** Sanitize filename for safe filesystem use (no path traversal) */
function safeFilename(name: string, fallback: string): string {
  const base = name.replace(/[/\\]/g, '_').trim();
  return base.length > 0 ? base : fallback;
}

/** Filesystem-safe folder name from ISO timestamp (e.g. 2026-03-06T00-46-00-271Z) for chronological order */
function timestampFolderName(payload: ExecutionArtifactPayload): string {
  const raw = payload.completedAt ?? payload.createdAt ?? new Date().toISOString();
  return raw.replace(/[:.]/g, '-');
}

/**
 * Entry for generated files: fileId + stepName (from result) + filename (as saved on disk).
 * Written to output.json as generatedFiles so each file is traceable.
 */
export interface GeneratedFileEntry {
  fileId: string;
  stepName: string;
  filename: string;
}

/**
 * Write execution artifact to executions/<timestamp>/output.json and download
 * generated files to executions/<timestamp>/files/. Folder name is ISO timestamp
 * (filesystem-safe) so runs are ordered chronologically. output.json includes
 * generatedFiles (fileId, stepName, filename) to match files on disk.
 */
export async function writeExecutionArtifacts(
  client: ApiClient,
  exampleDir: string,
  payload: ExecutionArtifactPayload
): Promise<string> {
  const folderName = timestampFolderName(payload);
  const executionsDir = join(exampleDir, 'executions', folderName);
  const filesDir = join(executionsDir, 'files');
  mkdirSync(filesDir, { recursive: true });

  const generatedFiles: GeneratedFileEntry[] = [];
  const result = payload.output;
  if (isWorkflowResult(result) && result.files.length > 0) {
    for (let i = 0; i < result.files.length; i++) {
      const entry = result.files[i];
      const fileId = entry?.fileId;
      const stepName = entry?.stepName ?? '';
      if (typeof fileId !== 'string') continue;
      try {
        const res = await client.getStream(`/api/v1/files/${fileId}`);
        const disposition = res.headers.get('Content-Disposition');
        const filename = filenameFromContentDisposition(disposition) ?? fileId;
        const safe = safeFilename(filename, `file-${i}${filename.includes('.') ? '' : '.bin'}`);
        const destPath = join(filesDir, safe);
        const buf = Buffer.from(await res.arrayBuffer());
        writeFileSync(destPath, buf);
        generatedFiles.push({ fileId, stepName, filename: safe });
      } catch (err) {
        console.warn(`  Warning: could not download file ${fileId}:`, err);
      }
    }
  }

  const output = {
    ...payload,
    generatedFiles: generatedFiles.length > 0 ? generatedFiles : undefined,
  };
  const outputPath = join(executionsDir, 'output.json');
  writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n', 'utf-8');
  await formatFileIfAvailable(outputPath);

  return executionsDir;
}

/**
 * Find the artifact folder name (timestamp) that contains the given executionId.
 * Used so judge summary links can point to executions/<timestamp>/files/...
 */
export function findArtifactFolderByExecutionId(
  exampleDir: string,
  executionId: string
): string | null {
  const executionsDir = join(exampleDir, 'executions');
  if (!existsSync(executionsDir)) return null;
  const entries = readdirSync(executionsDir, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const outputPath = join(executionsDir, e.name, 'output.json');
    if (!existsSync(outputPath)) continue;
    try {
      const data = JSON.parse(readFileSync(outputPath, 'utf-8')) as { executionId?: string };
      if (data.executionId === executionId) return e.name;
    } catch {
      // ignore invalid json
    }
  }
  return null;
}
