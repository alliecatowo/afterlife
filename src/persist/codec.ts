/**
 * Experiment document codec: packing, validation, and version migration.
 * Owned by `persist`. See `src/persist/store.ts` for the public-facing API.
 *
 * On-disk compactness
 * --------------------
 * We never store a snapshot per generation, and we never store a raw cell
 * buffer at all. `ExperimentDoc.edits` already holds only the sparse `EditOp`s
 * the app recorded (see `core/history.ts`); the initial state is just
 * `seed`/`density` (or, for a fully hand-drawn start, `density: 0` plus edits
 * recorded at generation 0 — both replay identically). Combined with the
 * B3/S23 engine, that is a complete, deterministic description of every
 * generation ever reached.
 *
 * The one further compaction we apply is cell packing: instead of
 * `{ x, y, alive }` objects (three JSON keys per cell) we store one integer
 * per cell — `wrapY(y) * width + wrapX(x)`, negated-and-offset for a dead
 * cell. Wrapping is safe because `LifeEngine.set` wraps identically at replay
 * time, so a packed/unpacked coordinate reproduces the exact same world.
 */
import type {
  BranchId, BranchMeta, DiscoveryEvent, EditOp, Generation, RenderLens, WorldSpec,
} from '@/core/types';
import { wrap } from '@/core/engine';
import { CONWAY_RULE_STRING, parseRule } from '@/core/rule';

/** A saved point of interest, e.g. "found a period-30 puffer here". */
export interface Bookmark {
  id: string;
  label: string;
  branch: BranchId;
  gen: Generation;
  createdAt: number;
}

/** Current on-disk/interchange schema version. */
export const EXPERIMENT_FORMAT_VERSION = 3 as const;

/** The full serialisable document. JSON, no binary — bits are RLE strings / packed ints. */
export interface ExperimentDoc {
  version: typeof EXPERIMENT_FORMAT_VERSION;
  title: string;
  createdAt: number;
  spec: WorldSpec;
  /**
   * Canonical B/S rulestring in force for this document (see `@/core/rule.ts`).
   * Part of the world's identity exactly like `spec` — a v1/v2 document
   * predates rule generalisation and is migrated to `"B3/S23"` (the only rule
   * that ever existed then), never left ambiguous. See `migrateToCurrent`.
   */
  rule: string;
  /** Seed used for the initial universe, so gen 0 reproduces exactly. */
  seed: number | string;
  density: number;
  /** Which branch was active when this was saved. */
  activeBranch: BranchId;
  branches: BranchMeta[];
  /** Recorded edits per branch, ascending by generation. Each branch's list
   *  is already flattened back to gen 0 (see `TimelineStore.entries()`), so
   *  no branch needs its ancestors' docs to replay. */
  edits: Record<string, Array<{ gen: Generation; ops: EditOp[] }>>;
  /** Where the camera was, so reopening feels like returning. */
  view?: { x: number; y: number; scale: number; gen: Generation };
  /** Active render lens at save time. */
  lens?: RenderLens;
  bookmarks: Bookmark[];
  discoveries: DiscoveryEvent[];
  notes?: string;
}

/** Pack absolute cell edits into one integer per cell (see module doc). */
export function packCells(cells: EditOp['cells'], width: number, height: number): number[] {
  return cells.map((c) => {
    const idx = wrap(c.y, height) * width + wrap(c.x, width);
    return c.alive ? idx : -(idx + 1);
  });
}

/** Inverse of `packCells`. Coordinates returned are already wrapped into `[0, width)`. */
export function unpackCells(nums: readonly number[], width: number): EditOp['cells'] {
  return nums.map((n) => {
    const alive = n >= 0;
    const idx = alive ? n : -(n + 1);
    const x = idx % width;
    const y = Math.floor(idx / width);
    return { x, y, alive };
  });
}

// --- On-disk shapes -------------------------------------------------------

interface PersistedEditsEntryV2 {
  g: Generation;
  /** Packed cells from every `EditOp` recorded at this generation, concatenated
   *  in order — safe because every `EditOp.kind` is `'set'` today. */
  c: number[];
}

