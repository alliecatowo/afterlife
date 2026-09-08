/**
 * The multiplayer room UI: host/join, peer presence, connection + stall +
 * desync status, and an obvious way to leave. Purely presentational against
 * `useMultiplayerStore` (`./store.ts`) — all the actual networking lives in
 * `@/net/**`. See DESIGN.md for the component vocabulary this is built from.
 */
import { useState } from 'react';
import { Button, Field, Toggle } from '@/ui/primitives';
import { ClockIcon, WarningIcon } from '@/ui/icons';
import { useMultiplayerStore } from './store';
import { PeerGlyph } from './PeerGlyph';
import { colorForRole, shapeForPeerIndex } from './colors';

function StatusLabel({ status }: { status: string }) {
  const label: Record<string, string> = {
    idle: 'Idle',
    connecting: 'Connecting…',
    open: 'Connected',
    reconnecting: 'Reconnecting…',
    closed: 'Disconnected',
    unavailable: 'Unavailable',
    error: 'Connection error',
  };
  return <span className="text-xs text-ivory-300">{label[status] ?? status}</span>;
}

function HostJoinForm() {
  const { localName, transportKind, relayUrl, error, setLocalName, setTransportKind, setRelayUrl, hostRoom, joinRoom } =
    useMultiplayerStore();
  const [joinCode, setJoinCode] = useState('');

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-ivory-300">
        Play the same universe with someone else, live. Nothing here runs until you host or join — see{' '}
        <span className="text-ivory-200">docs/MULTIPLAYER.md</span> for how it works.
      </p>

      <Field label="Your name" htmlFor="mp-name">
        <input
          id="mp-name"
          type="text"
          value={localName}
          onChange={(e) => setLocalName(e.target.value)}
          maxLength={24}
          className="h-9 rounded-sm border border-line bg-ink-800 px-3 text-sm text-ivory-100 outline-none focus-visible:focus-ring"
        />
      </Field>

      <Field label="Connect via" htmlFor="mp-transport">
        <Toggle
          aria-label="Connection method"
          value={transportKind}
          onChange={(v) => setTransportKind(v)}
          options={[
            { value: 'local', label: 'This browser' },
            { value: 'relay', label: 'Relay server' },
          ]}
        />
      </Field>

      {transportKind === 'relay' ? (
        <Field label="Relay URL" htmlFor="mp-relay" description="wss:// address of a relay — see docs/MULTIPLAYER.md.">
          <input
            id="mp-relay"
            type="text"
            value={relayUrl}
            onChange={(e) => setRelayUrl(e.target.value)}
            placeholder="wss://your-relay.example.com/room"
            className="h-9 rounded-sm border border-line bg-ink-800 px-3 text-sm text-ivory-100 outline-none focus-visible:focus-ring"
          />
        </Field>
      ) : (
        <p className="text-xs text-ivory-300">
          "This browser" uses <span className="text-ivory-200">BroadcastChannel</span> — open this app in another tab
          and join with the same room code. No server, no account.
        </p>
      )}

      {error ? (
        <p role="alert" className="flex items-center gap-1.5 text-xs text-accent-warn">
          <WarningIcon /> {error}
        </p>
      ) : null}

      <div className="flex flex-col gap-2 border-t border-line pt-3">
        <Button variant="solid" size="md" onClick={hostRoom}>
          Host a new room
        </Button>
        <div className="flex gap-2">
          <input
            aria-label="Room code"
            type="text"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            placeholder="ROOM CODE"
            maxLength={8}
            className="h-9 w-full rounded-sm border border-line bg-ink-800 px-3 text-sm uppercase tracking-[0.1em] text-ivory-100 outline-none focus-visible:focus-ring"
          />
          <Button variant="ghost" size="md" onClick={() => joinRoom(joinCode)} disabled={!joinCode.trim()}>
            Join
          </Button>
        </div>
      </div>
    </div>
  );
}

function PeerRow({ name, index, gen, stalledMs }: { name: string; index: number; gen: number; stalledMs?: number }) {
  const color = colorForRole('remote');
  const shape = shapeForPeerIndex(index);
  return (
    <li className="flex items-center gap-2 py-1 text-sm text-ivory-200">
      <PeerGlyph shape={shape} color={color} />
      <span className="flex-1 truncate">{name}</span>
      <span className="tabular text-xs text-ivory-300">gen {gen}</span>
      {stalledMs !== undefined ? (
        <span className="flex items-center gap-1 text-xs text-accent-warn" title={`No update for ${(stalledMs / 1000).toFixed(1)}s`}>
          <ClockIcon width={12} height={12} /> waiting
        </span>
      ) : null}
    </li>
  );
}

function RoomView() {
  const { roomCode, localName, peers, stall, desync, transportStatus, leaveRoom, requestResync, dismissDesync } = useMultiplayerStore();
  const [copied, setCopied] = useState(false);

  const copyCode = (): void => {
    if (!roomCode) return;
    void navigator.clipboard?.writeText(roomCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const stallByPeer = new Map((stall ?? []).map((s) => [s.peerId, s.stalledMs]));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <span className="text-micro uppercase tracking-[0.18em] text-ivory-300">Room code</span>
          <p className="tabular display-face-tight text-lg text-ivory-100">{roomCode}</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusLabel status={transportStatus} />
          <Button variant="ghost" size="sm" onClick={copyCode}>
            {copied ? 'Copied' : 'Copy code'}
          </Button>
        </div>
      </div>

      {stall && stall.length > 0 ? (
        <p role="status" className="flex items-center gap-1.5 rounded-sm border border-line bg-ink-800 px-3 py-2 text-xs text-accent-warn">
          <ClockIcon width={14} height={14} /> Waiting for {stall.length} peer{stall.length > 1 ? 's' : ''} to catch up — the world
          is paused at the shared boundary, not diverging.
        </p>
      ) : null}

      {desync ? (
        <div role="alert" className="flex flex-col gap-2 rounded-sm border border-line-strong bg-ink-800 px-3 py-2">
          <p className="flex items-center gap-1.5 text-xs text-accent-warn">
            <WarningIcon width={14} height={14} /> Desync detected at generation {desync.gen} against a peer. Worlds have
            diverged.
          </p>
          <div className="flex gap-2">
            <Button variant="solid" size="sm" onClick={requestResync}>
              Resync now
            </Button>
            <Button variant="quiet" size="sm" onClick={dismissDesync}>
              Dismiss
            </Button>
          </div>
        </div>
      ) : null}

      <div>
        <span className="text-micro uppercase tracking-[0.18em] text-ivory-300">Peers</span>
        <ul className="mt-1">
          <li className="flex items-center gap-2 py-1 text-sm text-ivory-100">
            <PeerGlyph shape="circle" color={colorForRole('local')} />
            <span className="flex-1 truncate">{localName} (you)</span>
          </li>
          {peers.map((p, i) => (
            <PeerRow key={p.peerId} name={p.name} index={i} gen={p.gen} stalledMs={stallByPeer.get(p.peerId)} />
          ))}
          {peers.length === 0 ? <li className="py-1 text-xs text-ivory-300">Waiting for someone to join…</li> : null}
        </ul>
      </div>

      <div className="border-t border-line pt-3">
        <Button variant="ghost" size="md" onClick={leaveRoom} className="w-full">
          Leave room
        </Button>
      </div>
    </div>
  );
}

export function MultiplayerPanel() {
  const phase = useMultiplayerStore((s) => s.phase);
  if (phase === 'offline') return <HostJoinForm />;
  return <RoomView />;
}
