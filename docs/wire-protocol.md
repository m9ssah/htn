# Device ↔ server wire protocol

> Version 1. Implemented in `apps/server/src/wire.ts` (types + inbound parser)
> and `apps/server/src/ws-server.ts` (the socket). Written for the device
> workstream — nothing in `apps/device/*` was modified to produce it.

One websocket. One JSON object per frame. Every frame has a `type`.

```
npm run serve                  # ws://127.0.0.1:8787
JIT_PORT=9000 npm run serve
```

**The graph is not wired yet.** `npm run serve` boots the real transport with a
placeholder graph that emits nothing, so a device that connects today gets
`hello`, then a real `turn-start` / `turn-end` pair with zero updates per
utterance. That is the honest state and it is deliberately not a canned demo
surface — `CLAUDE.md` constraint 5 (never hardcode a fallback that hides a
failure) and constraint 6 (the flow is never hardcoded). Replacing
`notWiredGraph` in `apps/server/src/server.ts` is the only change needed.

## Shape

```
 device                                   server
   │                                        │
   │◀───────── {"type":"hello",...} ────────│  on connect
   │                                        │
   │──── {"type":"utterance","text":…} ────▶│  starts a turn
   │                                        │
   │◀──── {"type":"turn-start",…} ──────────│
   │◀──── {"type":"update","seq":0,…} ──────│  paint immediately
   │◀──── {"type":"update","seq":1,…} ──────│
   │◀──── {"type":"turn-end","outcome":…} ──│
```

## Server → device

| frame | fields | meaning |
|---|---|---|
| `hello` | `protocol: 1` | First frame on every connection. Fail loudly on a version you do not know rather than silently misreading later frames. |
| `turn-start` | `turnId` | A turn began. Everything tagged with this `turnId` belongs to it. |
| `update` | `turnId`, `seq`, `update` | One `SurfaceUpdate`. `seq` is per-turn and monotonic from 0. |
| `turn-end` | `turnId`, `outcome`, `updates` | The turn is over. `updates` is how many `update` frames it sent. |
| `error` | `reason` | A frame the server could not act on. **The connection stays open.** |

### `update.update` is passed through untouched

Call `renderer.apply(frame.update)` with exactly what arrived. Do not
normalise it, do not add a `stage`, do not rewrap it.

`StructureUpdateV2` and `ContentUpdateV2` carry `stage: 'structure' | 'content'`.
`StyleUpdateV1` and `PolishUpdateV1` have `stage` **optional**, and the
renderer discriminates those on `'theme' in update` / `'tokens' in update`
(`packages/renderer/src/json-renderer.tsx`). A transport that stamped a stage
onto every update would be inventing contract, so this one does not.

The server does not validate `update` today. `TurnDeps.validate` is an
injected hook for whoever owns the contract (`validateContentResult`); with no
validator supplied, every update passes through. The renderer validates the
spec on apply either way.

### `outcome`

| value | what happened | what the device should do |
|---|---|---|
| `ok` | The graph ran out of updates. | Nothing. The surface is what it is. |
| `aborted` | Barge-in, disconnect, or the consumer left. | **Keep the current surface.** Do not clear, do not paint a fallback — the plan is explicit that when a turn cannot finish, keeping what is on screen is the only safe move. |
| `crashed` | The turn runner itself threw. A bug, not a degraded node. | Same as `aborted`. |

A turn that produced zero updates still sends `turn-start` and `turn-end`.
`updates: 0` with `outcome: "ok"` is exactly what the unwired graph produces
today.

### `seq`

Per-turn, from 0, monotonic, no gaps on a healthy turn. It exists so the
device (or a log) can distinguish "the turn produced nothing" from "something
was lost" without the server having to promise delivery. Nothing currently
retransmits.

## Device → server

| frame | fields | status |
|---|---|---|
| `utterance` | `text` (1–2000 chars, trimmed) | **Handled.** Starts a turn. |
| `action` | `action`, `elementId`, `value?` | **Reserved — answered with an `error` frame today.** |

### Barge-in

An `utterance` arriving while a turn is in flight aborts that turn. This is the
normal case on a voice device, not an exception. The interrupted turn:

- stops receiving updates immediately (its sink is gated on the turn's
  `AbortSignal`),
- gets a `turn-end` with `outcome: "aborted"`,
- never emits an `update` frame after the replacement turn's `turn-start`.

That last property is tested over a real loopback socket
(`apps/server/test/ws-server.test.ts`, "a second utterance aborts the first
turn…"), against a node that deliberately ignores the abort signal — because
`backend/probes/p19b_langgraph_cancel.mjs` measured that nothing on the
consumer side stops a running node, so the guarantee cannot come from the node.

### `action` is reserved, not forgotten

Control events (touch, the four buttons, the encoder, the slider) are named by
the `action` string the surface's own spec declared — see
`SurfaceActionDescriptor` in `packages/schema/src/surface.ts`. They are parsed
and answered with `{"type":"error","reason":"action \"…\" is not handled yet"}`
so the device workstream can send them today and see a defined response rather
than silence.

They are **not** going to be routed through the graph when they are
implemented. `docs/orchestration-plan.md` settles this: a slider scrub must
respond within one frame and must not depend on graph state being consistent
mid-turn, and routing it through the graph would also make a physical control
abortable by a barge-in, which is wrong. They will be served from a
pre-generated cache, which does not exist until the composer does.

## Errors and connection lifetime

**A malformed frame never closes the connection.** A device disconnected for one
bad message reconnects and sends it again, which is a loop, not a recovery. Bad
frames get an `error` frame and the socket stays open and usable.

**One device.** A second connection is closed with **1013 "Try Again Later"** and
the reason `device already connected`. `CLAUDE.md` describes a Raspberry Pi with
a 4" screen, not a fleet, and two devices sharing one session would race for the
same task state — a confusing surface rather than an error.

**A disconnect aborts the turn in flight.** The server does not keep rendering
into a dead socket, and it does not go down with it: both `close` and `error`
are handled on the socket, and `error` on a `ws` socket with no listener throws
out of the event loop.

**Reconnect** by opening a new socket. There is no session resumption: the turn
you were in is gone, and the device keeps whatever it last painted.

## Not yet defined

- **Audio.** `utterance` is text; STT lives upstream of this protocol and no
  decision has been made about where.
- **Server → device control remapping.** The hardware layer reads
  `getActions()` off the renderer, which already has the spec, so nothing needs
  to cross the wire for it.
- **Telemetry.** Deliberately not on this socket. It goes to the buffered JSONL
  turn log (`turns.jsonl`, one line per turn, keyed by `turnId`), because a
  stream whose consumer is a device should carry updates and not LangGraph node
  bookkeeping.
