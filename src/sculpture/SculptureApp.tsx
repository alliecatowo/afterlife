/**
 * Top-level mounted component for one `open()` session of the Time
 * Sculpture. Owns: WebGL/2D-fallback branching, the instance-budget
 * reduction pass, the slice-plane/history-depth/decorations state (all
 * low-frequency, user-driven — never per frame), the imperative controller
 * bridge exposed as `TimeSculpture`, and the "return to the living plane"
 * affordance (button + Escape).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import type { Generation, Rect } from '@/core/types';
import { bus } from '@/ui/bus';
import { INSTANCE_BUDGET, describeReduction, planReduction, type ReductionPlan } from './budget';
import { buildInstancePlacements, countLive } from './geometry';
import { sliceIndexToGen, planeTToSlot, genToSliceIndex } from './mapping';
import { CELL_SIZE, SPACING_Z, SculptureScene, type CameraApi } from './SculptureScene';
import { Fallback2D, WebGLUnsupportedNotice } from './Fallback2D';
import { isWebGLAvailable } from './webgl';
import { exportSculpturePng, type ExportAnnotation } from './export';
import { prefersReducedMotion, resolveCssColorString } from './tokens';

export interface SculptureController {
  setSlicePlane(t: number): void;
  setHistoryDepth(n: number): void;
  orbit(deltaAzimuth: number, deltaPolar: number, dolly?: number): void;
  exportPng(annotation?: Omit<ExportAnnotation, 'fromGen' | 'toGen'>): Promise<Blob>;
  goto(gen: Generation): void;
}

export interface SculptureAppProps {
  rect: Rect;
  fromGen: Generation;
  toGen: Generation;
  slices: Uint8Array[];
  onSliceSelected: (gen: Generation) => void;
  onControllerReady: (c: SculptureController | null) => void;
}

export function SculptureApp({
  rect, fromGen, toGen, slices, onSliceSelected, onControllerReady,
}: SculptureAppProps) {
  const reduceMotion = useMemo(() => prefersReducedMotion(), []);
  const webglOk = useMemo(() => isWebGLAvailable(), []);
  const backgroundColor = useMemo(() => resolveCssColorString('--color-ink-900', '#14181a'), []);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cameraApiRef = useRef<CameraApi | null>(null);

  const liveCounts = useMemo(() => slices.map(countLive), [slices]);
  const plan: ReductionPlan = useMemo(() => planReduction(liveCounts, INSTANCE_BUDGET), [liveCounts]);
  const renderedSlices = useMemo(() => plan.sliceIndices.map((i) => slices[i]), [plan, slices]);
  const slotGens = useMemo(() => plan.sliceIndices.map((i) => sliceIndexToGen(i, fromGen)), [plan, fromGen]);
  const reductionNote = plan.reduced ? describeReduction(plan) : undefined;

  const [planeT, setPlaneT] = useState(1);
  const [historyDepth, setHistoryDepth] = useState(Math.max(0, renderedSlices.length - 1));
  const [decorations, setDecorations] = useState(true);
  const [buildProgress, setBuildProgress] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    setHistoryDepth(Math.max(0, renderedSlices.length - 1));
    setPlaneT(1);
  }, [renderedSlices.length]);

  const placements = useMemo(
    () => buildInstancePlacements(renderedSlices, rect, CELL_SIZE, SPACING_Z),
    [renderedSlices, rect],
  );

  const planeSlot = useMemo(() => {
    if (renderedSlices.length === 0) return 0;
    const slot = planeTToSlot(planeT, plan.sliceIndices);
    return slot < 0 ? renderedSlices.length - 1 : slot;
  }, [planeT, plan.sliceIndices, renderedSlices.length]);

  function returnToLivingPlane() {
    bus.emit('sculpture:close', undefined);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') returnToLivingPlane();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const controller: SculptureController = {
      setSlicePlane: (t) => setPlaneT(Math.min(1, Math.max(0, t))),
      setHistoryDepth: (n) => setHistoryDepth(Math.max(0, Math.min(Math.round(n), renderedSlices.length - 1))),
      orbit: (da, dp, dolly) => cameraApiRef.current?.orbit(da, dp, dolly),
      exportPng: async (annotation) => {
        if (!canvasRef.current) throw new Error('sculpture canvas is not mounted');
        return exportSculpturePng(canvasRef.current, annotation ? { ...annotation, fromGen, toGen } : undefined);
      },
      goto: (gen) => {
        const index = genToSliceIndex(gen, fromGen);
        const slot = plan.sliceIndices.indexOf(index);
        if (slot >= 0 && renderedSlices.length > 1) setPlaneT(slot / (renderedSlices.length - 1));
      },
    };
    onControllerReady(controller);
    return () => onControllerReady(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderedSlices.length, plan, fromGen, toGen]);

  function handlePick(gen: Generation) {
    onSliceSelected(gen);
    bus.emit('sculpture:sliceSelected', { gen });
  }

  const overlay = (
    <div
      style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        fontFamily: 'var(--font-sans)', color: 'var(--color-ivory-200)',
      }}
    >
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: 12, gap: 12,
      }}
      >
        <div style={{
          pointerEvents: 'auto', fontSize: 'var(--text-xs)', color: 'var(--color-ivory-300)',
          background: 'var(--color-surface)', border: '1px solid var(--color-line)',
          borderRadius: 'var(--radius-sm)', padding: '6px 10px', maxWidth: 360,
        }}
        >
          {reductionNote ?? `showing all ${plan.totalSlices} recorded generations`}
          {buildProgress && buildProgress.done < buildProgress.total
            ? ` — building… ${Math.round((buildProgress.done / Math.max(1, buildProgress.total)) * 100)}%`
            : null}
        </div>
        <button
          type="button"
          onClick={returnToLivingPlane}
          style={{
            pointerEvents: 'auto', cursor: 'pointer', fontSize: 'var(--text-xs)',
            color: 'var(--color-ivory-100)', background: 'var(--color-surface-raised)',
            border: '1px solid var(--color-line-strong)', borderRadius: 'var(--radius-sm)',
            padding: '6px 12px', whiteSpace: 'nowrap',
          }}
        >
          Return to living plane (esc)
        </button>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: 12 }}>
        <label style={{
          pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: 6,
          fontSize: 'var(--text-micro)', textTransform: 'uppercase', letterSpacing: '0.18em',
          color: 'var(--color-ivory-300)', background: 'var(--color-surface)',
          border: '1px solid var(--color-line)', borderRadius: 'var(--radius-sm)', padding: '4px 8px',
        }}
        >
          <input type="checkbox" checked={decorations} onChange={(e) => setDecorations(e.target.checked)} />
          decorations
        </label>
      </div>
    </div>
  );

  if (!webglOk) {
    if (renderedSlices.length === 0) return <WebGLUnsupportedNotice />;
    return (
      <div style={{ position: 'absolute', inset: 0 }}>
        <Fallback2D rect={rect} fromGen={fromGen} toGen={toGen} slices={renderedSlices} slotGens={slotGens} reductionNote={reductionNote} />
        {overlay}
      </div>
    );
  }

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <Canvas
        gl={{ preserveDrawingBuffer: true, antialias: true }}
        onCreated={({ gl }) => { canvasRef.current = gl.domElement; }}
        camera={{ fov: 45, near: 0.1, far: 500 }}
      >
        <color attach="background" args={[backgroundColor]} />
        <SculptureScene
          placements={placements}
          sliceCount={renderedSlices.length}
          rectW={rect.w}
          rectH={rect.h}
          fromGen={fromGen}
          toGen={toGen}
          slotGens={slotGens}
          decorations={decorations}
          planeSlot={planeSlot}
          historyDepth={historyDepth}
          onPick={handlePick}
          onBuildProgress={(done, total) => setBuildProgress({ done, total })}
          reduceMotion={reduceMotion}
          cameraApiRef={cameraApiRef}
        />
      </Canvas>
      {overlay}
    </div>
  );
}

