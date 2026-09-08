/**
 * The soundscape as a real instrument: every control here reads and writes
 * actual state — `@/audio/settingsStore` for the musical parameters,
 * `@/ui/store` for mute/volume, `@/audio/midiStore` + `@/audio/midi` for
 * MIDI output, `@/audio/captureStore` + `@/audio/capture` for audio-reactive
 * capture. Nothing is decorative; see `@/audio/audio.ts`'s `applySettings`
 * for exactly how each field reaches the live `SoundscapeBrain`/`SynthGraph`.
 */
import { useEffect } from 'react';
import { useAppStore } from '@/ui/store';
import { Button, Divider, Field, Readout, Slider, Toggle } from '@/ui/primitives';
import { MAX_DENSITY, MIN_DENSITY } from '@/audio/mapper';
import { MAX_BPM, MAX_VOICES, MIN_BPM } from '@/audio/scheduler';
import { MAX_ROOT_MIDI, MIN_ROOT_MIDI, noteName, SCALE_MODES, type ScaleMode } from '@/audio/scale';
import {
  AUDIO_PRESETS, MAX_DECAY, MAX_DRONE_FILTER_HZ, MAX_DRONE_WEIGHT, MIN_DECAY, MIN_DRONE_FILTER_HZ,
  MIN_DRONE_WEIGHT, MIN_VOICE_CAP, PRESET_NAMES, type PresetName,
} from '@/audio/settings';
import { useAudioSettingsStore } from '@/audio/settingsStore';
import { midiController } from '@/audio/midi';
import { useMidiStore } from '@/audio/midiStore';
import { startMicCapture, startSystemCapture, stop as stopCapture, setReactDensity, setReactFilter, setReactTempo } from '@/audio/capture';
import { useCaptureStore } from '@/audio/captureStore';

const SCALE_LABELS: Record<ScaleMode, string> = {
  pentatonic: 'Pentatonic',
  lydian: 'Lydian',
  dorian: 'Dorian',
  wholetone: 'Whole-tone',
};

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

function hz(v: number): string {
  return `${Math.round(v)} Hz`;
}

function mult(v: number): string {
  return `${v.toFixed(2)}×`;
}

