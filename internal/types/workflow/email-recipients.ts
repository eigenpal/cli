export const ACTION_EMAIL_MAX_RECIPIENTS = 10;

export const ACTION_EMAIL_RECIPIENT_LIMIT_MESSAGE = `At most ${ACTION_EMAIL_MAX_RECIPIENTS} recipients combined across to, cc, and bcc`;

function splitRecipientTokens(value: string): string[] {
  const tokens: string[] = [];
  let start = 0;
  let templateClose: '}}' | '%}' | undefined;

  for (let index = 0; index < value.length; index++) {
    if (templateClose) {
      if (value.startsWith(templateClose, index)) {
        index++;
        templateClose = undefined;
      }
      continue;
    }
    if (value.startsWith('{{', index)) {
      templateClose = '}}';
      index++;
      continue;
    }
    if (value.startsWith('{%', index)) {
      templateClose = '%}';
      index++;
      continue;
    }
    if (value[index] === ',') {
      tokens.push(value.slice(start, index));
      start = index + 1;
    }
  }

  tokens.push(value.slice(start));
  return tokens;
}

/**
 * Count deterministically known recipient slots in one authored field value.
 * Comma-separated literals are split; template tokens count as one slot each.
 */
export function countDeterministicEmailRecipients(value: unknown): number {
  if (value === undefined || value === null) return 0;

  const parts = Array.isArray(value) ? value : [value];
  let count = 0;

  for (const part of parts) {
    if (typeof part !== 'string') continue;
    const tokens = splitRecipientTokens(part)
      .map((token) => token.trim())
      .filter((token) => token.length > 0);
    count += tokens.length;
  }

  return count;
}

export interface ActionEmailRecipientFields {
  to?: unknown;
  cc?: unknown;
  bcc?: unknown;
}

/** Combined deterministic recipient count across to, cc, and bcc. */
export function countActionEmailRecipients(fields: ActionEmailRecipientFields): number {
  return (
    countDeterministicEmailRecipients(fields.to) +
    countDeterministicEmailRecipients(fields.cc) +
    countDeterministicEmailRecipients(fields.bcc)
  );
}

export function actionEmailRecipientCountExceedsLimit(fields: ActionEmailRecipientFields): boolean {
  return countActionEmailRecipients(fields) > ACTION_EMAIL_MAX_RECIPIENTS;
}
