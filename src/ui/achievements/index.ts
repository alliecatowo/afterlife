/**
 * ACHIEVEMENTS — public entry point.
 *
 * `src/ui/App.tsx`/`src/ui/hud/**`/`src/ui/panels/**` are the mobile agent's
 * territory for this task (see the tour work's own task brief), so — same
 * reasoning `@/ui/cinematic/index.ts` already documents for its own overlay
 * — this mounts itself into a small, self-created DOM root appended to
 * `document.body` rather than threading a HUD icon through `Hud.tsx`. A
 * small quiet tab (bottom-right, above the timeline band, styled like
 * `WorldHint`'s own restrained register) opens the logbook; the 'l'
 * shortcut does the same, guarded by the same `shouldIgnoreGlobalShortcut`
 * every other global shortcut in the app uses. See `INTEGRATION-NOTES.md`
 * for the (not required, purely nicer-later) HUD icon this would prefer.
 *
 * `initAchievements()` also has the side effect of importing `./store`,
 * which is what actually wires the real bus/session listeners that earn
 * entries — importing this module is the one and only thing anything else
 * needs to do to turn the whole feature on. Idempotent, same discipline as
 * `initSession()`/`initCinematic()`: a second call is a no-op.
 */
import { createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { shouldIgnoreGlobalShortcut } from '@/interact/globalShortcutGuard';
import { AchievementsPanel } from './AchievementsPanel';
import './store';

const HOST_ID = 'achievements-host';
let initialized = false;

function Root() {
  const [open, setOpen] = useState(false);
  return createElement(
    'div',
    null,
    createElement(
      'button',
      {
        type: 'button',
        'aria-label': 'Logbook',
        onClick: () => setOpen(true),
        className:
          'fixed bottom-[calc(var(--size-timeline)_+_env(safe-area-inset-bottom)_+_12px)] right-3 z-[var(--z-chrome)] ' +
          'rounded-sm border border-line bg-ink-800/80 px-2.5 py-1 text-micro uppercase tracking-[0.18em] text-ivory-300 ' +
          'transition-colors duration-[var(--duration-instant)] ease-[var(--ease-standard)] ' +
          'hover:bg-ink-700 hover:text-ivory-100 focus-visible:focus-ring outline-none',
      },
      'Logbook',
    ),
    createElement(AchievementsPanel, { open, onOpenChange: setOpen }),
  );
}

export function initAchievements(): void {
  if (initialized) return;
  initialized = true;

  const host = document.createElement('div');
  host.id = HOST_ID;
  document.body.appendChild(host);
  createRoot(host).render(createElement(Root));

  window.addEventListener('keydown', (e) => {
    if (shouldIgnoreGlobalShortcut(e.target, e.key)) return;
    if (e.key.toLowerCase() === 'l') {
      host.querySelector('button')?.click();
    }
  });
}
