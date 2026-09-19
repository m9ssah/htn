import { readFileSync } from 'node:fs';

/** Reads and parses a JSON fixture. Shared by every `replay` client. */
export function readFixture<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}
