import type { ContentTrainingRecord } from './contract.js';
import { CATALOG } from './catalog.js';
import { LOCALES, SCENARIO_BUILDERS, type Locale, type ScenarioPair } from './scenarios.js';

/**
 * Expands the six hand-authored scenarios into the training set.
 *
 * Three passes, in order: (1) the base valid pairs, one per scenario per
 * locale; (2) mechanical VALID variants — optional fields present vs omitted,
 * text sitting exactly at a length boundary — because these are shape
 * coverage, not content, and belong in code rather than in six more
 * hand-written scripts; (3) mechanical INVALID variants, one rule violated per
 * record, each tagged with which rule it is meant to trip.
 *
 * The result is deliberately not shuffled or deduplicated here — `write.ts`
 * does that once, at the point the JSONL is actually emitted, so a caller
 * asking only for coverage stats gets a stable, inspectable order.
 */

let counter = 0;
const nextId = (prefix: string): string => `${prefix}-${(counter += 1).toString(36)}`;

export type Coverage = {
  leafKinds: Set<string>;
  locales: Set<Locale>;
  rejectionRules: Set<string>;
  sawOptionalPresent: boolean;
  sawOptionalOmitted: boolean;
  sawLengthBoundary: boolean;
};

const newCoverage = (): Coverage => ({
  leafKinds: new Set(),
  locales: new Set(),
  rejectionRules: new Set(),
  sawOptionalPresent: false,
  sawOptionalOmitted: false,
  sawLengthBoundary: false,
});

function track(coverage: Coverage, record: ContentTrainingRecord): void {
  coverage.locales.add(record.request.locale as Locale);
  for (const target of record.request.targets) coverage.leafKinds.add(target.component);
  if (record.expectRejection) coverage.rejectionRules.add(record.expectRejection.rule);
}

/* ------------------------------------------------------------------ *
 * Pass 1 — base pairs
 * ------------------------------------------------------------------ */

