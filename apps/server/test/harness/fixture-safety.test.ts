import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A recorded fixture holds the raw wire *response*, never the request — so
 * it should never contain the `Authorization` header or the key itself. This
 * is the assertion, not just an assumption, because a future recorder that
 * accidentally logs the request alongside the response would otherwise land
 * a key in git silently.
 */
const FIXTURES_DIR = join(import.meta.dirname, '../../fixtures/jev');

function jsonFilesIn(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => join(entry.parentPath, entry.name));
}

describe('recorded Jev fixtures', () => {
  const files = jsonFilesIn(FIXTURES_DIR);

  it('found at least one fixture to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s contains no Authorization header or key material', (file) => {
    const text = readFileSync(file, 'utf8');
    expect(text).not.toMatch(/authorization/i);
    expect(text).not.toMatch(/bearer\s/i);
    expect(text).not.toMatch(/TYPESAFE_API_KEY/);
  });
});