export function AudioPanel() {
  const muted = useAppStore((s) => s.muted);
  const setMuted = useAppStore((s) => s.setMuted);
  const volume = useAppStore((s) => s.volume);
  const setVolume = useAppStore((s) => s.setVolume);

  const settings = useAudioSettingsStore();
  const midi = useMidiStore();
  const capture = useCaptureStore();

  // "Never leave the instrument or a real MIDI device sounding after this
  // control surface goes away" — closing the panel silences MIDI and, if the
  // user forgot, stops any live capture and releases its tracks.
  useEffect(() => () => {
    midiController.allNotesOff();
    stopCapture();
  }, []);

  return (
    <div className="flex flex-col gap-5">
      <Field label="Master">
        <label className="flex items-center gap-2 text-xs text-ivory-200 max-[480px]:min-h-11">
          <input
            type="checkbox"
            checked={!muted}
            onChange={(e) => { setMuted(!e.target.checked); }}
            className="h-3.5 w-3.5 shrink-0 accent-[var(--color-ivory-100)] max-[480px]:h-5 max-[480px]:w-5"
          />
          Enable the soundscape
        </label>
        <Slider label="Volume" value={Math.round(volume * 100)} min={0} max={100} disabled={muted} onChange={(v) => setVolume(v / 100)} format={(v) => `${v}%`} />
      </Field>

      <Divider />

      <Field label="Preset" description={AUDIO_PRESETS[settings.preset]?.description ?? ''}>
        <Toggle
          aria-label="Preset"
          size="sm"
          options={PRESET_NAMES.map((name: PresetName) => ({ value: name, label: AUDIO_PRESETS[name].label }))}
          value={settings.preset}
          onChange={(v) => settings.applyPreset(v)}
        />
      </Field>

      <Divider />

      <Field label="Scale" description="Every mode is chosen so notes drawn from it never clash — there is no wrong note to play.">
        <Toggle
          aria-label="Scale mode"
          size="sm"
          options={SCALE_MODES.map((m) => ({ value: m, label: SCALE_LABELS[m] }))}
          value={settings.scaleMode}
          onChange={(v) => settings.update({ scaleMode: v })}
        />
      </Field>

      <Slider
        label="Root note"
        value={settings.rootMidi}
        min={MIN_ROOT_MIDI}
        max={MAX_ROOT_MIDI}
        step={1}
        onChange={(v) => settings.update({ rootMidi: v })}
        format={noteName}
      />

      <Divider />

      <Slider
        label="Tempo"
        value={settings.bpm}
        min={MIN_BPM}
        max={MAX_BPM}
        step={1}
        onChange={(v) => settings.update({ bpm: v })}
        format={(v) => `${v} bpm`}
      />
      <Slider
        label="Voice cap"
        value={settings.voiceCap}
        min={MIN_VOICE_CAP}
        max={MAX_VOICES}
        step={1}
        onChange={(v) => settings.update({ voiceCap: v })}
        format={(v) => `${v} voices`}
      />
      <Slider
        label="Note density"
        value={settings.density}
        min={MIN_DENSITY}
        max={MAX_DENSITY}
        step={0.05}
        onChange={(v) => settings.update({ density: v })}
        format={mult}
      />

      <Divider />

      <Slider
        label="Drone weight"
        value={settings.droneWeight}
        min={MIN_DRONE_WEIGHT}
        max={MAX_DRONE_WEIGHT}
        step={0.05}
        onChange={(v) => settings.update({ droneWeight: v })}
        format={mult}
      />
      <Slider
        label="Drone filter — low"
        value={settings.droneFilterMinHz}
        min={MIN_DRONE_FILTER_HZ}
        max={MAX_DRONE_FILTER_HZ}
        step={10}
        onChange={(v) => settings.update({ droneFilterMinHz: v })}
        format={hz}
      />
      <Slider
        label="Drone filter — high"
        value={settings.droneFilterMaxHz}
        min={MIN_DRONE_FILTER_HZ}
        max={MAX_DRONE_FILTER_HZ}
        step={10}
        onChange={(v) => settings.update({ droneFilterMaxHz: v })}
        format={hz}
      />
      <Slider
        label="Decay / reverb"
        value={settings.decay}
        min={MIN_DECAY}
        max={MAX_DECAY}
        step={0.05}
        onChange={(v) => settings.update({ decay: v })}
        format={mult}
      />

      <Divider />

      <Field label="Movement" description="A 20-minute session shouldn't sit on one static chord — both are driven by real simulation activity, never randomised.">
        <label className="flex items-center gap-2 text-xs text-ivory-200 max-[480px]:min-h-11">
          <input
            type="checkbox"
            checked={settings.harmonicMovement}
            onChange={(e) => settings.update({ harmonicMovement: e.target.checked })}
            className="h-3.5 w-3.5 shrink-0 accent-[var(--color-ivory-100)] max-[480px]:h-5 max-[480px]:w-5"
          />
          Slow harmonic drift with sustained population trends
        </label>
        <label className="flex items-center gap-2 text-xs text-ivory-200 max-[480px]:min-h-11">
          <input
            type="checkbox"
            checked={settings.percussion}
            onChange={(e) => settings.update({ percussion: e.target.checked })}
            className="h-3.5 w-3.5 shrink-0 accent-[var(--color-ivory-100)] max-[480px]:h-5 max-[480px]:w-5"
          />
          Generative percussion during real activity bursts
        </label>
      </Field>

      <Divider />

      <Field label="Scrubbing">
        <label className="flex items-center gap-2 text-xs text-ivory-200 max-[480px]:min-h-11">
          <input
            type="checkbox"
            checked={settings.auditionOnScrub}
            onChange={(e) => settings.update({ auditionOnScrub: e.target.checked })}
            className="h-3.5 w-3.5 shrink-0 accent-[var(--color-ivory-100)] max-[480px]:h-5 max-[480px]:w-5"
          />
          Play a preview note while dragging the timeline
        </label>
      </Field>

      <Button size="sm" variant="ghost" onClick={() => settings.resetToDefaults()}>Reset to defaults</Button>

      <Divider />

      <MidiSection midi={midi} />

      <Divider />

      <ReactivitySection capture={capture} />
    </div>
  );
}

