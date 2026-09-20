import { describe, expect, it } from 'vitest';
import { CATALOG } from '../src/content-gen/catalog.js';
import { LOCALES, SCENARIO_BUILDERS } from '../src/content-gen/scenarios.js';
import { synthesize } from '../src/content-gen/synthesize.js';
import { validateContentResult } from '../src/content-gen/validate.js';
import { ContentGenerationRequestV1, ContentGenerationResultV1 } from '../src/content-gen/contract.js';

/**
 * Guards against the exact class of bug this module actually shipped with
 * while being built: a hand-authored string quietly exceeding the length it
 * claims to fit, and a corruptor whose own bookkeeping erased the corruption
 * it existed to produce. Both passed a casual read; neither passes this file.
 */

const EXPECTED_LEAF_KINDS = Object.entries(CATALOG)
  .filter(([, entry]) => entry.generatable.length > 0)
  .map(([kind]) => kind)
  .sort();

describe('scenario authoring', () => {
  it('never exceeds — or falls under — the length constraint it declares', () => {
    for (const [name, build] of Object.entries(SCENARIO_BUILDERS)) {
      for (const locale of LOCALES) {
        const { request, result } = build(locale, 'probe');
        for (const target of request.targets) {
          const values = result.values[target.elementId];
          if (!values) continue;
          for (const field of target.fields) {
            const value = values[field.name];
            if (typeof value !== 'string') continue;
            const c = field.constraints;
            if (c?.minLength !== undefined) {
              expect(value.length, `${name}/${locale}/${target.elementId}.${field.name}`).toBeGreaterThanOrEqual(c.minLength);
            }
            if (c?.maxLength !== undefined) {
              expect(value.length, `${name}/${locale}/${target.elementId}.${field.name}`).toBeLessThanOrEqual(c.maxLength);
            }
          }
        }
      }
    }
  });

  it('only ever generates fields the catalog says are generatable', () => {
    for (const build of Object.values(SCENARIO_BUILDERS)) {
      for (const locale of LOCALES) {
        const { request } = build(locale, 'probe');
        for (const target of request.targets) {
          const allowed = new Set(CATALOG[target.component].generatable.map((f) => f.name));
          for (const field of target.fields) {
            expect(allowed.has(field.name), `${target.component}.${field.name}`).toBe(true);
          }
        }
      }
    }
  });

  it('every base scenario pair is itself schema-valid', () => {
    for (const build of Object.values(SCENARIO_BUILDERS)) {
      for (const locale of LOCALES) {
        const { request, result } = build(locale, 'probe');
        expect(ContentGenerationRequestV1.safeParse(request).success, locale).toBe(true);
        expect(ContentGenerationResultV1.safeParse(result).success, locale).toBe(true);
      }
    }
  });
});

describe('catalog', () => {
  it('gives Bars and Progress zero generatable fields — they never produce a Stage 2 target', () => {
    expect(CATALOG.Bars.generatable).toEqual([]);
    expect(CATALOG.Progress.generatable).toEqual([]);
    expect(CATALOG.Bars.fixedOnly).toContain('values');
    expect(CATALOG.Progress.fixedOnly).toContain('pct');
  });

  it('never lists the same field as both generatable and fixed-only', () => {
    for (const [component, entry] of Object.entries(CATALOG)) {
      const generatable = new Set(entry.generatable.map((f) => f.name));
      const overlap = entry.fixedOnly.filter((f) => generatable.has(f));
      expect(overlap, component).toEqual([]);
    }
  });
});

