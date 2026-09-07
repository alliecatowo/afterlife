/**
 * Pattern library + discovery detection. STUB, owned by the `content` agent
 * (`src/content/**`). Patterns are authored as RLE strings and parsed with
 * `fromRLE` so the library stays readable and diffable.
 */
import type { DiscoveryEvent, Generation, Rect, StampPattern } from '@/core/types';
import type { LifeEngine } from '@/core/engine';

export interface PatternEntry {
  id: string;
  name: string;
  /** Short editorial note in the natural-history register. One or two sentences. */
  note: string;
  category: 'still-life' | 'oscillator' | 'spaceship' | 'gun' | 'methuselah';
  rle: string;
}

/** The curated library shown in the left drawer. */
export const PATTERNS: readonly PatternEntry[] = [];

export function getPattern(_id: string): StampPattern {
  throw new Error('not implemented');
}

/** Scans a region for recognisable structures and emits `discovery:made`. */
export interface DiscoveryDetector {
  observe(engine: LifeEngine, gen: Generation, rect: Rect): DiscoveryEvent[];
  reset(): void;
}

export function createDiscoveryDetector(): DiscoveryDetector {
  throw new Error('not implemented');
}
