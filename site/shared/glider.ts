/**
 * A tiny, dependency-free B3/S23 simulation for the landing page's inline
 * diagram — the same rule the app runs (birth on exactly 3 neighbours,
 * survival on 2 or 3), stepped on a small toroidal grid seeded with a real
 * glider. This is a genuine simulation, not a canned animation loop: the
 * five live cells you see are stepped by the actual rule every tick.
 */

const GRID = 9;
// The smallest known spaceship: 5 cells, period 4, translates (1, 1) per
// period. Placed with a little headroom so it has room to travel before
// wrapping the small torus.
const GLIDER_SEED: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [2, 1],
  [0, 2],
  [1, 2],
  [2, 2],
];

function seed(): Uint8Array {
  const cells = new Uint8Array(GRID * GRID);
  for (const [x, y] of GLIDER_SEED) cells[y * GRID + x] = 1;
  return cells;
}

function step(cells: Uint8Array): Uint8Array {
  const next = new Uint8Array(GRID * GRID);
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = (x + dx + GRID) % GRID;
          const ny = (y + dy + GRID) % GRID;
          n += cells[ny * GRID + nx];
        }
      }
      const alive = cells[y * GRID + x] === 1;
      next[y * GRID + x] = alive ? (n === 2 || n === 3 ? 1 : 0) : n === 3 ? 1 : 0;
    }
  }
  return next;
}

function token(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export interface GliderDiagramHandle {
  stop(): void;
}

/** Mounts the animated diagram into `canvas`. Returns a handle to stop it (e.g. on unmount). */
export function mountGliderDiagram(canvas: HTMLCanvasElement, reducedMotion: boolean): GliderDiagramHandle {
  const ctx = canvas.getContext('2d');
  const noop: GliderDiagramHandle = { stop() {} };
  if (!ctx) return noop;

  let cells = seed();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssSize = canvas.clientWidth || canvas.width || 180;
  canvas.width = cssSize * dpr;
  canvas.height = cssSize * dpr;
  ctx.scale(dpr, dpr);
  const cellSize = cssSize / GRID;

  const inkBg = token('--color-ink-900', '#111417');
  const lineColor = token('--color-line', '#33383c');
  const lifeColor = token('--color-accent-life', '#7fe0a8');

  function draw() {
    if (!ctx) return;
    ctx.fillStyle = inkBg;
    ctx.fillRect(0, 0, cssSize, cssSize);
    ctx.strokeStyle = lineColor;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1;
    for (let i = 0; i <= GRID; i++) {
      ctx.beginPath();
      ctx.moveTo(i * cellSize, 0);
      ctx.lineTo(i * cellSize, cssSize);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i * cellSize);
      ctx.lineTo(cssSize, i * cellSize);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = lifeColor;
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        if (cells[y * GRID + x]) {
          ctx.fillRect(x * cellSize + 1.5, y * cellSize + 1.5, cellSize - 3, cellSize - 3);
        }
      }
    }
  }

  draw();

  if (reducedMotion) return noop;

  let rafId = 0;
  let lastStep = 0;
  const STEP_MS = 500;

  function tick(t: number) {
    if (t - lastStep >= STEP_MS) {
      cells = step(cells);
      draw();
      lastStep = t;
    }
    rafId = requestAnimationFrame(tick);
  }

  rafId = requestAnimationFrame(tick);
  return { stop: () => cancelAnimationFrame(rafId) };
}
