/**
 * Web MIDI output — turns the exact same `ScheduledNote`s the internal synth
 * plays into real MIDI note-on/note-off pairs on a user-chosen output port,
 * so the simulation can drive an external instrument or DAW.
 *
 * Design choices that exist specifically to avoid the classic Web MIDI bug
 * (a note-on with no matching note-off, left ringing forever on a real
 * synth):
 *  - Every `noteOn()` call schedules its own `noteOff()` via `setTimeout`
 *    at note-start; nothing here depends on being ticked again later.
 *  - Retriggering the same (channel, pitch) cancels the pending timer and
 *    sends an immediate note-off before the new note-on, so two overlapping
 *    requests can never leave one orphaned.
 *  - `allNotesOff()` (the panic control) sends both per-note note-offs for
 *    everything this module has tracked AND a CC 123 (All Notes Off) on
 *    every channel it has ever used, since some synths honour one but not
 *    the other.
 *  - `allNotesOff()` is wired to fire on mute (`audio.ts`), on disabling the
 *    output, on switching ports, on disposal, and on `pagehide`/`beforeunload`
 *    — see call sites below and in `audio.ts`.
 *
 * Never touches simulation state — this only ever reads `ScheduledNote`s
 * already produced by `SoundscapeBrain.tick()`, the same list handed to
 * `SynthGraph`, so it automatically respects the same voice cap and bucket
 * rate-limiting as the internal synth: it is fed nothing extra.
 */
import type { NoteSource, ScheduledNote } from './scheduler';
import { useMidiStore, type MidiPortInfo } from './midiStore';

const NOTE_ON = 0x90;
const NOTE_OFF = 0x80;
const CONTROL_CHANGE = 0xb0;
const ALL_NOTES_OFF_CC = 123;

interface ActiveNote {
  output: MIDIOutput;
  channel0: number; // 0-based
  pitch: number;
  timer: ReturnType<typeof setTimeout>;
}

function clampChannel(ch: number): number {
  return Math.min(16, Math.max(1, Math.round(ch)));
}

function clampVelocity(v: number): number {
  // MIDI velocity 0 is equivalent to a note-off in the spec — never send it
  // from a note-on; clamp to a minimum of 1.
  return Math.min(127, Math.max(1, Math.round(v * 127)));
}

/** Offsets applied to the base channel when "map event classes to channels"
 * is on, documented verbatim in the panel: churn on the selected channel,
 * discoveries one channel up, audition previews two channels up (wrapping
 * within 1..16). */
const SOURCE_CHANNEL_OFFSET: Record<NoteSource, number> = { churn: 0, discovery: 1, audition: 2 };

class MidiController {
  #access: MIDIAccess | null = null;
  #output: MIDIOutput | null = null;
  #active = new Map<string, ActiveNote>();
  #usedChannels0 = new Set<number>();

  private key(channel0: number, pitch: number): string {
    return `${channel0}:${pitch}`;
  }

