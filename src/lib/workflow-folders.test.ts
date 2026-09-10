import { describe, expect, test } from 'bun:test';
import { ApiError, type ApiClient } from './client';
import {
  buildFolderTree,
  ensureFolderPath,
  folderIdToPath,
  folderPathSegments,
  looksLikeFolderId,
  normalizeFolderPathInput,
  renderFolderTreeLines,
  resolveFolderPathToId,
  resolveWorkflowFolderRef,
} from './workflow-folders';

test('recognizes canonical folder ids', () => {
  expect(looksLikeFolderId('fldr_billing')).toBe(true);
  expect(looksLikeFolderId('fld_billing')).toBe(false);
});

describe('normalizeFolderPathInput', () => {
  test('treats slash-only paths as root', () => {
    expect(normalizeFolderPathInput('/')).toBe('/');
    expect(normalizeFolderPathInput('  /  ')).toBe('/');
  });

  test('trims leading and trailing slashes', () => {
    expect(normalizeFolderPathInput('/billing/invoices/')).toBe('billing/invoices');
  });
});

describe('folderPathSegments', () => {
  test('returns empty segments for root', () => {
    expect(folderPathSegments('/')).toEqual([]);
  });

  test('splits nested paths', () => {
    expect(folderPathSegments('billing/invoices')).toEqual(['billing', 'invoices']);
  });
});

describe('resolveFolderPathToId', () => {
  const folders = [
    { id: 'fldr_billing', name: 'billing', parentId: null, type: 'workflow' as const },
    {
      id: 'fldr_invoices',
      name: 'customer invoices',
      parentId: 'fldr_billing',
      type: 'workflow' as const,
    },
  ];

  test('resolves a nested path by segment names', () => {
    expect(resolveFolderPathToId(folders, 'billing/customer invoices')).toBe('fldr_invoices');
  });

  test('returns null when a segment is missing', () => {
    expect(resolveFolderPathToId(folders, 'billing/missing')).toBeNull();
  });
});

describe('folderIdToPath', () => {
  const folders = [
    { id: 'fldr_billing', name: 'billing', parentId: null, type: 'workflow' as const },
    {
      id: 'fldr_invoices',
      name: 'invoices',
      parentId: 'fldr_billing',
      type: 'workflow' as const,
    },
  ];

  test('builds a slash path from a folder id', () => {
    expect(folderIdToPath(folders, 'fldr_invoices')).toBe('billing/invoices');
    expect(folderIdToPath(folders, null)).toBe('/');
  });
});

describe('renderFolderTreeLines', () => {
  test('renders nested folders with ids', () => {
    const tree = buildFolderTree([
      {
        id: 'fldr_a',
        name: 'billing',
        parentId: null,
        type: 'workflow',
        workflowCount: 2,
      },
      {
        id: 'fldr_b',
        name: 'invoices',
        parentId: 'fldr_a',
        type: 'workflow',
        workflowCount: 0,
      },
    ]);
    const lines = renderFolderTreeLines(tree);
    expect(lines.join('\n')).toContain('billing (fldr_a)');
    expect(lines.join('\n')).toContain('invoices (fldr_b)');
  });
});

describe('resolveWorkflowFolderRef', () => {
  test('rejects template folders resolved by id', async () => {
    const client = {
      get: async (path: string) => {
        if (path === '/v1/folders/fldr_template') {
          return { id: 'fldr_template', name: 'Templates', parentId: null, type: 'template' };
        }
        throw new Error(`unexpected GET ${path}`);
      },
    };
    await expect(
      resolveWorkflowFolderRef(client as unknown as ApiClient, 'fldr_template')
    ).rejects.toThrow('Folder is not a workflow folder: fldr_template');
  });
});

describe('ensureFolderPath', () => {
  test('refetches and resolves a sibling after a concurrent create returns 409', async () => {
    let postCalls = 0;
    let listCalls = 0;
    const existing = {
      id: 'fldr_billing',
      name: 'billing',
      parentId: null,
      type: 'workflow' as const,
    };
    const client = {
      get: async (path: string, params?: Record<string, string>) => {
        if (path === '/v1/folders' && params?.tree === 'true') {
          listCalls += 1;
          return listCalls === 1 ? [] : [existing];
        }
        throw new Error(`unexpected GET ${path}`);
      },
      post: async () => {
        postCalls += 1;
        throw new ApiError(409, { error: 'Folder name already exists' });
      },
    };

    const folderId = await ensureFolderPath(client as unknown as ApiClient, 'billing');

    expect(folderId).toBe('fldr_billing');
    expect(postCalls).toBe(1);
    expect(listCalls).toBe(2);
  });

  test('rethrows non-409 errors from folder creation', async () => {
    const client = {
      get: async (path: string, params?: Record<string, string>) => {
        if (path === '/v1/folders' && params?.tree === 'true') return [];
        throw new Error(`unexpected GET ${path}`);
      },
      post: async () => {
        throw new ApiError(400, { error: 'Invalid folder name' });
      },
    };

    await expect(
      ensureFolderPath(client as unknown as ApiClient, 'billing')
    ).rejects.toBeInstanceOf(ApiError);
  });
});
