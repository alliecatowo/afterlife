/**
 * CINEMATIC MODE — public entry point.
 *
 * `initCinematic({ camera, engine })` is called once from `@/ui/session.ts`
 * (this module's owner) after the real camera/engine exist. It wires:
 *
 *  - the 'c' keyboard shortcut (toggle), guarded by the same
 *    `shouldIgnoreGlobalShortcut` the rest of the app's shortcuts use;
 *  - reuse of the EXISTING `presentation` app-state flag + `presentation:toggle`
 *    bus event for chrome-hiding (see ARCHITECTURE's frozen-file list —
 *    `@/ui/store.ts`/`@/ui/bus.ts` are frozen, but calling their already-
 *    public actions/events is not an edit to either file);
 *  - a best-effort Fullscreen API request on top of that, degrading
 *    silently to presentation mode's chrome-hiding alone when denied or
 *    unsupported (`@/ui/cinematic/fullscreen`);
 *  - the `CinematicDirector` (camera choreography — see `director.ts`);
 *  - a self-mounted `CinematicOverlay` root (see that file's doc for why
 *    self-mounted rather than wired into `App.tsx`/`Hud.tsx`);
 *  - hand-back-control: ANY real pointer/keyboard/touch/wheel input pauses
 *    the auto-pan immediately, matching `CameraController.releaseFollow()`'s
 *    existing "manual input always wins" rule. Pausing (not exiting) is the
 *    deliberate choice here — see `director.ts`'s doc for why. An idle
 *    period with no further input resumes the rotation on its own; `Esc`
 *    (already wired by `App.tsx`'s existing presentation Escape handler) or
 *    the overlay's own exit button leaves the mode entirely.
 *
 * See INTEGRATION-NOTES.md for the (not-yet-applied, by design) HUD icon
 * button this still wants near the existing presentation-mode control.
 */
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { bus } from '@/ui/bus';
import { readState, useAppStore } from '@/ui/store';
import { shouldIgnoreGlobalShortcut } from '@/interact/globalShortcutGuard';
import type { LifeEngine } from '@/core/engine';
import type { CameraController } from '@/render/camera';
import { CinematicDirector } from './director';
import { useCinematicStore } from './store';
import { exitFullscreen, isFullscreenSupported, requestFullscreen } from './fullscreen';
import { CinematicOverlay } from './CinematicOverlay';

/** How long the auto-pan stays paused after the user last touched anything, before resuming on its own. */
const IDLE_RESUME_MS = 15_000;
const OVERLAY_HOST_ID = 'cinematic-overlay-host';

export interface CinematicController {
  enter(): void;
  exit(): void;
  toggle(): void;
  isActive(): boolean;
}

let controller: CinematicController | null = null;

export interface CinematicDeps {
  camera: CameraController;
  engine: LifeEngine;
}

/** Idempotent, same discipline as `initSession()` — a second call returns the existing controller. */
export function initCinematic(deps: CinematicDeps): CinematicController {
  if (controller) return controller;

  const director = new CinematicDirector(deps);
  let overlayHost: HTMLElement | null = null;
  let overlayRoot: Root | null = null;
  let idleResumeTimer: ReturnType<typeof setTimeout> | null = null;
  let wasPlayingBeforeEntry = false;

  function ensureOverlayMounted(): void {
    if (overlayRoot) return;
    overlayHost = document.createElement('div');
    overlayHost.id = OVERLAY_HOST_ID;
    document.body.appendChild(overlayHost);
    overlayRoot = createRoot(overlayHost);
    overlayRoot.render(createElement(CinematicOverlay, { onExit: exit, onResume: () => director.resume() }));
  }

  function clearIdleResumeTimer(): void {
    if (idleResumeTimer !== null) { clearTimeout(idleResumeTimer); idleResumeTimer = null; }
  }

  function onAnyUserInput(e: Event): void {
    if (!director.active) return;
    // The mode's own affordance (exit/resume buttons) is an intentional
    // cinematic-mode action, not "the user wants their camera back" — and
    // 'c'/Escape are handled by their own dedicated handlers below/in
    // `App.tsx`, not as a generic "pause" signal.
    if (overlayHost && e.target instanceof Node && overlayHost.contains(e.target)) return;
    if (e instanceof KeyboardEvent && (e.key === 'Escape' || e.key.toLowerCase() === 'c')) return;
    director.pauseForUserInput();
    clearIdleResumeTimer();
    idleResumeTimer = setTimeout(() => director.resume(), IDLE_RESUME_MS);
  }

  const inputEvents: Array<[keyof WindowEventMap, AddEventListenerOptions]> = [
    ['pointerdown', { capture: true }],
    ['keydown', { capture: true }],
    ['touchstart', { capture: true, passive: true }],
    ['wheel', { capture: true, passive: true }],
  ];

  function attachInputListeners(): void {
    for (const [name, opts] of inputEvents) window.addEventListener(name, onAnyUserInput, opts);
  }

  function detachInputListeners(): void {
    for (const [name, opts] of inputEvents) window.removeEventListener(name, onAnyUserInput, opts);
  }

  function enter(): void {
    if (director.active) return;
    ensureOverlayMounted();
    const { presentation, playing } = readState();
    if (!presentation) {
      useAppStore.getState().setPresentation(true);
      bus.emit('presentation:toggle', { on: true });
    }
    wasPlayingBeforeEntry = playing;
    // A static, paused world has nothing to be cinematic ABOUT — the whole
    // premise is real, ongoing activity to find and hold on.
    if (!playing) bus.emit('playback:play', undefined);
    void requestFullscreen().then((ok) => useCinematicStore.getState().setFullscreenActive(ok));
    attachInputListeners();
    director.start();
  }

  function exit(): void {
    if (!director.active) return;
    clearIdleResumeTimer();
    detachInputListeners();
    director.stop();
    void exitFullscreen();
    useCinematicStore.getState().setFullscreenActive(false);
    if (readState().presentation) {
      useAppStore.getState().setPresentation(false);
      bus.emit('presentation:toggle', { on: false });
    }
    // Restore playback to whatever it was before entry, rather than always
    // leaving it running (or always leaving it stopped) regardless of what
    // the user had actually chosen beforehand.
    if (readState().playing !== wasPlayingBeforeEntry) {
      bus.emit(wasPlayingBeforeEntry ? 'playback:play' : 'playback:pause', undefined);
    }
  }

  // Presentation mode can be turned off from elsewhere entirely (the Hud's
  // own exit button, or `App.tsx`'s Escape handler) while cinematic is
  // active — it has no chrome-hidden state of its own to fall back to, so
  // that must tear cinematic down too, not leave it running invisibly.
  bus.on('presentation:toggle', ({ on }) => {
    if (!on && director.active) exit();
  });

  function toggle(): void {
    if (director.active) exit(); else enter();
  }

  window.addEventListener('keydown', (e) => {
    if (shouldIgnoreGlobalShortcut(e.target, e.key)) return;
    if (e.key.toLowerCase() === 'c' && !e.metaKey && !e.ctrlKey && !e.altKey) toggle();
  });

  controller = { enter, exit, toggle, isActive: () => director.active };
  return controller;
}

export { isFullscreenSupported };
