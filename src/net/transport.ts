/**
 * AFTERLIFE multiplayer — transports.
 *
 * A `Transport` just moves `WireMessage`s (see `./protocol`) between peers;
 * it has no opinion about lockstep, ordering, or simulation — that's
 * `./room.ts`. Two implementations:
 *
 *  - `BroadcastChannelTransport`: works TODAY, with no server and no
 *    account. Multiple tabs of the same browser, on the same origin,
 *    joining the same room code genuinely exchange messages via the
 *    standard `BroadcastChannel` API. This is not a stand-in for a future
 *    server — it IS the local multiplayer transport, and it's how
 *    `e2e/multiplayer.spec.ts` proves the lockstep engine end to end with
 *    two real browser tabs and zero network activity.
 *  - `WebSocketTransport`: a real client for a relay, reachable once one is
 *    configured (see `docs/MULTIPLAYER.md`'s hosting section). With no URL
 *    configured it reports `'unavailable'` immediately — never a hanging
 *    "connecting…" spinner — because a relay is optional infrastructure,
 *    not a requirement to use the app.
 *
 * Neither transport is ever constructed unless a caller explicitly creates
 * one (from `src/ui/multiplayer/**` in response to "Host" or "Join") — see
 * `tests/ui-multiplayer-guard.test.ts` for the assertion that nothing here
 * runs by default.
 */
import type { WireMessage } from './protocol';

export interface Disposable {
  dispose(): void;
}

export type TransportStatus =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'closed'
  | 'unavailable'
  | 'error';

export interface Transport {
  readonly status: TransportStatus;
  connect(): void;
  disconnect(): void;
  send(msg: WireMessage): void;
  onMessage(cb: (msg: WireMessage) => void): Disposable;
  onStatusChange(cb: (status: TransportStatus) => void): Disposable;
}

abstract class BaseTransport implements Transport {
  protected messageHandlers = new Set<(m: WireMessage) => void>();
  protected statusHandlers = new Set<(s: TransportStatus) => void>();
  protected _status: TransportStatus = 'idle';

  get status(): TransportStatus {
    return this._status;
  }

  protected setStatus(s: TransportStatus): void {
    if (this._status === s) return;
    this._status = s;
    for (const h of [...this.statusHandlers]) h(s);
  }

  protected deliver(msg: WireMessage): void {
    for (const h of [...this.messageHandlers]) h(msg);
  }

  onMessage(cb: (msg: WireMessage) => void): Disposable {
    this.messageHandlers.add(cb);
    return { dispose: () => this.messageHandlers.delete(cb) };
  }

  onStatusChange(cb: (status: TransportStatus) => void): Disposable {
    this.statusHandlers.add(cb);
    return { dispose: () => this.statusHandlers.delete(cb) };
  }

  abstract connect(): void;
  abstract disconnect(): void;
  abstract send(msg: WireMessage): void;
}

/** Namespaces every room's channel so unrelated tabs/rooms never cross-talk. */
export function broadcastChannelName(roomCode: string): string {
  return `afterlife-mp:${roomCode}`;
}

/**
 * A real transport backed by the standard `BroadcastChannel` API — same-
 * origin, cross-tab/cross-frame messaging with no server involved at all.
 * This is the entire mechanism that lets "open two tabs" be genuine
 * multiplayer: both tabs' `BroadcastChannel` instances constructed with the
 * same name ARE connected to each other by the browser, immediately, for
 * free.
 */
export class BroadcastChannelTransport extends BaseTransport {
  private channel: BroadcastChannel | null = null;

  constructor(private readonly roomCode: string) {
    super();
  }

  connect(): void {
    if (this.channel) return;
    if (typeof BroadcastChannel === 'undefined') {
      // No hanging state: this environment simply cannot do this. Callers
      // (see `room.ts`) surface this status directly rather than retrying.
      this.setStatus('unavailable');
      return;
    }
    this.setStatus('connecting');
    const channel = new BroadcastChannel(broadcastChannelName(this.roomCode));
    channel.onmessage = (ev: MessageEvent) => this.deliver(ev.data as WireMessage);
    this.channel = channel;
    this.setStatus('open');
  }

  disconnect(): void {
    this.channel?.close();
    this.channel = null;
    this.setStatus('closed');
  }

  send(msg: WireMessage): void {
    this.channel?.postMessage(msg);
  }
}

export interface WebSocketTransportOptions {
  /** Relay URL, e.g. `wss://relay.example.com/room/ABC123`. `null`/`undefined`/
   *  empty means "no relay configured" — `connect()` reports `'unavailable'`
   *  synchronously rather than attempting anything. */
  url: string | null | undefined;
  /** First reconnect delay, ms. Doubles (with jitter) up to `maxBackoffMs`. */
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  /** Injectable for tests; defaults to the global `WebSocket`. */
  WebSocketImpl?: typeof WebSocket;
}

/**
 * A real WebSocket client, ready to point at a relay once one exists (see
 * `docs/MULTIPLAYER.md`). Reconnects with exponential backoff + jitter on an
 * unexpected close, and always reports an honest `TransportStatus` rather
 * than leaving a caller to infer connection state from silence.
 */
export class WebSocketTransport extends BaseTransport {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private closedByUser = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: WebSocketTransportOptions) {
    super();
  }

  connect(): void {
    if (!this.options.url) {
      this.setStatus('unavailable');
      return;
    }
    const Impl = this.options.WebSocketImpl ?? (typeof WebSocket !== 'undefined' ? WebSocket : undefined);
    if (!Impl) {
      this.setStatus('unavailable');
      return;
    }
    this.closedByUser = false;
    this.attempt = 0;
    this.open(Impl);
  }

  private open(Impl: typeof WebSocket): void {
    this.setStatus(this.attempt === 0 ? 'connecting' : 'reconnecting');
    let ws: WebSocket;
    try {
      ws = new Impl(this.options.url!);
    } catch {
      this.setStatus('error');
      this.scheduleReconnect(Impl);
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.setStatus('open');
    };
    ws.onmessage = (ev: MessageEvent) => {
      try {
        this.deliver(JSON.parse(ev.data as string) as WireMessage);
      } catch {
        // Malformed frame from the relay — ignore rather than crash the room.
      }
    };
    ws.onclose = () => {
      this.ws = null;
      if (this.closedByUser) {
        this.setStatus('closed');
        return;
      }
      this.scheduleReconnect(Impl);
    };
    ws.onerror = () => {
      this.setStatus('error');
    };
  }

  private scheduleReconnect(Impl: typeof WebSocket): void {
    this.attempt++;
    const base = this.options.baseBackoffMs ?? 500;
    const max = this.options.maxBackoffMs ?? 15_000;
    const delay = Math.min(max, base * 2 ** (this.attempt - 1)) * (0.75 + Math.random() * 0.5);
    this.setStatus('reconnecting');
    this.reconnectTimer = setTimeout(() => this.open(Impl), delay);
  }

  disconnect(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.setStatus('closed');
  }

  send(msg: WireMessage): void {
    if (this.ws?.readyState === (globalThis.WebSocket ? globalThis.WebSocket.OPEN : 1)) {
      this.ws.send(JSON.stringify(msg));
    }
  }
}
