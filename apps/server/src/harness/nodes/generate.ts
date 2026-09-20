import type { ContentUpdateV2, JsonObject, SurfaceSpec } from '@jit/schema';
import { contentUpdateFrom, deriveContentRequest, validateContentResult } from '../../contract/content.js';
import type { Node } from '../types.js';

/**
 * Fills a composed surface's prose through the fine-tuned content model.
 *
 * The three steps are already owned elsewhere and only sequenced here:
 * `deriveContentRequest` reads the targets off the spec's own bindings,
 * `ContentModel.fill` asks the model, and `validateContentResult` decides what
 * is usable. This node's own job is to stay **total** — like `project`, it
 * reports instead of throwing, because a thrown content step would leave every
 * element on the surface shimmering for ever.
 *
 * It never invents content. When the model fails outright there is no patch
 * that could honestly fill the surface, so `content` is null and the reason is
 * in `warnings` (constraint 5). When the model answers partially,
 * `contentUpdateFrom` still resolves the elements it got wrong — a rejected
 * element gets a field-less entry, which clears its `pending` flag and shows
 * its placeholder rather than an endless shimmer.
 */
export type GenerateInput = {
  requestId: string;
  generationId: string;
  locale: string;
  intent: string;
  context: JsonObject;
  spec: SurfaceSpec;
};

export type GenerateResult = {
  /** Absent only when the model call itself failed — never a fabricated surface. */
  content: ContentUpdateV2 | null;
  /** Unfillable bindings, per-element rejections, and the model failure if there was one. */
  warnings: string[];
};

export const generate: Node<GenerateInput, GenerateResult> = {
  name: 'generate',
  async run(input, ctx): Promise<GenerateResult> {
    const { request, unresolved } = deriveContentRequest({
      requestId: input.requestId,
      locale: input.locale,
      intent: input.intent,
      context: input.context,
      spec: input.spec,
    });
    const warnings = unresolved.map((entry) => entry.reason);

    // A surface with no generated prose is a real outcome — a fully projected
    // recipe screen has every string computed already — not an empty answer to
    // paper over with a model call.
    if (request.targets.length === 0) return { content: null, warnings };

    let raw: unknown;
    try {
      raw = await ctx.contentModel.fill(request, ctx.signal);
    } catch (err) {
      ctx.telemetry({ kind: 'generate-fault', node: 'generate', ms: 0, error: err });
      return { content: null, warnings: [...warnings, `Content model failed: ${String(err)}`] };
    }

    let validation;
    try {
      validation = validateContentResult(request, raw);
    } catch (err) {
      // An envelope failure — not an object, wrong requestId, no `values`.
      // Nothing in the response is trustworthy, so none of it is painted.
      ctx.telemetry({ kind: 'generate-fault', node: 'generate', ms: 0, error: err });
      return { content: null, warnings: [...warnings, `Content result rejected: ${String(err)}`] };
    }

    return {
      content: contentUpdateFrom(request, validation, { generationId: input.generationId }),
      warnings: [...warnings, ...validation.rejected.map((entry) => entry.reason)],
    };
  },
};
