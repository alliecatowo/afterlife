import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CATALOGUE_SIZE, SURVIVAL_GENERATIONS, TRAVELLER_OBSERVATIONS } from '@/content/achievements';

/**
 * `@/ui/achievements/store.ts` wires itself up via module-level `bus.on(...)`
 * calls (same shape as `@/ui/discoveries.ts`/`@/ui/experiments.ts`, neither
 * of which has its own unit test either — this one exists because the
 * achievements logbook's entire job IS deciding when real state earns an
 * entry, so that decision logic is worth covering directly rather than only
 * through e2e). Every test re-imports both the bus and the store fresh via
 * `vi.resetModules()` — the exact pattern `tests/tutorial-store.test.ts`
 * already uses — so one test's module-level counters (`maxGenSeen`, the
 * catalogue's `Set`, ...) never leak into the next.
 */
async function freshWiring() {
  vi.resetModules();
  const busMod = await import('@/ui/bus');
  const storeMod = await import('@/ui/achievements/store');
  const discoveriesMod = await import('@/ui/discoveries');
  return { bus: busMod.bus, useAchievements: storeMod.useAchievements, useDiscoveries: discoveriesMod.useDiscoveries };
}

describe('achievements store: real-state triggers', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    window.localStorage.clear();
  });

  it('unlocks "extinction-witnessed" when population drops to zero after gen 0, never on the initial empty read', async () => {
    const { bus, useAchievements } = await freshWiring();
    bus.emit('gen:changed', { gen: 0, population: 0 });
    expect(useAchievements.getState().log['extinction-witnessed']).toBeUndefined();

    bus.emit('gen:changed', { gen: 1, population: 5 });
    bus.emit('gen:changed', { gen: 2, population: 0 });
    expect(useAchievements.getState().log['extinction-witnessed']?.gen).toBe(2);
  });

  it('unlocks "survived" once the alive streak reaches SURVIVAL_GENERATIONS', async () => {
    const { bus, useAchievements } = await freshWiring();
    bus.emit('gen:changed', { gen: SURVIVAL_GENERATIONS - 1, population: 3 });
    expect(useAchievements.getState().log.survived).toBeUndefined();
    bus.emit('gen:changed', { gen: SURVIVAL_GENERATIONS, population: 3 });
    expect(useAchievements.getState().log.survived?.gen).toBe(SURVIVAL_GENERATIONS);
  });

  it('a prior extinction resets the survival clock', async () => {
    const { bus, useAchievements } = await freshWiring();
    bus.emit('gen:changed', { gen: 5, population: 5 });
    bus.emit('gen:changed', { gen: 10, population: 0 }); // extinction — clock resets to gen 10
    bus.emit('gen:changed', { gen: 10 + SURVIVAL_GENERATIONS - 1, population: 5 });
    expect(useAchievements.getState().log.survived).toBeUndefined();
    bus.emit('gen:changed', { gen: 10 + SURVIVAL_GENERATIONS, population: 5 });
    expect(useAchievements.getState().log.survived).toBeDefined();
  });

  it('unlocks "scrub-backward" only when scrubbing to a gen below the highest ever reached, and only when the scrub is "done"', async () => {
    const { bus, useAchievements } = await freshWiring();
    bus.emit('gen:changed', { gen: 100, population: 5 });

    bus.emit('playback:scrub', { gen: 40, done: false });
    expect(useAchievements.getState().log['scrub-backward']).toBeUndefined();

    bus.emit('playback:scrub', { gen: 150, done: true }); // forward, not backward
    expect(useAchievements.getState().log['scrub-backward']).toBeUndefined();

    bus.emit('playback:scrub', { gen: 40, done: true });
    expect(useAchievements.getState().log['scrub-backward']?.gen).toBe(40);
  });

  it('unlocks "first-fork" for a real fork (fromGen > 0), not the automatic one-cell sibling branch (fromGen === 0)', async () => {
    const { bus, useAchievements } = await freshWiring();
    bus.emit('branch:created', { id: 'sibling', fromGen: 0, name: 'Flipped sibling' });
    expect(useAchievements.getState().log['first-fork']).toBeUndefined();

    bus.emit('branch:created', { id: 'b2', fromGen: 42, name: 'fork' });
    expect(useAchievements.getState().log['first-fork']?.gen).toBe(42);
  });

  it('unlocks "first-sculpture" on sculpture:open, with a rect to return to', async () => {
    const { bus, useAchievements } = await freshWiring();
    const rect = { x: 1, y: 2, w: 3, h: 4 };
    bus.emit('sculpture:open', { rect, fromGen: 12, toGen: 30 });
    expect(useAchievements.getState().log['first-sculpture']).toEqual({
      id: 'first-sculpture', gen: 12, at: expect.any(Number), rect,
    });
  });

  it('maps each experiment id to its own achievement on experiment:succeeded', async () => {
    const { bus, useAchievements } = await freshWiring();
    bus.emit('experiment:succeeded', { id: 'first-contact', gen: 5 });
    bus.emit('experiment:succeeded', { id: 'one-cell', gen: 6 });
    bus.emit('experiment:succeeded', { id: 'keep-alive', gen: 7 });
    const log = useAchievements.getState().log;
    expect(log['experiment-first-contact']?.gen).toBe(5);
    expect(log['experiment-one-cell']?.gen).toBe(6);
    expect(log['experiment-keep-alive']?.gen).toBe(7);
  });

  it('unlocks "first-oscillator" for any oscillator discovery, named or not', async () => {
    const { bus, useAchievements } = await freshWiring();
    bus.emit('discovery:made', { id: 'd1', kind: 'oscillator', gen: 9, rect: { x: 0, y: 0, w: 1, h: 1 }, label: 'blinker' });
    expect(useAchievements.getState().log['first-oscillator']?.gen).toBe(9);
  });

  it('unlocks "first-glider" for a named glider but not for other spaceships', async () => {
    const { bus, useAchievements } = await freshWiring();
    bus.emit('discovery:made', { id: 'd1', kind: 'spaceship', gen: 3, rect: { x: 0, y: 0, w: 1, h: 1 }, label: 'lwss' });
    expect(useAchievements.getState().log['first-glider']).toBeUndefined();

    bus.emit('discovery:made', { id: 'd2', kind: 'spaceship', gen: 4, rect: { x: 0, y: 0, w: 1, h: 1 }, label: 'glider' });
    expect(useAchievements.getState().log['first-glider']?.gen).toBe(4);
  });

  it('unlocks "first-gun" for an emitter-category specimen (a glider gun), not for a plain spaceship', async () => {
    const { bus, useAchievements } = await freshWiring();
    bus.emit('discovery:made', { id: 'd1', kind: 'spaceship', gen: 20, rect: { x: 0, y: 0, w: 1, h: 1 }, label: 'gosper-glider-gun' });
    expect(useAchievements.getState().log['first-gun']?.gen).toBe(20);
  });

  it('unlocks "catalogue" once CATALOGUE_SIZE distinct specimens have been logged', async () => {
    const { bus, useAchievements } = await freshWiring();
    const labels = ['block', 'blinker', 'glider', 'beehive', 'pulsar', 'toad'];
    expect(labels.length).toBeGreaterThanOrEqual(CATALOGUE_SIZE);
    for (let i = 0; i < CATALOGUE_SIZE - 1; i++) {
      bus.emit('discovery:made', { id: `d${i}`, kind: 'stability', gen: i, rect: { x: 0, y: 0, w: 1, h: 1 }, label: labels[i]! });
    }
    expect(useAchievements.getState().log.catalogue).toBeUndefined();
    bus.emit('discovery:made', {
      id: 'dlast', kind: 'stability', gen: 99, rect: { x: 0, y: 0, w: 1, h: 1 }, label: labels[CATALOGUE_SIZE - 1]!,
    });
    expect(useAchievements.getState().log.catalogue?.gen).toBe(99);
  });

  it('re-observing the SAME specimen repeatedly does not itself progress the catalogue tally', async () => {
    const { bus, useAchievements } = await freshWiring();
    for (let i = 0; i < CATALOGUE_SIZE + 5; i++) {
      bus.emit('discovery:made', { id: `d${i}`, kind: 'oscillator', gen: i, rect: { x: 0, y: 0, w: 1, h: 1 }, label: 'blinker' });
    }
    expect(useAchievements.getState().log.catalogue).toBeUndefined();
  });

  it('never re-earns an already-earned achievement (idempotent, first generation wins)', async () => {
    const { bus, useAchievements } = await freshWiring();
    bus.emit('branch:created', { id: 'b1', fromGen: 10, name: 'a' });
    bus.emit('branch:created', { id: 'b2', fromGen: 999, name: 'b' });
    expect(useAchievements.getState().log['first-fork']?.gen).toBe(10);
  });

  it('unlocks "collision-witnessed" when a FOLLOWED discovery transitions to lost, not merely because some item is lost', async () => {
    const { useAchievements, useDiscoveries } = await freshWiring();
    const { bookmarkRegion } = await import('@/content/discoveries');
    const base = bookmarkRegion({ x: 5, y: 5, w: 2, h: 2 }, 3);

    useDiscoveries.setState({ items: [{ ...base, following: true, lost: false }] });
    expect(useAchievements.getState().log['collision-witnessed']).toBeUndefined();

    useDiscoveries.setState({ items: [{ ...base, following: true, lost: true }] });
    expect(useAchievements.getState().log['collision-witnessed']?.gen).toBe(3);
  });

  it('does not unlock "collision-witnessed" for an item that was already lost (no false transition)', async () => {
    const { useAchievements, useDiscoveries } = await freshWiring();
    const { bookmarkRegion } = await import('@/content/discoveries');
    const base = bookmarkRegion({ x: 5, y: 5, w: 2, h: 2 }, 3);

    useDiscoveries.setState({ items: [{ ...base, following: true, lost: true }] });
    useDiscoveries.setState({ items: [{ ...base, following: true, lost: true, observationCount: 2 }] });
    expect(useAchievements.getState().log['collision-witnessed']).toBeUndefined();
  });

  it('unlocks "your-traveller" once a discovery has been re-observed TRAVELLER_OBSERVATIONS times', async () => {
    const { useAchievements, useDiscoveries } = await freshWiring();
    const { bookmarkRegion } = await import('@/content/discoveries');
    const base = bookmarkRegion({ x: 1, y: 1, w: 1, h: 1 }, 0);

    useDiscoveries.setState({ items: [{ ...base, observationCount: TRAVELLER_OBSERVATIONS - 1 }] });
    expect(useAchievements.getState().log['your-traveller']).toBeUndefined();

    useDiscoveries.setState({ items: [{ ...base, observationCount: TRAVELLER_OBSERVATIONS }] });
    expect(useAchievements.getState().log['your-traveller']).toBeDefined();
  });
});

describe('achievements store: persistence', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    window.localStorage.clear();
  });

  it('persists an unlock under the shared afterlife:v1 namespace, and reloads it on the next boot', async () => {
    const { STORAGE_PREFIX } = await import('@/persist/store');
    const { bus, useAchievements } = await freshWiring();
    bus.emit('branch:created', { id: 'b1', fromGen: 7, name: 'a' });
    expect(useAchievements.getState().log['first-fork']).toBeDefined();

    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}achievements`);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!)['first-fork'].gen).toBe(7);

    // Simulate a reload: fresh module graph reading the same storage back.
    vi.resetModules();
    const reloaded = await import('@/ui/achievements/store');
    expect(reloaded.useAchievements.getState().log['first-fork']?.gen).toBe(7);
  });

  it('localStorage being unavailable degrades to an empty log rather than throwing', async () => {
    vi.resetModules();
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    const { useAchievements } = await import('@/ui/achievements/store');
    expect(useAchievements.getState().log).toEqual({});
    vi.restoreAllMocks();
  });
});
