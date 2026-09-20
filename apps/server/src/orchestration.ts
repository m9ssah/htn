import {
  ContentGenerationRequestSchema,
  ContentGenerationResultSchema,
  ContentTargetSchema,
  type ContentGenerationRequestV1,
  type ContentGenerationResultV1,
  type JsonObject,
  type JsonValue,
  type LeafComponentV2,
  type StructureUpdateV2,
  type SurfaceSpec,
} from '@jit/schema';
import { JIT_CATALOG } from '@jit/renderer';

const GENERATED_FIELDS: Partial<Record<LeafComponentV2, ReadonlyArray<{ name: string; type: 'string' | 'number' | 'boolean' | 'number[]'; required: boolean; maxLength?: number }>>> = {
  Heading: [{ name: 'text', type: 'string', required: true, maxLength: 48 }],
  Text: [{ name: 'text', type: 'string', required: true, maxLength: 160 }],
  Label: [{ name: 'text', type: 'string', required: true, maxLength: 32 }],
  Metric: [{ name: 'label', type: 'string', required: true, maxLength: 32 }, { name: 'value', type: 'string', required: true, maxLength: 32 }, { name: 'delta', type: 'string', required: false, maxLength: 48 }],
  Media: [{ name: 'caption', type: 'string', required: false, maxLength: 48 }],
  Badge: [{ name: 'text', type: 'string', required: true, maxLength: 24 }],
  ListItem: [{ name: 'title', type: 'string', required: true, maxLength: 42 }, { name: 'detail', type: 'string', required: false, maxLength: 56 }, { name: 'meta', type: 'string', required: false, maxLength: 20 }],
  Rule: [{ name: 'left', type: 'string', required: true, maxLength: 36 }, { name: 'right', type: 'string', required: false, maxLength: 24 }],
  Button: [{ name: 'text', type: 'string', required: true, maxLength: 24 }],
  TextField: [{ name: 'label', type: 'string', required: true, maxLength: 32 }, { name: 'placeholder', type: 'string', required: false, maxLength: 48 }],
  Toggle: [{ name: 'label', type: 'string', required: true, maxLength: 44 }],
  Alert: [{ name: 'text', type: 'string', required: true, maxLength: 150 }],
  Slider: [{ name: 'label', type: 'string', required: true, maxLength: 28 }, { name: 'minLabel', type: 'string', required: false, maxLength: 18 }, { name: 'maxLabel', type: 'string', required: false, maxLength: 18 }],
};

function boundField(value: unknown): string | null {
  if (!value || typeof value !== 'object' || !('$state' in value) || typeof value.$state !== 'string') return null;
  const match = /^\/content\/([^/]+)\/([^/]+)$/.exec(value.$state);
  return match?.[2] ?? null;
}

/** Builds the exact fine-tuning/runtime request only after Stage 1 has selected a valid tree. */
export function deriveContentRequest(input: {
  requestId: string;
  locale: string;
  intent: string;
  context: JsonObject;
  spec: SurfaceSpec;
}): ContentGenerationRequestV1 {
  const targets = Object.entries(input.spec.elements).flatMap(([elementId, element]) => {
    const fields = GENERATED_FIELDS[element.type as LeafComponentV2];
    if (!fields) return [];
    const bound = new Set(Object.values(element.props).map(boundField).filter((value): value is string => value !== null));
    const selected = fields.filter((field) => bound.has(field.name)).map((field) => ({
      name: field.name,
      type: field.type,
      required: field.required,
      constraints: { ...(field.maxLength ? { maxLength: field.maxLength } : {}), format: 'plain-text' as const },
    }));
    if (selected.length === 0) return [];
    const fixed = Object.fromEntries(Object.entries(element.props).flatMap(([name, value]) => boundField(value) ? [] : [[name, value as JsonValue]]));
    return [{ elementId, component: element.type as LeafComponentV2, purpose: `${element.type} on the generated surface`, fields: selected, fixed }];
  });
  return ContentGenerationRequestSchema.parse({
    contract: 'jit.content.request.v1', requestId: input.requestId, catalogVersion: 'jit-device.v2', locale: input.locale, intent: input.intent, context: input.context, targets,
  });
}

