/**
 * localStorage-backed `PersistStore`. Owned by `persist`.
 *
 * Namespacing: everything lives under keys prefixed `afterlife:v1:` (a
 * storage-layout version, distinct from `EXPERIMENT_FORMAT_VERSION` — the
 * document schema can be migrated without ever touching key names).
 *
 *   afterlife:v1:working        — the debounced autosave slot (`save`/`load`)
 *   afterlife:v1:index          — [{ id, title, createdAt, bytes }] for named saves
 *   afterlife:v1:save:<id>      — one named save (`saveAs`/`loadFrom`)
 *   afterlife:v1:quarantine:*   — corrupt payloads moved aside, never silently dropped
 *
 * `save()` (the autosave slot) and `saveAs()` (named slots) are fully
 * independent keys — an autosave can never clobber a named save, and vice
 * versa. Nothing here blocks the simulation loop: `save()` is debounced
 * (>= 500 ms default) and every storage access is wrapped in try/catch, since
 * storage can be full (`QuotaExceededError`) or disabled entirely (Safari
 * private browsing throws on `setItem`).
 */
import { bus } from '@/ui/bus';
import { decodeDoc, encodeDoc, migrateToCurrent, type ExperimentDoc } from './codec';

export const STORAGE_PREFIX = 'afterlife:v1:';

const WORKING_KEY = `${STORAGE_PREFIX}working`;
const INDEX_KEY = `${STORAGE_PREFIX}index`;
const SAVE_PREFIX = `${STORAGE_PREFIX}save:`;
const QUARANTINE_PREFIX = `${STORAGE_PREFIX}quarantine:`;

const DEFAULT_DEBOUNCE_MS = 500;

/** The subset of the DOM `Storage` interface we depend on — real `localStorage`
 *  satisfies this directly; tests can inject a fake implementing the same shape. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  readonly length: number;
}

interface IndexEntry {
  id: string;
  title: string;
  createdAt: number;
  bytes: number;
}

export interface PersistStore {
  /** Debounced write of the working document to localStorage. */
  save(doc: ExperimentDoc): void;
  /** Read the working document back; null if absent or corrupt. */
  load(): ExperimentDoc | null;
  /** Named slots the user can keep. */
  list(): Array<{ id: string; title: string; createdAt: number }>;
  saveAs(id: string, doc: ExperimentDoc): void;
  loadFrom(id: string): ExperimentDoc | null;
  remove(id: string): void;
  clearAll(): void;
}

/** Thrown by `saveAs` when the write did not fit. Carries the biggest current
 *  saves so the caller can build an honest "delete one of these" message. */
export class PersistQuotaError extends Error {
  constructor(
    public readonly title: string,
    public readonly largest: Array<{ title: string; bytes: number }>,
  ) {
    super(
      `Could not save "${title}" — local storage is full.` +
        (largest.length > 0
          ? ` Largest saved experiments: ${largest.map((l) => `"${l.title}" (${humanBytes(l.bytes)})`).join(', ')}.`
          : '') +
        ' Delete a saved experiment to free space and try again.',
    );
    this.name = 'PersistQuotaError';
  }
}

export function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function isQuotaExceeded(err: unknown): boolean {
  if (err instanceof DOMException) {
    return err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED' || err.code === 22;
  }
  return isPlainErrorLike(err) && (err.name === 'QuotaExceededError' || err.code === 22);
}

function isPlainErrorLike(err: unknown): err is { name?: string; code?: number } {
  return typeof err === 'object' && err !== null;
}

function toast(message: string, tone: 'warn' | 'info' = 'warn'): void {
  try {
    bus.emit('toast', { message, tone, ms: 8000 });
  } catch {
    // The bus should never throw, but persistence must survive even if it does.
  }
}

class NoopStorage implements StorageLike {
  getItem(): null { return null; }
  setItem(): void { /* no-op: storage unavailable */ }
  removeItem(): void { /* no-op */ }
  key(): null { return null; }
  get length(): number { return 0; }
}

