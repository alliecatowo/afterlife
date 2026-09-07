/**
 * The Field Guide's growth-through-observation model: bookmark a region or
 * specimen `@/content/recognition#scan` found, optionally name it, and keep
 * a quiet trail of where and when it was seen. `follow()` advances that
 * trail generation by generation for a moving structure; if it collides or
 * stops matching, the LAST GOOD observation is preserved rather than
 * discarded, and `lastObservation()` gives the integration layer everything
 * it needs to route back to that place and moment (`TimelineStore.goto(gen)`
 * plus a camera centred on `rect`).
 *
 * This module holds plain, serialisable data only — no DOM, no timers, no
 * dependency on `@/ui` or `@/persist`. `@/persist` is expected to serialise
 * `DiscoveryLog#list()` directly; `@/ui` renders it (see `toFieldGuideEntry`,
 * which is shaped to match `@/ui/panels/FieldGuidePanel`'s `FieldGuideEntry`
 * structurally, without either module importing the other).
 */
import type { CellCoord, Generation, Rect } from '@/core/types';
import type { CameraSpec } from '@/content/scenes';
import type { RecognitionStatus, RecognizedCluster } from '@/content/recognition';
import { getSpecimen } from '@/content/specimens';

export interface DiscoverySighting {
  gen: Generation;
  rect: Rect;
}

export interface Discovery {
  id: string;
  /** User-given name, or `null` until `nameDiscovery` is called. */
  name: string | null;
  /** What recognition made of it at bookmark time. `'manual'` for a plain user-drawn bookmark with no scan behind it. */
  kind: RecognitionStatus | 'manual';
  /** Set when `kind === 'named'`: the curated specimen id. */
  specimenId?: string;
  period?: number;
  translation?: { dx: number; dy: number };
  discoveredAtGen: Generation;
  /** Oldest first; the last entry is the most recent sighting. Never empty. */
  trail: DiscoverySighting[];
  following: boolean;
  /** Set once a followed discovery stops matching (collision, dispersal, ran off the scanned area). The trail is left exactly as it was. */
  lost: boolean;
  /**
   * How many times this SAME structure has been (re-)observed, ambient or
   * manual, since it was first bookmarked. Starts at 1. This is the whole
   * point of `isSameDiscovery`/`reobserve`: a glider tracked across
   * generations is one discovery, re-observed — the count (and
   * `lastSeenGen`) is what "grows" the entry instead of the log gaining a
   * near-identical duplicate every ambient scan tick.
   */
  observationCount: number;
  /** Generation of the most recent (re-)observation. `>= discoveredAtGen`. */
  lastSeenGen: Generation;
}

let _counter = 0;
function freshId(gen: Generation, rect: Rect): string {
  _counter += 1;
  return `disc_${gen}_${rect.x}_${rect.y}_${_counter}`;
}

/** Bookmark whatever `scan` found at `rect`/`gen` as a new discovery. */
export function bookmark(cluster: RecognizedCluster, gen: Generation): Discovery {
  return {
    id: freshId(gen, cluster.bbox),
    name: cluster.status === 'named' ? cluster.name! : null,
    kind: cluster.status,
    specimenId: cluster.status === 'named' ? cluster.name : undefined,
    period: cluster.period,
    translation: cluster.translation,
    discoveredAtGen: gen,
    trail: [{ gen, rect: cluster.bbox }],
    following: false,
    lost: false,
    observationCount: 1,
    lastSeenGen: gen,
  };
}

/** Bookmark a plain user-drawn region with no recognition behind it yet. */
export function bookmarkRegion(rect: Rect, gen: Generation): Discovery {
  return {
    id: freshId(gen, rect),
    name: null,
    kind: 'manual',
    discoveredAtGen: gen,
    trail: [{ gen, rect }],
    following: false,
    lost: false,
    observationCount: 1,
    lastSeenGen: gen,
  };
}

