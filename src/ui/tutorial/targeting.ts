/**
 * Resolves a `TourTarget` (see `@/content/tour`) to a live screen rect, right
 * now. Pure DOM reads — no state, cheap enough to call from any single event
 * (see `CoachMark`, which recomputes on resize/scroll/camera-move/panel-open
 * events and a short bounded settle poll during CSS transitions — never an
 * unconditional per-frame loop; see that file's doc for why).
 *
 * Deliberately reads only the PUBLIC contracts other agents already
 * guarantee: the fixed layout ids `App.tsx` documents (`#hud-top`,
 * `#drawer-left`, `#timeline`, `#world-canvas`, `#panel-right`), and
 * accessible names (`aria-label`, or the accessible text of a `role`) that
 * the app's own `e2e/` suite already relies on (e.g.
 * `getByRole('radio', { name: 'Draw' })`). No `data-tour-*` attributes are
 * threaded through other agents' components.
 */
import type { TourTarget } from '@/content/tour';
import { getSession } from '@/ui/session';

export interface TargetRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Half-width, in WORLD cells, of the patch highlighted around a `world` target's point. */
const WORLD_TARGET_HALF_EXTENT_CELLS = 2.5;

function isVisible(rect: DOMRect | TargetRect): boolean {
  return rect.width > 0 && rect.height > 0;
}

function toTargetRect(rect: DOMRect): TargetRect {
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

/** Case-sensitive exact match against `aria-label`, then trimmed text content — the same
 *  notion of "accessible name" Playwright's `getByRole(role, { name })` already uses here. */
function accessibleName(el: Element): string {
  return el.getAttribute('aria-label') ?? (el.textContent ?? '').trim();
}

function findByRole(role: string, name: string): Element | null {
  const selector = role === 'heading' ? 'h1,h2,h3,h4,h5,h6,[role="heading"]' : `[role="${role}"]`;
  const candidates = document.querySelectorAll(selector);
  for (const el of candidates) {
    if (accessibleName(el).trim() === name) return el;
  }
  return null;
}

/** Resolves a DOM-anchored target (`role`/`selector`) to the actual element
 *  it matched — used only so `CoachMark` can put an `IntersectionObserver`
 *  on the real node (to notice it appearing/disappearing) without this
 *  module threading DOM concerns any further than a single element lookup.
 *  `null` for `center`/`world` targets, which have no element of their own,
 *  and whenever nothing currently matches. */
export function resolveTourTargetElement(target: TourTarget): Element | null {
  if (target.kind === 'center' || target.kind === 'world') return null;
  if (target.kind === 'role') return findByRole(target.role, target.name);
  for (const selector of target.selectors) {
    const el = document.querySelector(selector);
    if (el && isVisible(toTargetRect(el.getBoundingClientRect()))) return el;
  }
  // Nothing visible matched any selector — fall back to the first one that
  // exists at all (even zero-area), so a transient IntersectionObserver
  // subscription still has something concrete to watch appear.
  for (const selector of target.selectors) {
    const el = document.querySelector(selector);
    if (el) return el;
  }
  return null;
}

/** Resolves a target to its current screen rect, or `null` if it has no
 *  target (`kind: 'center'`) or nothing currently visible matches it. */
export function resolveTourTarget(target: TourTarget): TargetRect | null {
  if (target.kind === 'center') return null;

  if (target.kind === 'world') {
    const session = getSession();
    if (!session) return null;
    const p = session.renderer.worldToScreen(target.at.x, target.at.y);
    // A world target names a POINT, but the spotlight needs a real area to
    // cut a hole around — a few cells' worth, scaled by the live camera zoom
    // (`session.camera.camera.scale` is CSS px per world cell) so the
    // highlighted patch tracks pan AND zoom exactly like the thing it's
    // circling, with a screen-space floor so it's never imperceptibly small
    // at a fully zoomed-out view.
    const scale = session.camera.camera.scale;
    const half = Math.max(12, WORLD_TARGET_HALF_EXTENT_CELLS * scale);
    return { x: p.x - half, y: p.y - half, width: half * 2, height: half * 2 };
  }

  if (target.kind === 'role') {
    const el = findByRole(target.role, target.name);
    if (!el) return null;
    const rect = toTargetRect(el.getBoundingClientRect());
    return isVisible(rect) ? rect : null;
  }

  for (const selector of target.selectors) {
    const el = document.querySelector(selector);
    if (!el) continue;
    const rect = toTargetRect(el.getBoundingClientRect());
    if (isVisible(rect)) return rect;
  }
  return null;
}