interface PersistedDocV2 {
  version: 2;
  title: string;
  createdAt: number;
  spec: WorldSpec;
  seed: number | string;
  density: number;
  activeBranch: BranchId;
  branches: BranchMeta[];
  edits: Record<string, PersistedEditsEntryV2[]>;
  view?: { x: number; y: number; scale: number; gen: Generation };
  lens?: RenderLens;
  bookmarks: Bookmark[];
  discoveries: DiscoveryEvent[];
  notes?: string;
}

/** Current on-disk shape: V2 plus the world's rule (see `ExperimentDoc.rule`'s doc). */
interface PersistedDocV3 extends Omit<PersistedDocV2, 'version'> {
  version: 3;
  rule: string;
}

/** The original scaffolded shape (unpacked edits, no activeBranch/lens/bookmarks/discoveries). */
interface PersistedDocV1 {
  version: 1;
  title: string;
  createdAt: number;
  spec: WorldSpec;
  seed: number | string;
  density: number;
  branches: BranchMeta[];
  edits: Record<string, Array<{ gen: Generation; ops: EditOp[] }>>;
  view?: { x: number; y: number; scale: number; gen: Generation };
  notes?: string;
}

function fail(msg: string): never {
  throw new Error(`experiment document: ${msg}`);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function checkSpec(spec: unknown): asserts spec is WorldSpec {
  if (!isPlainObject(spec)) fail('"spec" must be an object');
  const { width, height, boundary } = spec as Record<string, unknown>;
  if (!Number.isInteger(width) || (width as number) <= 0) fail(`"spec.width" must be a positive integer, got ${JSON.stringify(width)}`);
  if (!Number.isInteger(height) || (height as number) <= 0) fail(`"spec.height" must be a positive integer, got ${JSON.stringify(height)}`);
  if (boundary !== 'torus') fail(`"spec.boundary" must be "torus", got ${JSON.stringify(boundary)}`);
}

function checkBranches(branches: unknown): asserts branches is BranchMeta[] {
  if (!Array.isArray(branches) || branches.length === 0) fail('"branches" must be a non-empty array');
  for (const b of branches) {
    if (!isPlainObject(b)) fail('every branch must be an object');
    if (typeof b.id !== 'string' || b.id.length === 0) fail('branch.id must be a non-empty string');
    if (typeof b.name !== 'string') fail(`branch "${String(b.id)}".name must be a string`);
    if (b.parent !== null && typeof b.parent !== 'string') fail(`branch "${String(b.id)}".parent must be a string or null`);
    if (!Number.isInteger(b.fromGen) || (b.fromGen as number) < 0) fail(`branch "${String(b.id)}".fromGen must be a non-negative integer`);
    if (typeof b.createdAt !== 'number') fail(`branch "${String(b.id)}".createdAt must be a number`);
  }
}

function checkEditOpCells(cells: unknown, where: string): asserts cells is EditOp['cells'] {
  if (!Array.isArray(cells)) fail(`${where}.cells must be an array`);
  for (const c of cells) {
    if (!isPlainObject(c) || typeof c.x !== 'number' || typeof c.y !== 'number' || typeof c.alive !== 'boolean') {
      fail(`${where}.cells entries must be { x: number, y: number, alive: boolean }`);
    }
  }
}

function checkV1Edits(edits: unknown): asserts edits is PersistedDocV1['edits'] {
  if (!isPlainObject(edits)) fail('"edits" must be an object keyed by branch id');
  for (const [branchId, list] of Object.entries(edits)) {
    if (!Array.isArray(list)) fail(`edits["${branchId}"] must be an array`);
    for (const entry of list) {
      if (!isPlainObject(entry) || !Number.isInteger(entry.gen) || (entry.gen as number) < 0) {
        fail(`edits["${branchId}"] entries need an integer "gen"`);
      }
      if (!Array.isArray(entry.ops)) fail(`edits["${branchId}"] entry at gen ${entry.gen as number} needs an "ops" array`);
      for (const op of entry.ops as unknown[]) {
        if (!isPlainObject(op) || op.kind !== 'set') fail(`edits["${branchId}"] op.kind must be "set"`);
        checkEditOpCells(op.cells, `edits["${branchId}"] op`);
      }
    }
  }
}

function checkV2Edits(edits: unknown): asserts edits is PersistedDocV2['edits'] {
  if (!isPlainObject(edits)) fail('"edits" must be an object keyed by branch id');
  for (const [branchId, list] of Object.entries(edits)) {
    if (!Array.isArray(list)) fail(`edits["${branchId}"] must be an array`);
    for (const entry of list) {
      if (!isPlainObject(entry) || !Number.isInteger(entry.g) || (entry.g as number) < 0) {
        fail(`edits["${branchId}"] entries need an integer "g"`);
      }
      if (!Array.isArray(entry.c) || !entry.c.every((n) => typeof n === 'number' && Number.isInteger(n))) {
        fail(`edits["${branchId}"] entry at gen ${entry.g as number} needs an integer array "c"`);
      }
    }
  }
}

function checkCommon(raw: Record<string, unknown>): void {
  if (typeof raw.title !== 'string') fail('"title" must be a string');
  if (typeof raw.createdAt !== 'number') fail('"createdAt" must be a number');
  checkSpec(raw.spec);
  if (typeof raw.seed !== 'number' && typeof raw.seed !== 'string') fail('"seed" must be a number or string');
  if (typeof raw.density !== 'number' || raw.density < 0 || raw.density > 1) fail('"density" must be a number in [0, 1]');
  checkBranches(raw.branches);
}

function validateV1(raw: Record<string, unknown>): PersistedDocV1 {
  checkCommon(raw);
  checkV1Edits(raw.edits);
  return raw as unknown as PersistedDocV1;
}

function validateV2(raw: Record<string, unknown>): PersistedDocV2 {
  checkCommon(raw);
  checkV2Edits(raw.edits);
  if (typeof raw.activeBranch !== 'string') fail('"activeBranch" must be a string');
  if (raw.bookmarks !== undefined && !Array.isArray(raw.bookmarks)) fail('"bookmarks" must be an array');
  if (raw.discoveries !== undefined && !Array.isArray(raw.discoveries)) fail('"discoveries" must be an array');
  return raw as unknown as PersistedDocV2;
}

function checkRuleField(raw: Record<string, unknown>): void {
  if (typeof raw.rule !== 'string') fail('"rule" must be a string');
  try {
    parseRule(raw.rule as string);
  } catch (err) {
    fail(`"rule" ${(err as Error).message}`);
  }
}

function validateV3(raw: Record<string, unknown>): PersistedDocV3 {
  checkCommon(raw);
  checkV2Edits(raw.edits);
  if (typeof raw.activeBranch !== 'string') fail('"activeBranch" must be a string');
  if (raw.bookmarks !== undefined && !Array.isArray(raw.bookmarks)) fail('"bookmarks" must be an array');
  if (raw.discoveries !== undefined && !Array.isArray(raw.discoveries)) fail('"discoveries" must be an array');
  checkRuleField(raw);
  return raw as unknown as PersistedDocV3;
}

function packV1Edits(edits: PersistedDocV1['edits'], width: number, height: number): PersistedDocV2['edits'] {
  const out: PersistedDocV2['edits'] = {};
  for (const [branchId, list] of Object.entries(edits)) {
    out[branchId] = list.map((entry) => ({
      g: entry.gen,
      c: entry.ops.flatMap((op) => packCells(op.cells, width, height)),
    }));
  }
  return out;
}

function migrateV1toV2(v1: PersistedDocV1): PersistedDocV2 {
  return {
    version: 2,
    title: v1.title,
    createdAt: v1.createdAt,
    spec: v1.spec,
    seed: v1.seed,
    density: v1.density,
    activeBranch: v1.branches[0]?.id ?? 'root',
    branches: v1.branches,
    edits: packV1Edits(v1.edits, v1.spec.width, v1.spec.height),
    view: v1.view,
    lens: 'life',
    bookmarks: [],
    discoveries: [],
    notes: v1.notes,
  };
}

/** v2 predates rule generalisation entirely — the only rule that ever existed then was Conway's, so migration is unambiguous. */
function migrateV2toV3(v2: PersistedDocV2): PersistedDocV3 {
  return { ...v2, version: 3, rule: CONWAY_RULE_STRING };
}

/** Parse + migrate an arbitrary decoded-JSON value up to the current schema. Throws descriptively. */
export function migrateToCurrent(raw: unknown): PersistedDocV3 {
  if (!isPlainObject(raw)) fail('expected a JSON object at the top level');
  const version = raw.version;
  if (version === EXPERIMENT_FORMAT_VERSION) return validateV3(raw);
  if (version === 2) return migrateV2toV3(validateV2(raw));
  if (version === 1) return migrateV2toV3(migrateV1toV2(validateV1(raw)));
  if (typeof version !== 'number' || !Number.isFinite(version)) {
    fail('missing or invalid "version" field — this file is not an AFTERLIFE experiment');
  }
  if (version > EXPERIMENT_FORMAT_VERSION) {
    fail(
      `format v${version} is newer than this build supports (v${EXPERIMENT_FORMAT_VERSION}) — ` +
        'update AFTERLIFE to open it',
    );
  }
  fail(`unknown schema version ${version}`);
}

/** Persisted → runtime document (unpack cells). */
export function decodeDoc(p: PersistedDocV3): ExperimentDoc {
  const edits: ExperimentDoc['edits'] = {};
  for (const [branchId, list] of Object.entries(p.edits)) {
    edits[branchId] = list.map((entry) => ({
      gen: entry.g,
      ops: entry.c.length > 0 ? [{ kind: 'set', cells: unpackCells(entry.c, p.spec.width) }] : [],
    }));
  }
  return {
    version: EXPERIMENT_FORMAT_VERSION,
    title: p.title,
    createdAt: p.createdAt,
    spec: p.spec,
    rule: p.rule,
    seed: p.seed,
    density: p.density,
    activeBranch: p.activeBranch,
    branches: p.branches,
    edits,
    view: p.view,
    lens: p.lens,
    bookmarks: p.bookmarks ?? [],
    discoveries: p.discoveries ?? [],
    notes: p.notes,
  };
}

/** Runtime document → persisted (pack cells, fixed key order for stable JSON). */
export function encodeDoc(doc: ExperimentDoc): PersistedDocV3 {
  const { width, height } = doc.spec;
  const branchOrder = doc.branches.map((b) => b.id);
  const editKeys = [...branchOrder, ...Object.keys(doc.edits).filter((k) => !branchOrder.includes(k)).sort()];

  const edits: PersistedDocV3['edits'] = {};
  for (const branchId of editKeys) {
    const list = doc.edits[branchId];
    if (!list) continue;
    edits[branchId] = [...list]
      .sort((a, b) => a.gen - b.gen)
      .map((entry) => ({
        g: entry.gen,
        c: entry.ops.flatMap((op) => packCells(op.cells, width, height)),
      }));
  }

  // Canonicalise, and fall back to Conway rather than writing an unvalidated
  // rule string — a defensive default, not the normal path (every ExperimentDoc
  // a live session builds always has a real `rule`, see `session.buildExperimentDoc`).
  let rule = CONWAY_RULE_STRING;
  try {
    if (doc.rule) rule = parseRule(doc.rule).rule;
  } catch {
    rule = CONWAY_RULE_STRING;
  }

  const out: PersistedDocV3 = {
    version: EXPERIMENT_FORMAT_VERSION,
    title: doc.title,
    createdAt: doc.createdAt,
    spec: doc.spec,
    rule,
    seed: doc.seed,
    density: doc.density,
    activeBranch: doc.activeBranch,
    branches: doc.branches,
    edits,
    bookmarks: doc.bookmarks ?? [],
    discoveries: doc.discoveries ?? [],
  };
  if (doc.view) out.view = doc.view;
  if (doc.lens) out.lens = doc.lens;
  if (doc.notes !== undefined) out.notes = doc.notes;
  return out;
}
