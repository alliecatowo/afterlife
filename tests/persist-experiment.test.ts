import { describe, expect, it } from 'vitest';
import { createEngine } from '@/core/engine';
import type { EditOp, WorldSpec } from '@/core/types';
import { EXPERIMENT_FORMAT_VERSION, exportExperiment, importExperiment, type ExperimentDoc } from '@/persist/store';

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
    version: EXPERIMENT_FORMAT_VERSION,
    title: 'Glider study',
    createdAt: 1234567890,
    spec: SPEC,
    rule: 'B36/S23', // non-Conway on purpose — exercises rule persistence through export/import
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
  const engine = createEngine({ width: doc.spec.width, height: doc.spec.height, rule: doc.rule });
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

  it('persists a non-Conway rule through export/import, and it actually governs replay', () => {
    const doc = buildDoc();
    expect(doc.rule).toBe('B36/S23');
    const reopened = importExperiment(exportExperiment(doc));
    expect(reopened.rule).toBe('B36/S23');

    // Not just round-tripped as a string — replaying under it produces a
    // DIFFERENT world than replaying the same edits under Conway would. Use a
    // dedicated ring-of-6-neighbours seed (a documented HighLife-only birth;
    // see tests/core-engine-rules.test.ts) rather than buildDoc()'s sparse
    // glider, which is too sparse to ever land on a 6-neighbour cell in a
    // handful of generations.
    const RING: EditOp = {
      kind: 'set',
      cells: [
        { x: 7, y: 7, alive: true }, { x: 8, y: 7, alive: true }, { x: 9, y: 7, alive: true },
        { x: 7, y: 8, alive: true }, { x: 9, y: 8, alive: true },
        { x: 7, y: 9, alive: true },
      ],
    };
    const ringDoc: ExperimentDoc = { ...doc, edits: { root: [{ gen: 0, ops: [RING] }] } };
    const reopenedRing = importExperiment(exportExperiment(ringDoc));
    expect(reopenedRing.rule).toBe('B36/S23');
    const underHighLife = replay(reopenedRing, 'root', 1);
    const underConway = replay({ ...reopenedRing, rule: 'B3/S23' }, 'root', 1);
    expect(Array.from(underHighLife)).not.toEqual(Array.from(underConway));
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
    expect(doc.version).toBe(EXPERIMENT_FORMAT_VERSION);
    expect(doc.title).toBe('legacy experiment');
    expect(doc.activeBranch).toBe('root');
    expect(doc.lens).toBe('life');
    expect(doc.bookmarks).toEqual([]);
    expect(doc.discoveries).toEqual([]);
    expect(doc.notes).toBe('from before bookmarks existed');
    // The whole point of the migration path: a save from before rule
    // generalisation existed opens as Conway, never left ambiguous.
    expect(doc.rule).toBe('B3/S23');

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

  it('loads a v2 payload (pre-rule-generalisation, packed edits) as Conway under the current version', () => {
    const v2 = {
      version: 2,
      title: 'pre-rule save',
      createdAt: 7,
      spec: SPEC,
      seed: 'v2-seed',
      density: 0,
      activeBranch: 'root',
      branches: [{ id: 'root', name: 'root', parent: null, fromGen: 0, createdAt: 0 }],
      edits: { root: [] },
      bookmarks: [],
      discoveries: [],
    };
    const doc = importExperiment(JSON.stringify(v2));
    expect(doc.version).toBe(EXPERIMENT_FORMAT_VERSION);
    expect(doc.rule).toBe('B3/S23');
    expect(doc.title).toBe('pre-rule save');
  });
});
