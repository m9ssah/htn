import type { ContentPatch, LeafComponent, SlotId, SlotValue, TemplateId } from '@jit/schema';
import { TEMPLATES, isLeaf, type TemplateNode } from '@jit/renderer';
import type { Ctx, Node } from '../types.js';
import { sleep } from '../signal.js';

/**
 * The two templates that cannot be computed from the domain model by
 * `project` (P4) — see CLAUDE.md's task brief. Restricting `templateId` to
 * these at the type level means a caller can't hand this node a template it
 * has no slot map for.
 */
export type GeneratedTemplateId = 'message_drafts' | 'generic_answer';

export type GenerateInput = {
  templateId: GeneratedTemplateId;
  utterance: string;
};

/**
 * `SlotKindMap` (packages/schema) binds a slot id to its component kind, but
 * it's a type — it doesn't exist at runtime. `TEMPLATES[id].tree` is the one
 * place that mapping is actually walkable, so this is the only source of
 * truth for "what slots does this template have, and what kind is each."
 */
function collectLeaves(node: TemplateNode, out: Map<SlotId, LeafComponent>): void {
  if (isLeaf(node)) {
    out.set(node.slot, node.type);
    return;
  }
  if ('children' in node) {
    for (const child of node.children) collectLeaves(child, out);
  }
}

function slotsFor(templateId: TemplateId): Map<SlotId, LeafComponent> {
  const out = new Map<SlotId, LeafComponent>();
  collectLeaves(TEMPLATES[templateId].tree, out);
  return out;
}

function describeSlot(id: SlotId, kind: LeafComponent): string {
  switch (kind) {
    case 'Heading':
    case 'Text':
    case 'Label':
    case 'Button':
      return `${id} (${kind}): {"text": string}`;
    case 'ListItem':
      return `${id} (ListItem): {"title": string, "detail"?: string, "meta"?: string}`;
    case 'Slider':
      return (
        `${id} (Slider): {"label": string, "min": number, "max": number, ` +
        `"step": number, "value": number, "unit"?: string, "minLabel"?: string, "maxLabel"?: string}`
      );
    default:
      return `${id} (${kind}): {}`;
  }
}

/**
 * The whole wire protocol lives here, not in `ContentSource` — the interface
 * stays a generic string stream so `realContentSource` (a subprocess) and a
 * test double can both implement it without knowing about slots.
 *
 * Line 1 is the not-applicable list, always, so the renderer's collapse (the
 * one deliberate reflow exception) happens before anything else lands. Every
 * other line is one slot. Buttons are listed first as a hint to the model —
 * `generate` enforces the real ordering guarantee itself below regardless of
 * what order they actually arrive in.
 */
function buildPrompt(input: GenerateInput, slots: Map<SlotId, LeafComponent>): string {
  const ordered = [...slots.entries()].sort(([, a], [, b]) => {
    if (a === 'Button' && b !== 'Button') return -1;
    if (b === 'Button' && a !== 'Button') return 1;
    return 0;
  });
  const spec = ordered.map(([id, kind]) => describeSlot(id, kind)).join('\n');
  return [
    `User request: ${input.utterance}`,
    '',
    'Fill these interface slots. Output JSON Lines only -- no prose, no markdown fences, one JSON value per line.',
    'Line 1: a JSON array of the slot ids below that do not apply to this response (use [] if all apply).',
    'Every other line: {"slot":"<id>","value":{...}} for each remaining slot, value shaped as shown. Button slots first.',
    '',
    spec,
  ].join('\n');
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isOptionalString(v: unknown): v is string | undefined {
  return v === undefined || typeof v === 'string';
}

/**
 * Hand-written per component kind actually used by `message_drafts` and
 * `generic_answer`. `SlotValue`'s shapes live only in `packages/schema` as a
 * type, so a value the model produced has to be checked field-by-field
 * before it can be trusted — a `Slider` missing `min` renders as `NaN%`.
 */
function validateValue(kind: LeafComponent, raw: unknown): SlotValue {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`generate: ${kind} value is not an object: ${JSON.stringify(raw)}`);
  }
  const v = raw as Record<string, unknown>;
  switch (kind) {
    case 'Heading':
      if (typeof v.text === 'string') return { kind: 'Heading', text: v.text };
      break;
    case 'Text':
      if (typeof v.text === 'string') return { kind: 'Text', text: v.text };
      break;
    case 'Label':
      if (typeof v.text === 'string') return { kind: 'Label', text: v.text };
      break;
    case 'Button':
      if (typeof v.text === 'string') return { kind: 'Button', text: v.text };
      break;
    case 'ListItem':
      if (typeof v.title === 'string' && isOptionalString(v.detail) && isOptionalString(v.meta)) {
        // `exactOptionalPropertyTypes` rejects `detail: undefined` outright —
        // the key must be absent, not present-with-undefined.
        return { kind: 'ListItem', title: v.title, ...(v.detail !== undefined && { detail: v.detail }), ...(v.meta !== undefined && { meta: v.meta }) };
      }
      break;
    case 'Slider':
      if (
        typeof v.label === 'string' &&
        isFiniteNumber(v.min) &&
        isFiniteNumber(v.max) &&
        isFiniteNumber(v.step) &&
        isFiniteNumber(v.value) &&
        isOptionalString(v.unit) &&
        isOptionalString(v.minLabel) &&
        isOptionalString(v.maxLabel)
      ) {
        return {
          kind: 'Slider',
          label: v.label,
          min: v.min,
          max: v.max,
          step: v.step,
          value: v.value,
          ...(v.unit !== undefined && { unit: v.unit }),
          ...(v.minLabel !== undefined && { minLabel: v.minLabel }),
          ...(v.maxLabel !== undefined && { maxLabel: v.maxLabel }),
        };
      }
      break;
    default:
      throw new Error(`generate: unsupported slot kind "${kind}"`);
  }
  throw new Error(`generate: malformed ${kind} value: ${JSON.stringify(raw)}`);
}

