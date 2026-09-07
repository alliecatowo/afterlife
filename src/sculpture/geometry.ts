/**
 * Pure slice -> instance-placement mapping. No three.js types here on
 * purpose: this is the part of the geometry pipeline that has to be exactly
 * right (a glider must land on a straight inclined line) and is worth
 * testing headlessly. `SculptureScene.tsx` consumes `buildInstancePlacements`
 * and writes the results into a single `InstancedMesh`'s matrices.
 *
 * Axes:
 *  - world x tracks cell x (left-right, unchanged from the flat plane).
 *  - world y is the NEGATION of cell y, because the flat renderer's cell y
 *    grows downward (row-major, y=0 is the top row) while three.js y grows
 *    upward. Negating keeps "down" reading as "down" when the camera looks
 *    face-on at the present slice, exactly like the 2D view it grew from.
 *  - world z is TIME. Slot `sliceCount - 1` (the present / toGen) sits at
 *    z = 0 — the same plane the camera was looking at before the sculpture
 *    opened. Earlier slots recede to negative z, so history extends *behind*
 *    the living plane instead of cutting to a new frame of reference.
 */
import type { Rect } from '@/core/types';

export interface PlacementOptions {
  rect: Pick<Rect, 'w' | 'h'>;
  /** World-unit size of one cell on the x/y axes. */
  cellSize: number;
  /** World-unit distance between consecutive rendered slots on the z axis. */
  spacingZ: number;
  /** Total number of rendered slots (post budget-reduction). */
  sliceCount: number;
}

/** World position of cell (x, y) at rendered slot `slot`. */
export function cellWorldPosition(x: number, y: number, slot: number, opts: PlacementOptions): [number, number, number] {
  const { rect, cellSize, spacingZ, sliceCount } = opts;
  const wx = (x - (rect.w - 1) / 2) * cellSize;
  const wy = -(y - (rect.h - 1) / 2) * cellSize;
  const wz = (slot - (sliceCount - 1)) * spacingZ;
  return [wx, wy, wz];
}

export interface InstancePlacement {
  /** World position. */
  x: number;
  y: number;
  z: number;
  /** Rendered slot this instance belongs to (0 = oldest shown, last = present). */
  slot: number;
  /** Source cell coordinates, for picking / debugging. */
  cellX: number;
  cellY: number;
}

/**
 * Flatten every live cell across `renderedSlices` (already thinned to the
 * instance budget, ascending in time) into one placement list ready to feed
 * an `InstancedMesh`. `renderedSlices[i]` is a row-major `rect.w * rect.h`
 * buffer, 1 = alive, matching `Snapshot.bits` / `sliceStack()`.
 */
export function buildInstancePlacements(
  renderedSlices: readonly Uint8Array[],
  rect: Pick<Rect, 'w' | 'h'>,
  cellSize: number,
  spacingZ: number,
): InstancePlacement[] {
  const sliceCount = renderedSlices.length;
  const out: InstancePlacement[] = [];
  const opts: PlacementOptions = { rect, cellSize, spacingZ, sliceCount };
  for (let slot = 0; slot < sliceCount; slot++) {
    const buf = renderedSlices[slot];
    for (let y = 0; y < rect.h; y++) {
      const row = y * rect.w;
      for (let x = 0; x < rect.w; x++) {
        if (buf[row + x]) {
          const [wx, wy, wz] = cellWorldPosition(x, y, slot, opts);
          out.push({ x: wx, y: wy, z: wz, slot, cellX: x, cellY: y });
        }
      }
    }
  }
  return out;
}

/** Total live-cell count of a slice buffer — used to feed `planReduction`. */
export function countLive(slice: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < slice.length; i++) n += slice[i];
  return n;
}
