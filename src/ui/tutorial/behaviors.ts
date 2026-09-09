/**
 * The imperative half of the tour: for each `TourStepId` (content lives in
 * `@/content/tour`), how to detect the REAL action that completes it, how to
 * perform that action on the user's behalf ("show me"), and any setup a step
 * needs on entry (e.g. opening the drawer so its target exists at all).
 *
 * Every `completesOn` here listens on `@/ui/bus` or a store subscription —
 * never a synthetic click, never a timer standing in for "the user did it".
 * Most also check the CURRENT state immediately: if the user already reached
 * the taught state before this step became active (they paused earlier out
 * of curiosity, say), the step completes right away instead of waiting for
 * an event that already happened and will not fire again.
 */
import { bus } from '@/ui/bus';
import { useAppStore } from '@/ui/store';
import { useUIState } from '@/ui/uiState';
import { getSession, type Session } from '@/ui/session';
import { PATTERNS } from '@/content/patterns';
import { OPENING_VERIFIED } from '@/content/scenes';
import type { TourStepId } from '@/content/tour';
import type { RenderLens } from '@/core/types';

export interface TourCtx {
  session: Session | null;
}

export interface TourBehavior {
  /** Runs once when the step becomes active. May return a cleanup, run when the step ends. */
  onEnter?: (ctx: TourCtx) => void | (() => void);
  /** Subscribes to the real action; call `done()` when it happens. Returns an unsubscribe. */
  completesOn?: (ctx: TourCtx, done: () => void) => () => void;
  /** Performs the step's action for a user who would rather watch than do. */
  showMe?: (ctx: TourCtx) => void;
}

/** No unsubscribe needed for a check that already fired synchronously. */
const NOOP = () => {};

/** Runs `check()` immediately — if it's already true, complete right away
 *  without waiting on an event that may never come again (see module doc).
 *  Otherwise defers to `subscribe`. */
function checkThenSubscribe(check: () => boolean, subscribe: (done: () => void) => () => void, done: () => void): () => void {
  if (check()) {
    done();
    return NOOP;
  }
  return subscribe(done);
}

function centerOfView(session: Session): { x: number; y: number } {
  const { x, y } = session.camera.camera;
  return { x: Math.round(x), y: Math.round(y) };
}

