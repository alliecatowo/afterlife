import { describe, expect, it } from 'vitest';
import { createEngine } from '@/core/engine';
import { createTimelineStore } from '@/core/history';
import type { EditOp } from '@/core/types';
import {
  EXPERIMENT_FORMAT_VERSION, encodeShareHash, exportExperiment, importExperiment, parseShareHash,
  MAX_SHARE_HASH, ShareTooLargeError, type ExperimentDoc,
} from '@/persist/store';

const GLIDER: EditOp = {
  kind: 'set',
  cells: [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]].map(([x, y]) => ({ x: x!, y: y!, alive: true })),
};
const BLOCK: EditOp = { kind: 'set', cells: [[10, 10], [11, 10], [10, 11], [11, 11]].map(([x, y]) => ({ x: x!, y: y!, alive: true })) };

function mk() {
  const engine = createEngine({ width: 32, height: 32 });
  const history = createTimelineStore({ engine });
  return { engine, history };
}

describe('branch persistence (restoreBranch)', () => {
  it('recreates a fork from its flattened entries, bit-exact', async () => {
    const a = mk();
    a.history.record(0, [GLIDER]);
    for (let g = 1; g <= 12; g++) { a.engine.step(); a.history.advance(g); }
    await a.history.goto(6);
    const id = a.history.branchFrom(6, [BLOCK]);
    await a.history.switchBranch(id);
    for (let g = a.engine.gen + 1; g <= 20; g++) { a.engine.step(); a.history.advance(g); }
    const want = a.engine.snapshot().bits;
    const entries = a.history.entries(id);
    const maxGen = a.history.branchMaxGen(id);
    const meta = a.history.branches.find((b) => b.id === id)!;
    expect(maxGen).toBe(20);

    // Fresh session: root first, then the saved fork.
    const b = mk();
    b.history.record(0, [GLIDER]);
    await b.history.loadEntries([{ gen: 0, edits: [GLIDER] }], 12);
    expect(b.history.restoreBranch(meta, entries, maxGen)).toBe(true);
    expect(b.history.restoreBranch(meta, entries, maxGen)).toBe(false);
    await b.history.switchBranch(id, 20);
    expect(b.engine.snapshot().bits).toEqual(want);
    // New forks never collide with a restored id.
    expect(b.history.branchFrom(20, [])).not.toBe(id);
    expect(b.history.entries('nope')).toEqual([]);
  });
});

describe('document round-trip keeps forks and the field guide', () => {
  it('carries branchMaxGen and fieldGuide through export/import', () => {
    const doc: ExperimentDoc = {
      version: EXPERIMENT_FORMAT_VERSION, title: 't', createdAt: 1, spec: { width: 16, height: 16, boundary: 'torus' },
      rule: 'B3/S23', seed: 0, density: 0, activeBranch: 'branch-1',
      branches: [
        { id: 'root', name: 'root', parent: null, fromGen: 0, createdAt: 1 },
        { id: 'branch-1', name: 'what if', parent: 'root', fromGen: 3, createdAt: 2 },
      ],
      branchMaxGen: { root: 9, 'branch-1': 14 },
      edits: { root: [{ gen: 0, ops: [GLIDER] }], 'branch-1': [{ gen: 0, ops: [GLIDER] }, { gen: 3, ops: [BLOCK] }] },
      bookmarks: [], discoveries: [],
      fieldGuide: [{ id: 'disc_1', trail: [{ gen: 1, rect: { x: 0, y: 0, w: 3, h: 3 } }] }],
    };
    const back = importExperiment(exportExperiment(doc));
    expect(back.branchMaxGen).toEqual(doc.branchMaxGen);
    expect(back.fieldGuide).toEqual(doc.fieldGuide);
    expect(back.branches).toHaveLength(2);
    expect(() => importExperiment(exportExperiment({ ...doc, fieldGuide: [{ nope: 1 }] }))).toThrow(/fieldGuide/);
  });
});

describe('share links', () => {
  const rect = { w: 8, h: 8 };
  const cells = new Uint8Array(64);
  for (const [x, y] of [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]]) cells[y! * 8 + x!] = 1;

  it('round-trips pattern and rule', () => {
    const hash = encodeShareHash(cells, rect, 'B36/S23');
    expect(hash.startsWith('#w=')).toBe(true);
    const p = parseShareHash(hash)!;
    expect(p.rule).toBe('B36/S23');
    expect([p.w, p.h]).toEqual([3, 3]);
    expect(p.cells.reduce((a, c) => a + c, 0)).toBe(5);
  });

  it('rejects junk, other hashes, and empty worlds', () => {
    expect(parseShareHash('')).toBeNull();
    expect(parseShareHash('#about')).toBeNull();
    expect(parseShareHash('#w=%E0%A4%A')).toBeNull();
    expect(parseShareHash('#w=B3%2FS23;3;3;<script>')).toBeNull();
    expect(parseShareHash('#w=B3%2FS23%2FC4;3;3;3o!')).toBeNull();
    expect(() => encodeShareHash(new Uint8Array(64), rect, 'B3/S23')).toThrow();
  });

  it('refuses links that would be too long', () => {
    const w = 400;
    const big = new Uint8Array(w * w);
    for (let i = 0; i < big.length; i += 2) big[i] = 1;
    expect(() => encodeShareHash(big, { w, h: w }, 'B3/S23')).toThrow(ShareTooLargeError);
    expect(MAX_SHARE_HASH).toBeGreaterThan(1000);
  });
});
