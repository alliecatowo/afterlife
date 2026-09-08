import { expect, test } from '@playwright/test';

/**
 * Proves the lockstep engine end to end with TWO REAL browser tabs and a
 * REAL `BroadcastChannel` — no server, no mock transport. This is exactly
 * the claim `docs/MULTIPLAYER.md` makes: "open two tabs and it genuinely
 * works". Each tab dynamically imports the actual shipped `src/net/**`
 * modules (Vite's dev server transforms and serves any module under `src/`
 * on request, not just ones reachable from `index.html` — verified by
 * curling `/src/net/protocol.ts` directly) and drives a real
 * `@/core/engine` with them, independently of the app's own mounted
 * session (this test never touches `App.tsx`'s UI, which doesn't import
 * multiplayer at all — see `tests/net-guard.test.ts`).
 *
 * Deliberately does not go through `src/ui/multiplayer/**`'s React UI: that
 * component tree is covered by `tests/ui-multiplayer-panel.test.tsx`
 * (jsdom/RTL, the right tool for interactive React behaviour). What can
 * only be proven in a real browser is the transport — two independent
 * `BroadcastChannel` instances in two independent tabs actually talking to
 * each other — which is exactly what this test drives directly.
 *
 * Both tabs tick their engine forward on their own `requestAnimationFrame`,
 * completely independently and at whatever real wall-clock rate the browser
 * gives each tab (a backgrounded/inactive tab is throttled by Chromium —
 * that's real and expected, and exactly what the stall gate exists for).
 * Comparing "whatever generation each tab happens to be at right now" would
 * be comparing two different moments of a MOVING glider — not a bug in the
 * lockstep engine, just a race in a naive test. So each tab is told a fixed
 * `stopAtGen` and freezes itself there; the comparison only happens once
 * BOTH have reached that exact same generation.
 */

declare global {
  interface Window {
    __mp?: {
      engine: { gen: number; region(r: { x: number; y: number; w: number; h: number }): Uint8Array };
      room: {
        peerList(): unknown[];
        submitEdit(op: unknown, gen: number): { targetGen: number };
        canAdvanceTo(gen: number): boolean;
      };
      setStopAt(gen: number): void;
    };
  }
}

const WORLD = 32;

async function setupPeer(page: import('@playwright/test').Page, roomCode: string, peerId: string, name: string): Promise<void> {
  await page.evaluate(
    async ({ roomCode, peerId, name, WORLD }) => {
      const { BroadcastChannelTransport } = await import('/src/net/transport.ts');
      const { createLockstepRoom } = await import('/src/net/room.ts');
      const { hashBits } = await import('/src/net/protocol.ts');
      const { createEngine } = await import('/src/core/engine.ts');

      const engine = createEngine({ width: WORLD, height: WORLD });
      const spec = {
        code: roomCode,
        world: { width: WORLD, height: WORLD, boundary: 'torus' as const, rule: 'B3/S23' },
        seed: 0,
        startGen: 0,
        createdAt: Date.now(),
      };
      const room = createLockstepRoom({
        transport: new BroadcastChannelTransport(roomCode),
        room: spec,
        localPeerId: peerId,
        localName: name,
        localColor: 'x',
      });
      room.join(0);

      let stopAtGen = Infinity;
      const tick = () => {
        // Frozen at the agreed comparison point — see the module doc. Not a
        // stall (the room may well still consider it safe to go further);
        // this is purely the test pinning both tabs to the same generation
        // before reading their worlds.
        if (engine.gen < stopAtGen) {
          const nextGen = engine.gen + 1;
          if (room.canAdvanceTo(nextGen)) {
            const due = room.takeDueEdits(engine.gen);
            for (const op of due as Array<{ cells: Array<{ x: number; y: number; alive: boolean }> }>) {
              for (const c of op.cells) engine.set(c.x, c.y, c.alive);
            }
            engine.step();
            room.reportGen(engine.gen);
            if (engine.gen % 8 === 0) {
              room.reportHash(engine.gen, hashBits(engine.region({ x: 0, y: 0, w: WORLD, h: WORLD })));
            }
          }
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);

      window.__mp = {
        engine,
        room,
        setStopAt: (gen: number) => {
          stopAtGen = gen;
        },
      };
    },
    { roomCode, peerId, name, WORLD },
  );
}

test.describe('multiplayer — two real browser tabs, one real BroadcastChannel room', () => {
  test('peer A draws, peer B converges to the identical world, and both hash equal', async ({ context }) => {
    const roomCode = `mp-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const pageA = await context.newPage();
    const pageB = await context.newPage();

    // Same-origin document is all that's required for BroadcastChannel and
    // dynamic `import()` of the dev server's modules — the running app's own
    // opening scene underneath is irrelevant to (and untouched by) this test.
    await pageA.goto('/');
    await pageB.goto('/');

    await setupPeer(pageA, roomCode, 'alice', 'Alice');
    await setupPeer(pageB, roomCode, 'bob', 'Bob');

    // Real presence: each tab's BroadcastChannel genuinely reaches the other.
    await expect.poll(() => pageA.evaluate(() => window.__mp!.room.peerList().length)).toBe(1);
    await expect.poll(() => pageB.evaluate(() => window.__mp!.room.peerList().length)).toBe(1);

    // Peer A draws a glider. Never applied instantly — scheduled
    // `LATENCY_BUFFER_GENS` generations into the future for EVERY peer,
    // including Alice herself (see `@/net/protocol`'s module doc).
    const targetGen = await pageA.evaluate(() => {
      const op = {
        kind: 'set',
        cells: [
          { x: 5, y: 5, alive: true },
          { x: 6, y: 6, alive: true },
          { x: 4, y: 7, alive: true },
          { x: 5, y: 7, alive: true },
          { x: 6, y: 7, alive: true },
        ],
      };
      return window.__mp!.room.submitEdit(op, window.__mp!.engine.gen).targetGen;
    });

    // Pin both tabs to the SAME future generation — comfortably past the
    // edit's deadline, and past the point where either tab could still be
    // gated waiting on the other (see the module doc on why this avoids a
    // moving-target comparison, not a lockstep correctness issue).
    const stopAtGen = targetGen + 20;
    await pageA.evaluate((g) => window.__mp!.setStopAt(g), stopAtGen);
    await pageB.evaluate((g) => window.__mp!.setStopAt(g), stopAtGen);

    await expect.poll(() => pageA.evaluate(() => window.__mp!.engine.gen), { timeout: 20_000 }).toBe(stopAtGen);
    await expect.poll(() => pageB.evaluate(() => window.__mp!.engine.gen), { timeout: 20_000 }).toBe(stopAtGen);

    const [regionA, regionB] = await Promise.all([
      pageA.evaluate((w) => Array.from(window.__mp!.engine.region({ x: 0, y: 0, w, h: w })), WORLD),
      pageB.evaluate((w) => Array.from(window.__mp!.engine.region({ x: 0, y: 0, w, h: w })), WORLD),
    ]);

    // The glider actually landed — this isn't "both empty, trivially equal".
    expect(regionA.some(Boolean)).toBe(true);
    // And both peers computed the exact same world, at the exact same
    // generation, from the same edit log.
    expect(regionA).toEqual(regionB);
  });
});
