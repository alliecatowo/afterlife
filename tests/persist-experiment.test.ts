import { describe, expect, it } from 'vitest';
import { createEngine } from '@/core/engine';
import type { EditOp, WorldSpec } from '@/core/types';
import { exportExperiment, importExperiment, type ExperimentDoc } from '@/persist/store';

const SPEC: WorldSpec = { width: 16, height: 16, boundary: 'torus' };

const GLIDER: EditOp = {
  kind: 'set',
  cells: [
    { x: 1, y: 0, alive: true },
    { x: 2, y: 1, alive: true },
    { x: 0, y: 2, alive: true },
    { x: 1, y: 2, alive: true },
    { x: 2, y: 2, alive: true },
  ],
};

const BLOCK: EditOp = {
  kind: 'set',
  cells: [
    { x: 10, y: 10, alive: true },
    { x: 11, y: 10, alive: true },
    { x: 10, y: 11, alive: true },
    { x: 11, y: 11, alive: true },
  ],
};

function buildDoc(): ExperimentDoc {
  return {
    version: 2,
    title: 'Glider study',
    createdAt: 1234567890,
    spec: SPEC,
    seed: 'afterlife-test-seed',
    density: 0, // fully hand-drawn start via gen-0 edits below
    activeBranch: 'branch-1',
    branches: [
      { id: 'root', name: 'root', parent: null, fromGen: 0, createdAt: 1000 },
      { id: 'branch-1', name: 'block fork', parent: 'root', fromGen: 5, createdAt: 2000 },
    ],
    edits: {
      root: [{ gen: 0, ops: [GLIDER] }],
      // branch-1's entries are already flattened back to gen 0, per TimelineStore.entries().
      'branch-1': [
        { gen: 0, ops: [GLIDER] },
        { gen: 5, ops: [BLOCK] },
      ],
    },
    view: { x: 3, y: -4, scale: 2.5, gen: 12 },
    lens: 'age',
    bookmarks: [{ id: 'bm-1', label: 'first block', branch: 'branch-1', gen: 5, createdAt: 3000 }],
    discoveries: [{ id: 'd-1', kind: 'still-life', gen: 6, rect: { x: 10, y: 10, w: 2, h: 2 }, label: 'Block' }],
    notes: 'A study of a glider that forks into a still life.',
  };
}

/** Reconstruct a branch's world at `toGen` purely from seed + density + edits,
 *  mirroring TimelineStore's replay semantics (edits at g apply after arriving
 *  at g, before the step that produces g + 1). */
function replay(doc: ExperimentDoc, branch: string, toGen: number): Uint8Array {
  const engine = createEngine({ width: doc.spec.width, height: doc.spec.height });
  engine.seed(doc.seed, doc.density);
  const byGen = new Map(doc.edits[branch]!.map((e) => [e.gen, e.ops]));
  for (let g = 0; g <= toGen; g++) {
    const ops = byGen.get(g);
    if (ops) for (const op of ops) for (const c of op.cells) engine.set(c.x, c.y, c.alive);
    if (g < toGen) engine.step();
  }
  return engine.snapshot().bits;
}

describe('experiment export/import', () => {
  it('round-trips export -> import -> export byte-identically', () => {
    const doc = buildDoc();
    const json1 = exportExperiment(doc);
    const reopened = importExperiment(json1);
    const json2 = exportExperiment(reopened);
    expect(json2).toBe(json1);
  });

  it('is pretty-printed JSON', () => {
    const json = exportExperiment(buildDoc());
    expect(json).toContain('\n  "title"');
  });

  it('reopened document reproduces the same world (buffers match)', () => {
    const doc = buildDoc();
    const reopened = importExperiment(exportExperiment(doc));

    const rootBefore = replay(doc, 'root', 4);
    const rootAfter = replay(reopened, 'root', 4);
    expect(Array.from(rootAfter)).toEqual(Array.from(rootBefore));

    const forkBefore = replay(doc, 'branch-1', 8);
    const forkAfter = replay(reopened, 'branch-1', 8);
    expect(Array.from(forkAfter)).toEqual(Array.from(forkBefore));

    // Sanity: the fork actually differs from root once its block edit lands.
    const rootAt8 = replay(doc, 'root', 8);
    expect(Array.from(forkAfter)).not.toEqual(Array.from(rootAt8));
  });

  it('preserves metadata: title, notes, view, lens, bookmarks, discoveries', () => {
    const doc = buildDoc();
    const reopened = importExperiment(exportExperiment(doc));
    expect(reopened.title).toBe(doc.title);
    expect(reopened.notes).toBe(doc.notes);
    expect(reopened.view).toEqual(doc.view);
    expect(reopened.lens).toBe(doc.lens);
    expect(reopened.bookmarks).toEqual(doc.bookmarks);
    expect(reopened.discoveries).toEqual(doc.discoveries);
    expect(reopened.activeBranch).toBe(doc.activeBranch);
    expect(reopened.branches).toEqual(doc.branches);
  });

  it('rejects malformed JSON with a descriptive error', () => {
    expect(() => importExperiment('{not json')).toThrow(/invalid JSON/);
  });

  it('rejects a structurally invalid document with a specific field-level error', () => {
    const bad = JSON.stringify({ version: 2, title: 'x', createdAt: 1, spec: { width: -1, height: 8, boundary: 'torus' }, seed: 1, density: 0, activeBranch: 'root', branches: [{ id: 'root', name: 'root', parent: null, fromGen: 0, createdAt: 0 }], edits: {} });
    expect(() => importExperiment(bad)).toThrow(/spec\.width/);
  });

  it('rejects a future schema version with a specific error, not silent corruption', () => {
    const future = JSON.stringify({ ...JSON.parse(exportExperiment(buildDoc())), version: 999 });
    expect(() => importExperiment(future)).toThrow(/v999/);
  });
});

describe('schema migration', () => {
  it('loads a v1 payload (original scaffolded shape) under the current version', () => {
    const v1 = {
      version: 1,
      title: 'legacy experiment',
      createdAt: 42,
      spec: SPEC,
      seed: 'old-seed',
      density: 0.1,
      branches: [{ id: 'root', name: 'root', parent: null, fromGen: 0, createdAt: 0 }],
      edits: {
        root: [{ gen: 0, ops: [GLIDER] }],
      },
      view: { x: 0, y: 0, scale: 1, gen: 0 },
      notes: 'from before bookmarks existed',
    };
    const doc = importExperiment(JSON.stringify(v1));
    expect(doc.version).toBe(2);
    expect(doc.title).toBe('legacy experiment');
    expect(doc.activeBranch).toBe('root');
    expect(doc.lens).toBe('life');
    expect(doc.bookmarks).toEqual([]);
    expect(doc.discoveries).toEqual([]);
    expect(doc.notes).toBe('from before bookmarks existed');

    // And the migrated edits still replay to the same world.
    const rebuilt = replay(doc, 'root', 3);
    const engine = createEngine({ width: SPEC.width, height: SPEC.height });
    engine.seed('old-seed', 0.1);
    for (const c of GLIDER.cells) engine.set(c.x, c.y, c.alive);
    engine.step();
    engine.step();
    engine.step();
    expect(Array.from(rebuilt)).toEqual(Array.from(engine.snapshot().bits));
  });
});
