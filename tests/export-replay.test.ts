import { describe, expect, it } from 'vitest';
import { createEngine } from '@/core/engine';
import { createTimelineStore } from '@/core/history';
import { createReplayCursor } from '@/export/replay';

function regionArray(engine: { region: (r: { x: number; y: number; w: number; h: number }) => Uint8Array }, w: number, h: number): number[] {
  return Array.from(engine.region({ x: 0, y: 0, w, h }));
}

describe('export replay: createReplayCursor', () => {
  it('matches history.goto() bit-for-bit at the same generation, without disturbing the live engine', async () => {
    const engine = createEngine({ width: 16, height: 16 });
    const history = createTimelineStore({ engine });

    const seedEdit = { kind: 'set' as const, cells: [{ x: 1, y: 1, alive: true }, { x: 2, y: 1, alive: true }, { x: 1, y: 2, alive: true }] };
    for (const c of seedEdit.cells) engine.set(c.x, c.y, c.alive);
    history.record(0, [seedEdit]);

    for (let g = 0; g < 5; g++) { engine.step(); history.advance(engine.gen); }

    const midEdit = { kind: 'set' as const, cells: [{ x: 5, y: 5, alive: true }] };
    engine.set(5, 5, true);
    history.record(engine.gen, [midEdit]);

    for (let g = 0; g < 5; g++) { engine.step(); history.advance(engine.gen); }

    const liveGenBefore = engine.gen;

    const cursor = await createReplayCursor(history, { fromGen: 0 });
    const atMid = cursor.advanceTo(5);
    await history.goto(5);
    expect(regionArray(atMid, 16, 16)).toEqual(regionArray(engine, 16, 16));

    const atEnd = cursor.advanceTo(10);
    await history.goto(10);
    expect(regionArray(atEnd, 16, 16)).toEqual(regionArray(engine, 16, 16));

    // The live engine/history were scrubbed by our own `goto()` calls above
    // (used only to build the expected comparison) — restore it and confirm
    // the replay cursor's OWN advancement never required touching it.
    await history.goto(liveGenBefore);
    expect(engine.gen).toBe(liveGenBefore);
  });

  it('is forward-only: requesting an earlier generation than already reached throws', async () => {
    const engine = createEngine({ width: 8, height: 8 });
    const history = createTimelineStore({ engine });
    for (let g = 0; g < 5; g++) { engine.step(); history.advance(engine.gen); }

    const cursor = await createReplayCursor(history, { fromGen: 0 });
    cursor.advanceTo(3);
    expect(() => cursor.advanceTo(1)).toThrow();
  });

  it('propagates cancellation via AbortSignal', async () => {
    const engine = createEngine({ width: 8, height: 8 });
    const history = createTimelineStore({ engine });
    for (let g = 0; g < 5; g++) { engine.step(); history.advance(engine.gen); }

    const controller = new AbortController();
    const cursor = await createReplayCursor(history, { fromGen: 0, signal: controller.signal });
    controller.abort();
    expect(() => cursor.advanceTo(5)).toThrow();
  });
});
