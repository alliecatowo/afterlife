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
  return { ...d, trail: [...d.trail, { gen, rect: freshScan.bbox }] };
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
