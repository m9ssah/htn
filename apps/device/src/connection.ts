import type { SurfaceUpdate } from '@jit/schema';

/**
 * The device's end of the wire protocol (`docs/wire-protocol.md`).
 *
 * Replaces `script.ts` as what drives the shell: utterances go out, surface
 * updates come back, and the shell applies them in arrival order. Nothing
 * here knows what a recipe, a template or a slot is.
 *
 * **No offline fallback to the scripted demo.** A device that silently
 * replayed canned beats when the server was unreachable would look exactly
 * like a working device — which is the failure CLAUDE.md constraint 5 names,
 * and the worst possible version of it on stage. A dropped connection is
 * surfaced as a state the shell can show, and the surface already painted
 * stays up.
 */

export const WIRE_PROTOCOL_VERSION = 1;

export type ServerMessage =
  | { type: 'hello'; protocol: number }
  | { type: 'turn-start'; turnId: string }
  | { type: 'update'; turnId: string; seq: number; update: SurfaceUpdate }
  | { type: 'turn-end'; turnId: string; outcome: 'ok' | 'aborted' | 'crashed'; updates: number }
  | { type: 'error'; reason: string };

export type ConnectionStatus = 'connecting' | 'live' | 'down';

export type ConnectionHandlers = {
  onStatus(status: ConnectionStatus, detail?: string): void;
  onTurnStart(turnId: string): void;
  onUpdate(update: SurfaceUpdate, seq: number): void;
  onTurnEnd(outcome: 'ok' | 'aborted' | 'crashed', updates: number): void;
  onError(reason: string): void;
};

export type Connection = {
  /** Where this device is trying to reach the server. Shown when it cannot. */
  readonly url: string;
  say(text: string): boolean;
  /** Tell the server how much room a surface actually has. */
  viewport(width: number, height: number): boolean;
  act(action: string, elementId: string, value?: string | number | boolean): boolean;
  readonly status: ConnectionStatus;
};

/** ws:// on the same host by default; `?server=` overrides it for a Pi on the bench. */
function serverUrl(): string {
  const override = new URLSearchParams(window.location.search).get('server');
  if (override) return override;
  const host = window.location.hostname || '127.0.0.1';
  return `ws://${host}:8787`;
}

/** 1013 "Try Again Later", 1012 "Service Restart" — see `ws-server.ts`. */
const TRY_AGAIN_LATER = 1013;
const REPLACED = 1012;

export function connect(handlers: ConnectionHandlers): Connection {
  let socket: WebSocket | null = null;
  let status: ConnectionStatus = 'connecting';
  // Backs off so a server that is down does not become a reconnect storm, but
  // stays fast enough that restarting the server mid-demo recovers on its own.
  let retryMs = 500;
  let retryTimer = 0;

  const setStatus = (next: ConnectionStatus, detail?: string): void => {
    if (status === next) return;
    status = next;
    handlers.onStatus(next, detail);
  };

  const open = (): void => {
    // Never race two sockets. The server allows exactly one device, so a
    // second one in flight is guaranteed to be refused — and each refusal
    // would schedule another retry, which is how a single stray attempt
    // becomes a permanent reconnect storm.
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
    window.clearTimeout(retryTimer);

    const url = serverUrl();
    setStatus('connecting');
    const ws = new WebSocket(url);
    socket = ws;
    const openedAt = Date.now();

    ws.addEventListener('open', () => {
      setStatus('live', url);
    });

    ws.addEventListener('message', (event: MessageEvent<string>) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(event.data) as ServerMessage;
      } catch {
        handlers.onError('server sent a frame that was not JSON');
        return;
      }
      switch (message.type) {
        case 'hello':
          // A version skew must fail loudly: past this point every frame
          // would be misread, and misreading a surface update paints
          // something nobody asked for.
          if (message.protocol !== WIRE_PROTOCOL_VERSION) {
            handlers.onError(`protocol skew: server speaks v${message.protocol}, device speaks v${WIRE_PROTOCOL_VERSION}`);
            ws.close();
          }
          return;
        case 'turn-start':
          handlers.onTurnStart(message.turnId);
          return;
        case 'update':
          // Passed through exactly as it arrived — the renderer discriminates
          // style/polish on `'theme' in`/`'tokens' in`, so normalising
          // anything here would invent contract (see wire.ts).
          handlers.onUpdate(message.update, message.seq);
          return;
        case 'turn-end':
          handlers.onTurnEnd(message.outcome, message.updates);
          return;
        case 'error':
          handlers.onError(message.reason);
          return;
      }
    });

    const reopen = (why: string): void => {
      if (socket !== ws) return;
      socket = null;
      setStatus('down', why);
      /**
       * Only a connection that actually held resets the backoff.
       *
       * The server ACCEPTS a second device and then closes it with 1013, so
       * `open` fires on a refused socket too. Resetting `retryMs` there made
       * every refusal retry in 500ms for ever — a fixed-cadence storm that
       * never backed off, which is exactly what the server log showed.
       */
      if (Date.now() - openedAt > 3000) retryMs = 500;
      retryTimer = window.setTimeout(open, retryMs);
      retryMs = Math.min(retryMs * 2, 8000);
    };

    ws.addEventListener('close', (event: CloseEvent) => {
      if (event.code === REPLACED) {
        /**
         * A newer connection took the session. Almost always this page is the
         * one being replaced — by its own reload — so reconnecting would
         * bounce the session back and forth between two dying contexts.
         * Stop, and say so.
         */
        socket = null;
        setStatus('down', 'replaced by a newer connection');
        return;
      }
      reopen(event.code === TRY_AGAIN_LATER
        ? 'another device is already connected'
        : 'connection closed');
    });
    ws.addEventListener('error', () => reopen('connection error'));
  };

  open();

  const send = (payload: unknown): boolean => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(payload));
    return true;
  };

  return {
    url: serverUrl(),
    say: (text) => send({ type: 'utterance', text }),
    viewport: (width, height) => send({ type: 'viewport', width, height }),
    act: (action, elementId, value) => send({ type: 'action', action, elementId, ...(value !== undefined ? { value } : {}) }),
    get status(): ConnectionStatus {
      return status;
    },
  };
}
