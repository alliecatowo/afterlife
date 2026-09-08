import { describe, expect, it } from 'vitest';
import { createEngine } from '@/core/engine';
import type { EditOp } from '@/core/types';
import {
  DesyncMonitor,
  EditLog,
  LATENCY_BUFFER_GENS,
  StallTracker,
  compareStampedEdits,
  describeWorldMismatch,
  hashBits,
  stampEdit,
  type NetEditOp,
  type RoomWorldSpec,
  type StampedEdit,
} from '@/net/protocol';

function set(x: number, y: number, alive = true): NetEditOp {
  return { kind: 'set', cells: [{ x, y, alive }] };
}

const WORLD: RoomWorldSpec = { width: 16, height: 16, boundary: 'torus', rule: 'B3/S23' };

describe('stampEdit / compareStampedEdits', () => {
  it('stamps an edit LATENCY_BUFFER_GENS ahead of the sender local generation', () => {
    const e = stampEdit('a', 1, 100, set(1, 1));
    expect(e.originGen).toBe(100);
    expect(e.targetGen).toBe(100 + LATENCY_BUFFER_GENS);
  });

  it('orders by (targetGen, peerId, seq), deterministically, regardless of array order', () => {
    const a = stampEdit('alice', 1, 0, set(0, 0));
    const b = stampEdit('bob', 1, 0, set(1, 1));
    const c = stampEdit('alice', 2, 0, set(2, 2));
    // all three share the same targetGen (same originGen + buffer) -> tie-break on peerId then seq
    const shuffled1 = [c, a, b];
    const shuffled2 = [b, c, a];
    const sort = (xs: StampedEdit[]) => [...xs].sort(compareStampedEdits).map((e) => `${e.peerId}:${e.seq}`);
    expect(sort(shuffled1)).toEqual(sort(shuffled2));
    expect(sort(shuffled1)).toEqual(['alice:1', 'alice:2', 'bob:1']);
  });

  it('orders primarily by targetGen even when peerId/seq would disagree', () => {
    const early = stampEdit('zzz', 99, 0, set(0, 0));
    const late = stampEdit('aaa', 1, 5, set(1, 1));
    expect(compareStampedEdits(early, late)).toBeLessThan(0);
  });
});

describe('EditLog', () => {
  it('rejects a duplicate (peerId, seq) without re-applying it', () => {
    const log = new EditLog();
    const e = stampEdit('a', 1, 0, set(0, 0));
    expect(log.add(e)).toEqual({ ok: true });
    expect(log.add(e)).toEqual({ ok: false, reason: 'duplicate' });
    expect(log.editsAt(e.targetGen)).toHaveLength(1);
  });

  it('rejects an edit whose targetGen has already been applied — a late edit is DETECTED, not silently applied', () => {
    const log = new EditLog();
    log.markApplied(50);
    const lateEdit = stampEdit('a', 1, 30, set(0, 0), 10); // targetGen 40, already < 50
    const result = log.add(lateEdit);
    expect(result).toEqual({ ok: false, reason: 'late', deadline: 40 });
    expect(log.editsAt(40)).toHaveLength(0);
  });

  it('accepts an edit that is late-arriving but still before its own deadline', () => {
    const log = new EditLog();
    log.markApplied(10); // simulation has reached gen 10
    const edit = stampEdit('a', 1, 5, set(0, 0), 12); // targetGen 17 — still in the future
    expect(log.add(edit)).toEqual({ ok: true });
    expect(log.consume(17)).toEqual([edit]);
  });

  it('editsAt / consume return edits in the deterministic order regardless of insertion order', () => {
    const log1 = new EditLog();
    const log2 = new EditLog();
    const edits = [
      stampEdit('bob', 1, 0, set(0, 0), 5),
      stampEdit('alice', 3, 0, set(1, 1), 5),
      stampEdit('alice', 1, 0, set(2, 2), 5),
    ];
    for (const e of edits) log1.add(e);
    for (const e of [...edits].reverse()) log2.add(e);
    expect(log1.editsAt(5)).toEqual(log2.editsAt(5));
  });

  it('since() returns everything past a generation, for resync payloads', () => {
    const log = new EditLog();
    const e1 = stampEdit('a', 1, 0, set(0, 0), 5);
    const e2 = stampEdit('a', 2, 10, set(1, 1), 5);
    log.add(e1);
    log.add(e2);
    expect(log.since(5)).toEqual([e2]);
    expect(log.since(-1)).toEqual([e1, e2]);
  });
});