/** Strictly validates a fine-tuned model result against the request it was given. */
export function validateContentResult(request: ContentGenerationRequestV1, result: unknown): ContentGenerationResultV1 {
  const parsed = ContentGenerationResultSchema.parse(result);
  if (parsed.requestId !== request.requestId || parsed.catalogVersion !== request.catalogVersion) throw new Error('Content result does not belong to this request.');
  const targets = new Map(request.targets.map((target) => [target.elementId, target]));
  for (const [elementId, values] of Object.entries(parsed.values)) {
    const target = targets.get(elementId);
    if (!target) throw new Error(`Content result returned an unrequested element: ${elementId}.`);
    const fields = new Map(target.fields.map((field) => [field.name, field]));
    for (const [name, value] of Object.entries(values)) {
      const field = fields.get(name);
      if (!field) throw new Error(`Content result returned an unrequested field: ${elementId}.${name}.`);
      if (field.type === 'string' && typeof value !== 'string') throw new Error(`Expected string at ${elementId}.${name}.`);
      if (field.type === 'number' && typeof value !== 'number') throw new Error(`Expected number at ${elementId}.${name}.`);
      if (field.type === 'boolean' && typeof value !== 'boolean') throw new Error(`Expected boolean at ${elementId}.${name}.`);
      if (field.type === 'number[]' && (!Array.isArray(value) || value.some((item) => typeof item !== 'number'))) throw new Error(`Expected number[] at ${elementId}.${name}.`);
      if (typeof value === 'string' && field.constraints?.maxLength !== undefined && value.length > field.constraints.maxLength) throw new Error(`Content exceeds maxLength at ${elementId}.${name}.`);
    }
    for (const field of target.fields) if (field.required && !(field.name in values)) throw new Error(`Content result omitted required field: ${elementId}.${field.name}.`);
  }
  for (const target of request.targets) if (!(target.elementId in parsed.values)) throw new Error(`Content result omitted target: ${target.elementId}.`);
  return parsed;
}

export type StructureComposer = {
  compose: (input: { intent: string; requestId: string; generationId: string }) => AsyncIterable<StructureUpdateV2>;
};

/** Offline/test adapter; production replaces it with the pinned Jev adapter at the same seam. */
export function fixtureComposer(structure: StructureUpdateV2): StructureComposer {
  return { async *compose() { yield structure; } };
}

export type JevCandidate = {
  id: string;
  description: string;
  root?: boolean;
  maxUses?: number;
  resource?: string;
  element: SurfaceSpec['elements'][string];
};

type ExperimentalCore = {
  experimental_createEvaluator: (options: { apiKey: string; model: string; timeoutMs?: number }) => unknown;
  experimental_composeSpec: (options: Record<string, unknown>) => AsyncIterable<{ type: 'step' | 'complete'; spec: SurfaceSpec | null; stopReason?: string }>;
};

/** Server-side adapter for the pinned experimental Jev composer. Credentials never reach the renderer. */
export function jevStructureComposer(options: {
  apiKey: string;
  candidates: readonly JevCandidate[];
  initialState: Record<string, unknown>;
  context?: Record<string, unknown>;
  maxWidth?: number;
}): StructureComposer {
  return {
    async *compose(input) {
      const experimental = await import('@json-render/core') as unknown as ExperimentalCore;
      const evaluate = experimental.experimental_createEvaluator({ apiKey: options.apiKey, model: 'typesafe-ai/jev', timeoutMs: 10_000 });
      for await (const event of experimental.experimental_composeSpec({
        catalog: JIT_CATALOG,
        candidates: options.candidates,
        prompt: input.intent,
        initialState: options.initialState,
        context: options.context,
        evaluate,
        maxElements: 24,
        maxDepth: 4,
        signal: AbortSignal.timeout(30_000),
      })) {
        if (!event.spec) continue;
        yield {
          v: 2,
          stage: 'structure',
          requestId: input.requestId,
          generationId: input.generationId,
          maxWidth: options.maxWidth ?? 640,
          status: event.type === 'complete' && event.stopReason === 'finish' ? 'complete' : 'partial',
          spec: event.spec,
        };
      }
    },
  };
}

export const isContentTarget = (value: unknown): value is ReturnType<typeof ContentTargetSchema.parse> => ContentTargetSchema.safeParse(value).success;
