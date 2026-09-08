/**
 * App orchestration — wires the now-implemented core/render/interact modules
 * together into one running universe, boots the verified opening scene, and
 * hosts every cross-module integration point (undo, sculpture, branching,
 * audio, persistence, discoveries). `App.tsx` calls `initSession()` once,
 * after the canvases in the DOM exist.
 *
 * Two independent loops, on purpose:
 *  - a persistent `requestAnimationFrame` loop that reads camera/engine state
 *    and paints every frame, REGARDLESS of play state (panning, ghost
 *    preview and selection must stay live while paused);
 *  - the core `SimLoop`, which only advances generations while `playing`.
 *
 * Every bus emission this module performs mirrors a payload another agent's
 * code already reads (`gen:changed`, `edit:committed`, `toast`, …). Nothing
 * here calls React/Zustand `setState` from inside the per-frame or
 * per-generation paths — only from response to a discrete user action
 * (branch switch, scrub release), same discipline as everywhere else.
 */
import { bus } from '@/ui/bus';
import { readState, useAppStore } from '@/ui/store';
import { useUIState } from '@/ui/uiState';
import { createEngine, type LifeEngine } from '@/core/engine';
import { createTimelineStore, HistoryWindowError, type TimelineStore } from '@/core/history';
import { createSimLoop, type SimLoop } from '@/core/loop';
import { createRenderer, type WorldRenderer } from '@/render/renderer';
import { createCamera, fitCameraSpec, type CameraController } from '@/render/camera';
import { createInput, type InputController } from '@/interact/input';
import { createSculpture, type TimeSculpture } from '@/sculpture/sculpture';
import { createSoundscape, type Soundscape } from '@/audio/audio';
import { createPersistStore, EXPERIMENT_FORMAT_VERSION, STORAGE_PREFIX, type PersistStore } from '@/persist/store';
import type { ExperimentDoc } from '@/persist/store';
import { scan, type ScanResult } from '@/content/recognition';
import { initCinematic, type CinematicController } from '@/ui/cinematic';
import { getPattern } from '@/content/patterns';
import { OPENING_SCENE, type CameraSpec, type SceneDef } from '@/content/scenes';
import type { EditOp, Rect, WorldSpec } from '@/core/types';

/** The one universe AFTERLIFE observes — the same 256x160 torus every curated
 *  scene (opening tableau, the three experiments) was verified against. */
export const WORLD_SPEC: WorldSpec = OPENING_SCENE.world;

const AUDIO_PREF_KEY = `${STORAGE_PREFIX}audio`;

export interface Session {
  engine: LifeEngine;
  history: TimelineStore;
  camera: CameraController;
  renderer: WorldRenderer;
  input: InputController;
  loop: SimLoop;
  sculpture: TimeSculpture;
  soundscape: Soundscape;
  persist: PersistStore;
  /** Cinematic mode's public entry point — see `@/ui/cinematic`'s doc. Exposed
   *  here mainly so `e2e/` and `window.__AFTERLIFE__` can drive/assert it
   *  without depending on the exact keyboard shortcut. */
  cinematic: CinematicController;
  /** Ask the sculpture to open on the current selection (or the whole world). */
  openSculpture(): void;
  closeSculpture(): void;
  /**
   * Apply a single edit "now": at `maxGen` this just records it; at a past
   * generation (after scrubbing back) this forks a branch instead of
   * truncating the future, exactly like a drawn gesture. Used by anything
   * that mutates cells outside the pointer gesture path (RLE import, an
   * experiment's scripted intervention).
   */
  applyEdit(op: EditOp): void;
  /** Scrub to `gen` and re-announce `gen:changed` on success; surfaces a
   *  toast on `HistoryWindowError` instead of throwing. */
  gotoGen(gen: number): Promise<void>;
  /** Seed a fresh universe from a curated `SceneDef`: clears the world,
   *  resets history to a fresh root branch, and records the scene's cells as
   *  a real generation-0 `EditOp` (so it replays and persists exactly like
   *  any other recorded edit — see `@/persist/codec`'s "hand-drawn start"
   *  note), then frames the establishing camera. */
  loadScene(scene: SceneDef): void;
  /** Recognise structures within `rect` right now. Synchronous, bounded. */
  scanRegion(rect: Rect): ScanResult;
  /** Serialise the active branch's full recorded history into a portable document. */
  buildExperimentDoc(title: string): ExperimentDoc;
  /** Restore a document built by `buildExperimentDoc` (or migrated from disk).
   *  Rejects (via a toast) if its world shape doesn't match `WORLD_SPEC`. */
  applyExperimentDoc(doc: ExperimentDoc): boolean;
}

