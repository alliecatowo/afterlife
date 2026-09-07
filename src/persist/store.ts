/**
 * Persistence + interchange. Owned by the `persist` agent (`src/persist/**`).
 *
 * This file is the module's public entry point — other agents should only
 * ever `import ... from '@/persist/store'`, never reach into `./codec`,
 * `./localStorage`, or `./rle` directly.
 *
 * localStorage keys are namespaced `afterlife:v1:*`. Nothing here may block the
 * simulation loop — writes are debounced (>= 500 ms) and wrapped in try/catch
 * because storage can be full or disabled. See `./localStorage.ts` for the
 * key layout and quota handling, and `./codec.ts` for the on-disk format.
 */
export type {
  Bookmark,
  ExperimentDoc,
} from './codec';
export { EXPERIMENT_FORMAT_VERSION, decodeDoc, encodeDoc, migrateToCurrent, packCells, unpackCells } from './codec';

export type { PersistStore, PersistStoreOptions, StorageLike } from './localStorage';
export { PersistQuotaError, STORAGE_PREFIX, createPersistStore, humanBytes } from './localStorage';

export type { ParsedPattern } from './rle';
export { UnsupportedRuleError, checkRule, fromRLE, toRLE } from './rle';

import { decodeDoc, encodeDoc, migrateToCurrent, type ExperimentDoc } from './codec';

/**
 * Serialise a document for download. Pretty-printed, stable key order (the
 * same logical document always produces byte-identical output), so
 * export → import → export round-trips exactly.
 */
export function exportExperiment(doc: ExperimentDoc): string {
  return JSON.stringify(encodeDoc(doc), null, 2);
}

/**
 * Parse + validate a portable experiment file. Throws a descriptive `Error`
 * (or `UnsupportedRuleError`-style specificity for RLE — experiment JSON has
 * no rule field, the app only ever simulates B3/S23) on invalid JSON, an
 * unknown/future schema version, or a structurally invalid document. Never
 * returns a partially-valid document.
 */
export function importExperiment(json: string): ExperimentDoc {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (err) {
    throw new Error(`importExperiment: invalid JSON — ${(err as Error).message}`);
  }
  return decodeDoc(migrateToCurrent(raw));
}