function detectStorage(): StorageLike {
  try {
    const probe = '__afterlife_probe__';
    globalThis.localStorage.setItem(probe, '1');
    globalThis.localStorage.removeItem(probe);
    return globalThis.localStorage;
  } catch {
    toast("Local storage isn't available (private browsing or a locked-down browser) — nothing will be saved between visits.");
    return new NoopStorage();
  }
}

export interface PersistStoreOptions {
  storage?: StorageLike;
  /** Debounce window for `save()`, in ms. Default 500. Tests may pass 0. */
  debounceMs?: number;
}

class LocalPersistStore implements PersistStore {
  private readonly storage: StorageLike;
  private readonly debounceMs: number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pendingDoc: ExperimentDoc | null = null;

  constructor(options: PersistStoreOptions = {}) {
    this.storage = options.storage ?? detectStorage();
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  }

  private saveKey(id: string): string {
    return `${SAVE_PREFIX}${id}`;
  }

  private readIndex(): IndexEntry[] {
    const raw = this.storage.getItem(INDEX_KEY);
    if (raw != null) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.every(isIndexEntry)) return parsed;
      } catch {
        // fall through to rebuild
      }
    }
    return this.rebuildIndex();
  }

  private writeIndex(entries: IndexEntry[]): void {
    try {
      this.storage.setItem(INDEX_KEY, JSON.stringify(entries));
    } catch {
      // Best-effort: the index is small, so this should only fail when
      // storage is already essentially full. `list()` self-heals by
      // rescanning save:* keys next time, so no data is lost.
    }
  }

  /** Reconstruct the index by scanning `save:*` keys — self-heals a lost/corrupt index. */
  private rebuildIndex(): IndexEntry[] {
    const entries: IndexEntry[] = [];
    for (let i = 0; i < this.storage.length; i++) {
      const key = this.storage.key(i);
      if (!key || !key.startsWith(SAVE_PREFIX)) continue;
      const id = key.slice(SAVE_PREFIX.length);
      const raw = this.storage.getItem(key);
      if (raw == null) continue;
      try {
        const doc = decodeDoc(migrateToCurrent(JSON.parse(raw)));
        entries.push({ id, title: doc.title, createdAt: doc.createdAt, bytes: raw.length });
      } catch {
        this.quarantine(key, raw, `named save "${id}"`);
      }
    }
    this.writeIndex(entries);
    return entries;
  }

  private upsertIndex(entry: IndexEntry): void {
    const entries = this.readIndex().filter((e) => e.id !== entry.id);
    entries.push(entry);
    this.writeIndex(entries);
  }

  private quarantine(key: string, raw: string, what: string): void {
    try {
      this.storage.setItem(`${QUARANTINE_PREFIX}${key}:${Date.now()}`, raw);
      this.storage.removeItem(key);
    } catch {
      // If we can't even quarantine it, leave it in place; better a stuck
      // entry than a thrown exception from a background read.
    }
    toast(`A saved experiment (${what}) couldn't be read and was moved aside as a backup, not deleted.`);
  }

  private describeLargest(n: number): Array<{ title: string; bytes: number }> {
    return this.readIndex()
      .slice()
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, n)
      .map((e) => ({ title: e.title, bytes: e.bytes }));
  }

  private handleWriteError(err: unknown, what: string): void {
    if (isQuotaExceeded(err)) {
      const largest = this.describeLargest(3);
      const detail = largest.length > 0
        ? ` Largest saves: ${largest.map((l) => `"${l.title}" (${humanBytes(l.bytes)})`).join(', ')}.`
        : '';
      toast(`Storage is full — couldn't save ${what}.${detail} Delete a saved experiment to free space.`);
      console.error('[persist] quota exceeded writing', what, err);
    } else {
      toast(`Couldn't save ${what} — local storage is unavailable.`);
      console.error('[persist] storage write failed for', what, err);
    }
  }

  save(doc: ExperimentDoc): void {
    this.pendingDoc = doc;
    if (this.timer != null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      const pending = this.pendingDoc;
      this.pendingDoc = null;
      if (pending) this.writeWorking(pending);
    }, this.debounceMs);
  }

  private writeWorking(doc: ExperimentDoc): void {
    let json: string;
    try {
      json = JSON.stringify(encodeDoc(doc));
    } catch (err) {
      console.error('[persist] failed to serialise the working experiment', err);
      return;
    }
    try {
      this.storage.setItem(WORKING_KEY, json);
    } catch (err) {
      this.handleWriteError(err, 'the working experiment');
    }
  }

  load(): ExperimentDoc | null {
    const raw = this.storage.getItem(WORKING_KEY);
    if (raw == null) return null;
    try {
      return decodeDoc(migrateToCurrent(JSON.parse(raw)));
    } catch (err) {
      this.quarantine(WORKING_KEY, raw, 'your last working experiment');
      console.error('[persist] working experiment was corrupt', err);
      return null;
    }
  }

  list(): Array<{ id: string; title: string; createdAt: number }> {
    return this.readIndex().map(({ id, title, createdAt }) => ({ id, title, createdAt }));
  }

  saveAs(id: string, doc: ExperimentDoc): void {
    let json: string;
    try {
      json = JSON.stringify(encodeDoc(doc));
    } catch (err) {
      throw new Error(`saveAs: failed to serialise "${doc.title}": ${(err as Error).message}`);
    }
    try {
      this.storage.setItem(this.saveKey(id), json);
    } catch (err) {
      this.handleWriteError(err, `"${doc.title}"`);
      if (isQuotaExceeded(err)) throw new PersistQuotaError(doc.title, this.describeLargest(5));
      throw err instanceof Error ? err : new Error(String(err));
    }
    this.upsertIndex({ id, title: doc.title, createdAt: doc.createdAt, bytes: json.length });
  }

  loadFrom(id: string): ExperimentDoc | null {
    const key = this.saveKey(id);
    const raw = this.storage.getItem(key);
    if (raw == null) return null;
    try {
      return decodeDoc(migrateToCurrent(JSON.parse(raw)));
    } catch (err) {
      this.quarantine(key, raw, `named save "${id}"`);
      console.error(`[persist] named save "${id}" was corrupt`, err);
      return null;
    }
  }

  remove(id: string): void {
    try {
      this.storage.removeItem(this.saveKey(id));
    } catch {
      // ignore
    }
    this.writeIndex(this.readIndex().filter((e) => e.id !== id));
  }

  /**
   * Wipe every AFTERLIFE key from storage, including named saves. This is an
   * explicit, destructive user action (e.g. a "reset all local data" button)
   * — it must NEVER be invoked from routine flows like reseeding the world,
   * clearing the canvas, or starting a new experiment. Those flows should
   * leave named saves and the working slot untouched.
   */
  clearAll(): void {
    const keys: string[] = [];
    for (let i = 0; i < this.storage.length; i++) {
      const key = this.storage.key(i);
      if (key && key.startsWith(STORAGE_PREFIX)) keys.push(key);
    }
    for (const key of keys) {
      try {
        this.storage.removeItem(key);
      } catch {
        // ignore
      }
    }
  }
}

function isIndexEntry(v: unknown): v is IndexEntry {
  return (
    typeof v === 'object' && v !== null &&
    typeof (v as IndexEntry).id === 'string' &&
    typeof (v as IndexEntry).title === 'string' &&
    typeof (v as IndexEntry).createdAt === 'number' &&
    typeof (v as IndexEntry).bytes === 'number'
  );
}

export function createPersistStore(options?: PersistStoreOptions): PersistStore {
  return new LocalPersistStore(options);
}