/**
 * Continuity check for the ambient scanner: is `cluster` (freshly scanned at
 * `gen`) plausibly the SAME structure as `d`, seen again — rather than a
 * distinct new discovery? Two conditions must both hold:
 *
 *  1. **Same identity.** A named cluster must name the same specimen; a
 *     characterized-but-unnamed cluster must share `d`'s period (and `d`
 *     must not itself be named — a coincidentally-matching period doesn't
 *     make an unnamed blinker the same object as a named one).
 *  2. **Same continuity through time.** The cluster's bounding box must be
 *     close to where `d` would be predicted to be at `gen`, extrapolating
 *     from its last sighting by `translation` (for a moving spaceship) or
 *     staying put (still lifes/oscillators). This is what turns "a glider
 *     re-scanned three cells further along" into a re-observation of the
 *     same traveler instead of a new entry, while still letting a second,
 *     unrelated glider elsewhere register as its own discovery.
 *
 * Position is compared in plain (non-wrapping) cell distance — ambient scans
 * are bounded to a small window around the camera, so a seam-crossing false
 * negative here just means (at worst) one extra entry, not a crash.
 */
export function isSameDiscovery(d: Discovery, cluster: RecognizedCluster, gen: Generation): boolean {
  const sameIdentity =
    cluster.status === 'named'
      ? d.specimenId !== undefined && d.specimenId === cluster.name
      : cluster.status === 'characterized'
        ? d.specimenId === undefined && d.kind === 'characterized' && d.period === cluster.period
        : false;
  if (!sameIdentity) return false;

  const last = lastObservation(d);
  const elapsed = Math.max(0, gen - last.gen);
  const lastCenter = { x: last.rect.x + last.rect.w / 2, y: last.rect.y + last.rect.h / 2 };
  const predicted =
    d.translation && d.period
      ? {
          x: lastCenter.x + (d.translation.dx * elapsed) / d.period,
          y: lastCenter.y + (d.translation.dy * elapsed) / d.period,
        }
      : lastCenter;
  const clusterCenter = { x: cluster.bbox.x + cluster.bbox.w / 2, y: cluster.bbox.y + cluster.bbox.h / 2 };
  const tolerance = Math.max(cluster.bbox.w, cluster.bbox.h, last.rect.w, last.rect.h, 8) + 6;
  const dx = clusterCenter.x - predicted.x;
  const dy = clusterCenter.y - predicted.y;
  return dx * dx + dy * dy <= tolerance * tolerance;
}

/**
 * Strengthen an existing discovery with a fresh sighting of the SAME
 * structure (see `isSameDiscovery`) instead of creating a duplicate entry —
 * "seeing the same small traveler repeatedly should gradually make it feel
 * like your traveler" (design brief). Bumps `observationCount`/`lastSeenGen`
 * always; only grows `trail` when the structure actually moved, otherwise
 * refreshes the last sighting's generation in place so a standing still life
 * re-observed for an hour doesn't accumulate hundreds of identical entries.
 */
export function reobserve(d: Discovery, gen: Generation, cluster: RecognizedCluster): Discovery {
  const last = lastObservation(d);
  const moved = last.rect.x !== cluster.bbox.x || last.rect.y !== cluster.bbox.y;
  const MAX_TRAIL = 24;
  const trail = moved
    ? [...d.trail, { gen, rect: cluster.bbox }].slice(-MAX_TRAIL)
    : [...d.trail.slice(0, -1), { gen, rect: cluster.bbox }];
  return {
    ...d,
    lost: false,
    period: cluster.period ?? d.period,
    translation: cluster.translation ?? d.translation,
    observationCount: d.observationCount + 1,
    lastSeenGen: gen,
    trail,
  };
}

export function nameDiscovery(d: Discovery, name: string): Discovery {
  return { ...d, name };
}

export function startFollowing(d: Discovery): Discovery {
  return d.lost ? d : { ...d, following: true };
}

export function stopFollowing(d: Discovery): Discovery {
  return { ...d, following: false };
}

/**
 * Advance a followed discovery with a fresh `scan` result taken from the
 * region the caller predicted it would be in (e.g. the last rect shifted by
 * `translation`). Appends to the trail if it still matches; otherwise marks
 * it `lost` and leaves the trail exactly as it was — the last good
 * observation is never overwritten or discarded.
 */
export function advanceFollow(d: Discovery, gen: Generation, freshScan: RecognizedCluster | null): Discovery {
  if (!d.following || d.lost) return d;
  if (!freshScan || freshScan.population === 0) {
    return { ...d, lost: true };
  }
  const stillMatches =
    d.kind === 'manual' || d.kind === 'unknown'
      ? freshScan.status !== 'unverified'
      : freshScan.status !== 'unverified' && (freshScan.name ?? null) === (d.specimenId ?? null);
  if (!stillMatches) {
    return { ...d, lost: true };
  }
  return {
    ...d,
    trail: [...d.trail, { gen, rect: freshScan.bbox }],
    observationCount: d.observationCount + 1,
    lastSeenGen: gen,
  };
}