function MidiSection({ midi }: { midi: ReturnType<typeof useMidiStore.getState> }) {
  return (
    <div className="flex flex-col gap-3">
      <span className="text-micro uppercase tracking-[0.18em] text-ivory-300">MIDI output</span>
      <p className="text-xs text-ivory-300">
        Sends every note this soundscape plays to a real MIDI device or DAW — same voices, same
        rate limits, nothing extra. Requires an explicit grant; sysex is never requested.
      </p>

      {midi.support === 'unknown' && (
        <Button size="sm" variant="ghost" onClick={() => void midiController.requestAccess()}>Enable MIDI output</Button>
      )}
      {midi.support === 'requesting' && <p className="text-xs text-ivory-300">Requesting access…</p>}
      {midi.support === 'unsupported' && (
        <p className="text-xs text-accent-warn">{midi.errorMessage ?? 'Web MIDI is not supported in this browser.'}</p>
      )}
      {(midi.support === 'denied' || midi.support === 'error') && (
        <>
          <p className="text-xs text-accent-warn">{midi.errorMessage}</p>
          <Button size="sm" variant="ghost" onClick={() => void midiController.requestAccess()}>Try again</Button>
        </>
      )}

      {midi.support === 'granted' && (
        <>
          {midi.outputs.length === 0 ? (
            <p className="text-xs text-ivory-300">No MIDI output devices found. Connect one and reopen this panel.</p>
          ) : (
            <>
              <Field label="Output device" htmlFor="midi-output">
                <select
                  id="midi-output"
                  value={midi.outputId ?? ''}
                  onChange={(e) => midiController.selectOutput(e.target.value || null)}
                  className="w-full rounded-xs border border-line-strong bg-ink-900 px-2 py-1.5 text-sm text-ivory-100 focus-visible:focus-ring outline-none max-[480px]:min-h-11"
                >
                  <option value="">None</option>
                  {midi.outputs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </Field>
              <Field label="Channel" htmlFor="midi-channel">
                <select
                  id="midi-channel"
                  value={midi.channel}
                  onChange={(e) => midiController.setChannel(Number(e.target.value))}
                  className="w-full rounded-xs border border-line-strong bg-ink-900 px-2 py-1.5 text-sm text-ivory-100 tabular focus-visible:focus-ring outline-none max-[480px]:min-h-11"
                >
                  {Array.from({ length: 16 }, (_, i) => i + 1).map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <label className="flex items-center gap-2 text-xs text-ivory-200 max-[480px]:min-h-11">
                <input
                  type="checkbox"
                  checked={midi.enabled}
                  disabled={!midi.outputId}
                  onChange={(e) => midiController.setEnabled(e.target.checked)}
                  className="h-3.5 w-3.5 shrink-0 accent-[var(--color-ivory-100)] max-[480px]:h-5 max-[480px]:w-5"
                />
                Forward notes to this device
              </label>
              <label className="flex items-center gap-2 text-xs text-ivory-200 max-[480px]:min-h-11">
                <input
                  type="checkbox"
                  checked={midi.mapEventClasses}
                  onChange={(e) => midiController.setMapEventClasses(e.target.checked)}
                  className="h-3.5 w-3.5 shrink-0 accent-[var(--color-ivory-100)] max-[480px]:h-5 max-[480px]:w-5"
                />
                Map event classes to channels
              </label>
              <p className="text-xs text-ivory-300">
                When mapping is on: churn notes → channel {midi.channel}, discoveries → channel{' '}
                {((midi.channel) % 16) + 1}, scrub previews → channel {((midi.channel + 1) % 16) + 1}, and
                drawing/stamping/branching/percussion each take the next channel after that.
              </p>
              <div className="flex items-center justify-between gap-2">
                <Readout label="Active notes" value={midi.activeNoteCount} digits={2} />
                <Button size="sm" variant="ghost" onClick={() => midiController.allNotesOff()} style={{ color: 'var(--color-accent-warn)' }}>
                  All notes off
                </Button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function ReactivitySection({ capture }: { capture: ReturnType<typeof useCaptureStore.getState> }) {
  const active = capture.state === 'active';
  return (
    <div className="flex flex-col gap-3">
      <span className="text-micro uppercase tracking-[0.18em] text-ivory-300">Audio reactivity</span>
      <p className="text-xs text-ivory-300">
        Captures system/tab audio (or, if that isn't available, your microphone) to modulate the
        soundscape's density and drone filter, or nudge playback speed on strong transients. This
        only ever changes presentation and tempo — it can never alter cell state, so the
        simulation stays fully deterministic no matter what's captured.
      </p>

      {!active && (
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="ghost" disabled={capture.state === 'requesting'} onClick={() => void startSystemCapture()}>
            Share tab/system audio
          </Button>
          <Button size="sm" variant="ghost" disabled={capture.state === 'requesting'} onClick={() => void startMicCapture()}>
            Use microphone instead
          </Button>
        </div>
      )}
      {capture.state === 'requesting' && <p className="text-xs text-ivory-300">Waiting for permission…</p>}
      {capture.state === 'unsupported' && <p className="text-xs text-accent-warn">{capture.errorMessage}</p>}
      {capture.state === 'error' && <p className="text-xs text-accent-warn">{capture.errorMessage}</p>}

      {active && (
        <>
          <p className="text-xs text-ivory-200">
            Capturing {capture.mode === 'system' ? 'system/tab audio' : 'your microphone'}.
          </p>
          <div className="flex gap-4">
            <Readout label="Level" value={pct(capture.level)} digits={4} />
            <Readout label="Brightness" value={pct(capture.centroid)} digits={4} />
            <Readout label="Onset" value={capture.onset ? 'yes' : '—'} digits={3} accent={capture.onset ? 'activity' : null} />
          </div>
          <label className="flex items-center gap-2 text-xs text-ivory-200 max-[480px]:min-h-11">
            <input type="checkbox" checked={capture.reactDensity} onChange={(e) => setReactDensity(e.target.checked)}
              className="h-3.5 w-3.5 shrink-0 accent-[var(--color-ivory-100)] max-[480px]:h-5 max-[480px]:w-5" />
            Modulate note density
          </label>
          <label className="flex items-center gap-2 text-xs text-ivory-200 max-[480px]:min-h-11">
            <input type="checkbox" checked={capture.reactFilter} onChange={(e) => setReactFilter(e.target.checked)}
              className="h-3.5 w-3.5 shrink-0 accent-[var(--color-ivory-100)] max-[480px]:h-5 max-[480px]:w-5" />
            Modulate drone filter
          </label>
          <label className="flex items-center gap-2 text-xs text-ivory-200 max-[480px]:min-h-11">
            <input type="checkbox" checked={capture.reactTempo} onChange={(e) => setReactTempo(e.target.checked)}
              className="h-3.5 w-3.5 shrink-0 accent-[var(--color-ivory-100)] max-[480px]:h-5 max-[480px]:w-5" />
            Nudge playback speed (never cell state)
          </label>
          <Button size="sm" variant="ghost" onClick={() => stopCapture()} style={{ color: 'var(--color-accent-warn)' }}>
            Stop capture
          </Button>
        </>
      )}
    </div>
  );
}
