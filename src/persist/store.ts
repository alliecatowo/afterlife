/**
 * Persistence + interchange. STUB, owned by the `persist` agent
 * (`src/persist/**`).
 *
 * localStorage keys are namespaced `afterlife:v1:*`. Nothing here may block the
 * simulation loop — writes are debounced (>= 500 ms) and wrapped in try/catch
 * because storage can be full or disabled.
 */
import type {
  BranchMeta, EditOp, Generation, Rect, StampPattern, WorldSpec,
} from '@/core/types';

export const STORAGE_PREFIX = 'afterlife:v1:';
export const EXPERIMENT_FORMAT_VERSION = 1;

/** The full serialisable document. JSON, no binary — bits are RLE strings. */
export interface ExperimentDoc {
  version: typeof EXPERIMENT_FORMAT_VERSION;
  title: string;
  createdAt: number;
  spec: WorldSpec;
  /** Seed used for the initial universe, so gen 0 reproduces exactly. */
  seed: number | string;
  density: number;
  branches: BranchMeta[];
  /** Recorded edits per branch, ascending by generation. */
  edits: Record<string, Array<{ gen: Generation; ops: EditOp[] }>>;
  /** Where the camera was, so reopening feels like returning. */
  view?: { x: number; y: number; scale: number; gen: Generation };
  notes?: string;
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

export function createPersistStore(): PersistStore {
  throw new Error('not implemented');
}

/** Serialise a document for download. Pretty-printed, stable key order. */
export function exportExperiment(_doc: ExperimentDoc): string {
  throw new Error('not implemented');
}

/** Parse + validate. Throws a descriptive Error on version or shape mismatch. */
export function importExperiment(_json: string): ExperimentDoc {
  throw new Error('not implemented');
}

/**
 * Encode a rect of cells as standard Life RLE (`b`/`o`/`$`/`!`), with an
 * `x = w, y = h, rule = B3/S23` header. Round-trips with `fromRLE`.
 */
export function toRLE(_cells: Uint8Array, _rect: Pick<Rect, 'w' | 'h'>, _name?: string): string {
  throw new Error('not implemented');
}

/** Parse Life RLE (tolerating `#` comment lines) into a StampPattern. */
export function fromRLE(_rle: string): StampPattern {
  throw new Error('not implemented');
}