function baseRecords(): ContentTrainingRecord[] {
  const out: ContentTrainingRecord[] = [];
  for (const build of Object.values(SCENARIO_BUILDERS)) {
    for (const locale of LOCALES) {
      const id = nextId('req');
      const { request, result } = build(locale, id);
      out.push({ request, result });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Pass 2 — valid shape variants
 * ------------------------------------------------------------------ */

/** Fits a string to an exact length. Synthetic filler, not natural copy — only the length matters here. */
function fitToLength(value: string, length: number): string {
  if (value.length === length) return value;
  if (value.length > length) return value.slice(0, length);
  const pad = ' ·'.repeat(Math.ceil((length - value.length) / 2));
  return (value + pad).slice(0, length);
}

/** One optional-field-omitted variant per target that has an optional field with a value present. */
function optionalOmissionVariants(base: ContentTrainingRecord[]): ContentTrainingRecord[] {
  const out: ContentTrainingRecord[] = [];
  for (const record of base) {
    for (const target of record.request.targets) {
      const optionalField = target.fields.find((f) => !f.required);
      if (!optionalField) continue;
      const current = record.result.values[target.elementId];
      if (!current || !(optionalField.name in current)) continue;

      const id = nextId('opt-omit');
      const values = { ...record.result.values };
      const { [optionalField.name]: _dropped, ...rest } = current;
      values[target.elementId] = rest;
      out.push({
        request: { ...record.request, requestId: id },
        result: { ...record.result, requestId: id, values },
      });
    }
  }
  return out;
}

/** One exactly-at-the-limit variant per target that has a maxLength constraint. */
function lengthBoundaryVariants(base: ContentTrainingRecord[]): ContentTrainingRecord[] {
  const out: ContentTrainingRecord[] = [];
  for (const record of base) {
    for (const target of record.request.targets) {
      const field = target.fields.find((f) => f.constraints?.maxLength !== undefined);
      if (!field?.constraints?.maxLength) continue;
      const current = record.result.values[target.elementId]?.[field.name];
      if (typeof current !== 'string') continue;

      const id = nextId('len-edge');
      const values = { ...record.result.values };
      values[target.elementId] = {
        ...values[target.elementId],
        [field.name]: fitToLength(current, field.constraints.maxLength),
      };
      out.push({
        request: { ...record.request, requestId: id },
        result: { ...record.result, requestId: id, values },
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Pass 3 — rejection variants
 *
 * Each corruptor breaks exactly one rule so a training or eval consumer can
 * attribute a rejection to a single cause. Real model output will not fail
 * this cleanly, but a dataset that conflates two violations per bad example
 * cannot teach — or test — either one.
 * ------------------------------------------------------------------ */

type Corruptor = (pair: ScenarioPair) => {
  pair: ScenarioPair;
  rule: string;
  elementId?: string;
  field?: string;
  /**
   * Set when the corruption IS a request/result id mismatch. The final pass
   * below normally rewrites both ids to a fresh, collision-free value — which
   * would silently repair this one corruption by making them match again.
   */
  keepIds?: boolean;
} | null;

const firstTextTarget = (pair: ScenarioPair) =>
  pair.request.targets.find((t) => {
    const v = pair.result.values[t.elementId];
    return v && Object.values(v).some((x) => typeof x === 'string');
  });

const CORRUPTORS: Corruptor[] = [
  // 1. A required field goes missing from the result entirely.
  (pair) => {
    const target = pair.request.targets.find((t) => t.fields.some((f) => f.required));
    if (!target) return null;
    const field = target.fields.find((f) => f.required)!;
    const values = { ...pair.result.values };
    const { [field.name]: _drop, ...rest } = values[target.elementId] ?? {};
    values[target.elementId] = rest;
    return {
      pair: { request: pair.request, result: { ...pair.result, values } },
      rule: 'missing_required_field',
      elementId: target.elementId,
      field: field.name,
    };
  },

  // 2. A value for an element nobody asked about.
  (pair) => {
    const values = { ...pair.result.values, 'ghost-element-not-in-targets': { text: 'unrequested' } };
    return {
      pair: { request: pair.request, result: { ...pair.result, values } },
      rule: 'unrequested_element',
      elementId: 'ghost-element-not-in-targets',
    };
  },

  // 3. A string field comes back as a number.
  (pair) => {
    const target = firstTextTarget(pair);
    if (!target) return null;
    const field = target.fields[0]!;
    const values = { ...pair.result.values, [target.elementId]: { ...pair.result.values[target.elementId], [field.name]: 42 } };
    return {
      pair: { request: pair.request, result: { ...pair.result, values } },
      rule: 'wrong_type',
      elementId: target.elementId,
      field: field.name,
    };
  },

  // 4. A value one character past its declared maxLength.
  (pair) => {
    const target = pair.request.targets.find((t) => t.fields.some((f) => f.constraints?.maxLength));
    if (!target) return null;
    const field = target.fields.find((f) => f.constraints?.maxLength)!;
    const current = pair.result.values[target.elementId]?.[field.name];
    if (typeof current !== 'string') return null;
    const tooLong = fitToLength(current, field.constraints!.maxLength!) + 'X';
    const values = { ...pair.result.values, [target.elementId]: { ...pair.result.values[target.elementId], [field.name]: tooLong } };
    return {
      pair: { request: pair.request, result: { ...pair.result, values } },
      rule: 'exceeds_max_length',
      elementId: target.elementId,
      field: field.name,
    };
  },

  // 5. The result claims to answer a different request. Marked `keepIds` so the
  // final pass gives the REQUEST a fresh, unique id (as it does for every other
  // rejection) while still deliberately NOT applying that same id to the
  // result — the mismatch this record exists to demonstrate.
  (pair) => ({
    pair: { request: pair.request, result: { ...pair.result, requestId: `${pair.result.requestId}-mismatched` } },
    rule: 'request_id_mismatch',
    keepIds: true,
  }),

  // 6. The result was generated against a catalog Stage 2 is not running.
  (pair) => ({
    pair: {
      request: pair.request,
      result: { ...pair.result, catalogVersion: 'jit-device.v1' as never },
    },
    rule: 'catalog_version_mismatch',
  }),

  // 7. Prose wrapper instead of the bare value — "no Markdown or explanatory wrapper".
  (pair) => {
    const target = firstTextTarget(pair);
    if (!target) return null;
    const field = target.fields[0]!;
    const current = pair.result.values[target.elementId]?.[field.name];
    if (typeof current !== 'string') return null;
    const wrapped = `**${current}**\n\nHere is the requested text.`;
    const values = { ...pair.result.values, [target.elementId]: { ...pair.result.values[target.elementId], [field.name]: wrapped } };
    return {
      pair: { request: pair.request, result: { ...pair.result, values } },
      rule: 'markdown_or_explanatory_wrapper',
      elementId: target.elementId,
      field: field.name,
    };
  },

  // 8. `null` where an omitted key was required instead.
  (pair) => {
    const target = pair.request.targets.find((t) => t.fields.some((f) => !f.required));
    if (!target) return null;
    const field = target.fields.find((f) => !f.required)!;
    const values = { ...pair.result.values, [target.elementId]: { ...pair.result.values[target.elementId], [field.name]: null as never } };
    return {
      pair: { request: pair.request, result: { ...pair.result, values } },
      rule: 'null_instead_of_omitted',
      elementId: target.elementId,
      field: field.name,
    };
  },

  // 9. A business fact Stage 2 was never given permission to touch.
  (pair) => {
    const target = pair.request.targets.find((t) => {
      const entry = CATALOG[t.component];
      return entry.fixedOnly.length > 0;
    });
    if (!target) return null;
    const fixedField = CATALOG[target.component].fixedOnly[0]!;
    const values = { ...pair.result.values, [target.elementId]: { ...pair.result.values[target.elementId], [fixedField]: 'a value the model invented' } };
    return {
      pair: { request: pair.request, result: { ...pair.result, values } },
      rule: 'generated_a_fixed_only_field',
      elementId: target.elementId,
      field: fixedField,
    };
  },
];

function rejectionVariants(base: ContentTrainingRecord[]): ContentTrainingRecord[] {
  const out: ContentTrainingRecord[] = [];
  // One corruptor per base record, cycling, so every rule gets applied across
  // several different domains and locales rather than to a single example.
  base.forEach((record, i) => {
    const corrupt = CORRUPTORS[i % CORRUPTORS.length]!;
    const outcome = corrupt({ request: record.request, result: record.result });
    if (!outcome) return;

    if (outcome.keepIds) {
      // Give the request a fresh, dataset-unique id like every other rejection
      // record — but derive the result's id from the PRE-rewrite result id, not
      // from the new request id, so the two stay exactly as mismatched as the
      // corruptor made them. Reusing the fresh id on both would repair the
      // corruption by construction.
      const id = nextId('reject');
      const resultId = outcome.pair.result.requestId.replace(outcome.pair.request.requestId, id);
      out.push({
        request: { ...outcome.pair.request, requestId: id },
        result: { ...outcome.pair.result, requestId: resultId },
        expectRejection: { rule: outcome.rule, elementId: outcome.elementId, field: outcome.field },
      });
      return;
    }

    const id = nextId('reject');
    out.push({
      request: { ...outcome.pair.request, requestId: id },
      result: { ...outcome.pair.result, requestId: id },
      expectRejection: { rule: outcome.rule, elementId: outcome.elementId, field: outcome.field },
    });
  });
  return out;
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

export function synthesize(): { records: ContentTrainingRecord[]; coverage: Coverage } {
  const base = baseRecords();
  const optional = optionalOmissionVariants(base);
  const boundary = lengthBoundaryVariants(base);
  const rejected = rejectionVariants([...base, ...optional, ...boundary]);

  const coverage = newCoverage();
  coverage.sawOptionalPresent = base.some((r) =>
    r.request.targets.some((t) => {
      const v = r.result.values[t.elementId];
      return t.fields.some((f) => !f.required && v && f.name in v);
    }),
  );
  coverage.sawOptionalOmitted = optional.length > 0;
  coverage.sawLengthBoundary = boundary.length > 0;

  const all = [...base, ...optional, ...boundary, ...rejected];
  for (const record of all) track(coverage, record);

  return { records: all, coverage };
}
