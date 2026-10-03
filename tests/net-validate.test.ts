import { describe, expect, it } from 'vitest';
import { MAX_CELLS_PER_EDIT, validateWireMessage } from '@/net/protocol';

const world = { width: 20, height: 10 };
const edit = (cells: unknown, over: Record<string, unknown> = {}) => ({
  type: 'edit',
  edit: { peerId: 'p', seq: 1, originGen: 3, targetGen: 15, op: { kind: 'set', cells }, ...over },
});

describe('validateWireMessage', () => {
  it('accepts a well-formed edit and strips unknown fields', () => {
    const m = validateWireMessage(edit([{ x: 19, y: 9, alive: true, extra: 1 }]), world);
    expect(m).toEqual(edit([{ x: 19, y: 9, alive: true }]));
  });

  it.each([
    ['null', null],
    ['array', []],
    ['no type', {}],
    ['unknown type', { type: 'nope' }],
    ['string', 'edit'],
  ])('rejects %s', (_n, v) => {
    expect(validateWireMessage(v, world)).toBeNull();
  });

  it.each([
    ['x out of range', [{ x: 20, y: 0, alive: true }]],
    ['y out of range', [{ x: 0, y: 10, alive: true }]],
    ['negative', [{ x: -1, y: 0, alive: true }]],
    ['fractional', [{ x: 0.5, y: 0, alive: true }]],
    ['NaN', [{ x: NaN, y: 0, alive: true }]],
    ['string coord', [{ x: '1', y: 0, alive: true }]],
    ['missing alive', [{ x: 1, y: 0 }]],
    ['cell not object', [5]],
    ['cells not array', 'x'],
  ])('rejects edit with %s', (_n, cells) => {
    expect(validateWireMessage(edit(cells), world)).toBeNull();
  });

  it('rejects oversized edits and bad generations', () => {
    const many = Array.from({ length: MAX_CELLS_PER_EDIT + 1 }, () => ({ x: 0, y: 0, alive: true }));
    expect(validateWireMessage(edit(many), world)).toBeNull();
    expect(validateWireMessage(edit([], { targetGen: -1 }), world)).toBeNull();
    expect(validateWireMessage(edit([], { targetGen: 1.5 }), world)).toBeNull();
    expect(validateWireMessage(edit([], { peerId: 7 }), world)).toBeNull();
  });

  it('validates resyncData edits element by element', () => {
    const good = (edit([{ x: 1, y: 1, alive: false }]) as { edit: unknown }).edit;
    const bad = (edit([{ x: 99, y: 1, alive: false }]) as { edit: unknown }).edit;
    expect(validateWireMessage({ type: 'resyncData', peerId: 'p', toGen: 5, edits: [good] }, world)).not.toBeNull();
    expect(validateWireMessage({ type: 'resyncData', peerId: 'p', toGen: 5, edits: [good, bad] }, world)).toBeNull();
  });

  it('checks simple messages', () => {
    expect(validateWireMessage({ type: 'heartbeat', peerId: 'p', gen: 4 }, world)).toEqual({ type: 'heartbeat', peerId: 'p', gen: 4 });
    expect(validateWireMessage({ type: 'heartbeat', peerId: 'p', gen: 'x' }, world)).toBeNull();
    expect(validateWireMessage({ type: 'leave' }, world)).toBeNull();
    expect(validateWireMessage({ type: 'hash', peerId: 'p', gen: 64, hash: 'abc' }, world)).not.toBeNull();
    expect(validateWireMessage({ type: 'resyncRequest', peerId: 'p', sinceGen: -2 }, world)).toBeNull();
  });

  it('validates hello and welcome', () => {
    const room = { code: 'ABC234', world: { width: 20, height: 10, boundary: 'torus', rule: 'B3/S23' }, seed: 1, startGen: 0, createdAt: 1 };
    expect(validateWireMessage({ type: 'hello', peerId: 'p', name: 'n', color: '#fff', gen: 0, room }, world)).not.toBeNull();
    expect(validateWireMessage({ type: 'hello', peerId: 'p', name: 'n', color: '#fff', gen: 0, room: { ...room, world: { ...room.world, boundary: 'wall' } } }, world)).toBeNull();
    expect(validateWireMessage({ type: 'welcome', peerId: 'p', peers: [{ peerId: 'q', name: 'n', color: 'c' }] }, world)).not.toBeNull();
    expect(validateWireMessage({ type: 'welcome', peerId: 'p', peers: [{ peerId: 'q' }] }, world)).toBeNull();
  });
});
