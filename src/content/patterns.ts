/**
 * Pattern library — the drawer-facing entry point.
 *
 * `PATTERNS`/`getPattern` back `src/ui/drawer/Drawer.tsx`'s stamp tool. The
 * actual live discovery scanning/de-duplication that feeds the Field Guide
 * is `src/ui/discoveries.ts`'s ambient scan loop, wired to the running
 * session; this file does not do discovery detection (an earlier
 * `createDiscoveryDetector` here was never wired to anything and has been
 * removed — don't resurrect it without wiring it up).
 *
 * The richer corpus (verified periods, transients, live miniatures) lives in
 * `@/content/specimens`; the richer recognition semantics (orientation/phase
 * matching, interference, repetition observation) live in
 * `@/content/recognition`. This file is a thin, UI-shaped façade over the
 * former.
 */
import type { StampPattern } from '@/core/types';
import { SPECIMENS, getSpecimen, toStampPattern, type SpecimenCategory } from '@/content/specimens';

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

