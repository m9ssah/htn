import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFixture } from '../../src/harness/clients/fixtures.js';

/**
 * A bare `SyntaxError` from `JSON.parse` names neither the file nor which
 * client hit it — unhelpful the one time a fixture is actually broken.
 */
describe('readFixture', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'jit-fixtures-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('names the file when the fixture is malformed JSON', () => {
    const path = join(dir, 'broken.json');
    writeFileSync(path, '{ not valid json');

    expect(() => readFixture(path)).toThrow(path);
  });
});
