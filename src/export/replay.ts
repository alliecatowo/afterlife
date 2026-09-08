/**
 * Deterministic, non-destructive replay for offline export.
 *
 * Builds an INDEPENDENT `LifeEngine` (via `TimelineStore.cloneBranchAt`,
 * exactly the mechanism `@/ui/session.ts`'s compare view already uses for a
 * second synchronized render) and steps it forward generation-by-generation,
 * re-applying the SAME real recorded `EditOp`s the live branch played, using
 * the exact apply-then-step order `TimelineStore`'s own internal replay uses
 * (see `@/core/history.ts`'s `replayAsync`: an edit recorded at generation
 * `g` is applied immediately after the step that PRODUCES `g`, not before).
 *
 * This never touches the live `engine`/`history` the rest of the app is
 * looking at — exporting never scrubs, steps, or otherwise disturbs the
 * running world.
 */
import type { EditOp, Generation } from '@/core/types';
import type { LifeEngine } from '@/core/engine';
import type { TimelineStore } from '@/core/history';

export interface ReplayCursor {
  /** The engine driven by this cursor. Only valid to read AFTER `advanceTo()`. */
  readonly engine: LifeEngine;
  /**
   * Step the engine forward (never backward — this is a one-way replay, not
   * a scrubber) until it reaches `gen`, applying every real recorded edit
   * along the way, and return it. Cancellable via the `signal` passed to
   * `createReplayCursor`.
   */
  advanceTo(gen: Generation): LifeEngine;
  dispose(): void;
}

export interface CreateReplayCursorOptions {
  fromGen: Generation;
  signal?: AbortSignal;
}

/** Create a cursor seeded at `fromGen` on the ACTIVE branch — export always
 *  renders the branch the user is currently looking at, matching "export
 *  what you see." Rejects with `HistoryWindowError` if `fromGen` has fallen
 *  out of the retained window; callers should clamp to `history.windowStart`
 *  first, same policy as the timeline scrubber. */
export async function createReplayCursor(
  history: TimelineStore,
  opts: CreateReplayCursorOptions,
): Promise<ReplayCursor> {
  const engine = await history.cloneBranchAt(history.activeBranch, opts.fromGen, opts.signal);

  // Flatten the branch's real recorded edits once, keyed by generation —
  // `entries()` is already filtered to the active branch's retained window.
  const editsByGen = new Map<Generation, EditOp[]>();
  for (const entry of history.entries()) editsByGen.set(entry.gen, entry.edits);

  let cursor = engine.gen;

  function applyEditsAt(gen: Generation): void {
    const ops = editsByGen.get(gen);
    if (!ops) return;
    for (const op of ops) {
      for (const cell of op.cells) engine.set(cell.x, cell.y, cell.alive);
    }
  }

  return {
    engine,
    advanceTo(gen: Generation): LifeEngine {
      if (gen < cursor) {
        throw new Error(`replay cursor: requested gen ${gen} is behind the current position ${cursor} (forward-only)`);
      }
      while (cursor < gen) {
        if (opts.signal?.aborted) throw new DOMException('export cancelled', 'AbortError');
        engine.step();
        cursor++;
        applyEditsAt(cursor);
      }
      return engine;
    },
    dispose() {
      // Nothing to release explicitly — the cloned engine holds only typed
      // arrays, reclaimed by GC once dropped. Kept as an explicit lifecycle
      // hook so callers don't have to know that.
    },
  };
}
