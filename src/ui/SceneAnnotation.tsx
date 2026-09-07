/**
 * A quiet, world-anchored label for a `SceneBeat` of kind `'annotate'` (see
 * `@/content/scenes`). Never a modal — a small marker that tracks the world
 * point via `renderer.worldToScreen`, positioned imperatively each frame
 * (transform only, no `setState` per frame) so it stays put even while the
 * camera eases toward the encounter alongside it. `@/ui/session` emits
 * `scene:annotate` when a beat fires and clears it (`null`) a few seconds
 * later.
 */
import { useEffect, useRef, useState } from 'react';
import { bus } from '@/ui/bus';
import { getSession } from '@/ui/session';
import type { CellCoord } from '@/core/types';

interface AnnotationState {
  at: CellCoord;
  label: string;
}

export function SceneAnnotation() {
  const [ann, setAnn] = useState<AnnotationState | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => bus.on('scene:annotate', setAnn).dispose, []);

  useEffect(() => {
    if (!ann) return;
    let raf = 0;
    const tick = (): void => {
      const session = getSession();
      const el = ref.current;
      if (session && el) {
        const p = session.renderer.worldToScreen(ann.at.x, ann.at.y);
        el.style.transform = `translate(${p.x}px, ${p.y}px)`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ann]);

  if (!ann) return null;

  return (
    <div ref={ref} className="pointer-events-none absolute left-0 top-0 z-[var(--z-overlay)] -translate-x-1/2 -translate-y-full">
      <div className="flex flex-col items-center gap-1.5 pb-1.5">
        <span className="whitespace-nowrap rounded-full border border-line bg-ink-800/90 px-2.5 py-1 text-micro uppercase tracking-[0.14em] text-ivory-100 shadow-[var(--shadow-raise)]">
          {ann.label}
        </span>
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--color-accent-time)' }} />
      </div>
    </div>
  );
}