function parseNullPreamble(line: string, slots: Map<SlotId, LeafComponent>): SlotId[] {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch (cause) {
    throw new Error(`generate: malformed not-applicable line: ${line}`, { cause });
  }
  if (!Array.isArray(raw)) throw new Error(`generate: not-applicable line is not a JSON array: ${line}`);
  return raw.map((id) => {
    if (typeof id !== 'string' || !slots.has(id as SlotId)) {
      throw new Error(`generate: not-applicable line names an unknown slot: ${JSON.stringify(id)}`);
    }
    return id as SlotId;
  });
}

function parseSlotLine(line: string, slots: Map<SlotId, LeafComponent>): { slot: SlotId; value: SlotValue } {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch (cause) {
    throw new Error(`generate: malformed slot line: ${line}`, { cause });
  }
  if (typeof raw !== 'object' || raw === null) throw new Error(`generate: slot line is not an object: ${line}`);
  const { slot, value } = raw as Record<string, unknown>;
  if (typeof slot !== 'string' || !slots.has(slot as SlotId)) {
    throw new Error(`generate: slot line names an unknown slot: ${JSON.stringify(slot)}`);
  }
  if (value === null) {
    // Nulls are declared once, up front (line 1) — see buildPrompt. Allowing
    // one inline too would let a null land after a Button already flushed,
    // which is the exact ordering guarantee this node exists to enforce.
    throw new Error(`generate: slot "${slot}" sent null inline; not-applicable slots belong on line 1`);
  }
  return { slot: slot as SlotId, value: validateValue(slots.get(slot as SlotId)!, value) };
}

function contentPatch(slot: SlotId, value: SlotValue | null): ContentPatch {
  // `slot` was checked against this template's own slot map in the parser
  // above, so the value is known to match `SlotKindMap[slot]` at runtime —
  // TypeScript can't express that for a key computed at runtime, hence the
  // cast.
  return { v: 1, slots: { [slot]: value } as ContentPatch['slots'] };
}

/**
 * Streams content for `message_drafts` / `generic_answer` slot by slot.
 *
 * Ordering (required, not a preference): not-applicable slots first (so the
 * renderer's collapse — the one deliberate reflow exception — happens before
 * anything else lands), then every Button (p14 measured a button label
 * arriving at 10s because the model emitted in declaration order — a late
 * button label is the physical hardware lying about what it does), then
 * everything else. Buttons are asked for first in the prompt, but the hold-
 * back buffer below is what actually guarantees it regardless of model
 * compliance.
 *
 * Cancellation and failure are different exits. An aborted signal rethrows
 * `signal.reason` — the turn is over, a later `beginTurn` has already made
 * this sink a no-op, so nothing is lost by propagating. A content-source
 * failure (or a malformed slot) is caught, flushed, fault-marked via
 * telemetry, and swallowed — letting it reach the stream controller would
 * reset the queue and discard chunks already enqueued but not yet read
 * (p19c/p19d), which would also drop everything already emitted this turn.
 */
export const generate: Node<GenerateInput, void> = {
  name: 'generate',
  async run(input, ctx: Ctx): Promise<void> {
    const t0 = ctx.now();
    const buffered: ContentPatch[] = [];
    const flush = (): void => {
      for (const patch of buffered) ctx.sink.emit(patch);
      buffered.length = 0;
    };

    try {
      if (input.templateId !== 'message_drafts' && input.templateId !== 'generic_answer') {
        throw new Error(`generate: unsupported templateId "${input.templateId}"`);
      }
      const slots = slotsFor(input.templateId);
      const pendingButtons = new Set<SlotId>();
      for (const [id, kind] of slots) if (kind === 'Button') pendingButtons.add(id);

      const emit = (slot: SlotId, value: SlotValue | null): void => {
        const patch = contentPatch(slot, value);
        if (pendingButtons.has(slot)) {
          ctx.sink.emit(patch);
          pendingButtons.delete(slot);
          if (pendingButtons.size === 0) flush();
        } else if (pendingButtons.size === 0) {
          ctx.sink.emit(patch);
        } else {
          buffered.push(patch);
        }
      };

      const prompt = buildPrompt(input, slots);
      let first = true;
      for await (const raw of ctx.content.stream(prompt, ctx.signal)) {
        await sleep(0, ctx.signal); // check between slots, not just inside the source
        const line = raw.trim();
        if (!line) continue;
        if (first) {
          first = false;
          for (const slot of parseNullPreamble(line, slots)) {
            ctx.sink.emit(contentPatch(slot, null));
            pendingButtons.delete(slot);
          }
          if (pendingButtons.size === 0) flush();
          continue;
        }
        const { slot, value } = parseSlotLine(line, slots);
        emit(slot, value);
      }
      flush();
    } catch (err) {
      if (ctx.signal.aborted) throw ctx.signal.reason;
      flush();
      ctx.telemetry({ kind: 'generate-fault', node: 'generate', ms: ctx.now() - t0, error: err });
    }
  },
};
