/**
 * The absolute constraint: offline, account-free, zero-network stays the
 * DEFAULT. Someone who never touches multiplayer must not be able to tell
 * this code exists in any way that costs them anything (extra network
 * fetch, connection attempt, account prompt).
 *
 * Once `<MultiplayerRoot/>` was actually mounted (see
 * `src/ui/hud/multiplayerLazy.tsx` and INTEGRATION-NOTES.md's "multiplayer
 * foundation" entry), a blanket "the word 'multiplayer' never appears in
 * `Hud.tsx`" check stopped being the right test — the whole point of
 * mounting the feature is that a real, honestly-labelled "Multiplayer"
 * button now exists there. What still must be true, and what this file now
 * proves with three independent lines of evidence:
 *
 *  1. STATIC: `App.tsx` and the HUD (`Hud.tsx`, `HudMoreSheet.tsx`) never
 *     contain a STATIC `import ... from '@/net'` or
 *     `import ... from '@/ui/multiplayer'` — only `@/ui/hud/multiplayerLazy`,
 *     which itself reaches either only through a dynamic `import()`. This is
 *     what keeps `@/net`/`@/ui/multiplayer` out of the app's initial JS
 *     bundle graph: nothing about loading the app fetches that code.
 *  2. The lazy loader's OWN source: no static import of `@/net` or
 *     `@/ui/multiplayer`, and a real dynamic `import('@/ui/multiplayer')`
 *     call as the only path to either.
 *  3. BEHAVIOURAL: merely importing `@/net` or `@/ui/multiplayer` (however
 *     it's reached) constructs no `BroadcastChannel`/`WebSocket`, the
 *     multiplayer store starts (and stays) in its `'offline'` phase, AND —
 *     the property that actually matters to a solo player — mounting
 *     `MultiplayerLazyHost` (exactly as `App.tsx` does) and never calling
 *     `requestMultiplayer()` renders nothing and touches neither module.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render } from '@testing-library/react';

function readSrc(relPath: string): string {
  return readFileSync(resolve(process.cwd(), relPath), 'utf8');
}

/** True if `src` has a top-level static import whose source specifier
 *  starts with `prefix` — deliberately NOT matching a dynamic `import(...)`
 *  call, a comment, or a string that merely mentions the path. */
function hasStaticImportFrom(src: string, prefix: string): boolean {
  const re = /^\s*import\s+[^;]*?from\s+['"]([^'"]+)['"]/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m[1]!.startsWith(prefix)) return true;
  }
  return false;
}

afterEach(() => {
  cleanup();
});

describe('multiplayer is opt-in only: the app shell never eagerly imports it', () => {
  it('App.tsx has no static import of @/net or @/ui/multiplayer', () => {
    const src = readSrc('src/ui/App.tsx');
    expect(hasStaticImportFrom(src, '@/net')).toBe(false);
    expect(hasStaticImportFrom(src, '@/ui/multiplayer')).toBe(false);
  });

  it('Hud.tsx and HudMoreSheet.tsx have no static import of @/net or @/ui/multiplayer', () => {
    for (const file of ['src/ui/hud/Hud.tsx', 'src/ui/hud/HudMoreSheet.tsx']) {
      const src = readSrc(file);
      expect(hasStaticImportFrom(src, '@/net'), `${file} statically imports @/net`).toBe(false);
      expect(hasStaticImportFrom(src, '@/ui/multiplayer'), `${file} statically imports @/ui/multiplayer`).toBe(false);
    }
  });

  it('the lazy loader (the one sanctioned seam) never statically imports either — only a real dynamic import()', () => {
    const src = readSrc('src/ui/hud/multiplayerLazy.tsx');
    expect(hasStaticImportFrom(src, '@/net')).toBe(false);
    expect(hasStaticImportFrom(src, '@/ui/multiplayer')).toBe(false);
    expect(src).toMatch(/import\(\s*['"]@\/ui\/multiplayer['"]\s*\)/);
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
    expect(state.panelOpen).toBe(false);
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
    globalThis.BroadcastChannel = SpyBC;
    try {
      await import('@/ui/multiplayer');
      expect(constructed).toBe(0);
    } finally {
      globalThis.BroadcastChannel = OriginalBC;
    }
  });

  it('mounting MultiplayerLazyHost (as App.tsx does, unconditionally) renders nothing and constructs no transport until requestMultiplayer() is called', async () => {
    let constructed = 0;
    const OriginalBC = globalThis.BroadcastChannel;
    class SpyBC extends OriginalBC {
      constructor(name: string) {
        super(name);
        constructed++;
      }
    }
    globalThis.BroadcastChannel = SpyBC;
    try {
      const { MultiplayerLazyHost } = await import('@/ui/hud/multiplayerLazy');
      const { container } = render(<MultiplayerLazyHost />);
      // Nothing at all — not even a hidden trigger — is in the DOM yet.
      expect(container.innerHTML).toBe('');
      expect(constructed).toBe(0);
    } finally {
      globalThis.BroadcastChannel = OriginalBC;
    }
  });

  it('requestMultiplayer() is the one seam that actually loads the feature, and only after being called', async () => {
    vi.resetModules();
    const { MultiplayerLazyHost, requestMultiplayer } = await import('@/ui/hud/multiplayerLazy');
    const { useMultiplayerStore } = await import('@/ui/multiplayer/store');

    const { container, findByRole } = render(<MultiplayerLazyHost />);
    expect(container.innerHTML).toBe('');

    requestMultiplayer();

    // The real, lazily-loaded multiplayer feature mounts AND opens its
    // dialog in one step — exactly what the HUD's own "Multiplayer" entry
    // points rely on (a single click opens the panel, not "click to mount,
    // click again to open").
    await findByRole('dialog', { name: 'Multiplayer' });
    expect(useMultiplayerStore.getState().panelOpen).toBe(true);
  });
});
