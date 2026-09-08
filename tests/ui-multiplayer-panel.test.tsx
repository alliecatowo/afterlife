/**
 * `MultiplayerPanel` exercised as a presentational component against
 * `useMultiplayerStore` — network behaviour itself is covered end to end in
 * `tests/net-room.test.ts`/`tests/net-lockstep.test.ts`; this file is about
 * the UI actually showing what the store says: peer presence (colour AND
 * shape, per DESIGN.md's "never colour alone" rule), the stall banner, the
 * desync banner + its resync action, and a real way back to solo play.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MultiplayerPanel } from '@/ui/multiplayer/MultiplayerPanel';
import { useMultiplayerStore } from '@/ui/multiplayer/store';

const initialState = useMultiplayerStore.getState();

afterEach(() => {
  cleanup();
  useMultiplayerStore.setState(initialState, true);
});

describe('MultiplayerPanel — offline (default) state', () => {
  it('shows the host/join form, not a network status', () => {
    render(<MultiplayerPanel />);
    expect(screen.getByLabelText('Your name')).toBeTruthy();
    expect(screen.getByText('Host a new room')).toBeTruthy();
    expect(screen.getByLabelText('Room code')).toBeTruthy();
  });

  it('disables Join until a room code is entered', () => {
    render(<MultiplayerPanel />);
    const join = screen.getByText('Join') as HTMLButtonElement;
    expect(join.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Room code'), { target: { value: 'ABC123' } });
    expect(join.disabled).toBe(false);
  });

  it('reveals the relay URL field only when "Relay server" is chosen', () => {
    render(<MultiplayerPanel />);
    expect(screen.queryByLabelText('Relay URL')).toBeNull();
    fireEvent.click(screen.getByText('Relay server'));
    expect(screen.getByLabelText('Relay URL')).toBeTruthy();
  });

  it('hosting before the session has loaded surfaces an honest error rather than hanging', () => {
    render(<MultiplayerPanel />);
    fireEvent.click(screen.getByText('Host a new room'));
    expect(screen.getByRole('alert').textContent).toMatch(/still loading/i);
  });
});

describe('MultiplayerPanel — in a room', () => {
  it('shows the room code, "you", and every peer with a distinct shape (not colour alone)', () => {
    useMultiplayerStore.setState({
      phase: 'in-room',
      roomCode: 'ABC123',
      localName: 'Alice',
      peers: [
        { peerId: 'p1', name: 'Bob', color: 'x', gen: 10, lastSeen: Date.now() },
        { peerId: 'p2', name: 'Carol', color: 'y', gen: 12, lastSeen: Date.now() },
      ],
      transportStatus: 'open',
    });
    render(<MultiplayerPanel />);
    expect(screen.getByText('ABC123')).toBeTruthy();
    expect(screen.getByText('Alice (you)')).toBeTruthy();
    expect(screen.getByText('Bob')).toBeTruthy();
    expect(screen.getByText('Carol')).toBeTruthy();
    // Every peer glyph carries an accessible shape name (<title>), not just a fill colour.
    const shapes = document.querySelectorAll('title');
    const shapeNames = [...shapes].map((s) => s.textContent);
    expect(new Set(shapeNames).size).toBeGreaterThan(1); // Bob and Carol get DIFFERENT shapes
  });

  it('shows a stall banner naming who the room is waiting on', () => {
    useMultiplayerStore.setState({
      phase: 'in-room',
      roomCode: 'ABC123',
      peers: [{ peerId: 'p1', name: 'Bob', color: 'x', gen: 1, lastSeen: Date.now() }],
      stall: [{ peerId: 'p1', stalledMs: 4200 }],
      transportStatus: 'open',
    });
    render(<MultiplayerPanel />);
    expect(screen.getByRole('status').textContent).toMatch(/waiting/i);
  });

  it('shows a desync banner with a working Resync action', () => {
    let resynced = false;
    const originalRequestResync = useMultiplayerStore.getState().requestResync;
    useMultiplayerStore.setState({
      phase: 'in-room',
      roomCode: 'ABC123',
      desync: { gen: 128, fromPeer: 'p1' },
      transportStatus: 'open',
      requestResync: () => {
        resynced = true;
        originalRequestResync();
      },
    });
    render(<MultiplayerPanel />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/desync/i);
    expect(alert.textContent).toMatch(/128/);
    fireEvent.click(screen.getByText('Resync now'));
    expect(resynced).toBe(true);
  });

  it('leaving returns to the offline host/join form', () => {
    let left = false;
    useMultiplayerStore.setState({
      phase: 'in-room',
      roomCode: 'ABC123',
      leaveRoom: () => {
        left = true;
        useMultiplayerStore.setState({ phase: 'offline', roomCode: null, peers: [] });
      },
    });
    render(<MultiplayerPanel />);
    fireEvent.click(screen.getByText('Leave room'));
    expect(left).toBe(true);
    expect(screen.getByText('Host a new room')).toBeTruthy();
  });
});