/** The most recent sighting — where "clicking an observation" should return to. */
export function lastObservation(d: Discovery): DiscoverySighting {
  return d.trail[d.trail.length - 1]!;
}

/** A camera centred on a sighting's rect, for the "return to this place and moment" route. */
export function cameraFor(sighting: DiscoverySighting, pxPerCell = 24): CameraSpec {
  return {
    centerX: sighting.rect.x + sighting.rect.w / 2,
    centerY: sighting.rect.y + sighting.rect.h / 2,
    pxPerCell,
    note: `Generation ${sighting.gen}.`,
  };
}

/** A small, world-anchored annotation for a fresh discovery — quiet by design, never a modal. */
export interface DiscoveryAnnotation {
  at: CellCoord;
  label: string;
}

export function annotationFor(d: Discovery): DiscoveryAnnotation {
  const s = lastObservation(d);
  const at = { x: Math.round(s.rect.x + s.rect.w / 2), y: Math.round(s.rect.y + s.rect.h / 2) };
  if (d.name) return { at, label: d.name };
  if (d.kind === 'characterized' && d.period !== undefined) return { at, label: `period ${d.period}` };
  return { at, label: 'unidentified' };
}

/**
 * Shaped to match `@/ui/panels/FieldGuidePanel`'s `FieldGuideEntry` prop
 * structurally (id/title/kind/body/discoveredAtGen/preview) without either
 * module importing the other.
 */
export interface FieldGuideEntry {
  id: string;
  title: string;
  kind: string;
  body: string;
  discoveredAtGen?: number;
  preview?: { w: number; h: number; cells: Uint8Array };
}

export function toFieldGuideEntry(d: Discovery): FieldGuideEntry {
  const title = d.name ?? 'Unnamed observation';
  let body: string;
  let preview: FieldGuideEntry['preview'];

  if (d.specimenId) {
    const s = getSpecimen(d.specimenId);
    body = s?.explanation ?? `Recognised as ${d.specimenId}.`;
    if (s) preview = { w: s.width, h: s.height, cells: s.cells };
  } else if (d.kind === 'characterized') {
    body = d.translation
      ? `Moves like a spaceship: displaced (${d.translation.dx}, ${d.translation.dy}) every ${d.period} generations, by direct observation.`
      : `Repeats with period ${d.period}, by direct observation — not one of the catalogued specimens.`;
  } else if (d.kind === 'unverified') {
    body = 'A candidate structure, but another live cell nearby means the observation was not clean.';
  } else if (d.lost) {
    body = 'Last seen before it collided, dispersed, or moved out of view. The trail below leads back to it.';
  } else {
    body = 'An unnamed structure, bookmarked for a closer look.';
  }

  // "Seeing the same small traveler repeatedly should gradually make it feel
  // like your traveler" — re-observation strengthens this entry in place
  // (see `reobserve`) rather than spawning a duplicate, so the growing count
  // is the visible trace of that familiarity.
  if (d.observationCount > 1) {
    body += ` Observed ${d.observationCount} times so far, most recently at generation ${d.lastSeenGen}.`;
  }

  return { id: d.id, title, kind: d.kind, body, discoveredAtGen: d.discoveredAtGen, preview };
}

// ---------------------------------------------------------------------------
// The log
// ---------------------------------------------------------------------------

export interface DiscoveryLog {
  list(): readonly Discovery[];
  get(id: string): Discovery | undefined;
  add(d: Discovery): void;
  update(id: string, updater: (d: Discovery) => Discovery): void;
  remove(id: string): void;
  clear(): void;
}

export function createDiscoveryLog(): DiscoveryLog {
  const byId = new Map<string, Discovery>();
  return {
    list: () => Array.from(byId.values()),
    get: (id) => byId.get(id),
    add: (d) => { byId.set(d.id, d); },
    update: (id, updater) => {
      const existing = byId.get(id);
      if (existing) byId.set(id, updater(existing));
    },
    remove: (id) => { byId.delete(id); },
    clear: () => { byId.clear(); },
  };
}
