import { describe, expect, it } from 'vitest';
import { BroadcastChannelTransport, WebSocketTransport, broadcastChannelName } from '@/net/transport';
import type { WireMessage } from '@/net/protocol';

function wait(ms = 30): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('BroadcastChannelTransport', () => {
  it('two instances constructed with the same room code genuinely exchange messages — no server involved', async () => {
    const room = `test-room-${Math.random()}`;
    const a = new BroadcastChannelTransport(room);
    const b = new BroadcastChannelTransport(room);
    a.connect();
    b.connect();
    expect(a.status).toBe('open');
    expect(b.status).toBe('open');

    const received: WireMessage[] = [];
    b.onMessage((m) => received.push(m));

    const msg: WireMessage = { type: 'heartbeat', peerId: 'alice', gen: 42 };
    a.send(msg);
    await wait();

    expect(received).toEqual([msg]);
    a.disconnect();
    b.disconnect();
  });

  it('different room codes do not cross-talk', async () => {
    const a = new BroadcastChannelTransport(`room-a-${Math.random()}`);
    const b = new BroadcastChannelTransport(`room-b-${Math.random()}`);
    a.connect();
    b.connect();
    const received: WireMessage[] = [];
    b.onMessage((m) => received.push(m));
    a.send({ type: 'heartbeat', peerId: 'alice', gen: 1 });
    await wait();
    expect(received).toEqual([]);
    a.disconnect();
    b.disconnect();
  });

  it('namespaces every room under a stable, predictable channel name', () => {
    expect(broadcastChannelName('ABC123')).toBe('afterlife-mp:ABC123');
  });

  it('reports status transitions and stops delivering after disconnect', async () => {
    const room = `test-room-${Math.random()}`;
    const a = new BroadcastChannelTransport(room);
    const statuses: string[] = [];
    a.onStatusChange((s) => statuses.push(s));
    a.connect();
    expect(statuses).toEqual(['connecting', 'open']);
    a.disconnect();
    expect(statuses).toEqual(['connecting', 'open', 'closed']);
    a.send({ type: 'leave', peerId: 'x' }); // must not throw after disconnect
  });
});

describe('WebSocketTransport', () => {
  it('reports "unavailable" immediately when no URL is configured — never a hanging spinner', () => {
    const t = new WebSocketTransport({ url: null });
    const statuses: string[] = [];
    t.onStatusChange((s) => statuses.push(s));
    t.connect();
    expect(t.status).toBe('unavailable');
    expect(statuses).toEqual(['unavailable']);
  });

  it('reports "unavailable" for an empty-string URL too', () => {
    const t = new WebSocketTransport({ url: '' });
    t.connect();
    expect(t.status).toBe('unavailable');
  });

  it('connects, sends JSON frames, and delivers parsed messages — using an injected fake WebSocket', async () => {
    class FakeSocket {
      static OPEN = 1;
      readyState = 0;
      sent: string[] = [];
      onopen: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onmessage: ((ev: { data: string }) => void) | null = null;
      constructor(public url: string) {
        setTimeout(() => {
          this.readyState = 1;
          this.onopen?.();
        }, 0);
      }
      send(data: string): void {
        this.sent.push(data);
      }
      close(): void {
        this.readyState = 3;
        this.onclose?.();
      }
    }

    const t = new WebSocketTransport({ url: 'wss://example.invalid/room', WebSocketImpl: FakeSocket as unknown as typeof WebSocket });
    const statuses: string[] = [];
    t.onStatusChange((s) => statuses.push(s));
    t.connect();
    expect(t.status).toBe('connecting');
    await wait(5);
    expect(t.status).toBe('open');

    const msg: WireMessage = { type: 'heartbeat', peerId: 'alice', gen: 7 };
    t.send(msg);

    // Simulate the relay echoing a frame back.
    const socket = (t as unknown as { ws: FakeSocket }).ws;
    const received: WireMessage[] = [];
    t.onMessage((m) => received.push(m));
    socket.onmessage?.({ data: JSON.stringify(msg) });
    expect(received).toEqual([msg]);
    expect(socket.sent).toEqual([JSON.stringify(msg)]);

    t.disconnect();
    expect(statuses).toEqual(['connecting', 'open', 'closed']);
  });

  it('reconnects with backoff after an unexpected close, not a user-initiated one', async () => {
    let constructCount = 0;
    class FlakySocket {
      static OPEN = 1;
      readyState = 0;
      onopen: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onmessage: (() => void) | null = null;
      constructor(public url: string) {
        constructCount++;
        setTimeout(() => {
          this.readyState = 1;
          this.onopen?.();
          // Immediately die, as if the relay dropped the connection.
          setTimeout(() => this.onclose?.(), 0);
        }, 0);
      }
      send(): void {}
      close(): void {
        this.onclose?.();
      }
    }

    const t = new WebSocketTransport({
      url: 'wss://example.invalid/room',
      WebSocketImpl: FlakySocket as unknown as typeof WebSocket,
      baseBackoffMs: 1,
      maxBackoffMs: 5,
    });
    const statuses: string[] = [];
    t.onStatusChange((s) => statuses.push(s));
    t.connect();
    await wait(60);
    expect(constructCount).toBeGreaterThan(1); // it actually retried
    expect(statuses).toContain('reconnecting');
    t.disconnect();
  });
});
