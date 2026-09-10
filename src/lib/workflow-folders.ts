import { ApiError, type ApiClient } from './client';

export interface WorkflowFolderRow extends Record<string, unknown> {
  id: string;
  name: string;
  parentId: string | null;
  type: 'workflow' | 'template';
  childCount?: number;
  workflowCount?: number;
}

function assertWorkflowFolder(folder: WorkflowFolderRow, ref: string): WorkflowFolderRow {
  if (folder.type !== 'workflow') {
    throw new Error(`Folder is not a workflow folder: ${ref}`);
  }
  return folder;
}

function findSiblingFolder(
  folders: WorkflowFolderRow[],
  parentId: string | null,
  segment: string
): WorkflowFolderRow | undefined {
  const decoded = safeDecode(segment);
  return folders.find(
    (f) =>
      f.parentId === parentId &&
      (f.name === segment || f.name === decoded || encodeURIComponent(f.name) === segment)
  );
}

const FOLDER_ID_PREFIX = 'fldr_';

export function looksLikeFolderId(value: string): boolean {
  return value.startsWith(FOLDER_ID_PREFIX);
}

/** Normalize a CLI folder path: trim slashes; `/` means root (empty segments). */
export function normalizeFolderPathInput(path: string): string {
  const trimmed = path.trim();
  if (trimmed === '/' || trimmed === '') return '/';
  return trimmed.replace(/^\/+|\/+$/g, '');
}

/** Split a folder path into segment names (empty for root). */
export function folderPathSegments(path: string): string[] {
  const normalized = normalizeFolderPathInput(path);
  if (normalized === '/') return [];
  return normalized.split('/').filter(Boolean);
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Resolve URL-style path segments to a folder id, mirroring Studio folder
 * navigation (`billing/invoices` or encoded segment names).
 */
export function resolveFolderPathToId(folders: WorkflowFolderRow[], path: string): string | null {
  const segments = folderPathSegments(path);
  if (segments.length === 0) return null;
  let parentId: string | null = null;
  for (const segment of segments) {
    const decoded = safeDecode(segment);
    const folder = folders.find(
      (f) =>
        f.parentId === parentId &&
        (f.name === segment || f.name === decoded || encodeURIComponent(f.name) === segment)
    );
    if (!folder) return null;
    parentId = folder.id;
  }
  return parentId;
}

/** Build a slash path from a folder id (null → `/`). */
export function folderIdToPath(folders: WorkflowFolderRow[], folderId: string | null): string {
  if (!folderId) return '/';
  const byId = new Map(folders.map((f) => [f.id, f]));
  const segments: string[] = [];
  let current: string | null = folderId;
  while (current) {
    const folder = byId.get(current);
    if (!folder) break;
    segments.unshift(folder.name);
    current = folder.parentId;
  }
  return segments.length > 0 ? segments.join('/') : '/';
}

export interface FolderTreeNode {
  folder: WorkflowFolderRow;
  children: FolderTreeNode[];
}

export function buildFolderTree(folders: WorkflowFolderRow[]): FolderTreeNode[] {
  const nodes = new Map<string, FolderTreeNode>();
  for (const folder of folders) {
    nodes.set(folder.id, { folder, children: [] });
  }
  const roots: FolderTreeNode[] = [];
  for (const folder of folders) {
    const node = nodes.get(folder.id)!;
    if (folder.parentId && nodes.has(folder.parentId)) {
      nodes.get(folder.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortNodes = (list: FolderTreeNode[]) => {
    list.sort((a, b) => a.folder.name.localeCompare(b.folder.name));
    for (const node of list) sortNodes(node.children);
  };
  sortNodes(roots);
  return roots;
}

export function renderFolderTreeLines(nodes: FolderTreeNode[], indent = ''): string[] {
  const lines: string[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    const branch = i === nodes.length - 1 ? '└── ' : '├── ';
    const childIndent = indent + (i === nodes.length - 1 ? '    ' : '│   ');
    const counts: string[] = [];
    if (node.folder.workflowCount != null && node.folder.workflowCount > 0) {
      counts.push(
        `${node.folder.workflowCount} workflow${node.folder.workflowCount === 1 ? '' : 's'}`
      );
    }
    if (node.folder.childCount != null && node.folder.childCount > 0) {
      counts.push(`${node.folder.childCount} subfolder${node.folder.childCount === 1 ? '' : 's'}`);
    }
    const suffix = counts.length > 0 ? ` ${counts.join(', ')}` : '';
    lines.push(`${indent}${branch}${node.folder.name} (${node.folder.id})${suffix}`);
    lines.push(...renderFolderTreeLines(node.children, childIndent));
  }
  return lines;
}

export async function fetchWorkflowFolders(
  client: ApiClient,
  opts: { tree?: boolean } = {}
): Promise<WorkflowFolderRow[]> {
  const params: Record<string, string> = { type: 'workflow' };
  if (opts.tree) params.tree = 'true';
  const raw = await client.get('/v1/folders', params);
  if (Array.isArray(raw)) return raw as WorkflowFolderRow[];
  if (raw && typeof raw === 'object' && Array.isArray((raw as { data?: unknown }).data)) {
    return (raw as { data: WorkflowFolderRow[] }).data;
  }
  return [];
}

/** Resolve a path-or-id argument to a folder row (throws on miss). */
export async function resolveWorkflowFolderRef(
  client: ApiClient,
  pathOrId: string
): Promise<WorkflowFolderRow> {
  const trimmed = pathOrId.trim();
  if (looksLikeFolderId(trimmed)) {
    const folder = assertWorkflowFolder(
      (await client.get(`/v1/folders/${encodeURIComponent(trimmed)}`)) as WorkflowFolderRow,
      trimmed
    );
    return folder;
  }
  const folders = await fetchWorkflowFolders(client, { tree: true });
  const folderId = resolveFolderPathToId(folders, trimmed);
  if (!folderId) {
    throw new Error(`Folder not found: ${trimmed}`);
  }
  const match = folders.find((f) => f.id === folderId);
  if (!match) throw new Error(`Folder not found: ${trimmed}`);
  return match;
}

/**
 * Ensure every segment in `path` exists, creating missing folders via POST.
 * Returns the leaf folder id, or null when `path` is root.
 */
export async function ensureFolderPath(client: ApiClient, path: string): Promise<string | null> {
  const segments = folderPathSegments(path);
  if (segments.length === 0) return null;
  let folders = await fetchWorkflowFolders(client, { tree: true });
  let parentId: string | null = null;
  for (const segment of segments) {
    const decoded = safeDecode(segment);
    let folder = findSiblingFolder(folders, parentId, segment);
    if (!folder) {
      try {
        folder = (await client.post('/v1/folders', {
          name: decoded,
          parentId,
          type: 'workflow',
        })) as WorkflowFolderRow;
        folders = [...folders, folder];
      } catch (err) {
        if (!(err instanceof ApiError) || err.status !== 409) throw err;
        folders = await fetchWorkflowFolders(client, { tree: true });
        folder = findSiblingFolder(folders, parentId, segment);
        if (!folder) throw err;
      }
    }
    parentId = folder.id;
  }
  return parentId;
}