let session: Session | null = null;

/** Non-reactive accessor for anything that needs the live session (panels, etc.). */
export function getSession(): Session | null {
  return session;
}

/** Idempotent: a second call is a no-op (React 18/19 StrictMode double-invokes effects). */
export function initSession(): Session {
  if (session) return session;

  const worldCanvas = document.getElementById('world-canvas') as HTMLCanvasElement;
  const sculptureHost = document.getElementById('sculpture-canvas') as HTMLElement;
  const compareCanvas = document.getElementById('compare-canvas') as HTMLCanvasElement;

  const engine = createEngine({ width: WORLD_SPEC.width, height: WORLD_SPEC.height });
  const history = createTimelineStore({ engine });
  const camera = createCamera({ scale: 8 });
  const renderer = createRenderer();
  renderer.attach(worldCanvas);
  renderer.setShowGrid(readState().showGrid);
  renderer.setLens(readState().lens);
  const input = createInput({ renderer, camera, engine });
  input.attach(worldCanvas);
  const sculptureController = createSculpture(sculptureHost);
  // Real, read-only access for the soundscape's interaction-feedback features
  // (drawing-as-instrument, proximity-weighted churn, a real population
  // centroid for pan) — see `@/audio/audio`'s `SoundscapeDeps` doc. Audio
  // only ever READS `engine`/`input`; it never mutates cell state.
  const soundscape = createSoundscape({ engine, input });
  const persist = createPersistStore();
  // See `@/ui/cinematic`'s doc: an "auto-pan, hold-on-what's-interesting"
  // full-screen mode, layered on top of the existing camera/presentation
  // machinery rather than a new chrome-hiding mechanism of its own.
  const cinematic = initCinematic({ camera, engine });

  // ---- specimen stamping: arm InputController from the drawer's selection ---
  // `@/ui/uiState` tracks WHICH pattern is selected and its transform (drawer-
  // facing, ephemeral UI state); `InputController` is what actually shows the
  // ghost preview and paints on click, via `setStampPattern`/
  // `setStampTransform`. Nothing previously connected the two — clicking a
  // specimen updated the drawer's own highlight and switched `tool` to
  // 'stamp', but the controller's armed pattern stayed null forever, so no
  // ghost ever appeared and a click fell through to painting a single cell.
  // This subscription is that missing wire.
  useUIState.subscribe((state, prev) => {
    if (state.selectedPatternId !== prev.selectedPatternId) {
      input.setStampPattern(state.selectedPatternId ? getPattern(state.selectedPatternId) : null);
    }
    if (state.stampTransform !== prev.stampTransform) {
      input.setStampTransform(state.stampTransform);
    }
  });
  // Leaving the stamp tool (without Escape, which already disarms the
  // controller directly) should also clear the drawer's own selection so the
  // two stay in sync — e.g. picking 'draw' after stamping shouldn't leave a
  // specimen looking selected in the drawer.
  useAppStore.subscribe((state, prev) => {
    if (prev.tool === 'stamp' && state.tool !== 'stamp' && useUIState.getState().selectedPatternId) {
      useUIState.getState().setSelectedPattern(null);
    }
  });

  // ---- compare view: a real, synchronized second render of another branch --
  // Shares the main `camera` object (same generation/viewport, painted every
  // frame from the same `frame()` loop below) so the two canvases genuinely
  // stay in lockstep — never an independent camera to keep synchronized by
  // hand. `compareEngine` is refreshed by REAL replay (`cloneBranchAt`),
  // never fabricated, on a throttle bounded by the keyframe interval (at
  // most ~64 steps of replay per refresh, regardless of how deep the session
  // is), so it stays cheap indefinitely.
  const compareRenderer = createRenderer();
  compareRenderer.attach(compareCanvas);
  compareRenderer.setShowGrid(readState().showGrid);
  compareRenderer.setLens(readState().lens);
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => compareRenderer.resize()).observe(compareCanvas);
  }
  let compareEngine: LifeEngine | null = null;
  let compareToken = 0;
  let lastCompareRefresh = 0;
  async function refreshCompare(force = false): Promise<void> {
    const { compareWith } = readState();
    if (!compareWith) { compareEngine = null; return; }
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (!force && now - lastCompareRefresh < 300) return;
    lastCompareRefresh = now;
    const myToken = ++compareToken;
    try {
      const clone = await history.cloneBranchAt(compareWith, engine.gen);
      if (myToken === compareToken) {
        compareEngine = clone;
        compareRenderer.invalidate();
      }
    } catch {
      // e.g. HistoryWindowError — leave the last good compareEngine in place.
    }
  }
  useAppStore.subscribe((state, prev) => {
    if (state.compareWith !== prev.compareWith) void refreshCompare(true);
  });
  bus.on('gen:changed', () => { if (readState().compareWith) void refreshCompare(); });
  bus.on('branch:switched', () => { if (readState().compareWith) void refreshCompare(true); });

  // ---- persisted audio preference (mute/volume survive a reload) ---------
  try {
    const raw = window.localStorage.getItem(AUDIO_PREF_KEY);
    if (raw) {
      const pref = JSON.parse(raw) as { muted?: boolean; volume?: number };
      if (typeof pref.muted === 'boolean') useAppStore.getState().setMuted(pref.muted);
      if (typeof pref.volume === 'number') useAppStore.getState().setVolume(pref.volume);
    }
  } catch {
    // Corrupt/missing preference — fall back to the store's defaults.
  }
  function persistAudioPref(): void {
    try {
      const { muted, volume } = readState();
      window.localStorage.setItem(AUDIO_PREF_KEY, JSON.stringify({ muted, volume }));
    } catch {
      // Best-effort only.
    }
  }
  bus.on('audio:toggle', persistAudioPref);
  bus.on('audio:volume', persistAudioPref);

  // ---- rendering: always LIVE (this loop itself never stops), independent
  // of play state — panning, ghost preview and selection must stay
  // responsive while paused — but each renderer's actual `draw()` call is
  // GATED on that renderer's own dirty flag (see `WorldRenderer.consumeDirty`'s
  // doc, BUG 4). An idle paused world with nothing changing skips both the
  // main and compare `draw()` entirely: no per-frame `ImageData` rebuild, no
  // per-cell iteration — just this cheap rAF callback running at ~0 cost.
  // The world canvas is also skipped while the Time Sculpture is showing
  // (`worldCanvas` is hidden then; see `showSculptureCanvas`) — no point
  // painting a hidden canvas every frame.
  let lastFrameTime = 0;
  function frame(now: number): void {
    const dt = lastFrameTime ? Math.min(0.1, (now - lastFrameTime) / 1000) : 0;
    lastFrameTime = now;
    camera.tick(dt);
    renderer.setCamera(camera.camera);
    if (!readState().sculptureOpen && renderer.consumeDirty()) {
      renderer.draw(engine);
    }
    if (compareEngine && readState().compareWith) {
      compareRenderer.setCamera(camera.camera);
      if (compareRenderer.consumeDirty()) compareRenderer.draw(compareEngine);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ---- curated camera framing: viewport-independent, re-fit on chrome change ----
  // A `CameraSpec` (scene establishing/focus framing) is authored against a
  // 1440x900 reference viewport (see `@/content/scenes`). Applying it as a raw
  // `{x, y, scale}` only reproduces the intended framing at that exact canvas
  // size — opening the right panel (or viewing on a phone) narrows the actual
  // `#world-canvas` rect, and the same absolute scale can clip the scene's
  // subject out of frame. `fitCameraSpec` reconstructs the authored world rect
  // and fits it to whatever the canvas rect actually is; `curatedCamera` and
  // the flag below let us re-apply that fit whenever the canvas resizes
  // (panel open/close, orientation change, window resize) WITHOUT overriding
  // a camera move the user or a scene beat made since — see the
  // `camera:changed` listener.
  let curatedCamera: CameraSpec | null = null;
  let applyingCuratedCamera = false;
  function applyCuratedCamera(spec: CameraSpec): void {
    applyingCuratedCamera = true;
    fitCameraSpec(camera, spec);
    applyingCuratedCamera = false;
    curatedCamera = spec;
  }
  bus.on('camera:changed', () => {
    if (!applyingCuratedCamera) curatedCamera = null;
  });
  if (typeof ResizeObserver !== 'undefined') {
    const reframe = new ResizeObserver(() => {
      // Bring the camera's notion of viewport size up to date before
      // re-fitting — mirrors `@/interact/input.ts`'s own `#syncViewport`,
      // done independently here so re-framing never races that observer.
      renderer.resize();
      camera.setViewport(renderer.viewport.width, renderer.viewport.height);
      if (curatedCamera) applyCuratedCamera(curatedCamera);
    });
    reframe.observe(worldCanvas);
  }

  // ---- scene beats: quiet camera eases / world-anchored annotations ------
  // Never a modal, never a cutscene — see `@/content/scenes`' `SceneBeat` doc
  // and DESIGN.md's "world dominates" rule.
  let currentScene: SceneDef | null = null;
  const firedBeats = new Set<number>();
  let followReleaseTimer: ReturnType<typeof setTimeout> | null = null;
  let annotationTimer: ReturnType<typeof setTimeout> | null = null;

  function checkBeats(gen: number): void {
    if (!currentScene) return;
    currentScene.beats.forEach((beat, i) => {
      if (firedBeats.has(i) || beat.atGen !== gen) return;
      firedBeats.add(i);
      if (beat.kind === 'camera-ease') {
        const rect = beat.toward;
        camera.follow({ x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 });
        if (followReleaseTimer) clearTimeout(followReleaseTimer);
        followReleaseTimer = setTimeout(() => camera.releaseFollow(), 3200);
        bus.emit('toast', { message: beat.label, tone: 'info', ms: 4200 });
      } else {
        bus.emit('scene:annotate', { at: beat.at, label: beat.label });
        if (annotationTimer) clearTimeout(annotationTimer);
        annotationTimer = setTimeout(() => bus.emit('scene:annotate', null), 4800);
      }
    });
  }

  /** The one place `gen:changed` is emitted from — also fires scene beats. */
  function emitGen(): void {
    // The renderer has no reference to `engine`'s internal state (`draw()`
    // takes it as a parameter each call) so it can't detect a step or a
    // committed edit itself — tell it explicitly. See BUG 4's dirty-flag doc.
    renderer.invalidate();
    compareRenderer.invalidate();
    bus.emit('gen:changed', { gen: engine.gen, population: engine.population });
    checkBeats(engine.gen);
  }

  // ---- simulation stepping: edits commit atomically at the boundary ------
  let queuedEdits: EditOp[] = [];

  function recordOrFork(atGen: number, edits: EditOp[]): void {
    if (edits.length === 0) return;
    const cellCount = edits.reduce((n, op) => n + op.cells.length, 0);

    // Editing behind `maxGen` (only possible while paused, after scrubbing
    // back) is the ENTIRE "alternate futures" feature (ARCHITECTURE.md
    // § Atomic edit commit): fork instead of truncating. During normal play
    // `atGen` is always `maxGen`, so this never triggers mid-playback.
    if (atGen < history.maxGen) {
      const newId = history.branchFrom(atGen, edits);
      bus.emit('branch:created', { id: newId, fromGen: atGen, name: newId });
      bus.emit('toast', { message: 'Branched — the original future is kept too.', tone: 'success' });
      bus.emit('branch:switched', { id: newId });
    } else {
      history.record(atGen, edits);
      bus.emit('edit:committed', { gen: atGen, cellCount });
    }
  }

  function flushEdits(atGen: number): void {
    if (queuedEdits.length === 0) return;
    const edits = queuedEdits;
    queuedEdits = [];
    recordOrFork(atGen, edits);
  }

  input.onGestureEnd(() => {
    const op = input.commit();
    if (!op) return;
    queuedEdits.push(op);
    if (!readState().playing) {
      // Applied straight to the live engine (see `history.record`'s
      // gen === engine.gen fast path) — re-announce `gen:changed` so the
      // population readout and empty/extinct overlays feel the edit
      // immediately, not only on the next real step.
      flushEdits(engine.gen);
      emitGen();
    }
  });

  function step(): void {
    flushEdits(engine.gen);
    engine.step();
    history.advance(engine.gen);
    emitGen();
  }

  const loop = createSimLoop(step);
  loop.setSpeed(readState().speed);

  function gotoGen(gen: number): Promise<void> {
    return history.goto(gen).then(emitGen).catch((err: unknown) => {
      if (err instanceof HistoryWindowError) {
        bus.emit('toast', { message: 'That generation has fallen out of the retained window.', tone: 'warn' });
      }
      // AbortError = superseded by a newer scrub; not an error worth surfacing.
    });
  }

  // ---- playback intents ----------------------------------------------------
  // `playing` is a store flag other UI reads (HUD icon state, etc.), but the
  // bus event is the single source of truth — it can be triggered from the
  // HUD button, from `input.ts`'s Space handler, or anywhere else, and must
  // stay in sync regardless of origin.
  bus.on('playback:play', () => { loop.start(); useAppStore.getState().setPlaying(true); });
  bus.on('playback:pause', () => { loop.stop(); useAppStore.getState().setPlaying(false); });
  bus.on('playback:speed', ({ speed }) => loop.setSpeed(speed));
  bus.on('playback:step', ({ by }) => {
    if (readState().playing) return;
    if (by >= 0) {
      loop.stepOnce(Math.max(1, by));
    } else {
      void gotoGen(Math.max(history.windowStart, engine.gen + by));
    }
  });

  // ---- timeline scrubbing: goto() is self-cancelling, so rapid-fire is fine --
  bus.on('playback:scrub', ({ gen }) => { void gotoGen(gen); });

  // ---- branching -----------------------------------------------------------
  function syncBranches(): void {
    useAppStore.getState().setBranches([...history.branches]);
  }
  bus.on('branch:switched', ({ id }) => {
    history.switchBranch(id).then(() => {
      useAppStore.getState().setActiveBranch(id);
      syncBranches();
      emitGen();
    }).catch(() => {
      bus.emit('toast', { message: `Could not switch to that branch.`, tone: 'warn' });
    });
  });
  bus.on('branch:renamed', ({ id, name }) => {
    try {
      history.renameBranch(id, name);
      syncBranches();
    } catch {
      bus.emit('toast', { message: 'Could not rename that branch.', tone: 'warn' });
    }
  });
  bus.on('branch:created', syncBranches);

  // ---- undo: `@/interact/input.ts`'s 'z' shortcut emits this; it doesn't
  // own the TimelineStore (see INTEGRATION-NOTES.md) --------------------------
  bus.on('history:undo', () => {
    const inverse = input.undo();
    if (!inverse) return;
    recordOrFork(engine.gen, [inverse]);
    if (!readState().playing) emitGen();
  });

  // ---- lens: mirror the bus intent onto both live renderers ---------------
  bus.on('lens:changed', ({ lens }) => {
    renderer.setLens(lens);
    compareRenderer.setLens(lens);
  });

  // ---- grid: `input.ts`'s own 'g' shortcut calls `renderer.setShowGrid`
  // directly, but the Drawer/Settings checkboxes only write to the store —
  // mirror any store change onto both renderers so every entry point agrees. --
  useAppStore.subscribe((state, prev) => {
    if (state.showGrid !== prev.showGrid) {
      renderer.setShowGrid(state.showGrid);
      compareRenderer.setShowGrid(state.showGrid);
    }
  });

  // ---- time sculpture --------------------------------------------------------
  const MAX_SCULPTURE_SLICES = 256;

  function showSculptureCanvas(show: boolean): void {
    worldCanvas.classList.toggle('hidden', show);
    sculptureHost.classList.toggle('hidden', !show);
    sculptureHost.setAttribute('aria-hidden', show ? 'false' : 'true');
    useAppStore.getState().setSculptureOpen(show);
  }

  bus.on('sculpture:open', ({ rect, fromGen, toGen }) => {
    const from = Math.max(history.windowStart, toGen - MAX_SCULPTURE_SLICES + 1, fromGen);
    history.sliceStack(rect, from, toGen).then((slices) => {
      sculptureController.open(rect, from, toGen, slices);
      showSculptureCanvas(true);
    }).catch((err: unknown) => {
      if (err instanceof HistoryWindowError) {
        bus.emit('toast', { message: 'That range has fallen out of the retained window.', tone: 'warn' });
      } else {
        bus.emit('toast', { message: 'Could not build the time sculpture for that region.', tone: 'warn' });
      }
    });
  });
  bus.on('sculpture:close', () => {
    sculptureController.close();
    showSculptureCanvas(false);
  });
  bus.on('sculpture:sliceSelected', ({ gen }) => { void gotoGen(gen); });

  // ---- scene loading (opening tableau + experiments) ----------------------
  function loadScene(scene: SceneDef): void {
    loop.stop();
    useAppStore.getState().setPlaying(false);
    engine.clear();
    history.reset();
    if (scene.cells.length > 0) {
      history.record(0, [{ kind: 'set', cells: scene.cells.map((c) => ({ x: c.x, y: c.y, alive: true })) }]);
    }
    applyCuratedCamera(scene.cameras.establishing);
    useAppStore.getState().setSpeed(scene.defaultSpeed);
    loop.setSpeed(scene.defaultSpeed);
    useAppStore.getState().setSelection(null);
    useAppStore.getState().setCompareWith(null);
    renderer.setSelection(null);
    syncBranches();
    useAppStore.getState().setActiveBranch(history.activeBranch);
    currentScene = scene;
    firedBeats.clear();
    if (followReleaseTimer) { clearTimeout(followReleaseTimer); followReleaseTimer = null; }
    if (annotationTimer) { clearTimeout(annotationTimer); annotationTimer = null; }
    bus.emit('scene:annotate', null);
    emitGen();
  }

  session = {
    engine, history, camera, renderer, input, loop, sculpture: sculptureController, soundscape, persist, cinematic,
    openSculpture() {
      const sel = readState().selection;
      const rect = sel ?? { x: 0, y: 0, w: Math.min(64, WORLD_SPEC.width), h: Math.min(64, WORLD_SPEC.height) };
      const toGen = engine.gen;
      const fromGen = Math.max(history.windowStart, toGen - MAX_SCULPTURE_SLICES + 1);
      bus.emit('sculpture:open', { rect, fromGen, toGen });
    },
    closeSculpture() {
      bus.emit('sculpture:close', undefined);
    },
    applyEdit(op) {
      recordOrFork(engine.gen, [op]);
      if (!readState().playing) emitGen();
    },
    gotoGen,
    loadScene,
    scanRegion(rect) {
      return scan(engine, rect);
    },
    buildExperimentDoc(title) {
      const activeMeta = history.branches.find((b) => b.id === history.activeBranch);
      return {
        version: EXPERIMENT_FORMAT_VERSION,
        title,
        createdAt: Date.now(),
        spec: WORLD_SPEC,
        seed: 0,
        density: 0,
        activeBranch: 'root',
        branches: [{ id: 'root', name: activeMeta?.name ?? 'Original', parent: null, fromGen: 0, createdAt: activeMeta?.createdAt ?? Date.now() }],
        edits: { root: history.entries().map((e) => ({ gen: e.gen, ops: e.edits })) },
        view: { x: camera.camera.x, y: camera.camera.y, scale: camera.camera.scale, gen: engine.gen },
        lens: readState().lens,
        bookmarks: [],
        discoveries: [],
      };
    },
    applyExperimentDoc(doc) {
      if (doc.spec.width !== WORLD_SPEC.width || doc.spec.height !== WORLD_SPEC.height || doc.spec.boundary !== WORLD_SPEC.boundary) {
        bus.emit('toast', { message: `That save is a ${doc.spec.width}x${doc.spec.height} world — this build only runs ${WORLD_SPEC.width}x${WORLD_SPEC.height}.`, tone: 'warn' });
        return false;
      }
      loop.stop();
      useAppStore.getState().setPlaying(false);
      engine.clear();
      history.reset();
      currentScene = null;
      firedBeats.clear();
      const rootEdits = doc.edits[doc.activeBranch] ?? doc.edits.root ?? [];
      const entries = rootEdits.map((e) => ({ gen: e.gen, edits: e.ops }));
      const maxEditGen = entries.reduce((m, e) => Math.max(m, e.gen), 0);
      const targetGen = doc.view?.gen ?? maxEditGen;
      // `loadEntries` also re-simulates the plain (edit-free) steps up to
      // `targetGen` — a document's edits only cover generations that had an
      // explicit edit, never the ordinary steps in between, so replaying just
      // the edits via `record()` would leave the branch's bookkeeping stuck
      // at the last EDITED generation rather than wherever it was saved from.
      history.loadEntries(entries, Math.max(targetGen, maxEditGen)).then(() => {
        if (doc.view) camera.set({ x: doc.view.x, y: doc.view.y, scale: doc.view.scale });
        if (doc.lens) {
          useAppStore.getState().setLens(doc.lens);
          renderer.setLens(doc.lens);
        }
        syncBranches();
        useAppStore.getState().setActiveBranch(history.activeBranch);
        emitGen();
      }).catch(() => {
        bus.emit('toast', { message: 'Could not replay that save to its saved moment.', tone: 'warn' });
      });
      return true;
    },
  };

  loadScene(OPENING_SCENE);
  // The opening tableau is a live observatory, not a paused diagram — it is
  // already running by the time the title plate fades (see the HUD's "pause
  // time anytime" invitation, and DESIGN's "playable observatory" framing).
  // The verified encounter at generation 123 is reached ~10s after boot at
  // the default 12 gens/sec exactly because this starts moving immediately.
  bus.emit('playback:play', undefined);

  // Dev/test-only introspection hook — never referenced by production code,
  // and dead-code-eliminated from a production build since `import.meta.env.DEV`
  // is statically `false` there. Exists so `e2e/` can assert on real engine
  // state (exact live-cell counts inside a bbox) that a screenshot can't.
  if (import.meta.env.DEV) {
    (window as unknown as { __AFTERLIFE__?: Session }).__AFTERLIFE__ = session;
  }

  return session;
}
