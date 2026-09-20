import { describe, expect, it } from 'vitest';
import {
  DEVIATION_FACTOR_DESCRIPTIONS,
  DEVIATION_FACTORS,
  buildQuestions,
  buildWireState,
  ROUTES,
  TEMPLATE_DESCRIPTIONS,
} from '../../src/harness/clients/jev-questions.js';

/**
 * Guards against silent drift in the tuned artefact
 * (docs/orchestration-plan.md "The shape" — wording moved accuracy from 1/7
 * to 9/9). Not a re-measurement, just "the 7 questions exist and are
 * well-formed" — changing an instruction string is a measurement, done by
 * re-running the Python probes, not by editing this test to match.
 */
describe('buildQuestions', () => {
  it('asks exactly route, templateId, layout, the 5 style axes, and P2s 3 gap questions', () => {
    const qs = buildQuestions();

    expect(Object.keys(qs).sort()).toEqual(
      [
        'density',
        'deviationFactor',
        'deviationIngredient',
        'fontPairing',
        'layout',
        'motif',
        'palette',
        'radius',
        'route',
        'templateId',
        'wantsStyleChange',
      ].sort(),
    );
  });

  it('every question is a non-empty choice or noul with non-empty option descriptions', () => {
    for (const q of Object.values(buildQuestions())) {
      expect(['choice', 'noul']).toContain(q.type);
      expect(q.instructions.length).toBeGreaterThan(0);
      expect(Object.keys(q.criteria).length).toBeGreaterThan(0);
      for (const desc of Object.values(q.criteria)) expect(desc.length).toBeGreaterThan(0);
    }
  });

  it('route has exactly the 5 routes plus other', () => {
    expect(Object.keys(ROUTES).sort()).toEqual(['correct', 'new_task', 'other', 'query', 'refine', 'select'].sort());
  });

  /**
   * Completeness is already compile-enforced: `TEMPLATE_DESCRIPTIONS` is a
   * `Record<TemplateId, string>`, so adding a template without describing it
   * fails the build. Counting them here only meant editing a number every
   * time the set grew. What is worth asserting is that each description says
   * something — Jev picks from these strings, and an empty one is a template
   * it can never choose on purpose.
   */
  it('every template Jev can pick is actually described to it', () => {
    const entries = Object.entries(TEMPLATE_DESCRIPTIONS);
    expect(entries.length).toBeGreaterThanOrEqual(8);
    for (const [id, description] of entries) {
      expect(description.length, `${id} has no description`).toBeGreaterThan(20);
    }
  });

  it('DEVIATION_FACTORS and its question descriptions cannot drift apart', () => {
    expect(Object.keys(DEVIATION_FACTORS).sort()).toEqual(Object.keys(DEVIATION_FACTOR_DESCRIPTIONS).sort());
  });
});

describe('buildWireState', () => {
  it('maps JevState 1:1 onto the wire state', () => {
    const state = { utterance: 'hi', currentTemplate: 'focus_step' as const, taskState: 'step 2 of 6' };

    expect(buildWireState(state)).toEqual({ utterance: 'hi', currentTemplate: 'focus_step', taskState: 'step 2 of 6' });
  });
});
