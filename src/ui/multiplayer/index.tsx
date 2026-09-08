/**
 * Public entry point for the multiplayer feature's UI. `<MultiplayerRoot/>`
 * is a single self-contained component: a small floating trigger button
 * plus the dialog it opens (`MultiplayerPanel`). It renders NOTHING network-
 * related and constructs no `Transport`/`LockstepRoom` on its own — those
 * only come into existence when the user presses "Host"/"Join" inside the
 * panel (see `./store.ts`).
 *
 * Mounted lazily from `App.tsx` via `@/ui/hud/multiplayerLazy`'s dynamic
 * `import()` — see that module's doc for why: `App.tsx`/`src/ui/hud/**` must
 * never statically import this feature (`tests/net-guard.test.ts`'s
 * import-graph guard), so nothing here loads until the user explicitly asks
 * for it from a HUD entry point.
 *
 * The dialog's open state lives in `useMultiplayerStore.panelOpen` (not a
 * local `useState`) specifically so that HUD entry point can open/reopen it
 * without its own reference into whatever mounted this component.
 *
 * Standalone even without any of that: any host page (or test harness — see
 * `e2e/fixtures/mp-harness.tsx`) can mount `<MultiplayerRoot/>` directly and
 * it works, fixed-positioned, with no layout coordination required.
 */
import { Dialog, IconButton } from '@/ui/primitives';
import { useMultiplayerStore } from './store';
import { MultiplayerPanel } from './MultiplayerPanel';
import { PeopleIcon } from './PeopleIcon';

export { useMultiplayerStore } from './store';
export { MultiplayerPanel } from './MultiplayerPanel';

export function MultiplayerRoot() {
  const open = useMultiplayerStore((s) => s.panelOpen);
  const setOpen = useMultiplayerStore((s) => s.setPanelOpen);
  const phase = useMultiplayerStore((s) => s.phase);
  const peerCount = useMultiplayerStore((s) => s.peers.length);
  const stalled = useMultiplayerStore((s) => (s.stall?.length ?? 0) > 0);

  const label =
    phase === 'in-room'
      ? `Multiplayer — ${peerCount + 1} in the room${stalled ? ', waiting' : ''}`
      : 'Play with others';

  return (
    <>
      <div className="fixed bottom-4 right-4 z-[var(--z-overlay)]" data-testid="multiplayer-trigger-anchor">
        <IconButton
          label={label}
          icon={<PeopleIcon />}
          variant={phase === 'in-room' ? 'solid' : 'ghost'}
          pressed={phase === 'in-room'}
          onClick={() => setOpen(true)}
          indicator={
            phase === 'in-room' ? (
              <span
                aria-hidden="true"
                className="flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-accent-branch-a px-0.5 text-[9px] font-medium text-ink-900"
              >
                {peerCount + 1}
              </span>
            ) : undefined
          }
        />
      </div>
      <Dialog open={open} onOpenChange={setOpen} title="Multiplayer" description="Local-first by default — nothing here runs until you host or join." width={420}>
        <MultiplayerPanel />
      </Dialog>
    </>
  );
}
