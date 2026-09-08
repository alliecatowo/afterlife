/**
 * Peer identity: colour + shape, always paired — DESIGN.md's accents carry
 * ONE fixed meaning each, and per the multiplayer brief the two that best
 * match "two comparable perspectives on one world" are the existing branch
 * comparison accents (`--color-accent-branch-a`/`-b`), not a new invented
 * palette. Beyond the first remote peer, additional peers are told apart by
 * SHAPE and initials/name, never by inventing more accent colours — this is
 * also what keeps every peer distinguishable without colour at all (a11y
 * requirement from the brief), e.g. for colourblind users or the CVD palette
 * mode `@/render/color.ts` already supports elsewhere in the app.
 */
export type PeerShape = 'circle' | 'square' | 'triangle' | 'diamond';

const SHAPES: readonly PeerShape[] = ['circle', 'square', 'triangle', 'diamond'];

/** `index` 0 is always the local peer (branch-a); every other peer cycles
 *  through shapes so a third/fourth peer stays distinguishable even though
 *  they share branch-b's colour with the second peer. */
export function shapeForPeerIndex(index: number): PeerShape {
  return SHAPES[index % SHAPES.length]!;
}

export function colorForRole(role: 'local' | 'remote'): string {
  return role === 'local' ? 'var(--color-accent-branch-a)' : 'var(--color-accent-branch-b)';
}

/** A short, stable label for a shape — used as the accessible description
 *  alongside the swatch so the distinction survives without colour. */
export const SHAPE_LABEL: Record<PeerShape, string> = {
  circle: 'circle',
  square: 'square',
  triangle: 'triangle',
  diamond: 'diamond',
};
