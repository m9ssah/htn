import type { ContentGenerationRequestV1 } from '@jit/schema';
import type { ContentSource } from '../types.js';

/**
 * The seam the `content` node generates through.
 *
 * `ContentSource` streams lines of text; the json-render contract wants one
 * `jit.content.result.v1` object validated against the request that produced
 * it. This is the adapter between them, and nothing more — it does NOT
 * validate. Validation is `contract/content.ts`'s `validateContentResult`,
 * which owns the contract, and keeping the two apart is what lets a test
 * script a malformed result without also faking a transport.
 *
 * Only OPEN-ENDED surfaces reach here. A projected surface's content is
 * computed in `domain/` and returned by `composeProjected` alongside the
 * structure, so it costs no model call and no round trip (CLAUDE.md
 * constraint 2, and the reason the projected path meets the paint budget).
 */

export interface ContentGenerator {
  generate(request: ContentGenerationRequestV1, signal: AbortSignal): Promise<unknown>;
}

/**
 * The prompt. Deliberately a serialisation of the request rather than prose
 * about it: the request already names every element, field, type, maximum
 * length and fixed prop, so restating any of that in English would be a
 * second copy to keep in sync.
 *
 * **No arithmetic is asked for** (CLAUDE.md constraint 2). `deriveContentRequest`
 * only ever selects `GENERATED_FIELDS`, which are prose; a number the user
 * could check arrives in `fixed` as context, never as something to produce.
 */
export function contentPrompt(request: ContentGenerationRequestV1): string {
  return [
    'Fill the copy for a generated interface.',
    `Intent: ${request.intent}`,
    `Locale: ${request.locale}`,
    '',
    'Request:',
    JSON.stringify(request, null, 0),
    '',
    'Reply with ONE JSON object and nothing else:',
    JSON.stringify({
      contract: 'jit.content.result.v1',
      requestId: request.requestId,
      catalogVersion: request.catalogVersion,
      values: { '<elementId>': { '<field>': '<text>' } },
    }),
    '',
    'Every requested element must appear. Respect each field\'s maxLength exactly.',
    'Never invent an element id. Never restate a number that is already in "fixed".',
  ].join('\n');
}

/**
 * Concatenates a `ContentSource`'s lines and parses the result as JSON.
 *
 * Whole-response, not incremental: `ContentUpdateV2` carries a `values` map
 * that the device applies at once, so there is no per-slot patch to emit
 * early — and a half-parsed JSON object is not a partial surface, it is a
 * syntax error. Streaming buys nothing here and would only widen the window
 * in which a malformed response looks like a working one.
 *
 * Throws on a malformed response rather than substituting anything
 * (constraint 5). The caller resolves the shimmer by rejecting every target,
 * which is visible, instead of inventing copy, which is not.
 */
export function contentGeneratorFrom(source: ContentSource): ContentGenerator {
  return {
    async generate(request, signal): Promise<unknown> {
      const lines: string[] = [];
      for await (const line of source.stream(contentPrompt(request), signal)) {
        signal.throwIfAborted();
        lines.push(line);
      }
      const text = lines.join('\n').trim();
      // A model that wraps its answer in a fence is a formatting slip, not a
      // different answer; anything else stays a failure.
      const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(text);
      const body = fenced?.[1] ?? text;
      if (!body) throw new Error('content source produced nothing');
      try {
        return JSON.parse(body);
      } catch (cause) {
        throw new Error(`content source did not return JSON: ${body.slice(0, 200)}`, { cause });
      }
    },
  };
}
