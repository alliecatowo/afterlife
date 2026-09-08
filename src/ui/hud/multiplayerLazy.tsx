/**
 * Mounting glue for the opt-in multiplayer feature (`src/net/**`,
 * `src/ui/multiplayer/**`, built by the `netplay` agent — see
 * `INTEGRATION-NOTES.md`'s "multiplayer foundation" entry). `<MultiplayerRoot/>`
 * is fully functional but was never wired into the running app because
 * `App.tsx`/`src/ui/hud/**` must never statically import `@/net` or
 * `@/ui/multiplayer` — see `tests/net-guard.test.ts`'s import-graph guard.
 *
 * That guard exists to prove a real product guarantee, not just a lint rule:
 * solo play stays account-free and network-free — no connection attempt, no
 * peer discovery, no `BroadcastChannel`/`WebSocket` construction — unless the
 * user explicitly opts in. A STATIC import would pull `@/net` into the main
 * bundle and, depending on what runs at module-eval time, risk doing exactly
 * that on every page load. This module is the one deliberate seam: the ONLY
 * place in `src/ui/hud/**`/`src/ui/App.tsx` that ever mentions
 * `@/ui/multiplayer`, and it only ever reaches it through a dynamic
 * `import()` — never a static one — and only from inside `requestMultiplayer()`,
 * which itself only ever runs from an explicit click handler (see
 * `Hud.tsx`'s "More tools" menu and `HudMoreSheet.tsx`'s "More" section).
 *
 * `<MultiplayerLazyHost/>` is mounted once, unconditionally, in `App.tsx`
 * (same spot `ShortcutsDialog`/`AboutDialog`/`AchievementsPanel` live) — it
 * renders nothing at all until `requestMultiplayer()` has been called at
 * least once, so the multiplayer code (and its `@/net` dependency) is never
 * even fetched, let alone executed, for a user who never touches this
 * feature. `tests/net-guard.test.ts` proves both halves: the static
 * import-graph check on this file's own source, and a behavioural check
 * that mounting `<MultiplayerLazyHost/>` and NOT calling `requestMultiplayer()`
 * does no network-adjacent work.
 */
import { Suspense, lazy, useSyncExternalStore } from 'react';

let requested = false;
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function getSnapshot(): boolean {
  return requested;
}

// A dynamic import — the one, deliberate seam described above. Vite code-
// splits this into its own chunk, so it is never fetched over the network
// until this factory actually runs (i.e. until `<LazyMultiplayerRoot/>` is
// first rendered, which only happens after `requestMultiplayer()` flips
// `requested` to `true`).
const LazyMultiplayerRoot = lazy(() =>
  import('@/ui/multiplayer').then((m) => ({ default: m.MultiplayerRoot })),
);

/**
 * Call from any click handler that means "the user just asked to see
 * multiplayer" (a HUD icon, a sheet row, ...). Idempotent for the mount
 * itself; safe to call again on a later click (e.g. reopening after
 * closing the dialog) — the module is already loaded by then, so this just
 * flips `useMultiplayerStore`'s `panelOpen` back to `true` via the loaded
 * module's own store, with no re-fetch and no duplicate mount.
 */
export function requestMultiplayer(): void {
  if (!requested) {
    requested = true;
    notify();
  }
  void import('@/ui/multiplayer').then((m) => {
    m.useMultiplayerStore.getState().setPanelOpen(true);
  });
}

/** Mount once near the app root. Renders nothing until the first
 *  `requestMultiplayer()` call anywhere in the app. */
export function MultiplayerLazyHost() {
  const on = useSyncExternalStore(subscribe, getSnapshot, () => false);
  if (!on) return null;
  return (
    <Suspense fallback={null}>
      <LazyMultiplayerRoot />
    </Suspense>
  );
}
