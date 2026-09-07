import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bus } from '@/ui/bus';
import {
  PersistQuotaError,
  STORAGE_PREFIX,
  createPersistStore,
  type ExperimentDoc,
  type StorageLike,
} from '@/persist/store';

/** In-memory `StorageLike` fake. `failOn` lets tests simulate a browser that
 *  throws `QuotaExceededError` for specific keys (or all writes). */
class FakeStorage implements StorageLike {
  private map = new Map<string, string>();
  failOn: (key: string) => boolean = () => false;

  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }

  setItem(key: string, value: string): void {
    if (this.failOn(key)) {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    }
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null;
  }

  get length(): number {
    return this.map.size;
  }

  /** Test helper: peek at the raw underlying map. */
  dump(): Map<string, string> {
    return this.map;
  }
}

function makeDoc(title: string): ExperimentDoc {
  return {
    version: 2,
    title,
    createdAt: 1,
    spec: { width: 8, height: 8, boundary: 'torus' },
    seed: 1,
    density: 0,
    activeBranch: 'root',
    branches: [{ id: 'root', name: 'root', parent: null, fromGen: 0, createdAt: 0 }],
    edits: {},
    bookmarks: [],
    discoveries: [],
  };
}

let toasts: Array<{ message: string; tone?: string }> = [];
beforeEach(() => {
  toasts = [];
  bus.on('toast', (p) => toasts.push(p));
});
afterEach(() => {
  bus.clear();
});

describe('quota handling', () => {
  it('saveAs throws PersistQuotaError and leaves no partial write behind', () => {
    const storage = new FakeStorage();
    storage.failOn = (key) => key.startsWith(`${STORAGE_PREFIX}save:`);
    const store = createPersistStore({ storage });

    expect(() => store.saveAs('big', makeDoc('Big Bang'))).toThrow(PersistQuotaError);

    // No orphan data key, no orphan index entry.
    expect(storage.getItem(`${STORAGE_PREFIX}save:big`)).toBeNull();
    expect(store.list()).toEqual([]);
  });

  it('saveAs quota failure emits an honest toast with a path forward', () => {
    const storage = new FakeStorage();
    storage.failOn = (key) => key.startsWith(`${STORAGE_PREFIX}save:`);
    const store = createPersistStore({ storage });

    expect(() => store.saveAs('big', makeDoc('Big Bang'))).toThrow();
    expect(toasts.length).toBeGreaterThan(0);
    expect(toasts[0]!.tone).toBe('warn');
    expect(toasts[0]!.message).toMatch(/storage is full/i);
  });

  it('a prior named save survives a failed overwrite attempt (no data loss)', () => {
    const storage = new FakeStorage();
    const store = createPersistStore({ storage });
    store.saveAs('keep-me', makeDoc('Original'));

    storage.failOn = (key) => key === `${STORAGE_PREFIX}save:keep-me`;
    expect(() => store.saveAs('keep-me', makeDoc('Overwrite attempt'))).toThrow(PersistQuotaError);

    const survived = store.loadFrom('keep-me');
    expect(survived?.title).toBe('Original');
  });

  it('debounced save() never throws synchronously and reports failure via toast', async () => {
    const storage = new FakeStorage();
    storage.failOn = (key) => key === `${STORAGE_PREFIX}working`;
    const store = createPersistStore({ storage, debounceMs: 0 });

    expect(() => store.save(makeDoc('Working experiment'))).not.toThrow();
    await new Promise((r) => setTimeout(r, 5));

    expect(store.load()).toBeNull();
    expect(toasts.some((t) => /storage is full/i.test(t.message))).toBe(true);
  });

  it('reports the largest saves as part of the quota message', () => {
    const storage = new FakeStorage();
    const store = createPersistStore({ storage });
    store.saveAs('a', makeDoc('Alpha'));
    store.saveAs('b', makeDoc('Beta'));

    storage.failOn = (key) => key.startsWith(`${STORAGE_PREFIX}save:`);
    try {
      store.saveAs('c', makeDoc('Gamma'));
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(PersistQuotaError);
      const q = err as PersistQuotaError;
      expect(q.largest.length).toBeGreaterThan(0);
      expect(q.message).toMatch(/Alpha|Beta/);
    }
  });
});

describe('working slot vs named saves', () => {
  it('save() (autosave) never overwrites a named save, and vice versa', () => {
    const storage = new FakeStorage();
    const store = createPersistStore({ storage, debounceMs: 0 });
    store.saveAs('named', makeDoc('Named Save'));
    store.save(makeDoc('Autosave draft'));

    expect(store.loadFrom('named')?.title).toBe('Named Save');
  });
});

describe('corrupt data handling', () => {
  it('load() quarantines unreadable working data instead of crashing', () => {
    const storage = new FakeStorage();
    storage.dump().set(`${STORAGE_PREFIX}working`, '{ not valid json');
    const store = createPersistStore({ storage });

    expect(store.load()).toBeNull();
    expect(storage.getItem(`${STORAGE_PREFIX}working`)).toBeNull();
    const quarantined = Array.from(storage.dump().keys()).filter((k) => k.includes('quarantine'));
    expect(quarantined.length).toBe(1);
    expect(storage.dump().get(quarantined[0]!)).toBe('{ not valid json');
  });

  it('loadFrom() quarantines a corrupt named save and list() self-heals its index', () => {
    const storage = new FakeStorage();
    const store = createPersistStore({ storage });
    store.saveAs('good', makeDoc('Good Save'));
    storage.dump().set(`${STORAGE_PREFIX}save:bad`, 'not json at all');
    storage.dump().delete(`${STORAGE_PREFIX}index`); // simulate a lost/corrupt index

    const list = store.list();
    expect(list.map((e) => e.id)).toEqual(['good']);
    expect(store.loadFrom('bad')).toBeNull();
  });
});

describe('storage unavailable', () => {
  it('createPersistStore falls back gracefully if localStorage access throws', () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError: storage disabled');
      },
    });
    try {
      expect(() => createPersistStore()).not.toThrow();
      const store = createPersistStore();
      expect(() => store.save(makeDoc('x'))).not.toThrow();
      expect(store.load()).toBeNull();
    } finally {
      if (originalDescriptor) Object.defineProperty(globalThis, 'localStorage', originalDescriptor);
    }
  });
});
