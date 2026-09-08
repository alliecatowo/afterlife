import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveTourTarget, resolveTourTargetElement } from '@/ui/tutorial/targeting';
import * as sessionModule from '@/ui/session';

/** jsdom never actually lays anything out, so every element's real
 *  `getBoundingClientRect()` is always a zero rect regardless of CSS —
 *  stubbing it per-element is the standard way to test "visible vs. not"
 *  logic against jsdom. */
function stubRect(el: Element, rect: { x: number; y: number; width: number; height: number }): void {
  el.getBoundingClientRect = () =>
    ({ ...rect, top: rect.y, left: rect.x, right: rect.x + rect.width, bottom: rect.y + rect.height, toJSON() { return this; } }) as DOMRect;
}

describe('tutorial: resolveTourTarget', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('kind "center" never resolves to a rect', () => {
    expect(resolveTourTarget({ kind: 'center' })).toBeNull();
  });

  it('kind "selector" finds the first matching, visible element', () => {
    const el = document.createElement('button');
    el.setAttribute('aria-label', 'Pause');
    document.body.appendChild(el);
    stubRect(el, { x: 10, y: 20, width: 30, height: 40 });

    const rect = resolveTourTarget({ kind: 'selector', selectors: ['[aria-label="Pause"]'] });
    expect(rect).toEqual({ x: 10, y: 20, width: 30, height: 40 });
  });

  it('kind "selector" skips a zero-area (invisible) match and falls through to the next selector', () => {
    const hidden = document.createElement('div');
    hidden.setAttribute('aria-label', 'Render lens');
    document.body.appendChild(hidden);
    stubRect(hidden, { x: 0, y: 0, width: 0, height: 0 });

    const fallback = document.createElement('div');
    fallback.id = 'hud-top';
    document.body.appendChild(fallback);
    stubRect(fallback, { x: 0, y: 0, width: 1440, height: 48 });

    const rect = resolveTourTarget({ kind: 'selector', selectors: ['[aria-label="Render lens"]', '#hud-top'] });
    expect(rect).toEqual({ x: 0, y: 0, width: 1440, height: 48 });
  });

  it('kind "selector" resolves to null when nothing matches or everything is invisible', () => {
    expect(resolveTourTarget({ kind: 'selector', selectors: ['#nope'] })).toBeNull();
  });

  it('kind "role" matches a Radix-style radio item by its accessible (text) name', () => {
    const group = document.createElement('div');
    group.innerHTML = `
      <button role="radio" aria-checked="false">Draw</button>
      <button role="radio" aria-checked="false">Erase</button>
    `;
    document.body.appendChild(group);
    const draw = group.querySelector('[role="radio"]')!;
    const erase = group.querySelectorAll('[role="radio"]')[1]!;
    stubRect(draw, { x: 5, y: 5, width: 20, height: 20 });
    stubRect(erase, { x: 30, y: 5, width: 20, height: 20 });

    const rect = resolveTourTarget({ kind: 'role', role: 'radio', name: 'Draw' });
    expect(rect).toEqual({ x: 5, y: 5, width: 20, height: 20 });
  });

  it('kind "role" matches a heading by its text content (e.g. a Panel title)', () => {
    const h2 = document.createElement('h2');
    h2.textContent = 'Patterns';
    document.body.appendChild(h2);
    stubRect(h2, { x: 0, y: 100, width: 200, height: 24 });

    const rect = resolveTourTarget({ kind: 'role', role: 'heading', name: 'Patterns' });
    expect(rect).toEqual({ x: 0, y: 100, width: 200, height: 24 });
  });

  it('kind "world" resolves via the live session renderer, and is null without one', () => {
    // No session initialized in this unit-test environment (no canvases,
    // no `initSession()`) — `getSession()` returns null, so this must
    // degrade to "no target" rather than throw.
    expect(resolveTourTarget({ kind: 'world', at: { x: 123, y: 94 } })).toBeNull();
  });

  describe('kind "world" — follows the live camera transform', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    function stubSession(scale: number, screenPoint: { x: number; y: number }) {
      vi.spyOn(sessionModule, 'getSession').mockReturnValue({
        camera: { camera: { x: 0, y: 0, scale } },
        renderer: { worldToScreen: () => screenPoint },
        // Only the two properties above are read by `resolveTourTarget`.
      } as unknown as sessionModule.Session);
    }

    it('centers the cutout on the live screen projection of the world point', () => {
      stubSession(10, { x: 500, y: 300 });
      const rect = resolveTourTarget({ kind: 'world', at: { x: 40, y: 12 } })!;
      expect(rect.x + rect.width / 2).toBeCloseTo(500, 5);
      expect(rect.y + rect.height / 2).toBeCloseTo(300, 5);
    });

    it('grows with camera scale (zooming in enlarges the highlighted patch)', () => {
      stubSession(4, { x: 0, y: 0 });
      const zoomedOut = resolveTourTarget({ kind: 'world', at: { x: 0, y: 0 } })!;
      stubSession(40, { x: 0, y: 0 });
      const zoomedIn = resolveTourTarget({ kind: 'world', at: { x: 0, y: 0 } })!;
      expect(zoomedIn.width).toBeGreaterThan(zoomedOut.width);
    });

    it('has a screen-space floor so it is never imperceptibly small when fully zoomed out', () => {
      stubSession(0.1, { x: 0, y: 0 });
      const rect = resolveTourTarget({ kind: 'world', at: { x: 0, y: 0 } })!;
      expect(rect.width).toBeGreaterThanOrEqual(24);
    });
  });

  describe('resolveTourTargetElement', () => {
    it('is null for "center" and "world" targets', () => {
      expect(resolveTourTargetElement({ kind: 'center' })).toBeNull();
      expect(resolveTourTargetElement({ kind: 'world', at: { x: 1, y: 1 } })).toBeNull();
    });

    it('returns the same element resolveTourTarget used, for "selector"', () => {
      const el = document.createElement('div');
      el.id = 'hud-top';
      document.body.appendChild(el);
      stubRect(el, { x: 0, y: 0, width: 1440, height: 48 });
      expect(resolveTourTargetElement({ kind: 'selector', selectors: ['#hud-top'] })).toBe(el);
    });

    it('returns the accessible-name match for "role"', () => {
      const btn = document.createElement('button');
      btn.setAttribute('role', 'radio');
      btn.textContent = 'Draw';
      document.body.appendChild(btn);
      expect(resolveTourTargetElement({ kind: 'role', role: 'radio', name: 'Draw' })).toBe(btn);
    });
  });
});
