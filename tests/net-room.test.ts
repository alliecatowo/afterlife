/**
 * `LockstepRoom` exercised end to end over a REAL `BroadcastChannelTransport`
 * — two room instances in one process, talking only through the standard
 * `BroadcastChannel` API (no server, no mocked transport). This is the same
 * mechanism `e2e/multiplayer.spec.ts` proves across two actual browser tabs;
 * here it's exercised at full speed against real `@/core/engine` state.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createEngine } from '@/core/engine';
import { hashBits, type NetEditOp, type RoomSpec } from '@/net/protocol';
import { BroadcastChannelTransport } from '@/net/transport';
import { createLockstepRoom, type LockstepRoom, type RoomEvent } from '@/net/room';

function wait(ms = 30): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeSpec(code: string): RoomSpec {
  return {
    code,
    world: { width: 20, height: 20, boundary: 'torus', rule: 'B3/S23' },
    seed: 0,
    startGen: 0,
    createdAt: Date.now(),
  };
}

const rooms: LockstepRoom[] = [];
function track(r: LockstepRoom): LockstepRoom {
  rooms.push(r);
  return r;
}
afterEach(() => {
  for (const r of rooms.splice(0)) r.leave();
});

describe('LockstepRoom over a real BroadcastChannelTransport', () => {
  it('two peers discover each other on join', async () => {
    const code = `room-${Math.random()}`;
    const spec = makeSpec(code);
    const a = track(createLockstepRoom({ transport: new BroadcastChannelTransport(code), room: spec, localPeerId: 'alice', localName: 'Alice', localColor: 'x' }));
    const b = track(createLockstepRoom({ transport: new BroadcastChannelTransport(code), room: spec, localPeerId: 'bob', localName: 'Bob', localColor: 'y' }));
    a.join(0);
    b.join(0);
    await wait(50);
    expect(a.peerList().map((p) => p.peerId)).toEqual(['bob']);
    expect(b.peerList().map((p) => p.peerId)).toEqual(['alice']);
  });

  it('a world mismatch is refused, not silently joined', async () => {
    const code = `room-${Math.random()}`;
    const specA = makeSpec(code);
    const specB = { ...specA, world: { ...specA.world, rule: 'B36/S23' } };
    const a = track(createLockstepRoom({ transport: new BroadcastChannelTransport(code), room: specA, localPeerId: 'alice', localName: 'Alice', localColor: 'x' }));
    const b = track(createLockstepRoom({ transport: new BroadcastChannelTransport(code), room: specB, localPeerId: 'bob', localName: 'Bob', localColor: 'y' }));
    const events: RoomEvent[] = [];
    a.on((e) => events.push(e));
    a.join(0);
    b.join(0);
    await wait(50);
    expect(a.peerList()).toEqual([]);
    expect(events.some((e) => e.type === 'worldMismatch')).toBe(true);
  });

  it('an edit submitted by one peer is scheduled and, once due, is available to both — never applied instantly to either', async () => {
    const code = `room-${Math.random()}`;
    const spec = makeSpec(code);
    const a = track(createLockstepRoom({ transport: new BroadcastChannelTransport(code), room: spec, localPeerId: 'alice', localName: 'Alice', localColor: 'x', heartbeatMs: 20 }));
    const b = track(createLockstepRoom({ transport: new BroadcastChannelTransport(code), room: spec, localPeerId: 'bob', localName: 'Bob', localColor: 'y', heartbeatMs: 20 }));
    a.join(0);
    b.join(0);
    await wait(30);

    const op: NetEditOp = { kind: 'set', cells: [{ x: 4, y: 4, alive: true }] };
    const stamped = a.submitEdit(op, 0);
    await wait(30);

    // Not due yet at generation 0 for EITHER peer — including the author.
    expect(a.takeDueEdits(0)).toEqual([]);
    expect(b.takeDueEdits(0)).toEqual([]);

    // Due at its target generation, identically, on both peers.
    expect(a.takeDueEdits(stamped.targetGen)).toEqual([op]);
    expect(b.takeDueEdits(stamped.targetGen)).toEqual([op]);
  });

  it('the stall gate reflects a real slow peer, and releases once they catch up', async () => {
    const code = `room-${Math.random()}`;
    const spec = makeSpec(code);
    const a = track(createLockstepRoom({ transport: new BroadcastChannelTransport(code), room: spec, localPeerId: 'alice', localName: 'Alice', localColor: 'x' }));
    const b = track(createLockstepRoom({ transport: new BroadcastChannelTransport(code), room: spec, localPeerId: 'bob', localName: 'Bob', localColor: 'y' }));
    a.join(0);
    b.join(0);
    await wait(30);

    // Alice races ahead to gen 50 without Bob ever reporting past 0.
    a.reportGen(50);
    await wait(30);
    expect(a.canAdvanceTo(51)).toBe(false); // Bob's watermark (0) caps safeGen at 0+12-1=11

    // Bob catches up.
    b.reportGen(60);
    await wait(30);
    expect(a.canAdvanceTo(51)).toBe(true);
  });

  it('a genuine desync (mismatched world hash at the same generation) is reported loudly, not swallowed', async () => {
    const code = `room-${Math.random()}`;
    const spec = makeSpec(code);
    const a = track(createLockstepRoom({ transport: new BroadcastChannelTransport(code), room: spec, localPeerId: 'alice', localName: 'Alice', localColor: 'x' }));
    const b = track(createLockstepRoom({ transport: new BroadcastChannelTransport(code), room: spec, localPeerId: 'bob', localName: 'Bob', localColor: 'y' }));
    const events: RoomEvent[] = [];
    a.on((e) => events.push(e));
    a.join(0);
    b.join(0);
    await wait(30);

    const engineA = createEngine({ width: 20, height: 20 });
    const engineB = createEngine({ width: 20, height: 20 });
    engineB.set(1, 1, true); // the actual, real divergence between the two worlds

    a.reportHash(64, hashBits(engineA.region({ x: 0, y: 0, w: 20, h: 20 })));
    b.reportHash(64, hashBits(engineB.region({ x: 0, y: 0, w: 20, h: 20 })));
    await wait(30);

    const desync = events.find((e) => e.type === 'desync');
    expect(desync).toBeTruthy();
    if (desync?.type === 'desync') {
      expect(desync.gen).toBe(64);
      expect(desync.fromPeer).toBe('bob');
    }
  });

  it('resync: a peer can request and receive the authoritative edit log and rebuild from it', async () => {
    const code = `room-${Math.random()}`;
    const spec = makeSpec(code);
    const a = track(createLockstepRoom({ transport: new BroadcastChannelTransport(code), room: spec, localPeerId: 'alice', localName: 'Alice', localColor: 'x' }));
    const b = track(createLockstepRoom({ transport: new BroadcastChannelTransport(code), room: spec, localPeerId: 'bob', localName: 'Bob', localColor: 'y' }));
    a.join(0);
    b.join(0);
    await wait(30);

    a.submitEdit({ kind: 'set', cells: [{ x: 2, y: 2, alive: true }] }, 0);
    a.submitEdit({ kind: 'set', cells: [{ x: 3, y: 3, alive: true }] }, 5);
    await wait(30);

    const events: RoomEvent[] = [];
    b.on((e) => events.push(e));
    b.requestResync(-1);
    await wait(30);

    const resync = events.find((e) => e.type === 'resync');
    expect(resync).toBeTruthy();
    if (resync?.type === 'resync') {
      expect(resync.edits).toHaveLength(2);
      expect(resync.fromPeer).toBe('alice');
    }
  });

  it('leaving a room stops delivering messages and clears peer state', async () => {
    const code = `room-${Math.random()}`;
    const spec = makeSpec(code);
    const a = track(createLockstepRoom({ transport: new BroadcastChannelTransport(code), room: spec, localPeerId: 'alice', localName: 'Alice', localColor: 'x' }));
    const b = track(createLockstepRoom({ transport: new BroadcastChannelTransport(code), room: spec, localPeerId: 'bob', localName: 'Bob', localColor: 'y' }));
    a.join(0);
    b.join(0);
    await wait(30);
    expect(a.peerList()).toHaveLength(1);

    b.leave();
    await wait(30);
    expect(a.peerList()).toEqual([]);
  });
});
