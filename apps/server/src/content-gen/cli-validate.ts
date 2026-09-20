#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TrainingRecordEnvelope } from './contract.js';
import { validateContentResult } from './validate.js';

/**
 * `npm run dataset:validate [path]` — the gate before a dataset reaches a
 * training run.
 *
 * Checks two things per record: that it parses as a `ContentTrainingRecord`
 * at all, and that its actual validity (per `validateContentResult`) matches
 * what the record CLAIMS about itself. A record with no `expectRejection`
 * must validate clean; a record with one must fail, and specifically for the
 * rule it names — a rejection record that turns out to be valid, or invalid
 * for the wrong reason, teaches the wrong lesson just as surely as a bad
 * positive example does.
 */

const DEFAULT_PATH = fileURLToPath(
  new URL('../../../../training/content-model/dataset.jsonl', import.meta.url),
);

function main(): void {
  const path = process.argv[2] ?? DEFAULT_PATH;
  const lines = readFileSync(path, 'utf8').split('\n').filter((l) => l.trim().length > 0);

  let failures = 0;
  const ruleCounts = new Map<string, number>();

  lines.forEach((line, index) => {
    const lineNo = index + 1;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      failures += 1;
      console.error(`line ${lineNo}: not valid JSON (${(error as Error).message})`);
      return;
    }

    const record = TrainingRecordEnvelope.safeParse(parsed);
    if (!record.success) {
      failures += 1;
      for (const issue of record.error.issues) {
        console.error(`line ${lineNo}: record shape — ${issue.path.join('.')}: ${issue.message}`);
      }
      return;
    }

    const { request, result, expectRejection } = record.data;
    // Envelope-level only: enough to label console output, not to assume the
    // record is well-formed. `validateContentResult` re-parses both strictly.
    const requestId =
      typeof request === 'object' && request !== null && 'requestId' in request
        ? String((request as { requestId: unknown }).requestId)
        : `line-${lineNo}`;
    const outcome = validateContentResult(request, result);

    if (expectRejection === undefined) {
      if (!outcome.valid) {
        failures += 1;
        console.error(
          `line ${lineNo} [${requestId}]: expected VALID, got violations: ` +
            outcome.violations.map((v) => `${v.rule}${v.elementId ? ` @${v.elementId}` : ''}${v.field ? `.${v.field}` : ''}`).join(', '),
        );
      }
      return;
    }

    ruleCounts.set(expectRejection.rule, (ruleCounts.get(expectRejection.rule) ?? 0) + 1);
    if (outcome.valid) {
      failures += 1;
      console.error(`line ${lineNo} [${requestId}]: expected rejection (${expectRejection.rule}), but validated clean`);
      return;
    }
    const matched = outcome.violations.some((v) => v.rule === expectRejection.rule);
    if (!matched) {
      failures += 1;
      console.error(
        `line ${lineNo} [${requestId}]: expected rejection rule "${expectRejection.rule}", ` +
          `got [${outcome.violations.map((v) => v.rule).join(', ')}]`,
      );
    }
  });

  console.log(`\n${lines.length} records, ${failures} failed`);
  if (ruleCounts.size > 0) {
    console.log('rejection rules exercised:');
    for (const [rule, count] of [...ruleCounts].sort()) console.log(`  ${rule}: ${count}`);
  }

  if (failures > 0) process.exitCode = 1;
}

main();
