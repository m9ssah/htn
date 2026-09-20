import {
  ContentGenerationRequestSchema,
  ContentGenerationResultSchema,
  ContentTargetSchema,
  ContentUpdateSchema,
  type ContentGenerationRequestV1,
  type ContentGenerationResultV1,
  type ContentUpdateV2,
  type JsonObject,
  type JsonValue,
  type LeafComponentV2,
  type SurfaceSpec,
} from '@jit/schema';

/**
 * The fields a language model is allowed to fill, per component.
 *
 * `Bars` (`values: number[]`) and `Progress` (`pct: number`) are deliberately
 * absent, and so are `Slider`'s `min`/`max`/`step`/`value`/`unit` — every one
 * of them is a number the user could check, and CLAUDE.md constraint 2 says
 * those are computed in TypeScript from the typed domain model, never
 * generated. Their props are bound to state the server writes, or shipped as
 * fixed literals; a `Bars` or `Progress` element therefore yields no content
 * target at all, which is the intended outcome and not an oversight. Only
 * their prose (`Slider.label`/`minLabel`/`maxLabel`) is generated.
 */
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

export type ContentPointer = { elementId: string; field: string };

const CONTENT_POINTER = /^\/content\/([^/]+)\/([^/]+)$/;

/** The `$state`/`$bindState` path a prop is bound to, or `null` for a literal. */
export function bindingPath(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const expression = '$state' in value ? (value as { $state: unknown }).$state
    : '$bindState' in value ? (value as { $bindState: unknown }).$bindState
      : null;
  return typeof expression === 'string' ? expression : null;
}

/**
 * The full `{elementId, field}` a `/content/...` binding names — both
 * segments, never just the last one.
 *
 * `$bindState` is read here exactly like `$state`: a two-way binding is still
 * a binding, and treating it as a fixed literal ships the expression object
 * itself to the model as a prop value.
 */
export function contentPointer(value: unknown): ContentPointer | null {
  const path = bindingPath(value);
  const match = path === null ? null : CONTENT_POINTER.exec(path);
  return match ? { elementId: match[1]!, field: match[2]! } : null;
}

/**
 * A binding that can never receive generated content. Reported, never
 * silently dropped — a silently omitted target is an element that shimmers
 * for ever, which is exactly what the invariant forbids.
 *
 * Returned rather than thrown: the caller needs to know WHICH elements cannot
 * be filled so it can resolve them explicitly. Throwing would discard the
 * targets that are fine, i.e. the same failure mode as defect 3.
 */
export type UnresolvedBinding = { elementId: string; prop: string; path: string; reason: string };

export type ContentRequestDerivation = {
  request: ContentGenerationRequestV1;
  unresolved: UnresolvedBinding[];
};

/**
 * A generated prop resolves iff its binding is exactly
 * `/content/<its own element id>/<its own prop name>`, because
 * `values[elementId][field]` is the only write the device performs
 * (`packages/renderer/src/json-renderer.tsx` applyContent). Anything else —
 * another element's path, a different last segment, a non-`/content` root —
 * would leave the prop unfilled, so it is reported as unresolved.
 *
 * A binding that resolves but is NOT a generated field (`pending`, a
 * `Slider`'s numeric axis, a `TextField`'s `value`) is neither a target nor
 * `fixed`: the device or the server owns that state.
 */
export function deriveContentRequest(input: {
  requestId: string;
  locale: string;
  intent: string;
  context: JsonObject;
  spec: SurfaceSpec;
}): ContentRequestDerivation {
  const unresolved: UnresolvedBinding[] = [];
  const targets = Object.entries(input.spec.elements).flatMap(([elementId, element]) => {
    const fields = GENERATED_FIELDS[element.type as LeafComponentV2] ?? [];
    const generated = new Map(fields.map((field) => [field.name, field]));
    const selected: ContentGenerationRequestV1['targets'][number]['fields'] = [];
    const fixed: JsonObject = {};
    for (const [prop, value] of Object.entries(element.props)) {
      const path = bindingPath(value);
      if (path === null) {
        fixed[prop] = value as JsonValue;
        continue;
      }
      const pointer = contentPointer(value);
      const field = generated.get(prop);
      if (pointer && pointer.elementId === elementId && pointer.field === prop) {
        if (field) {
          selected.push({
            name: field.name,
            type: field.type,
            required: field.required,
            constraints: { ...(field.maxLength ? { maxLength: field.maxLength } : {}), format: 'plain-text' as const },
          });
        }
        continue;
      }
      // Only a generated prop can be "unfillable" — the rest are bound on
      // purpose to state this layer does not own.
      if (!field) continue;
      unresolved.push({
        elementId,
        prop,
        path,
        reason: !pointer ? `${elementId}.${prop} is bound outside /content, so generated content can never reach it.`
          : pointer.elementId !== elementId ? `${elementId}.${prop} is bound to another element's content (${pointer.elementId}).`
            : `${elementId}.${prop} is bound to /content/${elementId}/${pointer.field}, which no content field writes.`,
      });
    }
    if (selected.length === 0) return [];
    return [{ elementId, component: element.type as LeafComponentV2, purpose: `${element.type} on the generated surface`, fields: selected, fixed }];
  });
  const request = ContentGenerationRequestSchema.parse({
    contract: 'jit.content.request.v1', requestId: input.requestId, catalogVersion: 'jit-device.v2', locale: input.locale, intent: input.intent, context: input.context, targets,
  });
  return { request, unresolved };
}

