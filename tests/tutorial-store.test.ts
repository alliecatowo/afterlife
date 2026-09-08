import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_PREFIX } from '@/persist/store';
import { TOUR_STEPS } from '@/content/tour';

const TOUR_SEEN_KEY = `${STORAGE_PREFIX}tour-seen`;

/**
 * `useTourStore` reads its persisted "seen" flag once, at module load — the
 * same pattern `@/ui/session.ts` uses for the audio preference. To test both
 * "fresh profile" and "reloaded browser" behaviour honestly, each test
 * re-imports the module fresh (`vi.resetModules`) so the read-at-load-time
 * behaviour is actually exercised, not just the store's in-memory mutators.
 */
async function freshStore() {
  vi.resetModules();
  const mod = await import('@/ui/tutorial/tourStore');
  return mod.useTourStore;
}

describe('tutorial: tourStore first-run persistence', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    window.localStorage.clear();
  });

  it('a fresh profile has not seen the tour, and start() activates it', async () => {
    const useTourStore = await freshStore();
    expect(useTourStore.getState().seen).toBe(false);
    useTourStore.getState().start();
    expect(useTourStore.getState().status).toBe('active');
    expect(useTourStore.getState().stepIndex).toBe(0);
  });

  it('skip() persists "seen" under the shared afterlife:v1 namespace', async () => {
    const useTourStore = await freshStore();
    useTourStore.getState().start();
    useTourStore.getState().skip();
    expect(useTourStore.getState().status).toBe('done');
    expect(useTourStore.getState().seen).toBe(true);
    expect(window.localStorage.getItem(TOUR_SEEN_KEY)).toBe('1');
  });

  it('a second visit (reloaded module, same storage) does not auto-start', async () => {
    let useTourStore = await freshStore();
    useTourStore.getState().start();
    useTourStore.getState().finish();

    // Simulate a reload: re-import the module so it re-reads localStorage
    // from scratch, exactly like a fresh page load would.
    useTourStore = await freshStore();
    expect(useTourStore.getState().seen).toBe(true);
    useTourStore.getState().start(); // the auto-start call `App.tsx` makes on title dismissal
    expect(useTourStore.getState().status).toBe('idle'); // unchanged — still not shown
  });

  it('the explicit replay control (force=true) always restarts, even once seen', async () => {
    const useTourStore = await freshStore();
    useTourStore.getState().start();
    useTourStore.getState().finish();
    expect(useTourStore.getState().seen).toBe(true);

    useTourStore.getState().start(true);
    expect(useTourStore.getState().status).toBe('active');
    expect(useTourStore.getState().stepIndex).toBe(0);
  });

  it('next() walks every step and finishes (marking seen) after the last one', async () => {
    const useTourStore = await freshStore();
    useTourStore.getState().start();
    for (let i = 0; i < TOUR_STEPS.length - 1; i++) {
      useTourStore.getState().next();
      expect(useTourStore.getState().status).toBe('active');
      expect(useTourStore.getState().stepIndex).toBe(i + 1);
    }
    useTourStore.getState().next(); // past the last step
    expect(useTourStore.getState().status).toBe('done');
    expect(useTourStore.getState().seen).toBe(true);
  });

  it('currentStep() reflects the active step, and is null when not active', async () => {
    const useTourStore = await freshStore();
    expect(useTourStore.getState().currentStep()).toBeNull();
    useTourStore.getState().start();
    expect(useTourStore.getState().currentStep()?.id).toBe(TOUR_STEPS[0]!.id);
  });

  it('localStorage being unavailable degrades to "never seen" rather than throwing', async () => {
    const realGetItem = window.localStorage.getItem.bind(window.localStorage);
    vi.spyOn(window.localStorage, 'getItem').mockImplementation((key: string) => {
      if (key === TOUR_SEEN_KEY) throw new DOMException('blocked', 'SecurityError');
      return realGetItem(key);
    });
    const useTourStore = await freshStore();
    expect(useTourStore.getState().seen).toBe(false);
    vi.restoreAllMocks();
  });
});
