import { warn } from './ui';

export function exitDeprecatedCli(message: string): never {
  warn(message);
  process.exit(2);
}
