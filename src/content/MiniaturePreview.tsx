/**
 * A tiny, self-contained live preview of a specimen: its own independent
 * engine instance, stepped on a fixed timestep, paused while offscreen.
 * Prop-driven and self-contained — it does not read UI state, the app store,
 * or the event bus, so an integration agent can drop it anywhere (drawer row,
 * Field Guide entry) without wiring anything beyond the `LiveMiniatureSpec`.
 *
 * Deliberately plain Canvas2D + `requestAnimationFrame`, not the world
 * renderer — this draws a handful of cells at a few pixels each, not the
 * simulation canvas, and never touches `@/render` or `@/ui`.
 */
import { useEffect, useRef } from 'react';
import { createEngine, type LifeEngine } from '@/core/engine';
import type { LiveMiniatureSpec } from '@/content/specimens';

export interface MiniaturePreviewProps {
  spec: LiveMiniatureSpec;
  /** Rendered cell size in CSS px. Default 3. */
  cellSize?: number;
  className?: string;
  /** Alive-cell colour. Defaults to a neutral foreground so it works on any chrome surface. */
  color?: string;
}

export function MiniaturePreview({ spec, cellSize = 3, className, color = 'currentColor' }: MiniaturePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = spec.width + spec.padding * 2;
    const h = spec.height + spec.padding * 2;
    const engine: LifeEngine = createEngine({ width: w, height: h });
    for (let y = 0; y < spec.height; y++) {
      for (let x = 0; x < spec.width; x++) {
        if (spec.cells[y * spec.width + x]) engine.set(x + spec.padding, y + spec.padding, true);
      }
    }

    canvas.width = w * cellSize;
    canvas.height = h * cellSize;

    let raf = 0;
    let last = 0;
    let running = false;
    const stepMs = 1000 / Math.max(1, spec.fps);

    function draw() {
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas!.width, canvas!.height);
      ctx.fillStyle = color;
      engine.forEachLive({ x: 0, y: 0, w, h }, (x, y) => {
        ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
      });
    }

    function tick(t: number) {
      raf = requestAnimationFrame(tick);
      if (t - last < stepMs) return;
      last = t;
      // A seed that dies or a gun whose emitted glider drifts off this tiny
      // torus and wraps back into itself will loop forever, which is fine —
      // this is decoration, not a claim about long-run behaviour.
      engine.step();
      draw();
    }

    draw();

    const io = new IntersectionObserver(
      ([entry]) => {
        const visible = !!entry?.isIntersecting;
        if (visible && !running) {
          running = true;
          last = 0;
          raf = requestAnimationFrame(tick);
        } else if (!visible && running) {
          running = false;
          cancelAnimationFrame(raf);
        }
      },
      { threshold: 0.01 },
    );
    io.observe(canvas);

    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [spec, cellSize, color]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: (spec.width + spec.padding * 2) * cellSize, height: (spec.height + spec.padding * 2) * cellSize }}
      aria-hidden="true"
    />
  );
}
