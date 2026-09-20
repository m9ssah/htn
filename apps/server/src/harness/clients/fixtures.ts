import { readFileSync } from 'node:fs';

/** Reads and parses a JSON fixture. Shared by every `replay` client. */
export function readFixture<T>(path: string): T {
  const text = readFileSync(path, 'utf8');
  try {
    return JSON.parse(text) as T;
  } catch (cause) {
    // A bare SyntaxError here names neither the file nor which client hit
    // it — unhelpful the one time a fixture is actually broken.
    throw new Error(`readFixture: malformed JSON in ${path}`, { cause });
  }
}
