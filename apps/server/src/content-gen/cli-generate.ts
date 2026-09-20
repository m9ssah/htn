#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { synthesize } from './synthesize.js';
import { LOCALES } from './scenarios.js';
import { CATALOG } from './catalog.js';

/**
 * `npm run dataset:generate` — writes the Stage 2 training set.
 *
 * Deterministic: no randomness, no network, no model call. Re-running this
 * produces byte-identical output (modulo the shuffle seed below), which is
 * what lets the dataset live in the repo as a reviewable diff rather than as a
 * binary blob someone has to trust.
 */

const OUT = fileURLToPath(new URL('../../../../training/content-model/dataset.jsonl', import.meta.url));

/** Fixed seed — reproducible shuffling, not cryptographic. */
function shuffle<T>(items: T[], seed = 42): T[] {
  const out = [...items];
  let s = seed;
  for (let i = out.length - 1; i > 0; i -= 1) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Every leaf kind with at least one generatable field — the only ones that can ever produce a Stage 2 target. */
const EXPECTED_LEAF_KINDS = Object.entries(CATALOG)
  .filter(([, entry]) => entry.generatable.length > 0)
  .map(([kind]) => kind);

function main(): void {
  const { records, coverage } = synthesize();
  const ordered = shuffle(records);

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, ordered.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');

  const missingLeafKinds = EXPECTED_LEAF_KINDS.filter((k) => !coverage.leafKinds.has(k));
  const missingLocales = LOCALES.filter((l) => !coverage.locales.has(l));

  console.log(`wrote ${ordered.length} records to ${OUT}`);
  console.log(`  leaf kinds covered:   ${coverage.leafKinds.size}/${EXPECTED_LEAF_KINDS.length}`);
  console.log(`  locales covered:      ${coverage.locales.size}/${LOCALES.length}`);
  console.log(`  rejection rules:      ${coverage.rejectionRules.size}`);
  console.log(`  optional present:     ${coverage.sawOptionalPresent}`);
  console.log(`  optional omitted:     ${coverage.sawOptionalOmitted}`);
  console.log(`  length boundary:      ${coverage.sawLengthBoundary}`);
  console.log(
    `  never generates (Bars, Progress — zero generatable fields, by design): ` +
      `${Object.entries(CATALOG).filter(([, e]) => e.generatable.length === 0).map(([k]) => k).join(', ')}`,
  );

  if (missingLeafKinds.length > 0 || missingLocales.length > 0) {
    console.error(`\nCOVERAGE GAP — leaf kinds missing: [${missingLeafKinds.join(', ')}], locales missing: [${missingLocales.join(', ')}]`);
    process.exitCode = 1;
  }
}

main();