describe('synthesize', () => {
  const { records, coverage } = synthesize();

  it('covers every leaf kind that can ever appear in a Stage 2 target', () => {
    expect([...coverage.leafKinds].sort()).toEqual(EXPECTED_LEAF_KINDS);
  });

  it('covers every locale', () => {
    expect(coverage.locales.size).toBe(LOCALES.length);
  });

  it('exercises both states of an optional field', () => {
    expect(coverage.sawOptionalPresent).toBe(true);
    expect(coverage.sawOptionalOmitted).toBe(true);
  });

  it('exercises a length boundary', () => {
    expect(coverage.sawLengthBoundary).toBe(true);
  });

  it('produces at least one example of every rejection rule the corruptors implement', () => {
    expect(coverage.rejectionRules.size).toBeGreaterThanOrEqual(9);
  });

  it('gives every record a unique requestId, even the deliberately mismatched ones', () => {
    const ids = records.map((r) => r.request.requestId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('produces only records whose actual validity matches what they claim', () => {
    // This is the test that would have caught every bug this module shipped
    // with: a valid-looking record that is secretly invalid, or a rejection
    // record whose corruption got erased by later bookkeeping.
    let checked = 0;
    for (const record of records) {
      const outcome = validateContentResult(record.request, record.result);
      if (record.expectRejection === undefined) {
        expect(outcome.valid, `${record.request.requestId} expected valid`).toBe(true);
      } else {
        expect(outcome.valid, `${record.request.requestId} expected invalid`).toBe(false);
        expect(
          outcome.violations.map((v) => v.rule),
          `${record.request.requestId} expected rule ${record.expectRejection.rule}`,
        ).toContain(record.expectRejection.rule);
      }
      checked += 1;
    }
    expect(checked).toBeGreaterThan(500);
  });
});

describe('validateContentResult', () => {
  const base = SCENARIO_BUILDERS['cookie_recipe']!('en-US', 'r1');

  it('accepts a clean result', () => {
    expect(validateContentResult(base.request, base.result).valid).toBe(true);
  });

  it('rejects a value for an element nobody asked about', () => {
    const outcome = validateContentResult(base.request, {
      ...base.result,
      values: { ...base.result.values, ghost: { text: 'hi' } },
    });
    expect(outcome.valid).toBe(false);
    expect(outcome.violations.map((v) => v.rule)).toContain('unrequested_element');
  });

  it('rejects a business-fact field the model was never asked to generate', () => {
    const outcome = validateContentResult(base.request, {
      ...base.result,
      values: { ...base.result.values, 'ing-1': { ...base.result.values['ing-1'], meta: '9 cups' } },
    });
    expect(outcome.valid).toBe(false);
    expect(outcome.violations.map((v) => v.rule)).toContain('generated_a_fixed_only_field');
  });

  it('flags markdown even when the value is otherwise perfectly valid', () => {
    const outcome = validateContentResult(base.request, {
      ...base.result,
      values: { ...base.result.values, title: { text: '**Classic Chocolate Chip**' } },
    });
    expect(outcome.violations.map((v) => v.rule)).toContain('markdown_or_explanatory_wrapper');
  });

  it('does not flag ordinary punctuation as markdown', () => {
    const outcome = validateContentResult(base.request, {
      ...base.result,
      values: { ...base.result.values, title: { text: "Alex's favorite — 30% more chips!" } },
    });
    expect(outcome.violations.map((v) => v.rule)).not.toContain('markdown_or_explanatory_wrapper');
  });

  it('does not require an optional field to be present', () => {
    const values = { ...base.result.values };
    delete values['preview'];
    const outcome = validateContentResult(base.request, { ...base.result, values });
    expect(outcome.valid).toBe(true);
  });

  it('rejects null in place of an omitted optional field', () => {
    const outcome = validateContentResult(base.request, {
      ...base.result,
      values: { ...base.result.values, preview: { caption: null as never } },
    });
    expect(outcome.valid).toBe(false);
    expect(outcome.violations.map((v) => v.rule)).toContain('null_instead_of_omitted');
  });

  it('rejects a result whose catalogVersion disagrees with the request', () => {
    const outcome = validateContentResult(base.request, {
      ...base.result,
      catalogVersion: 'jit-device.v1',
    });
    expect(outcome.valid).toBe(false);
    expect(outcome.violations.map((v) => v.rule)).toContain('catalog_version_mismatch');
  });
});
