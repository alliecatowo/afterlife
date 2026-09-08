/**
 * The cinematic camera choreographer. Owns the "what to look at next, how
 * long to hold, when to pull back" state machine; drives the shared
 * `CameraController` via `follow()` (see `@/render/camera`'s doc — the
 * existing per-frame `camera.tick()` call in `session.ts`'s render loop does
 * all the actual easing, so this module adds no new per-frame work of its
 * own beyond that pre-existing tick).
 *
 * Scheduling is entirely `setTimeout`-based, one pending timer at a time
 * (plus, only while holding on a traveller, one lightweight verify
 * interval) — nothing here runs on a schedule tighter than about a second,
 * and every timer is cleared on `stop()`/`pause()`, so an inactive director
 * costs exactly nothing.
 *
 * Hand-back-control: ANY real pointer/keyboard/touch input pauses the
 * auto-pan immediately (mirrors `CameraController.releaseFollow()`'s own
 * "any manual camera call releases follow" rule) — see `index.ts`'s window
 * listener, which calls `pauseForUserInput()`. Pausing does NOT exit
 * cinematic mode; it just stops moving the camera until the user has left
 * it alone for a while, or `resume()` is called explicitly. That choice
 * (pause, not exit) is deliberate: an accidental stray click shouldn't kick
 * you out of a full-screen mode you just settled into.
 */
import type { LifeEngine } from '@/core/engine';
import { prefersReducedMotion, type CameraController, type Viewport } from '@/render/camera';
import { pickSubject, rankRegions, type VisitedMemoryEntry } from './interest';
import {
  confirmTravellers, predictTravellerCenter, sampleKey, sampleWorldGrid, travellerStillAlive,
  type TravellerLock,
} from './worldSample';
import { chooseCloseScale, chooseWideScale } from './framing';
import { useCinematicStore, type CinematicBeatKind } from './store';

const BASE_HOLD_MS = 6000;
const ACTIVITY_HOLD_BONUS_MS = 9000;
const TRAVELLER_HOLD_BONUS_MS = 3000;
const MAX_HOLD_MS = 18000;
const WIDE_HOLD_MS = 4500;
const AFTERMATH_BONUS_MS = 5000;
const TRAVELLER_VERIFY_INTERVAL_MS = 1400;
/** How many close-up beats happen, on average, between establishing wide shots. */
const WIDE_INTERVAL_MIN = 3;
const WIDE_INTERVAL_MAX = 5;
/** How many past subjects the "don't immediately revisit" memory keeps. */
const MEMORY_CAP = 12;
const GRID_BLOCK_SIZE = 16;

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function randomWideThreshold(): number {
  return WIDE_INTERVAL_MIN + Math.floor(Math.random() * (WIDE_INTERVAL_MAX - WIDE_INTERVAL_MIN + 1));
}

export interface CinematicDirectorDeps {
  camera: CameraController;
  engine: LifeEngine;
}

export class CinematicDirector {
  #camera: CameraController;
  #engine: LifeEngine;

  #active = false;
  #paused = false;
  #memory: VisitedMemoryEntry[] = [];
  #beatsSinceWide = 0;
  #wideThreshold = randomWideThreshold();

  #holdTimer: ReturnType<typeof setTimeout> | null = null;
  #verifyTimer: ReturnType<typeof setInterval> | null = null;

  constructor(deps: CinematicDirectorDeps) {
    this.#camera = deps.camera;
    this.#engine = deps.engine;
  }

  get active(): boolean {
    return this.#active;
  }

  get paused(): boolean {
    return this.#paused;
  }