describe('StallTracker', () => {
  it('is unbounded (Infinity) with no known peers', () => {
    const t = new StallTracker(12);
    expect(t.safeGen()).toBe(Infinity);
  });

  it('safeGen is the slowest peer plus the buffer, minus one', () => {
    const t = new StallTracker(12);
    t.upsert('a', 20);
    t.upsert('b', 5);
    expect(t.safeGen()).toBe(5 + 12 - 1);
  });

  it('never lets a stale/out-of-order watermark move a peer backwards', () => {
    const t = new StallTracker(12);
    t.upsert('a', 20);
    t.upsert('a', 10); // stale — must be ignored
    expect(t.safeGen()).toBe(20 + 12 - 1);
  });

  it('reports exactly which peers are blocking a given target generation', () => {
    const t = new StallTracker(12);
    t.upsert('slow', 0);
    t.upsert('fast', 100);
    const blocking = t.blocking(11); // slow's ceiling is 0+12-1=11, so 11 is still safe
    expect(blocking).toEqual([]);
    const blocking2 = t.blocking(12); // 12 > 11, slow is now blocking
    expect(blocking2.map((b) => b.peerId)).toEqual(['slow']);
  });

  it('removing a peer lifts any stall it was causing', () => {
    const t = new StallTracker(12);
    t.upsert('slow', 0);
    expect(t.safeGen()).toBe(11);
    t.remove('slow');
    expect(t.safeGen()).toBe(Infinity);
  });
});

describe('hashBits / DesyncMonitor', () => {
  it('hashBits is deterministic and sensitive to any single bit', () => {
    const a = new Uint8Array([0, 1, 1, 0, 1]);
    const b = new Uint8Array([0, 1, 1, 0, 1]);
    const c = new Uint8Array([0, 1, 0, 0, 1]);
    expect(hashBits(a)).toBe(hashBits(b));
    expect(hashBits(a)).not.toBe(hashBits(c));
  });

  it('reports "unknown" before the local hash for that generation has been recorded', () => {
    const m = new DesyncMonitor();
    expect(m.check(64, 'deadbeef')).toEqual({ status: 'unknown' });
  });

  it('detects a real injected divergence between two otherwise-identical engines', () => {
    const engineA = createEngine({ width: 12, height: 12 });
    const engineB = createEngine({ width: 12, height: 12 });
    const glider: EditOp = { kind: 'set', cells: [{ x: 1, y: 0, alive: true }, { x: 2, y: 1, alive: true }, { x: 0, y: 2, alive: true }, { x: 1, y: 2, alive: true }, { x: 2, y: 2, alive: true }] };
    for (const c of glider.cells) { engineA.set(c.x, c.y, c.alive); engineB.set(c.x, c.y, c.alive); }
    for (let i = 0; i < 8; i++) { engineA.step(); engineB.step(); }
    // Identical histories so far — hashes must agree.
    const region = (e: typeof engineA) => e.region({ x: 0, y: 0, w: 12, h: 12 });
    expect(hashBits(region(engineA))).toBe(hashBits(region(engineB)));

    // Inject a real divergence: a cell flips on B that never happened on A —
    // simulating a bug or a cheat, not a normal replay path.
    engineB.set(5, 5, !engineB.get(5, 5));

    const monitor = new DesyncMonitor();
    monitor.recordLocal(engineA.gen, hashBits(region(engineA)));
    const result = monitor.check(engineB.gen, hashBits(region(engineB)));
    expect(result.status).toBe('mismatch');
  });

  it('prunes old hash points beyond its retention window', () => {
    const m = new DesyncMonitor(2);
    m.recordLocal(0, 'a');
    m.recordLocal(64, 'b');
    m.recordLocal(128, 'c'); // evicts gen 0
    expect(m.check(0, 'a').status).toBe('unknown');
    expect(m.check(128, 'c').status).toBe('match');
  });
});

describe('describeWorldMismatch', () => {
  it('is null for identical world specs', () => {
    expect(describeWorldMismatch(WORLD, { ...WORLD })).toBeNull();
  });

  it('names a size mismatch', () => {
    expect(describeWorldMismatch(WORLD, { ...WORLD, width: 8 })).toMatch(/size/);
  });

  it('names a rule mismatch — the rule is part of world identity', () => {
    expect(describeWorldMismatch(WORLD, { ...WORLD, rule: 'B36/S23' })).toMatch(/rule/);
  });
});
