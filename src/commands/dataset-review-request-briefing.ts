export type DatasetReviewFocusFieldInput = {
  path: string;
  reason?: string | null;
};

export type DatasetReviewItemNoteInput = {
  exampleName: string;
  comment?: string | null;
  fields?: Array<{ path: string; comment: string }>;
};

function splitOnce(value: string, separator: string): [string, string | undefined] {
  const index = value.indexOf(separator);
  if (index < 0) return [value, undefined];
  return [value.slice(0, index), value.slice(index + separator.length)];
}

export function parseFocusReasonFlag(value: string): DatasetReviewFocusFieldInput {
  const [path, reason] = splitOnce(value, '=');
  const trimmedPath = path.trim();
  if (!trimmedPath) {
    throw new Error('--focus-reason requires path=reason');
  }
  const trimmedReason = reason?.trim();
  if (!trimmedReason) {
    throw new Error('--focus-reason requires path=reason');
  }
  return { path: trimmedPath, reason: trimmedReason };
}

export function parseItemNoteFlag(value: string): DatasetReviewItemNoteInput {
  const [exampleName, comment] = splitOnce(value, '=');
  const trimmedName = exampleName.trim();
  const trimmedComment = comment?.trim();
  if (!trimmedName || !trimmedComment) {
    throw new Error('--item-note requires exampleName=comment');
  }
  return { exampleName: trimmedName, comment: trimmedComment };
}

export function parseFieldNoteFlag(value: string): DatasetReviewItemNoteInput {
  const [left, comment] = splitOnce(value, '=');
  const trimmedComment = comment?.trim();
  const dot = left.indexOf('.');
  const exampleName = (dot < 0 ? left : left.slice(0, dot)).trim();
  const path = (dot < 0 ? '' : left.slice(dot + 1)).trim();
  if (!exampleName || !path || !trimmedComment) {
    throw new Error('--field-note requires exampleName.path=comment');
  }
  return { exampleName, fields: [{ path, comment: trimmedComment }] };
}

export function mergeFocusFields(
  paths: readonly string[],
  reasons: readonly DatasetReviewFocusFieldInput[]
): DatasetReviewFocusFieldInput[] {
  const byPath = new Map<string, DatasetReviewFocusFieldInput>();
  for (const path of paths) {
    const trimmed = path.trim();
    if (!trimmed) continue;
    byPath.set(trimmed, { path: trimmed, reason: null });
  }
  for (const field of reasons) {
    byPath.set(field.path, field);
  }
  return [...byPath.values()];
}

export function mergeItemNotes(
  notes: readonly DatasetReviewItemNoteInput[]
): DatasetReviewItemNoteInput[] {
  const byName = new Map<string, DatasetReviewItemNoteInput>();
  for (const note of notes) {
    const current = byName.get(note.exampleName) ?? { exampleName: note.exampleName };
    if (note.comment) current.comment = note.comment;
    if (note.fields?.length) {
      current.fields = [...(current.fields ?? []), ...note.fields];
    }
    byName.set(note.exampleName, current);
  }
  return [...byName.values()];
}

export function parseJsonObjectFlag(raw: string, flag: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`${flag} must be valid JSON`);
  }
}
