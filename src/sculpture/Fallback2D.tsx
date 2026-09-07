/**
 * WebGL is unavailable. Don't crash and don't silently drop the feature:
 * explain what's missing, and still let the idea land by layering a handful
 * of REAL recorded history slices on a 2D canvas with a diagonal offset and
 * decaying opacity per slice — a poor man's depth axis, but an honest one.
 */
import { useEffect, useRef } from 'react';
import type { Generation, Rect } from '@/core/types';
import { resolveCssColorString } from './tokens';

export interface Fallback2DProps {
  rect: Rect;
  fromGen: Generation;
  toGen: Generation;
  slices: Uint8Array[];
  slotGens: Generation[];
  reductionNote?: string;
}

const MAX_LAYERS = 8;

export function Fallback2D({ rect, fromGen, toGen, slices, slotGens, reductionNote }: Fallback2DProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth || 640;
    const height = canvas.clientHeight || 480;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    const ink900 = resolveCssColorString('--color-ink-900', '#111417');
    const accentTime = resolveCssColorString('--color-accent-time', '#7fb8e0');
    ctx.fillStyle = ink900;
    ctx.fillRect(0, 0, width, height);

    const layerCount = Math.min(MAX_LAYERS, slices.length);
    if (layerCount === 0) return;
    const stride = Math.max(1, Math.floor(slices.length / layerCount));
    const layerIndices: number[] = [];
    for (let i = slices.length - 1; i >= 0 && layerIndices.length < layerCount; i -= stride) layerIndices.unshift(i);

    const cell = Math.min(width / rect.w, height / rect.h) * 0.8;
    const boardW = rect.w * cell;
    const boardH = rect.h * cell;
    const offsetStep = Math.min(24, cell * 3);

    layerIndices.forEach((sliceIndex, layerPos) => {
      const t = layerCount > 1 ? layerPos / (layerCount - 1) : 1;
      const ox = (width - boardW) / 2 - (layerCount - 1 - layerPos) * offsetStep * 0.5 + layerPos * offsetStep * 0.5;
      const oy = (height - boardH) / 2 + (layerCount - 1 - layerPos) * offsetStep * 0.35;
      ctx.globalAlpha = 0.18 + 0.82 * t;
      ctx.fillStyle = accentTime;
      const buf = slices[sliceIndex];
      for (let y = 0; y < rect.h; y++) {
        for (let x = 0; x < rect.w; x++) {
          if (buf[y * rect.w + x]) ctx.fillRect(ox + x * cell, oy + y * cell, Math.max(1, cell - 1), Math.max(1, cell - 1));
        }
      }
    });
    ctx.globalAlpha = 1;
  }, [rect, slices]);

  return (
    <div style={{
      position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
      background: 'var(--color-ink-900)',
    }}
    >
      <div style={{
        padding: '8px 16px', color: 'var(--color-ivory-300)', fontFamily: 'var(--font-sans)',
        fontSize: 'var(--text-xs)',
      }}
      >
        WebGL is unavailable in this browser — showing a flattened 2D approximation:
        {' '}{Math.min(MAX_LAYERS, slices.length)} offset history slices from gen {fromGen} to {toGen}
        {slotGens.length ? ` (present at gen ${slotGens[slotGens.length - 1]})` : ''}.
        {reductionNote ? ` ${reductionNote}` : ''}
      </div>
      <canvas ref={canvasRef} style={{ flex: 1, width: '100%', height: '100%' }} />
    </div>
  );
}

export function WebGLUnsupportedNotice() {
  return (
    <div style={{
      position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: 'var(--color-ink-900)', padding: 24,
    }}
    >
      <div style={{ maxWidth: 420, textAlign: 'center', color: 'var(--color-ivory-200)', fontFamily: 'var(--font-sans)' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-lg)', color: 'var(--color-ivory-100)', marginBottom: 8 }}>
          Time Sculpture needs WebGL
        </div>
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-ivory-300)' }}>
          This browser or device doesn&rsquo;t expose a WebGL context, so the 3D history volume
          can&rsquo;t be built. A flattened 2D approximation is shown instead where possible.
        </div>
      </div>
    </div>
  );
}