export const TOUR_BEHAVIORS: Partial<Record<TourStepId, TourBehavior>> = {
  encounter: {
    onEnter: ({ session }) => {
      if (!session) return;
      // Honest timing: the encounter is a real, one-time event in this
      // session's history (verified at generation 123 — see
      // `OPENING_VERIFIED`). If the user lingered on the welcome step long
      // enough that it's already well behind us, rewind far enough to watch
      // it happen again rather than silently completing this step on
      // arrival — and say so, out loud, via the toast layer everything else
      // in the app already uses for this kind of aside.
      if (session.engine.gen >= OPENING_VERIFIED.encounterGen + 30) {
        bus.emit('toast', { message: 'Rewinding to watch the two travelers meet.', tone: 'info', ms: 3200 });
        void session.gotoGen(Math.max(0, OPENING_VERIFIED.encounterGen - 20));
      }
      if (!useAppStore.getState().playing) bus.emit('playback:play', undefined);
    },
    completesOn: ({ session }, done) => {
      if (!session) return NOOP;
      return checkThenSubscribe(
        () => session.engine.gen >= OPENING_VERIFIED.encounterGen,
        (d) => bus.on('gen:changed', ({ gen }) => { if (gen >= OPENING_VERIFIED.encounterGen) d(); }).dispose,
        done,
      );
    },
    showMe: ({ session }) => {
      if (!session) return;
      bus.emit('toast', { message: 'Rewinding to watch the two travelers meet.', tone: 'info', ms: 3200 });
      void session.gotoGen(Math.max(0, OPENING_VERIFIED.encounterGen - 20));
      bus.emit('playback:play', undefined);
    },
  },

  transport: {
    completesOn: (_ctx, done) => checkThenSubscribe(
      () => !useAppStore.getState().playing,
      (d) => bus.on('playback:pause', d).dispose,
      done,
    ),
    showMe: () => bus.emit('playback:pause', undefined),
  },

  draw: {
    onEnter: () => {
      useAppStore.getState().setDrawerOpen(true);
      useAppStore.getState().setTool('draw');
    },
    completesOn: (_ctx, done) => {
      const a = bus.on('edit:committed', () => done());
      const b = bus.on('branch:created', () => done());
      return () => { a.dispose(); b.dispose(); };
    },
    showMe: ({ session }) => {
      if (!session) return;
      const { x, y } = centerOfView(session);
      session.applyEdit({ kind: 'set', cells: [{ x, y, alive: true }] });
    },
  },

  stamp: {
    onEnter: () => {
      useAppStore.getState().setDrawerOpen(true);
    },
    completesOn: (_ctx, done) => checkThenSubscribe(
      () => useUIState.getState().selectedPatternId !== null,
      (d) => useUIState.subscribe((state, prev) => {
        if (state.selectedPatternId !== null && state.selectedPatternId !== prev.selectedPatternId) d();
      }),
      done,
    ),
    showMe: () => {
      const first = PATTERNS[0];
      if (!first) return;
      useUIState.getState().setSelectedPattern(first.id);
      useAppStore.getState().setTool('stamp');
    },
  },

  lenses: {
    completesOn: (_ctx, done) => bus.on('lens:changed', () => done()).dispose,
    showMe: () => {
      // Tutorial demo cycles the 3 original lenses only — the 5 colour lenses
      // are discoverable via the HUD toggle/keyboard, not this walkthrough step.
      const order: readonly RenderLens[] = ['life', 'age', 'activity'];
      const next = order[(order.indexOf(useAppStore.getState().lens) + 1) % order.length]!;
      useAppStore.getState().setLens(next);
      bus.emit('lens:changed', { lens: next });
    },
  },

  ribbon: {
    completesOn: (_ctx, done) => bus.on('playback:scrub', ({ done: finished }) => { if (finished) done(); }).dispose,
    showMe: ({ session }) => {
      if (!session) return;
      const target = Math.max(session.history.windowStart, session.engine.gen - 30);
      // `synthetic: true` — this is the tour performing the action for the
      // visitor, not a real drag; achievements must not credit it as one.
      bus.emit('playback:scrub', { gen: target, done: true, synthetic: true });
    },
  },

  fork: {
    completesOn: (_ctx, done) => {
      const a = bus.on('branch:created', () => done());
      const b = bus.on('edit:committed', () => done());
      return () => { a.dispose(); b.dispose(); };
    },
    showMe: ({ session }) => {
      if (!session) return;
      const { x, y } = centerOfView(session);
      session.applyEdit({ kind: 'set', cells: [{ x, y, alive: true }] });
    },
  },

  sculpture: {
    completesOn: (_ctx, done) => checkThenSubscribe(
      () => useAppStore.getState().sculptureOpen,
      (d) => bus.on('sculpture:open', () => d()).dispose,
      done,
    ),
    showMe: ({ session }) => session?.openSculpture(),
  },

  'field-guide': {
    completesOn: (_ctx, done) => checkThenSubscribe(
      () => useUIState.getState().rightPanel === 'guide',
      (d) => useUIState.subscribe((state) => { if (state.rightPanel === 'guide') d(); }),
      done,
    ),
    showMe: () => useUIState.getState().setRightPanel('guide'),
  },

  experiments: {
    completesOn: (_ctx, done) => checkThenSubscribe(
      () => useUIState.getState().rightPanel === 'experiments',
      (d) => useUIState.subscribe((state) => { if (state.rightPanel === 'experiments') d(); }),
      done,
    ),
    showMe: () => useUIState.getState().setRightPanel('experiments'),
  },
};

export function tourCtx(): TourCtx {
  return { session: getSession() };
}
