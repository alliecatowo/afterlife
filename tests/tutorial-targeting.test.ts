import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveTourTarget } from '@/ui/tutorial/targeting';

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
});
