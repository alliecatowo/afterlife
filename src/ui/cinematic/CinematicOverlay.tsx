/**
 * Cinematic mode's ENTIRE visible chrome: a minimal, auto-fading bar with
 * the generation count, a short caption for the current beat, and a way
 * out. Everything else (drawer, panel, HUD, timeline) is already hidden by
 * the existing `presentation` app-state flag `index.ts` sets — see its doc
 * for why this mode piggybacks on that flag rather than inventing a second
 * chrome-hiding mechanism. Since presentation mode collapses `#hud-top` to
 * `height: 0; overflow: hidden` (verified in `e2e/shortcuts.spec.ts`), its
 * own minimal readout is NOT visible during cinematic mode either — this
 * component is what actually shows the generation count.
 *
 * Self-mounted: `index.ts` creates its own DOM host + React root for this,
 * appended to `document.body`, entirely outside the `App.tsx` tree — see
 * INTEGRATION-NOTES.md for why (a concurrent agent owns `App.tsx`/`Hud.tsx`
 * for mobile layout work, so this mode's real HUD entry point had to avoid
 * touching either file; the keyboard shortcut ('c') and this floating exit
 * affordance are the reachable entry/exit in the meantime).
 */
import { useEffect, useRef, useState } from 'react';
import { subscribeReadout } from '@/ui/hooks/useSimulationReadout';
import { useCinematicStore } from './store';

const IDLE_FADE_MS = 4000;

export interface CinematicOverlayProps {
  onExit: () => void;
  onResume: () => void;
}

export function CinematicOverlay({ onExit, onResume }: CinematicOverlayProps) {
  const active = useCinematicStore((s) => s.active);
  const paused = useCinematicStore((s) => s.paused);
  const caption = useCinematicStore((s) => s.caption);
  const fullscreenActive = useCinematicStore((s) => s.fullscreenActive);
  const genRef = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(true);

  useEffect(() => subscribeReadout((r) => {
    if (genRef.current) genRef.current.textContent = String(r.gen);
  }), []);

  // Auto-fade after a beat of no pointer movement; any movement (including
  // the movement that precedes a click) brings it right back. This is
  // display-only — it never affects whether input hands control back (see
  // `index.ts`'s own, always-active input listener for that).
  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const show = () => {
      setVisible(true);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setVisible(false), IDLE_FADE_MS);
    };
    show();
    window.addEventListener('pointermove', show);
    window.addEventListener('pointerdown', show);
    window.addEventListener('keydown', show);
    return () => {
      window.removeEventListener('pointermove', show);
      window.removeEventListener('pointerdown', show);
      window.removeEventListener('keydown', show);
      if (timer) clearTimeout(timer);
    };
  }, [active]);

  if (!active) return null;

  return (
    <div
      className={
        // The wrapper is always `pointer-events-none` (it spans the whole
        // viewport width so it must never block clicks meant for the world
        // canvas beneath it) — the bar inside re-enables pointer events for
        // itself only.
        'pointer-events-none fixed inset-x-0 bottom-6 z-[2147483000] flex justify-center transition-opacity duration-500 ease-[var(--ease-standard)] ' +
        (visible ? 'opacity-100' : 'opacity-0')
      }
      aria-hidden={!visible}
    >
      <div className="pointer-events-auto flex items-center gap-3 rounded-sm border border-line bg-ink-800/90 px-4 py-2 text-ivory-200 shadow-raise">
        <span className="text-micro uppercase tracking-[0.18em] text-ivory-300">cinematic</span>
        <span className="tabular text-xs text-ivory-100">
          gen <span ref={genRef}>0</span>
        </span>
        <span aria-live="polite" className="text-xs italic text-ivory-300">{caption}</span>
        {!fullscreenActive && (
          <span className="text-micro text-ivory-300">(windowed)</span>
        )}
        {paused && (
          <button
            type="button"
            onClick={onResume}
            className="rounded-xs border border-line px-2 py-1 text-micro uppercase tracking-[0.18em] text-ivory-100 hover:bg-ink-700 focus-ring"
          >
            Resume
          </button>
        )}
        <button
          type="button"
          onClick={onExit}
          aria-label="Exit cinematic mode"
          className="rounded-xs border border-line px-2 py-1 text-micro uppercase tracking-[0.18em] text-ivory-100 hover:bg-ink-700 focus-ring"
        >
          Exit (Esc)
        </button>
      </div>
    </div>
  );
}