  private setActiveCount(): void {
    useMidiStore.setState({ activeNoteCount: this.#active.size });
  }

  /** Must be called from a real user gesture (a button click in the panel).
   * `sysex` is always false — this app has no use for system-exclusive
   * messages and requesting it would trigger a scarier permission prompt for
   * no benefit. Resolves once the support/permission state is known; never
   * rejects — check `useMidiStore.getState().support` for the honest result. */
  async requestAccess(): Promise<void> {
    if (typeof navigator === 'undefined' || typeof navigator.requestMIDIAccess !== 'function') {
      useMidiStore.setState({ support: 'unsupported', errorMessage: 'This browser does not implement the Web MIDI API.' });
      return;
    }
    useMidiStore.setState({ support: 'requesting', errorMessage: null });
    try {
      const access = await navigator.requestMIDIAccess({ sysex: false });
      this.#access = access;
      access.onstatechange = () => this.refreshOutputs();
      this.refreshOutputs();
      useMidiStore.setState({ support: 'granted', errorMessage: null });
    } catch (err) {
      const denied = err instanceof DOMException && err.name === 'NotAllowedError';
      useMidiStore.setState({
        support: denied ? 'denied' : 'error',
        errorMessage: denied
          ? 'MIDI access was denied. Allow it in the browser’s site settings to enable output.'
          : `Could not access MIDI devices: ${(err as Error).message}`,
      });
    }
  }

  private refreshOutputs(): void {
    if (!this.#access) return;
    const outputs: MidiPortInfo[] = [];
    for (const output of this.#access.outputs.values()) {
      outputs.push({ id: output.id, name: output.name ?? `MIDI output ${output.id}` });
    }
    const { outputId } = useMidiStore.getState();
    // If the previously-selected port disconnected, drop it (and its notes)
    // rather than silently keep pointing at a dead port.
    if (outputId && !outputs.some((o) => o.id === outputId)) {
      this.allNotesOff();
      this.#output = null;
      useMidiStore.setState({ outputId: null });
    }
    useMidiStore.setState({ outputs });
  }

  /** Switch output ports. Always silences the PREVIOUS port first — a port
   * change is one of the moments a stuck note could otherwise be left behind
   * on hardware nobody is looking at anymore. */
  selectOutput(id: string | null): void {
    this.allNotesOff();
    this.#output = id && this.#access ? (this.#access.outputs.get(id) ?? null) : null;
    useMidiStore.setState({ outputId: this.#output?.id ?? null });
  }

  setChannel(channel: number): void {
    useMidiStore.setState({ channel: clampChannel(channel) });
  }

  setMapEventClasses(on: boolean): void {
    useMidiStore.setState({ mapEventClasses: on });
  }

  /** Enable/disable forwarding without dropping the port selection —
   * disabling always panics first, exactly like mute. */
  setEnabled(on: boolean): void {
    if (!on) this.allNotesOff();
    useMidiStore.setState({ enabled: on });
  }

  private channelFor(source: NoteSource): number {
    const { channel, mapEventClasses } = useMidiStore.getState();
    if (!mapEventClasses) return clampChannel(channel) - 1;
    const offset = SOURCE_CHANNEL_OFFSET[source];
    return (clampChannel(channel) - 1 + offset) % 16;
  }

  /**
   * Forward one scheduler tick's worth of notes. `currentTime` is the same
   * `AudioContext.currentTime` the caller used as `now` for this tick, so a
   * note whose `time` is slightly in the future is delayed by the matching
   * number of real milliseconds rather than fired immediately.
   */
  sendNotes(notes: readonly ScheduledNote[], currentTime: number): void {
    const { enabled } = useMidiStore.getState();
    if (!enabled || !this.#output) return;
    for (const note of notes) {
      const delayMs = Math.max(0, (note.time - currentTime) * 1000);
      const channel0 = this.channelFor(note.source);
      const velocity = clampVelocity(note.velocity);
      const durationMs = Math.max(20, note.duration * 1000);
      if (delayMs < 1) this.noteOn(this.#output, channel0, note.pitch, velocity, durationMs);
      else setTimeout(() => { if (this.#output) this.noteOn(this.#output!, channel0, note.pitch, velocity, durationMs); }, delayMs);
    }
  }

  private noteOn(output: MIDIOutput, channel0: number, pitch: number, velocity: number, durationMs: number): void {
    const key = this.key(channel0, pitch);
    const existing = this.#active.get(key);
    if (existing) {
      // Retrigger: cut the old note off cleanly before starting the new one
      // rather than risk two overlapping note-offs racing each other.
      clearTimeout(existing.timer);
      this.sendRaw(output, [NOTE_OFF | channel0, pitch, 0]);
      this.#active.delete(key);
    }
    this.#usedChannels0.add(channel0);
    this.sendRaw(output, [NOTE_ON | channel0, pitch, velocity]);
    const timer = setTimeout(() => {
      this.sendRaw(output, [NOTE_OFF | channel0, pitch, 0]);
      this.#active.delete(key);
      this.setActiveCount();
    }, durationMs);
    this.#active.set(key, { output, channel0, pitch, timer });
    this.setActiveCount();
  }

  private sendRaw(output: MIDIOutput, bytes: number[]): void {
    try {
      output.send(bytes);
    } catch {
      // A disconnected/failed port must never throw into the scheduler tick.
    }
  }

  /**
   * The panic control. Sends a real note-off for every note this module
   * currently believes is sounding, THEN a CC 123 (All Notes Off) on every
   * channel it has ever used this session — belt and suspenders, since some
   * receivers only honour one of the two. Safe to call at any time,
   * including with no port selected (no-op).
   */
  allNotesOff(): void {
    for (const { output, channel0, pitch, timer } of this.#active.values()) {
      clearTimeout(timer);
      this.sendRaw(output, [NOTE_OFF | channel0, pitch, 0]);
    }
    this.#active.clear();
    this.setActiveCount();
    if (this.#output) {
      for (const ch0 of this.#usedChannels0) {
        this.sendRaw(this.#output, [CONTROL_CHANGE | ch0, ALL_NOTES_OFF_CC, 0]);
      }
    }
  }

  /** Full teardown: panic, drop the port/access references, clear listeners. */
  dispose(): void {
    this.allNotesOff();
    if (this.#access) this.#access.onstatechange = null;
    this.#access = null;
    this.#output = null;
    useMidiStore.setState({ outputs: [], outputId: null, enabled: false });
  }
}

export const midiController = new MidiController();

// Defense in depth: a page unload (tab close, navigation, reload) must never
// leave a hardware synth holding a note. `dispose()` on the singleton is the
// same panic path `Soundscape.dispose()` calls on ordinary teardown.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => midiController.allNotesOff());
  window.addEventListener('beforeunload', () => midiController.allNotesOff());
}