export type RejectedElement = { elementId: string; reason: string };

/**
 * `result.values` carries only the elements that passed. `rejected` carries
 * every element that did not, with the reason — including elements the model
 * returned that were never requested.
 */
export type ContentValidation = {
  result: ContentGenerationResultV1;
  rejected: RejectedElement[];
};

type Target = ContentGenerationRequestV1['targets'][number];

/** The six per-field checks, verbatim. First failure names the element. */
function checkElement(target: Target, values: Record<string, JsonValue>): string | null {
  const elementId = target.elementId;
  const fields = new Map(target.fields.map((field) => [field.name, field]));
  for (const [name, value] of Object.entries(values)) {
    const field = fields.get(name);
    if (!field) return `Content result returned an unrequested field: ${elementId}.${name}.`;
    if (field.type === 'string' && typeof value !== 'string') return `Expected string at ${elementId}.${name}.`;
    if (field.type === 'number' && typeof value !== 'number') return `Expected number at ${elementId}.${name}.`;
    if (field.type === 'boolean' && typeof value !== 'boolean') return `Expected boolean at ${elementId}.${name}.`;
    if (field.type === 'number[]' && (!Array.isArray(value) || value.some((item) => typeof item !== 'number'))) return `Expected number[] at ${elementId}.${name}.`;
    if (typeof value === 'string' && field.constraints?.maxLength !== undefined && value.length > field.constraints.maxLength) return `Content exceeds maxLength at ${elementId}.${name}.`;
  }
  for (const field of target.fields) if (field.required && !(field.name in values)) return `Content result omitted required field: ${elementId}.${field.name}.`;
  return null;
}

/**
 * Validates a model result against the request it was given, with the ELEMENT
 * as the unit of failure.
 *
 * Envelope failures stay fatal — not an object, no `values` map, a result
 * belonging to another request: nothing in it is trustworthy. Element
 * failures isolate, so one malformed field cannot discard the rest of the
 * surface. An unrequested element is dropped and reported rather than thrown
 * on: that is the model being chatty, not the result being corrupt.
 *
 * Every requested target ends up in exactly one of `result.values` or
 * `rejected`, which is what lets the caller resolve every element on the
 * surface (see `contentUpdateFrom`).
 */
export function validateContentResult(request: ContentGenerationRequestV1, result: unknown): ContentValidation {
  const parsed = ContentGenerationResultSchema.parse(result);
  if (parsed.requestId !== request.requestId || parsed.catalogVersion !== request.catalogVersion) throw new Error('Content result does not belong to this request.');
  const targets = new Map(request.targets.map((target) => [target.elementId, target]));
  const accepted: Record<string, Record<string, JsonValue>> = {};
  const rejected: RejectedElement[] = [];
  for (const [elementId, values] of Object.entries(parsed.values)) {
    const target = targets.get(elementId);
    if (!target) {
      rejected.push({ elementId, reason: `Content result returned an unrequested element: ${elementId}.` });
      continue;
    }
    const reason = checkElement(target, values);
    if (reason) rejected.push({ elementId, reason });
    else accepted[elementId] = values;
  }
  const seen = new Set(rejected.map((entry) => entry.elementId));
  for (const target of request.targets) {
    if (target.elementId in accepted || seen.has(target.elementId)) continue;
    rejected.push({ elementId: target.elementId, reason: `Content result omitted target: ${target.elementId}.` });
  }
  return { result: { ...parsed, values: accepted }, rejected };
}

/**
 * The patch that resolves every requested element: accepted values for the
 * ones that passed, and a field-less entry for the ones that did not.
 *
 * A field-less entry is not a no-op — `applyContent` clears
 * `/content/<id>/pending` for every key in `values`
 * (`packages/renderer/src/json-renderer.tsx:163`), so a rejected element
 * stops shimmering and shows its placeholder instead of pending for ever.
 *
 * Elements the model invented are filtered out: the device rejects a whole
 * content update that names an element the spec does not have.
 */
export function contentUpdateFrom(
  request: ContentGenerationRequestV1,
  validation: ContentValidation,
  meta: { generationId: string; complete?: boolean },
): ContentUpdateV2 {
  const requested = new Set(request.targets.map((target) => target.elementId));
  const values: Record<string, Record<string, JsonValue>> = { ...validation.result.values };
  for (const entry of validation.rejected) if (requested.has(entry.elementId)) values[entry.elementId] ??= {};
  return ContentUpdateSchema.parse({
    v: 2, stage: 'content', requestId: request.requestId, generationId: meta.generationId, complete: meta.complete ?? true, values,
  });
}

export const isContentTarget = (value: unknown): value is ReturnType<typeof ContentTargetSchema.parse> => ContentTargetSchema.safeParse(value).success;
