/**
 * Resolves a `TourTarget` (see `@/content/tour`) to a live screen rect, right
 * now. Pure DOM reads — no state, safe to call every animation frame (see
 * `CoachMark`, which does exactly that so a coach mark stays correctly
 * anchored across resize, panel open/close, and camera motion without any
 * ResizeObserver wiring of its own).
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

/** Resolves a target to its current screen rect, or `null` if it has no
 *  target (`kind: 'center'`) or nothing currently visible matches it. */
export function resolveTourTarget(target: TourTarget): TargetRect | null {
  if (target.kind === 'center') return null;

  if (target.kind === 'world') {
    const session = getSession();
    if (!session) return null;
    const p = session.renderer.worldToScreen(target.at.x, target.at.y);
    return { x: p.x, y: p.y, width: 1, height: 1 };
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
