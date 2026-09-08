/**
 * The logbook's live wiring — the impure bridge between real bus events/
 * session state and `@/content/achievements`'s pure shapes, same relationship
 * `@/ui/discoveries.ts` has to `@/content/discoveries`. Every unlock here is
 * derived from an event or state transition that could only happen from
 * genuine simulation activity — never a timer standing in for "the user did
 * it", never awarded twice, never awarded for merely opening a panel (see
 * that module's doc for the full list of what does and doesn't count).
 *
 * Persistence mirrors `@/ui/tutorial/tourStore`'s own pattern (itself
 * modelled on the session module's audio-preference key): `STORAGE_PREFIX`
 * from `@/persist/store` for the shared `afterlife:v1:*` namespace, plain
 * `localStorage` reads/writes in a `try/catch`, no dependency on
 * `PersistStore` itself (shaped around `ExperimentDoc`, not an arbitrary
 * earned-achievements map).
 */
import { create } from 'zustand';
import { STORAGE_PREFIX } from '@/persist/store';
import { bus } from '@/ui/bus';
import { getSession } from '@/ui/session';
import { useDiscoveries } from '@/ui/discoveries';
import { getSpecimen } from '@/content/specimens';
import {
  ACHIEVEMENTS, CATALOGUE_SIZE, SURVIVAL_GENERATIONS, TRAVELLER_OBSERVATIONS, parseAchievementLog,
  type AchievementId, type AchievementLog, type EarnedAchievement,
} from '@/content/achievements';
import type { Rect } from '@/core/types';

const STORAGE_KEY = `${STORAGE_PREFIX}achievements`;

function load(): AchievementLog {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw == null) return {};
    return parseAchievementLog(JSON.parse(raw));
  } catch {
    return {};
  }
}

function persist(log: AchievementLog): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(log));
  } catch {
    // Best-effort only, same as every other write in `@/persist` and `tourStore`.
  }
}

interface AchievementsState {
  log: AchievementLog;
  /** Idempotent: re-earning an already-earned achievement is a silent no-op
   *  (the FIRST time it was true is what's recorded, never overwritten). */
  unlock(id: AchievementId, gen: number, rect?: Rect): void;
  /** Explicit reset — not wired to any routine flow, same caution as
   *  `PersistStore.clearAll()`. */
  clear(): void;
}

export const useAchievements = create<AchievementsState>((set, get) => ({
  log: load(),

  unlock(id, gen, rect) {
    if (get().log[id]) return;
    const entry: EarnedAchievement = { id, gen, at: Date.now(), rect };
    const log = { ...get().log, [id]: entry };
    set({ log });
    persist(log);
    const def = ACHIEVEMENTS.find((a) => a.id === id);
    bus.emit('toast', { message: `Logbook: ${def?.title ?? id}`, tone: 'success', ms: 4200 });
  },

  clear() {
    set({ log: {} });
    persist({});
  },
}));

/** Move the sim to where an earned achievement happened and frame it — the
 *  same "return to this place and moment" route `@/ui/discoveries.ts#goTo`
 *  already uses, reusing the identical `gotoGen` + camera-centre shape. */
export function goToAchievement(id: AchievementId): void {
  const entry = useAchievements.getState().log[id];
  const session = getSession();
  if (!entry || !session) return;
  void session.gotoGen(entry.gen).then(() => {
    if (entry.rect) {
      session.camera.set({ x: entry.rect.x + entry.rect.w / 2, y: entry.rect.y + entry.rect.h / 2 });
    }
  });
}

// ---------------------------------------------------------------------------
// Self-wired bus/store subscriptions — module side effects, same convention
// `@/ui/discoveries.ts` and `@/ui/experiments.ts` both already use for this
// exact "impure bridge" shape.
// ---------------------------------------------------------------------------

const EXPERIMENT_ACHIEVEMENT: Record<string, AchievementId> = {
  'first-contact': 'experiment-first-contact',
  'one-cell': 'experiment-one-cell',
  'keep-alive': 'experiment-keep-alive',
};