  /** Begin the choreography. Idempotent. */
  start(): void {
    if (this.#active) return;
    this.#active = true;
    this.#paused = false;
    this.#memory = [];
    this.#beatsSinceWide = this.#wideThreshold; // force an establishing wide shot first
    useCinematicStore.getState().setActive(true);
    useCinematicStore.getState().setPaused(false);
    this.#runBeat();
  }

  /** Full teardown. Clears every timer and releases the camera. Idempotent. */
  stop(): void {
    if (!this.#active) return;
    this.#active = false;
    this.#paused = false;
    this.#clearTimers();
    this.#camera.releaseFollow();
    useCinematicStore.getState().setActive(false);
    useCinematicStore.getState().setPaused(false);
    useCinematicStore.getState().setBeat('', null);
  }

  /** Called by `index.ts`'s window-level input listener on ANY real user
   *  gesture. Stops the auto-pan without exiting the mode; resumes on its
   *  own (see `index.ts`'s idle timer) or via an explicit `resume()`. */
  pauseForUserInput(): void {
    if (!this.#active || this.#paused) return;
    this.#paused = true;
    this.#clearTimers();
    this.#camera.releaseFollow();
    useCinematicStore.getState().setPaused(true);
  }

  /** Resume the rotation with a fresh pick — never resumes into a stale target. */
  resume(): void {
    if (!this.#active || !this.#paused) return;
    this.#paused = false;
    useCinematicStore.getState().setPaused(false);
    this.#runBeat();
  }

  #clearTimers(): void {
    if (this.#holdTimer !== null) { clearTimeout(this.#holdTimer); this.#holdTimer = null; }
    if (this.#verifyTimer !== null) { clearInterval(this.#verifyTimer); this.#verifyTimer = null; }
  }

  #remember(center: { x: number; y: number }): void {
    this.#memory.push({ x: center.x, y: center.y, visitedAtMs: now() });
    if (this.#memory.length > MEMORY_CAP) this.#memory.shift();
  }

  /** Apply one shot: eases in normally, or performs a single hard cut and
   *  holds static when `prefers-reduced-motion` is set — per the brief, this
   *  mode must never silently keep animating under that preference. A
   *  moving `pointFn` is only ever passed when motion is allowed; reduced
   *  motion always freezes to one snapshot position for the whole beat. */
  #applyShot(pointOrFn: { x: number; y: number } | (() => { x: number; y: number }), scale: number): void {
    if (prefersReducedMotion()) {
      const p = typeof pointOrFn === 'function' ? pointOrFn() : pointOrFn;
      this.#camera.follow(p, scale);
    } else {
      this.#camera.follow(pointOrFn, scale);
    }
  }

  #scheduleNext(delayMs: number): void {
    if (this.#holdTimer !== null) clearTimeout(this.#holdTimer);
    this.#holdTimer = setTimeout(() => this.#runBeat(), delayMs);
  }

  #setBeat(caption: string, kind: CinematicBeatKind): void {
    useCinematicStore.getState().setBeat(caption, kind);
  }

  #runWideBeat(): void {
    this.#beatsSinceWide = 0;
    this.#wideThreshold = randomWideThreshold();
    const world = this.#engine.spec;
    const viewport: Viewport = this.#camera.viewport;
    const scale = chooseWideScale(world, viewport);
    const center = { x: world.width / 2, y: world.height / 2 };
    this.#applyShot(center, scale);
    this.#setBeat('a wide view of the whole world', 'wide');
    this.#scheduleNext(WIDE_HOLD_MS);
  }

  #runBeat(): void {
    if (!this.#active || this.#paused) return;
    if (this.#verifyTimer !== null) { clearInterval(this.#verifyTimer); this.#verifyTimer = null; }

    this.#beatsSinceWide += 1;
    if (this.#beatsSinceWide > this.#wideThreshold) {
      this.#runWideBeat();
      return;
    }

    const world = this.#engine.spec;
    const rawSamples = sampleWorldGrid(this.#engine, GRID_BLOCK_SIZE);
    const rankedRaw = rankRegions(rawSamples).filter((r) => r.score > 0);
    const { samples: checkedTop, travellers } = confirmTravellers(this.#engine, rankedRaw);
    const travellerKeys = new Set<string>();
    for (const s of checkedTop) if (s.hasTraveller) travellerKeys.add(sampleKey(s));
    const finalSamples = rawSamples.map((s) => (travellerKeys.has(sampleKey(s)) ? { ...s, hasTraveller: true } : s));

    const picked = pickSubject(finalSamples, { nowMs: now(), memory: this.#memory, world });
    if (!picked) {
      // Nothing alive anywhere worth looking at — fall back to the wide
      // shot and try again soon rather than freezing on a stale frame.
      this.#runWideBeat();
      return;
    }

    this.#remember(picked.center);
    const lock = picked.hasTraveller ? travellers.get(sampleKey(picked)) : undefined;

    let hold = BASE_HOLD_MS + picked.activity * ACTIVITY_HOLD_BONUS_MS;
    if (lock) hold += TRAVELLER_HOLD_BONUS_MS;
    hold = Math.min(MAX_HOLD_MS, hold);

    if (lock) {
      this.#followTraveller(lock, world, hold);
    } else {
      const span = Math.max(picked.w, picked.h);
      const scale = chooseCloseScale(span, this.#camera.viewport);
      this.#applyShot({ x: picked.center.x, y: picked.center.y }, scale);
      this.#setBeat('a busy patch of the world', 'activity');
      this.#scheduleNext(hold);
    }
  }

  #followTraveller(lock: TravellerLock, world: { width: number; height: number }, baseHoldMs: number): void {
    const scale = chooseCloseScale(lock.spanCells, this.#camera.viewport);
    let frozen: { x: number; y: number } | null = null;
    const track = () => frozen ?? predictTravellerCenter(lock, this.#engine.gen, world);

    this.#applyShot(track, scale);
    this.#setBeat(lock.name ? `following the ${lock.name}` : 'following a traveller', 'traveller');

    let bonusApplied = false;
    const beatStarted = now();
    this.#scheduleNext(baseHoldMs);

    // Only a traveller beat runs this — a lightweight liveness re-check, not
    // a re-scan of the whole world. If the structure has died or collided,
    // freeze the camera on its last known position (the aftermath) and give
    // the beat a bit longer, instead of cutting away the instant it's gone.
    this.#verifyTimer = setInterval(() => {
      if (!this.#active || this.#paused) return;
      const at = track();
      if (!travellerStillAlive(this.#engine, at) && !frozen) {
        frozen = at;
        this.#setBeat('the trail goes quiet', 'traveller');
        if (!bonusApplied) {
          bonusApplied = true;
          const elapsed = now() - beatStarted;
          this.#scheduleNext(Math.max(0, baseHoldMs - elapsed) + AFTERMATH_BONUS_MS);
        }
      }
    }, TRAVELLER_VERIFY_INTERVAL_MS);
  }
}
