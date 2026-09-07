/**
 * Experiment orchestration — the `ui`-owned bridge between `@/content`'s
 * three authored challenges (pure scene + evaluator definitions, no engine
 * access of their own) and the running session. Restart, intervention and
 * time travel all reuse the ordinary editing/scrubbing paths (an experiment
 * is just a `TimelineStore` seeded from a `SceneDef`); this module only adds
 * the edit-budget count and the "check outcome" evaluation, which always
 * reads REAL state off `session.engine`/`session.history` — replayed or
 * live, never fabricated.
 */
import { create } from 'zustand';
import { bus } from '@/ui/bus';
import { getSession } from '@/ui/session';
import { useAppStore } from '@/ui/store';
import {
  activitySeries, EXPERIMENTS, evaluateFirstContact, evaluateKeepAlive, FIRST_CONTACT_VERIFIED,
  KEEP_ALIVE_VERIFIED, ONE_CELL_VERIFIED, type ExperimentDef,
} from '@/content';

export type ExperimentVerdict =
  | { kind: 'first-contact'; changedOutcome: boolean; note: string; gen: number }
  | { kind: 'one-cell'; divergentCells: number; gen: number }
  | { kind: 'keep-alive'; success: boolean; minActivity: number; failedAtGen: number | null; targetGen: number };

interface ExperimentsState {
  active: ExperimentDef | null;
  editCount: number;
  verdict: ExperimentVerdict | null;
  checking: boolean;
  start(exp: ExperimentDef): void;
  restart(): void;
  checkOutcome(): void;
  keepPlaying(): void;
  exit(): void;
}

export const useExperiments = create<ExperimentsState>((set, get) => ({
  active: null,
  editCount: 0,
  verdict: null,
  checking: false,

  start(exp) {
    const session = getSession();
    if (!session) return;
    session.loadScene(exp.scene);
    useAppStore.getState().setCompareWith(null);

    if (exp.id === 'one-cell') {
      const { x, y, to } = ONE_CELL_VERIFIED.flip;
      const siblingId = session.history.branchFrom(0, [{ kind: 'set', cells: [{ x, y, alive: to }] }]);
      session.history.renameBranch(siblingId, 'Flipped sibling');
      bus.emit('branch:created', { id: siblingId, fromGen: 0, name: 'Flipped sibling' });
      useAppStore.getState().setCompareWith(siblingId);
    }

    set({ active: exp, editCount: 0, verdict: null, checking: false });
    bus.emit('experiment:started', { id: exp.id, title: exp.title });
    bus.emit('playback:play', undefined);
  },

  restart() {
    const exp = get().active;
    if (exp) get().start(exp);
  },

  exit() {
    set({ active: null, editCount: 0, verdict: null, checking: false });
    useAppStore.getState().setCompareWith(null);
  },

  /** The world is already exactly this state — keep playing, drop the experiment framing. */
  keepPlaying() {
    get().exit();
  },

  checkOutcome() {
    const session = getSession();
    const exp = get().active;
    if (!session || !exp) return;
    set({ checking: true });

    if (exp.id === 'first-contact') {
      void session.gotoGen(FIRST_CONTACT_VERIFIED.outcomeCompareGen).then(() => {
        const candidate = session.engine.region(FIRST_CONTACT_VERIFIED.outcomeCompareRect);
        const v = evaluateFirstContact(candidate);
        set({ verdict: { kind: 'first-contact', changedOutcome: v.changedOutcome, note: v.note, gen: session.engine.gen }, checking: false });
        if (v.changedOutcome) bus.emit('experiment:succeeded', { id: exp.id, gen: session.engine.gen });
      });
      return;
    }

    if (exp.id === 'one-cell') {
      const siblingId = useAppStore.getState().compareWith;
      if (!siblingId) { set({ checking: false }); return; }
      const gen = session.engine.gen;
      void session.history.diff(session.history.activeBranch, siblingId, gen, ONE_CELL_VERIFIED.measurementRect).then((d) => {
        set({ verdict: { kind: 'one-cell', divergentCells: d.count, gen }, checking: false });
        if (d.count > 0) bus.emit('experiment:succeeded', { id: exp.id, gen });
      });
      return;
    }

    // keep-alive: the real recorded activity series over the whole run, via replay.
    void session.history.sliceStack(KEEP_ALIVE_VERIFIED.measurementRect, 0, KEEP_ALIVE_VERIFIED.targetGen).then((slices) => {
      const series = activitySeries(slices, KEEP_ALIVE_VERIFIED.activityWindow);
      const v = evaluateKeepAlive(series, KEEP_ALIVE_VERIFIED.targetGen, KEEP_ALIVE_VERIFIED.activityWindow);
      set({
        verdict: { kind: 'keep-alive', success: v.success, minActivity: v.minActivity, failedAtGen: v.failedAtGen, targetGen: KEEP_ALIVE_VERIFIED.targetGen },
        checking: false,
      });
      if (v.success) bus.emit('experiment:succeeded', { id: exp.id, gen: KEEP_ALIVE_VERIFIED.targetGen });
    }).catch(() => set({ checking: false }));
  },
}));

export { EXPERIMENTS };

// An edit made while an experiment is active counts against its budget,
// whether it lands as a plain record (drawing at the present) or a fork
// (an intervention made after scrubbing back).
bus.on('edit:committed', () => {
  if (useExperiments.getState().active) useExperiments.setState((s) => ({ editCount: s.editCount + 1 }));
});
bus.on('branch:created', (p) => {
  // Don't double-count the automatic one-cell sibling branch created by `start()`.
  if (useExperiments.getState().active && p.fromGen !== 0) {
    useExperiments.setState((s) => ({ editCount: s.editCount + 1 }));
  }
});
