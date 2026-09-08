/**
 * ACHIEVEMENTS — public entry point.
 *
 * Originally self-mounted into its own DOM root (a floating "Logbook" tab)
 * because `App.tsx`/`Hud.tsx`/`panels/**` were a concurrent mobile-layout
 * pass's territory at the time this was built — see INTEGRATION-NOTES.md's
 * achievements entries. That constraint is gone: this integration pass has
 * full write access to every file, and the floating tab had a real, reported
 * problem (it could overlap the cinematic overlay's own bottom bar at narrow
 * widths). Relocated to a proper HUD icon button (`Hud.tsx`, and the mobile
 * `HudMoreSheet.tsx`), exactly like `About`/`Cinematic mode`'s own entries.
 *
 * `initAchievements()` still exists and is still the one thing anything
 * needs to call: it has the side effect of importing `./store`, which wires
 * the real bus/session listeners that earn entries. Idempotent — a second
 * call is a no-op, same discipline as `initSession()`/`initCinematic()`. The
 * 'l' keyboard shortcut (documented in `ShortcutsDialog.tsx`) is wired here
 * too, guarded by the same `shouldIgnoreGlobalShortcut` every other global
 * shortcut in the app uses, toggling the SAME `useUIState.logbookOpen` flag
 * the HUD button does — one source of truth for "is the logbook open,"
 * reachable two ways.
 */
import { shouldIgnoreGlobalShortcut } from '@/interact/globalShortcutGuard';
import { useUIState } from '@/ui/uiState';
import './store';

export { AchievementsPanel } from './AchievementsPanel';

let initialized = false;

export function initAchievements(): void {
  if (initialized) return;
  initialized = true;

  window.addEventListener('keydown', (e) => {
    if (shouldIgnoreGlobalShortcut(e.target, e.key)) return;
    if (e.key.toLowerCase() === 'l') {
      useUIState.getState().setLogbookOpen(true);
    }
  });
}
