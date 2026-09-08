/**
 * UI-facing state for MIDI output — the real ports Web MIDI enumerated, the
 * user's selections, and honest support/permission status. `midi.ts` is the
 * only thing that writes to this store (it owns the actual `MIDIAccess`);
 * `AudioPanel` only reads it and calls `midi.ts`'s controller methods.
 */
import { create } from 'zustand';

export type MidiSupportState = 'unknown' | 'unsupported' | 'requesting' | 'denied' | 'granted' | 'error';

export interface MidiPortInfo {
  id: string;
  name: string;
}

interface MidiState {
  support: MidiSupportState;
  errorMessage: string | null;
  outputs: MidiPortInfo[];
  outputId: string | null;
  /** 1..16, the conventional 1-based MIDI channel numbering shown to users. */
  channel: number;
  /** Whether the soundscape currently forwards notes to the selected output. */
  enabled: boolean;
  /** Map churn/discovery/audition to distinct channels — see `midi.ts`'s
   * `channelFor()` for the exact mapping, documented in the panel. */
  mapEventClasses: boolean;
  /** Live count of notes currently held on (for the panel's readout, and to
   * make a stuck-note bug immediately visible during development). */
  activeNoteCount: number;
}

export const useMidiStore = create<MidiState>(() => ({
  support: 'unknown',
  errorMessage: null,
  outputs: [],
  outputId: null,
  channel: 1,
  enabled: false,
  mapEventClasses: false,
  activeNoteCount: 0,
}));
