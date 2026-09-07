/**
 * Canvas2D drawing for the history ribbon. Pure functions only — no DOM
 * queries besides the one-time colour read, no React. `Timeline.tsx` owns the
 * canvas lifecycle and calls `drawRibbon` from its own rAF loop.
 */
import type { HistorySnapshot } from './historyRing';
import type { BranchMeta, Generation } from '@/core/types';

export interface RibbonColors {
  life: string;
  activity: string;
  time: string;
  line: string;
  lineStrong: string;
  ink700: string;
  ink600: string;
  ivory100: string;
  ivory300: string;
  warn: string;
}

/** Resolved once (colours don't change at runtime) — same pattern as the world renderer. */
export function readRibbonColors(): RibbonColors {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string) => cs.getPropertyValue(name).trim();
  return {
    life: v('--color-accent-life'),
    activity: v('--color-accent-activity'),
    time: v('--color-accent-time'),
    line: v('--color-line'),
    lineStrong: v('--color-line-strong'),
    ink700: v('--color-ink-700'),
    ink600: v('--color-ink-600'),
    ivory100: v('--color-ivory-100'),
    ivory300: v('--color-ivory-300'),
    warn: v('--color-accent-warn'),
  };
}

export interface RibbonParams {
  snapshot: HistorySnapshot;
  windowStart: Generation;
  currentGen: Generation;
  branches: readonly BranchMeta[];
  /** Live gen while dragging/keyboard-stepping the scrubber, before commit. */
  scrubGen: Generation | null;
  seeking: boolean;
  colors: RibbonColors;
}

export interface RibbonGeometry {
  rangeStart: number;
  rangeEnd: number;
  genToX(gen: number): number;
  xToGen(x: number): number;
}

export function ribbonGeometry(w: number, p: Pick<RibbonParams, 'snapshot' | 'windowStart' | 'currentGen'>): RibbonGeometry {
  const rangeStart = p.windowStart;
  const rangeEnd = Math.max(p.currentGen, p.snapshot.maxGen, rangeStart + 1);
  const span = Math.max(1, rangeEnd - rangeStart);
  return {
    rangeStart,
    rangeEnd,
    genToX: (gen) => ((gen - rangeStart) / span) * w,
    xToGen: (x) => Math.round(rangeStart + (x / w) * span),
  };
}

const TRACK_TOP = 6;

