import type { SurfaceUpdate } from '@jit/schema';

/**
 * The device <-> server wire protocol. One JSON object per websocket frame,
 * discriminated by `type`.
 *
 * Deliberately boring. The interesting contract is `SurfaceUpdate`, which
 * `packages/schema` already owns and the renderer already validates; this
 * layer only has to say *which turn* an update belongs to and *when a turn
 * starts and stops*, because those are the two things a stream of updates
 * cannot express about itself.
 *
 * **`update` is passed through untouched.** The renderer's `apply()`
 * discriminates structure/content on `stage` but style/polish on
 * `'theme' in` / `'tokens' in`, because `stage` is optional on
 * `StyleUpdateV1`/`PolishUpdateV1`. A transport that normalised `stage` onto
 * every update would be inventing contract. The device should call
 * `renderer.apply(message.update)` with exactly what arrived.
 *
 * See `docs/wire-protocol.md`.
 */

export const WIRE_PROTOCOL_VERSION = 1;

export type ServerMessage =
  /** First frame on every connection. Lets the device fail loudly on a version skew. */
  | { type: 'hello'; protocol: number }
  /** A turn began. Everything tagged with this `turnId` until its `turn-end`. */
  | { type: 'turn-start'; turnId: string }
  /**
   * One surface update. `seq` is per-turn and monotonic from 0, so a device
   * (or a log) can tell "nothing was produced" from "something was lost"
   * without the server having to promise delivery.
   */
  | { type: 'update'; turnId: string; seq: number; update: SurfaceUpdate }
  /**
   * The turn is over. `ok` means the graph ran out of updates; `aborted`
   * means a barge-in, a disconnect, or a consumer that left; `crashed` means
   * the turn runner itself threw, which is a bug, not a degraded node.
   *
   * A device that receives `aborted` should keep the surface it has. The
   * plan is explicit that when a turn cannot finish, the only safe move is
   * to keep the current surface rather than paint a fallback.
   */
  | { type: 'turn-end'; turnId: string; outcome: 'ok' | 'aborted' | 'crashed'; updates: number }
  /** A frame the server could not act on. The connection stays open. */
  | { type: 'error'; reason: string };

export type ClientMessage =
  /** Speech (or typed text). Arriving mid-turn is a barge-in and aborts the turn in flight. */
  | { type: 'utterance'; text: string }
  /**
   * A touch, button, encoder or slider event, named by the action the
   * surface's own spec declared (`SurfaceActionDescriptor.action`).
   *
   * Reserved, not yet handled: the plan routes control events AROUND the
   * graph ("a slider scrub emits a cached content patch and must not depend
   * on graph state being consistent mid-turn"), and there is no cache to
   * serve from until the concrete graph exists. The server parses and
   * acknowledges these so the device workstream can send them today and see
   * a defined response rather than silence.
   */
  | { type: 'action'; action: string; elementId: string; value?: string | number | boolean };

/** Refuses anything longer. An utterance is a sentence, not a payload. */
export const MAX_UTTERANCE_CHARS = 2000;

export type ParseResult = { ok: true; message: ClientMessage } | { ok: false; reason: string };

/**
 * Every inbound frame is untrusted input from a device on a network. Parsing
 * returns a reason instead of throwing, and a bad frame never closes the
 * connection — a device that gets disconnected for one malformed message
 * reconnects and sends it again, which is a loop, not a recovery.
 */
export function parseClientMessage(raw: string): ParseResult {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'frame is not valid JSON' };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, reason: 'frame is not a JSON object' };
  }
  const m = value as Record<string, unknown>;

  switch (m.type) {
    case 'utterance': {
      if (typeof m.text !== 'string') return { ok: false, reason: 'utterance.text must be a string' };
      const text = m.text.trim();
      if (!text) return { ok: false, reason: 'utterance.text is empty' };
      if (text.length > MAX_UTTERANCE_CHARS) {
        return { ok: false, reason: `utterance.text exceeds ${MAX_UTTERANCE_CHARS} characters` };
      }
      return { ok: true, message: { type: 'utterance', text } };
    }
    case 'action': {
      if (typeof m.action !== 'string' || !m.action) return { ok: false, reason: 'action.action must be a non-empty string' };
      if (typeof m.elementId !== 'string' || !m.elementId) {
        return { ok: false, reason: 'action.elementId must be a non-empty string' };
      }
      const value = m.value;
      if (value !== undefined && typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
        return { ok: false, reason: 'action.value must be a string, number or boolean' };
      }
      return {
        ok: true,
        message: { type: 'action', action: m.action, elementId: m.elementId, ...(value !== undefined && { value }) },
      };
    }
    default:
      return { ok: false, reason: `unknown message type: ${JSON.stringify(m.type)}` };
  }
}