/** Highest generation observed this session — the baseline "scrubbing
 *  backward" and "kept alive" both measure against. */
let maxGenSeen = 0;
/** The generation of the most recent gen-0-or-later moment the population
 *  was exactly zero (starts at 0: a freshly-seeded world is "alive since the
 *  beginning" until proven otherwise). "Survived" measures the gap since here. */
let lastZeroGen = 0;
let lastPopulation = -1;
/** `${kind}:${label}` per distinct specimen ever logged — see `catalogue`. */
const seenSpecimens = new Set<string>();

bus.on('gen:changed', ({ gen, population }) => {
  maxGenSeen = Math.max(maxGenSeen, gen);
  if (population === 0) {
    if (gen > 0 && lastPopulation > 0) {
      useAchievements.getState().unlock('extinction-witnessed', gen);
    }
    lastZeroGen = gen;
  } else if (gen - lastZeroGen >= SURVIVAL_GENERATIONS) {
    useAchievements.getState().unlock('survived', gen);
  }
  lastPopulation = population;
});

bus.on('playback:scrub', ({ gen, done }) => {
  if (done && gen < maxGenSeen) useAchievements.getState().unlock('scrub-backward', gen);
});

bus.on('branch:created', ({ fromGen }) => {
  // `fromGen === 0` is the automatic sibling branch `@/ui/experiments.ts`
  // creates when starting the "One Cell" experiment, not a deliberate fork
  // by the visitor — the same distinction that module's own edit-budget
  // counter already draws.
  if (fromGen > 0) useAchievements.getState().unlock('first-fork', fromGen);
});

bus.on('sculpture:open', ({ fromGen, rect }) => {
  useAchievements.getState().unlock('first-sculpture', fromGen, rect);
});

bus.on('experiment:succeeded', ({ id, gen }) => {
  const achievementId = EXPERIMENT_ACHIEVEMENT[id];
  if (achievementId) useAchievements.getState().unlock(achievementId, gen);
});

bus.on('discovery:made', ({ kind, gen, rect, label }) => {
  seenSpecimens.add(`${kind}:${label}`);
  if (seenSpecimens.size >= CATALOGUE_SIZE) {
    useAchievements.getState().unlock('catalogue', gen, rect);
  }
  if (kind === 'oscillator') {
    useAchievements.getState().unlock('first-oscillator', gen, rect);
    return;
  }
  if (kind === 'spaceship') {
    const specimen = getSpecimen(label);
    if (specimen?.category === 'emitter') {
      useAchievements.getState().unlock('first-gun', gen, rect);
    } else if (specimen?.name === 'glider') {
      useAchievements.getState().unlock('first-glider', gen, rect);
    }
  }
});

// A followed discovery flips `lost: false -> true` ONLY via `advanceFollow`
// (`@/content/discoveries`), which only ever runs for entries the visitor
// chose to follow — see that module's doc. That's a real, watched traveler
// whose trail stopped matching, the honest proxy this logbook uses for "met
// something it didn't survive" without recognition needing to model
// collisions explicitly.
useDiscoveries.subscribe((state, prev) => {
  for (const d of state.items) {
    if (!d.lost) continue;
    const before = prev.items.find((p) => p.id === d.id);
    if (before && !before.lost) {
      const last = d.trail[d.trail.length - 1]!;
      useAchievements.getState().unlock('collision-witnessed', last.gen, last.rect);
    }
    if (d.observationCount >= TRAVELLER_OBSERVATIONS) {
      const last = d.trail[d.trail.length - 1]!;
      useAchievements.getState().unlock('your-traveller', last.gen, last.rect);
    }
  }
  // `your-traveller` doesn't require `lost` — re-check every changed item,
  // not only the ones that just became lost, above.
  for (const d of state.items) {
    if (d.lost) continue;
    if (d.observationCount >= TRAVELLER_OBSERVATIONS) {
      const last = d.trail[d.trail.length - 1]!;
      useAchievements.getState().unlock('your-traveller', last.gen, last.rect);
    }
  }
});
