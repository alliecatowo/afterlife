/**
 * Input events the soundscape reacts to. Pure type-only module (no Web Audio,
 * no runtime deps) so `brain.ts`/`mapper.ts` can import it without pulling in
 * anything impure. Re-exported from `audio.ts` for external callers.
 *
 * Two ways events arrive, both supported:
 *  - Bus subscriptions the soundscape sets up itself (`discovery:made`,
 *    `playback:scrub`, `audio:toggle`, `audio:volume`, `gen:changed` as a
 *    fallback population source) — see `audio.ts`.
 *  - Explicit `feed()` calls from whichever module computes richer per-
 *    generation data the bus doesn't carry (raw birth/death counts, a
 *    population centroid) — see `Soundscape.feed` in `audio.ts`.
 */
import type { DiscoveryEvent, Generation } from '@/core/types';

export type AudioEvent =
  | {
      kind: 'tick';
      gen: Generation;
      population: number;
      /** Real centroid-of-life position in world cells, if the caller has
       * computed one (e.g. from `engine.forEachLive`). Optional: without it,
       * centroid-driven pan degrades honestly to centred rather than being
       * fabricated. */
      centroid?: { x: number; y: number };
    }
  | { kind: 'birth'; count: number }
  | { kind: 'death'; count: number }
  | { kind: 'discovery'; discovery: DiscoveryEvent }
  | { kind: 'branch'; fromGen: Generation }
  | { kind: 'scrub'; gen: Generation }
  | {
      /** One real cell placed/cleared by the user, mid-gesture — "drawing
       * feels like playing an instrument." `nx`/`ny` are world position
       * normalised 0..1 (never fabricated: computed from the actual `EditOp`
       * cell and the real `LifeEngine.spec`); `localDensity` (0..1), when
       * supplied, is the real fraction of live neighbours around that cell. */
      kind: 'paint';
      nx: number;
      ny: number;
      alive: boolean;
      localDensity?: number;
    }
  | {
      /** A stamp gesture just committed. `cellCount` is the exact real cell
       * count of the committed `EditOp` (its bounding box), from
       * `edit:committed`'s payload — reflects the pattern's real
       * size/complexity, never estimated. */
      kind: 'stamp';
      cellCount: number;
    };
