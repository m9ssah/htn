import type { ContentGenerationRequestV1, ContentGenerationResultV1 } from './contract.js';
import { LOCALES, SCENARIO_BUILDERS } from './scenarios.js';

/**
 * The deterministic Stage 2 adapter for local dev, the harness, and tests —
 * no network, no model, no API key. It answers a request by finding the
 * scenario whose SHAPE it matches (same elements, same components, same
 * locale) and returning that scenario's hand-authored result, restamped with
 * the caller's actual `requestId`.
 *
 * This is not a mock of the fine-tuned model's behaviour — it is a stand-in
 * for "Stage 2 ran and produced a valid answer," useful anywhere the rest of
 * the pipeline needs something real to render while the trained model is not
 * yet wired up. It never fabricates content for a shape it doesn't recognise;
 * it throws, loudly, per constraint 6 (no silent fallback that hides a
 * failure) — a caller that wants graceful degradation implements that itself.
 */

export class UnknownFixtureShapeError extends Error {
  constructor(requestId: string) {
    super(
      `No fixture scenario matches the shape of request "${requestId}". ` +
        'The fixture adapter only answers requests shaped like the six seed ' +
        'scenarios in scenarios.ts — add one, or use the real content model.',
    );
    this.name = 'UnknownFixtureShapeError';
  }
}

/** The identity of a target that must match for a fixture to apply: which elements, which components, in which order. */
function shapeKey(request: ContentGenerationRequestV1): string {
  return request.targets.map((t) => `${t.elementId}:${t.component}`).join('|');
}

export function fixtureContentAdapter(
  request: ContentGenerationRequestV1,
): ContentGenerationResultV1 {
  const wantShape = shapeKey(request);
  const locale = (LOCALES as readonly string[]).includes(request.locale)
    ? (request.locale as (typeof LOCALES)[number])
    : LOCALES[0];

  for (const build of Object.values(SCENARIO_BUILDERS)) {
    const candidate = build(locale, request.requestId);
    if (shapeKey(candidate.request) === wantShape) {
      return { ...candidate.result, requestId: request.requestId, catalogVersion: request.catalogVersion };
    }
  }

  throw new UnknownFixtureShapeError(request.requestId);
}
