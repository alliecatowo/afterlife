/**
 * Cinematic mode's own ephemeral UI state — same discipline as
 * `@/ui/uiState` and `@/ui/tutorial/tourStore`: a small local zustand store
 * owned entirely by this module, not the frozen `@/ui/store`. Written a
 * handful of times per subject change, never per frame/generation.
 */
import { create } from 'zustand';

export type CinematicBeatKind = 'traveller' | 'activity' | 'wide' | null;

interface CinematicState {
  /** True whenever cinematic mode is running (whether or not the user has
   *  currently paused the auto-pan by touching the camera themselves). */
  active: boolean;
  /** True once real user input has released the director's `follow()` —
   *  the camera stays put (still cinematic chrome, still fullscreen) until
   *  the director resumes on its own schedule. See `director.ts`'s doc. */
  paused: boolean;
  /** A short, human-readable caption for the current beat, e.g. "following
   *  a glider" / "wide shot" / "a quiet corner" — shown by `CinematicOverlay`. */
  caption: string;
  beatKind: CinematicBeatKind;
  /** Whether the real Fullscreen API is actually engaged. False means we
   *  degraded to presentation mode's chrome-hiding only (denied/unsupported) —
   *  `CinematicOverlay` uses this to say so, rather than silently pretending. */
  fullscreenActive: boolean;

  setActive: (active: boolean) => void;
  setPaused: (paused: boolean) => void;
  setBeat: (caption: string, kind: CinematicBeatKind) => void;
  setFullscreenActive: (on: boolean) => void;
}

export const useCinematicStore = create<CinematicState>((set) => ({
  active: false,
  paused: false,
  caption: '',
  beatKind: null,
  fullscreenActive: false,
  setActive: (active) => set({ active }),
  setPaused: (paused) => set({ paused }),
  setBeat: (caption, beatKind) => set({ caption, beatKind }),
  setFullscreenActive: (fullscreenActive) => set({ fullscreenActive }),
}));
