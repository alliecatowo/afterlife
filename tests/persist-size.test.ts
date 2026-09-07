import { describe, expect, it } from 'vitest';
import { mulberry32 } from '@/core/rng';
import type { EditOp, WorldSpec } from '@/core/types';
import { exportExperiment, type ExperimentDoc } from '@/persist/store';

/** A "typical" AFTERLIFE session: a 256x160 world (the size ARCHITECTURE.md
 *  uses as its reference), ~40 minutes of drawing spread over a few thousand
 *  generations on the root branch, plus one exploratory fork. */
function buildTypicalExperiment(): ExperimentDoc {
  const spec: WorldSpec = { width: 256, height: 160, boundary: 'torus' };
  const rng = mulberry32(7);

  function randomEdits(genStart: number, genEnd: number, editsPerGenChance: number): Array<{ gen: number; ops: EditOp[] }> {
    const out: Array<{ gen: number; ops: EditOp[] }> = [];
    for (let g = genStart; g <= genEnd; g++) {
      if (rng() > editsPerGenChance) continue;
      const cellCount = 3 + Math.floor(rng() * 12); // a small brush stroke or stamp
      const cells: EditOp['cells'] = [];
      const baseX = Math.floor(rng() * spec.width);
      const baseY = Math.floor(rng() * spec.height);
      for (let i = 0; i < cellCount; i++) {
        cells.push({ x: baseX + Math.floor(rng() * 6), y: baseY + Math.floor(rng() * 6), alive: rng() > 0.15 });
      }
      out.push({ gen: g, ops: [{ kind: 'set', cells }] });
    }
    return out;
  }

  // A realistic editing session: bursts of drawing early on, then sparser
  // interventions over a longer stretch, roughly 120 edited generations
  // total spread across ~3000 generations of play.
  const rootEdits = [...randomEdits(0, 200, 0.35), ...randomEdits(200, 3000, 0.02)];
  const forkEdits = [...rootEdits.filter((e) => e.gen <= 800), ...randomEdits(800, 1400, 0.05)];

  return {
    version: 2,
    title: 'Typical session',
    createdAt: Date.now(),
    spec,
    seed: 'typical-session-seed',
    density: 0.12,
    activeBranch: 'branch-1',
    branches: [
      { id: 'root', name: 'root', parent: null, fromGen: 0, createdAt: Date.now() - 100000 },
      { id: 'branch-1', name: 'what if it survives', parent: 'root', fromGen: 800, createdAt: Date.now() - 50000 },
    ],
    edits: { root: rootEdits, 'branch-1': forkEdits },
    view: { x: 128, y: 80, scale: 4, gen: 1400 },
    lens: 'activity',
    bookmarks: [
      { id: 'bm-1', label: 'nice glider herd', branch: 'root', gen: 240, createdAt: Date.now() },
      { id: 'bm-2', label: 'stable region', branch: 'branch-1', gen: 900, createdAt: Date.now() },
    ],
    discoveries: [
      { id: 'd-1', kind: 'oscillator', gen: 300, rect: { x: 10, y: 10, w: 13, h: 13 }, label: 'Pulsar', period: 3 },
      { id: 'd-2', kind: 'spaceship', gen: 450, rect: { x: 40, y: 40, w: 3, h: 3 }, label: 'Glider', period: 4 },
    ],
    notes: 'A long exploratory session with one fork to see if the colony survives.',
  };
}

describe('typical experiment storage size', () => {
  it('measures the exported/persisted JSON size for a realistic session', () => {
    const doc = buildTypicalExperiment();
    const json = exportExperiment(doc);
    const bytes = new TextEncoder().encode(json).length;

    const totalEditedGens = doc.edits.root!.length + doc.edits['branch-1']!.length;
    const totalCells = [...doc.edits.root!, ...doc.edits['branch-1']!]
      .reduce((sum, e) => sum + e.ops.reduce((s, op) => s + op.cells.length, 0), 0);

    const rawSnapshotBytes = doc.spec.width * doc.spec.height; // one dense Uint8Array
    const naiveFullHistoryBytes = rawSnapshotBytes * 3000; // one snapshot per generation, no compaction

    // eslint-disable-next-line no-console
    console.log(
      `[persist size] world ${doc.spec.width}x${doc.spec.height}, ${totalEditedGens} edited-generation ` +
        `entries, ${totalCells} total cell writes across 2 branches over 3000 generations\n` +
        `  exported JSON:            ${bytes.toLocaleString()} bytes (${(bytes / 1024).toFixed(1)} KB)\n` +
        `  vs. one raw snapshot:     ${rawSnapshotBytes.toLocaleString()} bytes\n` +
        `  vs. naive per-gen history:${naiveFullHistoryBytes.toLocaleString()} bytes (${(naiveFullHistoryBytes / 1024 / 1024).toFixed(1)} MB) — what we deliberately never store`,
    );

    // Sanity bounds: comfortably fits in localStorage's ~5MB quota with vast
    // headroom for many such saves, and is far smaller than even a single
    // naive per-generation history of the same session.
    expect(bytes).toBeLessThan(200 * 1024);
    expect(bytes).toBeLessThan(naiveFullHistoryBytes / 50);
  });

  it('an empty/fresh experiment is tiny', () => {
    const spec: WorldSpec = { width: 256, height: 160, boundary: 'torus' };
    const doc: ExperimentDoc = {
      version: 2,
      title: 'Fresh',
      createdAt: Date.now(),
      spec,
      seed: 1,
      density: 0.1,
      activeBranch: 'root',
      branches: [{ id: 'root', name: 'root', parent: null, fromGen: 0, createdAt: Date.now() }],
      edits: { root: [] },
      bookmarks: [],
      discoveries: [],
    };
    const bytes = new TextEncoder().encode(exportExperiment(doc)).length;
    // eslint-disable-next-line no-console
    console.log(`[persist size] fresh experiment: ${bytes} bytes`);
    expect(bytes).toBeLessThan(600);
  });
});
