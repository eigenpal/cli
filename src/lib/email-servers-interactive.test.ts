import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

const promptCalls: Array<{ message: string }> = [];
const passwordMock = mock(async ({ message }: { message: string }) => {
  promptCalls.push({ message });
  return 'tty-secret-value';
});

mock.module('@clack/prompts', () => ({
  password: passwordMock,
  isCancel: () => false,
  cancel: mock(() => {}),
}));

import { buildCreateRequest, buildUpdateRequest } from './email-servers-cli';

const SMTP_EXISTING = {
  transport: 'smtp' as const,
  host: 'smtp.example.com',
  username: 'mailer',
  passwordConfigured: true,
};

async function withTty(fn: () => void | Promise<void>): Promise<void> {
  const stdinDesc = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  const stdoutDesc = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
  Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
  Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
  try {
    await fn();
  } finally {
    if (stdinDesc) Object.defineProperty(process.stdin, 'isTTY', stdinDesc);
    else delete (process.stdin as { isTTY?: boolean }).isTTY;
    if (stdoutDesc) Object.defineProperty(process.stdout, 'isTTY', stdoutDesc);
    else delete (process.stdout as { isTTY?: boolean }).isTTY;
  }
}

describe('email-servers CLI interactive secrets', () => {
  beforeEach(() => {
    promptCalls.length = 0;
    passwordMock.mockClear();
  });

  afterEach(() => {
    passwordMock.mockClear();
  });

  test('buildCreateRequest prompts for SMTP password before schema validation when username is set', async () => {
    await withTty(async () => {
      const body = await buildCreateRequest({
        name: 'Corp SMTP',
        transport: 'smtp',
        host: 'smtp.example.com',
        fromEmail: 'noreply@example.com',
        fromName: 'Eigenpal',
        username: 'mailer',
      });
      expect(passwordMock).toHaveBeenCalledTimes(1);
      expect(promptCalls[0]?.message).toContain('password');
      expect(body).toMatchObject({
        transport: 'smtp',
        username: 'mailer',
        password: 'tty-secret-value',
      });
    });
  });

  test('buildUpdateRequest prompts for Resend API key before transport compatibility validation', async () => {
    await withTty(async () => {
      const patch = await buildUpdateRequest({
        existing: SMTP_EXISTING,
        opts: {
          transport: 'resend',
          fromEmail: 'alerts@example.com',
          fromName: 'Alerts',
        },
      });
      expect(passwordMock).toHaveBeenCalledTimes(1);
      expect(promptCalls[0]?.message).toContain('api-key');
      expect(patch).toMatchObject({
        transport: 'resend',
        apiKey: 'tty-secret-value',
      });
    });
  });

  test('buildUpdateRequest prompts for a fresh password when the SMTP destination changes', async () => {
    await withTty(async () => {
      const patch = await buildUpdateRequest({
        existing: SMTP_EXISTING,
        opts: {
          transport: 'smtp',
          host: 'smtp.other.example.com',
          port: 587,
          security: 'starttls',
          fromEmail: 'alerts@example.com',
          fromName: 'Alerts',
        },
      });
      expect(passwordMock).toHaveBeenCalledTimes(1);
      expect(promptCalls[0]?.message).toContain('password');
      expect(patch).toMatchObject({
        transport: 'smtp',
        host: 'smtp.other.example.com',
        password: 'tty-secret-value',
      });
    });
  });

  test('buildCreateRequest requires password flags off TTY when username is set', async () => {
    if (process.stdin.isTTY && process.stdout.isTTY) return;
    await expect(
      buildCreateRequest({
        name: 'Corp SMTP',
        transport: 'smtp',
        host: 'smtp.example.com',
        fromEmail: 'noreply@example.com',
        fromName: 'Eigenpal',
        username: 'mailer',
      })
    ).rejects.toThrow(/--password-stdin|password is required in noninteractive/i);
    expect(passwordMock).not.toHaveBeenCalled();
  });

  test('buildUpdateRequest requires api-key flags off TTY when switching SMTP to Resend', async () => {
    if (process.stdin.isTTY && process.stdout.isTTY) return;
    await expect(
      buildUpdateRequest({
        existing: SMTP_EXISTING,
        opts: {
          transport: 'resend',
          fromEmail: 'alerts@example.com',
          fromName: 'Alerts',
        },
      })
    ).rejects.toThrow(/--api-key-stdin|api-key is required in noninteractive/i);
    expect(passwordMock).not.toHaveBeenCalled();
  });
});
