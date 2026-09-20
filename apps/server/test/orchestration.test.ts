import { describe, expect, it } from 'vitest';
import { STUDY_SESSION_EXAMPLE } from '@jit/renderer';
import { deriveContentRequest, validateContentResult } from '../src/orchestration.js';

describe('Stage 2 content contract', () => {
  it('derives targets only after Stage 1 has selected the concrete spec', () => {
    const request = deriveContentRequest({
      requestId: 'study-session-planner',
      locale: 'en-CA',
      intent: STUDY_SESSION_EXAMPLE.intent,
      context: { audience: 'student' },
      spec: STUDY_SESSION_EXAMPLE.structure.spec,
    });

    expect(request.targets.map((target) => target.elementId)).toContain('title');
    expect(request.targets.map((target) => target.elementId)).toContain('duration');
    expect(request.targets.map((target) => target.elementId)).not.toContain('stack');
    expect(request.targets.find((target) => target.elementId === 'duration')?.fields.map((field) => field.name)).toEqual(['label']);
  });

  it('rejects extra targets, fields, and values outside the declared contract', () => {
    const request = deriveContentRequest({
      requestId: 'study-session-planner', locale: 'en-CA', intent: STUDY_SESSION_EXAMPLE.intent, context: {}, spec: STUDY_SESSION_EXAMPLE.structure.spec,
    });
    const values = Object.fromEntries(request.targets.map((target) => [target.elementId, Object.fromEntries(target.fields.filter((field) => field.required).map((field) => [field.name, 'valid']))]));
    expect(() => validateContentResult(request, { contract: 'jit.content.result.v1', requestId: request.requestId, catalogVersion: request.catalogVersion, values: { ...values, extra: { text: 'no' } } })).toThrow('unrequested element');
    expect(() => validateContentResult(request, { contract: 'jit.content.result.v1', requestId: request.requestId, catalogVersion: request.catalogVersion, values: { ...values, title: { text: 'valid', surprise: 'no' } } })).toThrow('unrequested field');
  });
});
