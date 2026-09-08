/**
 * The core claim of the multiplayer design: two independent engines, fed the
 * SAME stream of edits through the lockstep protocol (`@/net/protocol`),
 * converge bit-identically — including edits that arrive out of order, and
 * edits that arrive late but still before their own deadline. This is
 * deliberately at the `EditLog`/`StallTracker` level rather than through a
 * `Transport` (see `tests/net-room.test.ts` for the transport-level version)
 * so the determinism claim is tested against real `@/core/engine` state
 * with nothing else (timers, message scheduling) able to introduce noise.
 */
import { describe, expect, it } from 'vitest';
import { createEngine } from '@/core/engine';
import { EditLog, StallTracker, stampEdit, type NetEditOp } from '@/net/protocol';

const WIDTH = 24;
const HEIGHT = 24;
const BUFFER = 6;

function netSet(x: number, y: number, alive = true): NetEditOp {
  return { kind: 'set', cells: [{ x, y, alive }] };
}

/**
 * Drives an engine forward to `toGen`, pulling due edits out of `log` at
 * each generation boundary exactly like `@/ui/session.ts`'s multiplayer
 * hook does (`multiplayerEditSource` applied via direct `set()`, then
 * `step()`). Mirrors the real integration path closely enough to be a
 * faithful proxy for it.
 */
function driveWithLog(log: EditLog, toGen: number) {
  const engine = createEngine({ width: WIDTH, height: HEIGHT });
  while (engine.gen < toGen) {
    const due = log.consume(engine.gen);
    for (const e of due) for (const c of e.op.cells) engine.set(c.x, c.y, c.alive);
    engine.step();
  }
  return engine;
}

describe('lockstep convergence', () => {
  it('two independent engines fed the same edits converge bit-identically, in ANY arrival order', () => {
    const editsInSubmitOrder = [
      stampEdit('alice', 1, 0, netSet(3, 3), BUFFER),
      stampEdit('bob', 1, 2, netSet(3, 3, false), BUFFER), // same cell, later submit — must win deterministically for BOTH peers
      stampEdit('alice', 2, 4, netSet(10, 10), BUFFER),
      stampEdit('bob', 2, 4, netSet(10, 10, false), BUFFER), // same targetGen as alice#2 — tiebreak by peerId
      stampEdit('alice', 3, 9, netSet(1, 1), BUFFER),
    ];

    const logA = new EditLog();
    const logB = new EditLog();
    // Peer A receives them in submit order; peer B receives them scrambled
    // (simulating arbitrary network arrival order) — the deterministic
    // (targetGen, peerId, seq) ordering must make this not matter.
    const scrambled = [editsInSubmitOrder[2]!, editsInSubmitOrder[0]!, editsInSubmitOrder[4]!, editsInSubmitOrder[3]!, editsInSubmitOrder[1]!];
    for (const e of editsInSubmitOrder) logA.add(e);
    for (const e of scrambled) logB.add(e);

    const toGen = 20;
    const engineA = driveWithLog(logA, toGen);
    const engineB = driveWithLog(logB, toGen);

    expect(engineA.snapshot().bits).toEqual(engineB.snapshot().bits);
    expect(engineA.gen).toBe(engineB.gen);
  });

  it('an edit delivered late (network delay) but still before its scheduled deadline is applied identically to a promptly-delivered one', () => {
    const edit = stampEdit('alice', 1, 0, netSet(5, 5), BUFFER); // targetGen = 6

    const promptLog = new EditLog();
    promptLog.add(edit); // delivered "immediately"

    const delayedLog = new EditLog();
    // Simulate the receiving peer having already stepped a few generations
    // before the edit shows up over the wire — still fine, since 6 > 3.
    delayedLog.markApplied(3);
    const result = delayedLog.add(edit);
    expect(result).toEqual({ ok: true });

    const toGen = 10;
    expect(driveWithLog(promptLog, toGen).snapshot().bits).toEqual(driveWithLog(delayedLog, toGen).snapshot().bits);
  });

  it('an edit arriving AFTER its deadline is detected and rejected, never silently applied', () => {
    const log = new EditLog();
    log.markApplied(6); // this peer has already simulated past generation 6
    const tooLate = stampEdit('alice', 1, 0, netSet(5, 5), BUFFER); // targetGen 6, already applied
    const result = log.add(tooLate);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('late');
    // And critically: it must not silently take effect later either.
    expect(log.editsAt(6)).toHaveLength(0);
  });

  it('the stall gate blocks advancing past a generation a known peer has not yet vouched for, and releases the instant it has', () => {
    const stall = new StallTracker(BUFFER);
    stall.upsert('me', 0);
    stall.upsert('peer', 0);
    // Both at gen 0: safe up to 0 + 6 - 1 = 5.
    expect(stall.safeGen()).toBe(5);
    expect(stall.blocking(6).map((b) => b.peerId)).toContain('peer');

    // Both advance together to gen 4.
    stall.upsert('me', 4);
    stall.upsert('peer', 4);
    expect(stall.safeGen()).toBe(9);
    expect(stall.blocking(6)).toEqual([]);
  });

  it('hosting a room with no one else joined yet never stalls solo play: the local peer keeps re-reporting its own generation every tick, which always stays >= 1 generation ahead of what advancing needs (buffer >= 2)', () => {
    const stall = new StallTracker(BUFFER);
    for (let gen = 0; gen < 50; gen++) {
      stall.upsert('me', gen); // mirrors `LockstepRoom.reportGen` on every `gen:changed`
      expect(stall.safeGen()).toBeGreaterThanOrEqual(gen + 1);
    }
  });
});