export function drawRibbon(ctx: CanvasRenderingContext2D, w: number, h: number, p: RibbonParams): void {
  ctx.clearRect(0, 0, w, h);
  const trackH = h - TRACK_TOP - 14; // leave room for the axis caption below
  const geo = ribbonGeometry(w, p);
  const { snapshot: s, colors: c } = p;

  // Baseline track.
  ctx.fillStyle = c.ink700;
  ctx.fillRect(0, TRACK_TOP, w, trackH);

  if (s.gens.length === 0) {
    // Genuinely nothing observed yet this session/branch — the ONLY case
    // where "no history recorded yet" is accurate. A single hand-drawn edit
    // while paused (gen unchanged) already pushes one real sample (see
    // `historyRing.push`), so this message must not linger past that —
    // it previously did, because a lone sample also failed the old `< 2`
    // check even though something real HAD been recorded.
    ctx.fillStyle = c.ivory300;
    ctx.font = '11px "Inter Variable", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText('no history recorded yet — press play or draw a cell', w / 2, TRACK_TOP + trackH / 2);
    return;
  }

  if (s.gens.length === 1) {
    // One real recorded sample — honest about there not being a trend to
    // trace yet, without falsely claiming nothing was recorded.
    ctx.fillStyle = c.life;
    ctx.globalAlpha = 0.55;
    const bh = Math.max(2, trackH * 0.12);
    ctx.fillRect(w / 2 - 1, TRACK_TOP + trackH - bh, 2, bh);
    ctx.globalAlpha = 1;
    ctx.fillStyle = c.ivory300;
    ctx.font = '11px "Inter Variable", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText('recorded — press play to trace its history', w / 2, TRACK_TOP + trackH / 2 + 12);
    return;
  }

  // Bucket samples into pixel columns (population = accent-life fill height,
  // activity = accent-activity line on top). Both are real observed values.
  const popMax = Float32Array.from({ length: Math.ceil(w) }, () => 0);
  const actMax = Float32Array.from({ length: Math.ceil(w) }, () => 0);
  const hit = new Uint8Array(Math.ceil(w));
  for (let i = 0; i < s.gens.length; i++) {
    const x = Math.min(w - 1, Math.max(0, Math.floor(geo.genToX(s.gens[i]!))));
    if ((s.pops[i] ?? 0) > popMax[x]!) popMax[x] = s.pops[i]!;
    if ((s.activity[i] ?? 0) > actMax[x]!) actMax[x] = s.activity[i]!;
    hit[x] = 1;
  }
  const popScale = s.maxPopulation > 0 ? (trackH - 4) / s.maxPopulation : 0;
  const actPeak = Math.max(1, ...actMax);
  const actScale = (trackH - 4) / actPeak;

  ctx.fillStyle = c.life;
  ctx.globalAlpha = 0.55;
  for (let x = 0; x < popMax.length; x++) {
    if (!hit[x]) continue;
    const bh = Math.max(1, popMax[x]! * popScale);
    ctx.fillRect(x, TRACK_TOP + trackH - bh, 1, bh);
  }
  ctx.globalAlpha = 1;

  ctx.strokeStyle = c.activity;
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  let started = false;
  for (let x = 0; x < actMax.length; x++) {
    if (!hit[x]) continue;
    const y = TRACK_TOP + trackH - actMax[x]! * actScale;
    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Window-start boundary: honest about where retained history stops.
  if (geo.rangeStart > 0) {
    const x = geo.genToX(geo.rangeStart);
    ctx.strokeStyle = c.lineStrong;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(x, TRACK_TOP);
    ctx.lineTo(x, TRACK_TOP + trackH);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Fork points.
  for (const b of p.branches) {
    if (b.fromGen < geo.rangeStart || b.fromGen > geo.rangeEnd) continue;
    const x = geo.genToX(b.fromGen);
    ctx.fillStyle = c.ivory100;
    ctx.beginPath();
    ctx.moveTo(x, TRACK_TOP - 1);
    ctx.lineTo(x + 3.5, TRACK_TOP + 4);
    ctx.lineTo(x, TRACK_TOP + 9);
    ctx.lineTo(x - 3.5, TRACK_TOP + 4);
    ctx.closePath();
    ctx.fill();
  }

  // Present / scrub marker.
  const markerGen = p.scrubGen ?? p.currentGen;
  const mx = geo.genToX(markerGen);
  ctx.strokeStyle = c.time;
  ctx.lineWidth = p.scrubGen !== null ? 2 : 1.5;
  ctx.globalAlpha = p.seeking ? 0.55 + 0.35 * Math.abs(Math.sin(performance.now() / 220)) : 1;
  ctx.beginPath();
  ctx.moveTo(mx, TRACK_TOP - 2);
  ctx.lineTo(mx, TRACK_TOP + trackH + 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = c.time;
  ctx.beginPath();
  ctx.moveTo(mx - 4, TRACK_TOP - 6);
  ctx.lineTo(mx + 4, TRACK_TOP - 6);
  ctx.lineTo(mx, TRACK_TOP - 1);
  ctx.closePath();
  ctx.fill();

  // Axis caption.
  ctx.fillStyle = c.ivory300;
  ctx.font = '10px "JetBrains Mono Variable", monospace';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText(String(geo.rangeStart), 2, h - 12);
  ctx.textAlign = 'right';
  ctx.fillText(String(geo.rangeEnd), w - 2, h - 12);
}
