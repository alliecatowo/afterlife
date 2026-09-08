/**
 * The tour's own state machine: which step is active, and whether this
 * browser has ever finished/skipped it before. Ephemeral UI state, same
 * discipline as `@/ui/uiState` (a plain zustand store, not the frozen
 * `@/ui/store`).
 *
 * Persistence deliberately mirrors `@/ui/session.ts`'s own audio-preference
 * pattern rather than inventing a second mechanism: it reuses
 * `STORAGE_PREFIX` from `@/persist/store` so the key lives in the same
 * `afterlife:v1:*` namespace, and reads/writes `localStorage` directly inside
 * a `try/catch`, exactly like the audio preference does. The persist
 * module's own `PersistStore` is shaped for `ExperimentDoc`s (autosave/named
 * saves), not a single boolean flag, so reusing ITS API here would mean
 * bending an experiment-document shape around one bit — this reuses the
 * STORE'S NAMESPACE AND DEFENSIVE PATTERN instead, which is the part of "the
 * existing store" that actually applies.
 */
import { create } from 'zustand';
import { STORAGE_PREFIX } from '@/persist/store';
import { TOUR_STEPS, type TourStepContent } from '@/content/tour';

const TOUR_SEEN_KEY = `${STORAGE_PREFIX}tour-seen`;

function loadSeen(): boolean {
  try {
    return window.localStorage.getItem(TOUR_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

function saveSeen(): void {
  try {
    window.localStorage.setItem(TOUR_SEEN_KEY, '1');
  } catch {
    // Best-effort only, same as every other write in `@/persist`.
  }
}

export type TourStatus = 'idle' | 'active' | 'done';

interface TourState {
  status: TourStatus;
  stepIndex: number;
  /** True once the tour has been completed OR skipped at least once, in this browser. */
  seen: boolean;
  /** The "What is this?" dialog — independent of the tour's own run state, reachable anytime. */
  aboutOpen: boolean;
  setAboutOpen: (open: boolean) => void;
  currentStep: () => TourStepContent | null;
  /** Begin the tour from its first step. A first-run auto-start is a no-op
   *  once `seen` — pass `force` for the explicit replay control, which always starts it. */
  start: (force?: boolean) => void;
  /** Advance to the next step, or finish if this was the last one. */
  next: () => void;
  /** Ends the tour early; counts as "seen" — skipping is not a lesser outcome. */
  skip: () => void;
  finish: () => void;
}

export const useTourStore = create<TourState>((set, get) => ({
  status: 'idle',
  stepIndex: 0,
  seen: loadSeen(),
  aboutOpen: false,

  setAboutOpen: (aboutOpen) => set({ aboutOpen }),

  currentStep: () => {
    const { status, stepIndex } = get();
    return status === 'active' ? (TOUR_STEPS[stepIndex] ?? null) : null;
  },

  start: (force = false) => {
    if (!force && get().seen) return;
    set({ status: 'active', stepIndex: 0 });
  },

  next: () => {
    const { stepIndex } = get();
    if (stepIndex + 1 >= TOUR_STEPS.length) {
      get().finish();
      return;
    }
    set({ stepIndex: stepIndex + 1 });
  },

  skip: () => {
    saveSeen();
    set({ status: 'done', seen: true });
  },

  finish: () => {
    saveSeen();
    set({ status: 'done', seen: true });
  },
}));
