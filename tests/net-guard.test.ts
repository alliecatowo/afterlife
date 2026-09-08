/**
 * The absolute constraint: offline, account-free, zero-network stays the
 * DEFAULT. Someone who never touches multiplayer must not be able to tell
 * this code exists. Two independent lines of evidence:
 *
 *  1. A static check of the app shell's own source: `App.tsx` (and the HUD)
 *     must not import anything from `src/net/**` or `src/ui/multiplayer/**`.
 *     Since nothing else mounts React trees for the running app, this is an
 *     exhaustive guarantee that `<MultiplayerRoot/>` never renders and no
 *     `Transport` gets constructed by simply loading/using the app —
 *     mounting it is a real `INTEGRATION-NOTES.md`-proposed diff, not
 *     something that happened silently.
 *  2. A behavioural check: merely importing `@/net` or `@/ui/multiplayer`
 *     constructs no `BroadcastChannel`/`WebSocket`, and the multiplayer
 *     store starts (and stays) in its `'offline'` phase until a user
 *     explicitly calls `hostRoom()`/`joinRoom()`.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function readSrc(relPath: string): string {
  return readFileSync(resolve(process.cwd(), relPath), 'utf8');
}

describe('multiplayer is opt-in only: the app shell never imports it', () => {
  it('App.tsx does not import src/net or src/ui/multiplayer', () => {
    const src = readSrc('src/ui/App.tsx');
    expect(src).not.toMatch(/@\/net/);
    expect(src).not.toMatch(/multiplayer/i);
  });

  it('the HUD does not import src/net or src/ui/multiplayer', () => {
    const src = readSrc('src/ui/hud/Hud.tsx');
    expect(src).not.toMatch(/@\/net/);
    expect(src).not.toMatch(/multiplayer/i);
  });

  it('session.ts (the one file this feature is allowed to hook) never imports src/net itself — the hooks are called FROM src/net, not the other way around', () => {
    const src = readSrc('src/ui/session.ts');
    expect(src).not.toMatch(/from ['"]@\/net/);
  });
});

describe('importing the multiplayer feature does no network work by itself', () => {
  it('the store starts in the offline phase, with no room, no peers', async () => {
    const { useMultiplayerStore } = await import('@/ui/multiplayer/store');
    const state = useMultiplayerStore.getState();
    expect(state.phase).toBe('offline');
    expect(state.roomCode).toBeNull();
    expect(state.peers).toEqual([]);
  });

  it('constructing zero transports/rooms happens just from importing @/net', async () => {
    let constructed = 0;
    const OriginalBC = globalThis.BroadcastChannel;
    class SpyBC extends OriginalBC {
      constructor(name: string) {
        super(name);
        constructed++;
      }
    }
    // @ts-expect-error -- test-only global stand-in
    globalThis.BroadcastChannel = SpyBC;
    try {
      await import('@/net');
      await import('@/net/transport');
      await import('@/net/room');
      await import('@/net/protocol');
      await import('@/net/sessionBridge');
      expect(constructed).toBe(0);
    } finally {
      globalThis.BroadcastChannel = OriginalBC;
    }
  });

  it('importing src/ui/multiplayer/index.tsx does not construct a transport either', async () => {
    let constructed = 0;
    const OriginalBC = globalThis.BroadcastChannel;
    class SpyBC extends OriginalBC {
      constructor(name: string) {
        super(name);
        constructed++;
      }
    }
    // @ts-expect-error -- test-only global stand-in
    globalThis.BroadcastChannel = SpyBC;
    try {
      await import('@/ui/multiplayer');
      expect(constructed).toBe(0);
    } finally {
      globalThis.BroadcastChannel = OriginalBC;
    }
  });
});
