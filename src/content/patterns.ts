/**
 * Pattern library + discovery detection — the drawer-facing entry point.
 *
 * `PATTERNS`/`getPattern` back `src/ui/drawer/Drawer.tsx`'s stamp tool.
 * `createDiscoveryDetector` wraps `@/content/recognition`'s `scan` with
 * de-duplication so the same standing structure doesn't re-fire
 * `discovery:made` every time it's scanned; it only reports newly matched
 * (named or characterized) clusters.
 *
 * The richer corpus (verified periods, transients, live miniatures) lives in
 * `@/content/specimens`; the richer recognition semantics (orientation/phase
 * matching, interference, repetition observation) live in
 * `@/content/recognition`. This file is a thin, UI-shaped façade over both.
 */
import type { DiscoveryEvent, Generation, Rect, StampPattern } from '@/core/types';
import type { LifeEngine } from '@/core/engine';
import { SPECIMENS, getSpecimen, toStampPattern, type SpecimenCategory } from '@/content/specimens';
import { scan } from '@/content/recognition';

export interface PatternEntry {
  id: string;
  name: string;
  /** Short editorial note in the natural-history register. One or two sentences. */
  note: string;
  category: 'still-life' | 'oscillator' | 'spaceship' | 'gun' | 'methuselah';
  rle: string;
}

const CATEGORY_MAP: Record<SpecimenCategory, PatternEntry['category']> = {
  still: 'still-life',
  oscillator: 'oscillator',
  spaceship: 'spaceship',
  emitter: 'gun',
  seed: 'methuselah',
};

/** The curated library shown in the left drawer. */
export const PATTERNS: readonly PatternEntry[] = SPECIMENS.map((s) => ({
  id: s.id,
  name: s.name,
  note: s.explanation,
  category: CATEGORY_MAP[s.category],
  rle: s.rle,
}));

export function getPattern(id: string): StampPattern {
  const s = getSpecimen(id);
  if (!s) throw new Error(`getPattern: unknown pattern id "${id}"`);
  return toStampPattern(s);
}

/** Scans a region for recognisable structures and emits `discovery:made`. */
export interface DiscoveryDetector {
  observe(engine: LifeEngine, gen: Generation, rect: Rect): DiscoveryEvent[];
  reset(): void;
}

function toDiscoveryKind(category: SpecimenCategory | undefined): DiscoveryEvent['kind'] {
  // DiscoveryEvent#kind is a frozen, fixed vocabulary (core/types.ts) with no
  // 'emitter' or 'seed' entry — a firing gun is reported as its own kind of
  // oscillator, which is mechanically true (its footprint is periodic).
  if (category === 'still') return 'still-life';
  if (category === 'spaceship') return 'spaceship';
  return 'oscillator';
}

/**
 * Stateful de-duplication wrapper around `@/content/recognition#scan`. Each
 * detector instance remembers which (identity, roughly-here) clusters it has
 * already reported so a standing still life doesn't re-fire every throttle
 * tick; `reset()` clears that memory (e.g. on branch switch or world reset).
 */
export function createDiscoveryDetector(): DiscoveryDetector {
  const seen = new Set<string>();

  return {
    observe(engine, gen, rect) {
      const result = scan(engine, rect);
      const events: DiscoveryEvent[] = [];
      for (const c of result.clusters) {
        if (c.status !== 'named' && c.status !== 'characterized') continue;
        // Round position so a spaceship drifting one cell per phase doesn't
        // count as a brand-new discovery every time it's rescanned.
        const identity = `${c.name ?? `char:${c.period ?? '?'}`}:${Math.round(c.bbox.x / 8)}:${Math.round(c.bbox.y / 8)}`;
        if (seen.has(identity)) continue;
        seen.add(identity);
        events.push({
          id: `${identity}@${gen}`,
          kind: toDiscoveryKind(c.category),
          gen,
          rect: c.bbox,
          label: c.status === 'named' ? `Recognised: ${c.name}` : `An unnamed structure — ${c.note}`,
          period: c.period,
        });
      }
      return events;
    },
    reset() {
      seen.clear();
    },
  };
}
