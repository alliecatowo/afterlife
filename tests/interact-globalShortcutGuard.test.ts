import { afterEach, describe, expect, it } from 'vitest';
import {
  isDialogOpen, isMenuOpen, isTypingTarget, shouldIgnoreGlobalShortcut, targetConsumesKey,
} from '@/interact/globalShortcutGuard';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('interact/globalShortcutGuard', () => {
  it('isTypingTarget recognises text-entry elements and nothing else', () => {
    expect(isTypingTarget(document.createElement('input'))).toBe(true);
    expect(isTypingTarget(document.createElement('textarea'))).toBe(true);
    expect(isTypingTarget(document.createElement('select'))).toBe(true);
    // `isContentEditable` itself is exercised only via real browser e2e
    // coverage, not here: jsdom's `HTMLElement.isContentEditable` isn't
    // implemented (reads back `undefined` rather than `false`, for EVERY
    // element, the same category of gap as `HTMLCanvasElement.getContext`
    // elsewhere in this suite) — `toBeFalsy` rather than `toBe(false)`
    // tolerates that without weakening what's actually being checked here
    // (a plain button must not read as a typing target).
    expect(isTypingTarget(document.createElement('button'))).toBeFalsy();
    expect(isTypingTarget(null)).toBeFalsy();
  });

  it('isDialogOpen reflects whether a role="dialog" element is anywhere in the document', () => {
    expect(isDialogOpen()).toBe(false);
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.appendChild(dialog);
    expect(isDialogOpen()).toBe(true);
  });

  it('isMenuOpen reflects whether a role="menu" element is anywhere in the document (Radix DropdownMenu content)', () => {
    expect(isMenuOpen()).toBe(false);
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    document.body.appendChild(menu);
    expect(isMenuOpen()).toBe(true);
  });

  it('targetConsumesKey lets Space/Enter through on a button/link, and arrow/edge keys through on roving-focus widgets, and nothing else', () => {
    const button = document.createElement('button');
    expect(targetConsumesKey(button, 'Enter')).toBe(true);
    expect(targetConsumesKey(button, ' ')).toBe(true);
    expect(targetConsumesKey(button, 'a')).toBe(false);

    const radio = document.createElement('div');
    radio.setAttribute('role', 'radio');
    expect(targetConsumesKey(radio, 'ArrowRight')).toBe(true);
    expect(targetConsumesKey(radio, 'Home')).toBe(true);
    expect(targetConsumesKey(radio, 'a')).toBe(false);

    const plain = document.createElement('div');
    expect(targetConsumesKey(plain, 'ArrowRight')).toBe(false);
  });

  it('shouldIgnoreGlobalShortcut is true while an open Radix menu exists, even for a key the menu itself does not visibly consume', () => {
    // The regression this guards: opening the HUD's render-lens `Menu`
    // (`@/ui/hud/Hud.tsx`) and pressing "v" to type-ahead to "Velocity"
    // used to ALSO fire `App.tsx`'s global "v" (toggle presentation mode)
    // shortcut, because Radix's own type-ahead does not stop the keydown
    // from bubbling to `window`. A plain, unfocused target with key "v"
    // must be ignored purely because a menu is open somewhere in the
    // document — the same "any open overlay wins" rule `isDialogOpen`
    // already enforced for dialogs.
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    document.body.appendChild(menu);
    const target = document.createElement('div');
    expect(shouldIgnoreGlobalShortcut(target, 'v')).toBe(true);
  });

  it('shouldIgnoreGlobalShortcut is false when no dialog/menu is open and the target does not consume the key', () => {
    const target = document.createElement('div');
    expect(shouldIgnoreGlobalShortcut(target, 'v')).toBe(false);
  });
});
