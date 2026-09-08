/**
 * Shared guard for every WINDOW-level keyboard shortcut in the app — the
 * world/camera/tool/lens shortcuts in `./input.ts`, the app-chrome shortcuts
 * in `@/ui/App.tsx` (`?`, `v`, panel/presentation `Escape`), and the
 * sculpture's `Escape`-to-close in `@/sculpture/SculptureApp.tsx`. A global
 * shortcut must never fire while:
 *
 *  - the user is typing into a text field (`isTypingTarget`), or
 *  - focus is trapped inside an open dialog OR menu. Radix only renders a
 *    `role="dialog"`/`role="menu"` element while that dialog/menu is open
 *    (unmounted otherwise, absent `forceMount`), so checking for either's
 *    presence anywhere in the document is equivalent to "is ANY dialog or
 *    menu currently open" — generically, for every one that exists today or
 *    gets added later, with no dependency on a specific piece of UI state.
 *    The menu half of this matters for exactly the reason the dialog half
 *    always did: a Radix `DropdownMenu`'s own type-ahead (jump to the item
 *    starting with the letter just pressed) does not stop the same keydown
 *    from bubbling to `window` — without this, opening the HUD's render-lens
 *    menu (`@/ui/hud/Hud.tsx`) and pressing "v" to type-ahead to "Velocity"
 *    also fired the app's global `v` (toggle presentation mode) shortcut
 *    underneath it, or
 *  - the focused element would consume this exact key itself: a button/link
 *    activating on Space/Enter, or a Radix roving-focus widget (ToggleGroup's
 *    `radiogroup`/`toolbar`, Slider's `slider`) consuming arrow keys/Home/End
 *    to move its own selection.
 *
 * Without the last check, Radix's own `preventDefault()` on those keys only
 * stops the BROWSER's default action (e.g. page scroll) — it does not stop
 * propagation, so a focused Toggle/Slider's arrow-key navigation would also
 * pan the world camera underneath it, and Space on any focused button would
 * also toggle playback underneath it, every time.
 */

export function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

export function isDialogOpen(): boolean {
  return document.querySelector('[role="dialog"]') !== null;
}

/** Same reasoning as `isDialogOpen`, for Radix `DropdownMenu`/`ContextMenu`
 *  content (`role="menu"`) — see this module's doc for why type-ahead alone
 *  isn't enough to make an open menu safe from global single-key shortcuts. */
export function isMenuOpen(): boolean {
  return document.querySelector('[role="menu"]') !== null;
}

const ARROW_AND_EDGE_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']);
const ROVING_FOCUS_ROLES = new Set(['slider', 'radio', 'radiogroup', 'toolbar', 'tab', 'tablist', 'menuitem']);

/** True if the focused/target element already handles this exact key itself. */
export function targetConsumesKey(target: EventTarget | null, key: string): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if ((key === ' ' || key === 'Enter') && /^(button|a)$/i.test(target.tagName)) return true;
  if (ARROW_AND_EDGE_KEYS.has(key)) {
    const role = target.getAttribute('role') ?? target.closest('[role]')?.getAttribute('role');
    if (role && ROVING_FOCUS_ROLES.has(role)) return true;
  }
  return false;
}

/** The single check every window-level shortcut handler should bail out on. */
export function shouldIgnoreGlobalShortcut(target: EventTarget | null, key: string): boolean {
  return isTypingTarget(target) || isDialogOpen() || isMenuOpen() || targetConsumesKey(target, key);
}
