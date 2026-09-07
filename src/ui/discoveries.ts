/**
 * The Field Guide's live discovery log — the `ui`-owned bridge between
 * `@/content/recognition`/`@/content/discoveries` (pure, no DOM) and the
 * running session. Two things happen here, both throttled (recognition is
 * documented as "a few Hz at most, never every generation"):
 *
 *  1. **Ambient scanning**: every ~2.2s of real playback, scan a bounded
 *     window around the camera for a NEW named/characterized structure —
 *     "something catches the eye" without the user doing anything. Dedup is
 *     a quantised (name, position) key so a slowly drifting spaceship or a
 *     revisited pattern doesn't spam duplicate entries.
 *  2. **Following**: every ~0.22s of real playback, any discovery flagged
 *     `following` gets its trail advanced by re-scanning a small margin
 *     around its last known rect (see `advanceFollow`'s doc — the last good
 *     observation is kept even after a discovery is lost).
 *
 * Both only run in response to `gen:changed`, so nothing happens while
 * paused, and both are skipped entirely once nothing is alive.
 */
import { create } from 'zustand';
import {
  advanceFollow, bookmark, cameraFor, isSameDiscovery, lastObservation, nameDiscovery,
  reobserve, startFollowing, stopFollowing, toFieldGuideEntry, type Discovery, type FieldGuideEntry,
} from '@/content/discoveries';
import type { RecognizedCluster } from '@/content/recognition';
import { bus } from '@/ui/bus';
import { getSession } from '@/ui/session';
import type { DiscoveryEvent, Rect } from '@/core/types';

function kindFor(cluster: RecognizedCluster): DiscoveryEvent['kind'] {
  if (cluster.category === 'still') return 'still-life';
  if (cluster.category === 'oscillator') return 'oscillator';
  if (cluster.category === 'spaceship' || cluster.category === 'emitter') return 'spaceship';
  return 'stability';
}

interface DiscoveriesState {
  items: Discovery[];
  /** Manual scan (e.g. a "scan selection" button). Returns the number of NEW entries
   *  (a re-observed structure that already had an entry strengthens it in place — see
   *  `@/content/discoveries#isSameDiscovery`/`reobserve` — and isn't counted here). */
  scanRect(rect: Rect, opts?: { ambient?: boolean }): number;
  rename(id: string, name: string): void;
  toggleFollow(id: string): void;
  /** Move the sim to the discovery's most recent sighting and frame it. */
  goTo(id: string): void;
  remove(id: string): void;
  clear(): void;
}

export const useDiscoveries = create<DiscoveriesState>((set, get) => ({
  items: [],

  scanRect(rect, opts) {
    const session = getSession();
    if (!session) return 0;
    const gen = session.engine.gen;
    const { clusters } = session.scanRegion(rect);
    const added: Discovery[] = [];
    // Same structure re-scanned (a glider three cells further along its own
    // trajectory, a still life scanned again next tick) strengthens its
    // existing Field Guide entry instead of spawning a duplicate — see
    // `isSameDiscovery`'s doc for the identity+continuity test. Matched by
    // id so two clusters in one scan can't both claim the same existing entry.
    const toReobserve = new Map<string, RecognizedCluster>();
    const existing = get().items;
    for (const cluster of clusters) {
      if (cluster.population === 0) continue;
      if (cluster.status === 'unknown' || cluster.status === 'unverified') continue;

      const match = existing.find((d) => !toReobserve.has(d.id) && isSameDiscovery(d, cluster, gen));
      if (match) {
        toReobserve.set(match.id, cluster);
        continue;
      }
      const d = bookmark(cluster, gen);
      added.push(d);
      bus.emit('discovery:made', {
        id: d.id, kind: kindFor(cluster), gen, rect: cluster.bbox,
        label: d.name ?? cluster.note, period: cluster.period,
      });
    }
    if (added.length > 0 || toReobserve.size > 0) {
      set((s) => ({
        items: [
          ...added,
          ...s.items.map((d) => (toReobserve.has(d.id) ? reobserve(d, gen, toReobserve.get(d.id)!) : d)),
        ],
      }));
    }
    return added.length;
  },

  rename(id, name) {
    set((s) => ({ items: s.items.map((d) => (d.id === id ? nameDiscovery(d, name) : d)) }));
  },

  toggleFollow(id) {
    set((s) => ({
      items: s.items.map((d) => (d.id === id ? (d.following ? stopFollowing(d) : startFollowing(d)) : d)),
    }));
  },

  goTo(id) {
    const d = get().items.find((x) => x.id === id);
    const session = getSession();
    if (!d || !session) return;
    const sighting = lastObservation(d);
    void session.gotoGen(sighting.gen).then(() => {
      const cam = cameraFor(sighting);
      session.camera.set({ x: cam.centerX, y: cam.centerY });
    });
  },

  remove(id) {
    set((s) => ({ items: s.items.filter((d) => d.id !== id) }));
  },

  clear() {
    set({ items: [] });
  },
}));

export function fieldGuideEntries(): FieldGuideEntry[] {
  return useDiscoveries.getState().items.map(toFieldGuideEntry);
}

// ---------------------------------------------------------------------------
// Self-wired, throttled bus subscription — see module doc.
// ---------------------------------------------------------------------------

const AMBIENT_INTERVAL_MS = 2200;
const FOLLOW_INTERVAL_MS = 220;
const FOLLOW_MARGIN = 6;
const AMBIENT_HALF_EXTENT = 48;

let lastAmbientAt = 0;
let lastFollowAt = 0;

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

bus.on('gen:changed', ({ gen, population }) => {
  if (population === 0) return;
  const session = getSession();
  if (!session) return;
  const t = now();

  if (t - lastFollowAt >= FOLLOW_INTERVAL_MS) {
    lastFollowAt = t;
    const following = useDiscoveries.getState().items.some((d) => d.following && !d.lost);
    if (following) {
      useDiscoveries.setState((s) => ({
        items: s.items.map((d) => {
          if (!d.following || d.lost) return d;
          const last = lastObservation(d);
          const probe: Rect = {
            x: last.rect.x - FOLLOW_MARGIN,
            y: last.rect.y - FOLLOW_MARGIN,
            w: last.rect.w + FOLLOW_MARGIN * 2,
            h: last.rect.h + FOLLOW_MARGIN * 2,
          };
          const { clusters } = session.scanRegion(probe);
          const match = clusters.find((c) => (
            d.specimenId ? c.name === d.specimenId : c.status !== 'unverified' && c.status !== 'unknown'
          )) ?? null;
          return advanceFollow(d, gen, match);
        }),
      }));
    }
  }

  if (t - lastAmbientAt >= AMBIENT_INTERVAL_MS) {
    lastAmbientAt = t;
    const cam = session.camera.camera;
    const vp = session.camera.viewport;
    const halfW = Math.max(4, Math.min(AMBIENT_HALF_EXTENT, vp.width / 2 / cam.scale));
    const halfH = Math.max(4, Math.min(AMBIENT_HALF_EXTENT, vp.height / 2 / cam.scale));
    const rect: Rect = {
      x: Math.floor(cam.x - halfW),
      y: Math.floor(cam.y - halfH),
      w: Math.max(1, Math.round(halfW * 2)),
      h: Math.max(1, Math.round(halfH * 2)),
    };
    useDiscoveries.getState().scanRect(rect, { ambient: true });
  }
});
