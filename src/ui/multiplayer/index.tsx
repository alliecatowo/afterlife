/**
 * Public entry point for the multiplayer feature's UI. `<MultiplayerRoot/>`
 * is a single self-contained component: a small floating trigger button
 * plus the dialog it opens (`MultiplayerPanel`). It renders NOTHING network-
 * related and constructs no `Transport`/`LockstepRoom` on its own — those
 * only come into existence when the user presses "Host"/"Join" inside the
 * panel (see `./store.ts`).
 *
 * Not wired into `App.tsx` by this pass — see `INTEGRATION-NOTES.md` for the
 * exact one-line diff to mount it (and the alternative HUD-icon placement
 * that would match `Hud.tsx`'s existing Achievements/Cinematic/About icons
 * more closely). Until that diff is applied, this component is simply never
 * imported by the running app, which is exactly why
 * `tests/net-guard.test.ts` can assert "no multiplayer UI is present" for
 * anyone who never touches this feature.
 *
 * Standalone even without that diff: any host page (or test harness — see
 * `e2e/fixtures/mp-harness.tsx`) can mount `<MultiplayerRoot/>` directly and
 * it works, fixed-positioned, with no layout coordination required.
 */
import { useState } from 'react';
import { Dialog, IconButton } from '@/ui/primitives';
import { useMultiplayerStore } from './store';
import { MultiplayerPanel } from './MultiplayerPanel';
import { PeopleIcon } from './PeopleIcon';

export { useMultiplayerStore } from './store';
export { MultiplayerPanel } from './MultiplayerPanel';

export function MultiplayerRoot() {
  const [open, setOpen] = useState(false);
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
