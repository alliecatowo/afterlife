/**
 * System/tab or microphone audio capture for the "audio-reactive" panel
 * section. Impure by necessity (real `MediaStream`/`AnalyserNode`) — the
 * actual feature math lives in the pure, unit-tested `reactivity.ts`; this
 * file is just the browser plumbing plus the explicit, narrow bridge into
 * the soundscape's own settings and the simulation's playback speed.
 *
 * THE DETERMINISM BOUNDARY, enforced by construction, not just convention:
 * this module imports `@/audio/settingsStore` (density/drone filter) and
 * `@/ui/store` (`setSpeed`, an existing, ordinary UI action — the same one
 * the speed presets in the HUD call) and NOTHING from `@/core/**`. It has no
 * way to touch cell state, history, or the RNG even by accident — playback
 * SPEED changes how often the (already-deterministic) engine step is called
 * by the loop, it never changes what a step computes. See DESIGN's
 * instruction that audio reactivity "must not corrupt the simulation."
 *
 * Consent: capture only ever starts from an explicit button press in
 * `AudioPanel` (never on load, never implicitly from another feature), each
 * button labelled with exactly what will be captured before the browser's
 * own permission prompt appears. `stop()` releases every track and tears
 * down the analysis graph; it is also called from the panel's unmount
 * effect and from a `pagehide` listener below, so a forgotten capture can't
 * outlive the tab.
 */
import { useAppStore } from '@/ui/store';
import { useAudioSettingsStore } from './settingsStore';
import { useCaptureStore, type CaptureMode } from './captureStore';
import {
  computeBands, computeCentroid, computeLevel, OnsetDetector, reactiveDensity,
  reactiveFilterRange, reactiveSpeedMultiplier, smooth,
} from './reactivity';

const TICK_MS = 120;
const FFT_SIZE = 1024;
const LEVEL_SMOOTHING_ALPHA = 0.35;
const CENTROID_SMOOTHING_ALPHA = 0.2;
const REACTIVITY_AMOUNT = 0.6;
const MIN_SPEED = 0.5;
const MAX_SPEED = 90;

let ctx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let source: MediaStreamAudioSourceNode | null = null;
let stream: MediaStream | null = null;
let intervalHandle: ReturnType<typeof setInterval> | null = null;
let timeData: Uint8Array<ArrayBuffer> | null = null;
let freqData: Uint8Array<ArrayBuffer> | null = null;
let smoothedLevel = 0;
let smoothedCentroid = 0.5;
const onsetDetector = new OnsetDetector();

/** Baselines captured at `start()` time — reactivity modulates AROUND these
 * and `stop()` restores them exactly, so turning capture off always leaves
 * the panel's manual sliders exactly where the user last set them. */
let baseline: { density: number; filterMinHz: number; filterMaxHz: number; speed: number } | null = null;

function teardownMediaGraph(): void {
  if (intervalHandle !== null) { clearInterval(intervalHandle); intervalHandle = null; }
  try { source?.disconnect(); } catch { /* already disconnected */ }
  try { analyser?.disconnect(); } catch { /* already disconnected */ }
  if (stream) {
    for (const track of stream.getTracks()) track.stop();
  }
  if (ctx) {
    void ctx.close().catch(() => { /* already closed */ });
  }
  source = null;
  analyser = null;
  stream = null;
  ctx = null;
  timeData = null;
  freqData = null;
}

/** Restore whatever the panel's sliders were showing before reactivity took
 * over, so stopping capture is fully non-destructive. */
function restoreBaseline(): void {
  if (!baseline) return;
  useAudioSettingsStore.getState().update({
    density: baseline.density,
    droneFilterMinHz: baseline.filterMinHz,
    droneFilterMaxHz: baseline.filterMaxHz,
  });
  useAppStore.getState().setSpeed(baseline.speed);
  baseline = null;
}

function tick(): void {
  if (!analyser || !timeData || !freqData) return;
  analyser.getByteTimeDomainData(timeData);
  analyser.getByteFrequencyData(freqData);

  const level = computeLevel(timeData);
  const centroid = computeCentroid(freqData);
  const bands = computeBands(freqData);
  smoothedLevel = smooth(smoothedLevel, level, LEVEL_SMOOTHING_ALPHA);
  smoothedCentroid = smooth(smoothedCentroid, centroid, CENTROID_SMOOTHING_ALPHA);
  const onset = onsetDetector.update(smoothedLevel, performance.now() / 1000);

  useCaptureStore.setState({ level: smoothedLevel, bands, centroid: smoothedCentroid, onset });

  const { reactDensity, reactFilter, reactTempo } = useCaptureStore.getState();
  if (!baseline) return; // stopped mid-tick, or never started

  if (reactDensity) {
    useAudioSettingsStore.getState().update({
      density: reactiveDensity(baseline.density, smoothedLevel, REACTIVITY_AMOUNT),
    });
  }
  if (reactFilter) {
    const { minHz, maxHz } = reactiveFilterRange(baseline.filterMinHz, baseline.filterMaxHz, smoothedCentroid, REACTIVITY_AMOUNT);
    useAudioSettingsStore.getState().update({ droneFilterMinHz: minHz, droneFilterMaxHz: maxHz });
  }
  if (reactTempo) {
    const multiplier = reactiveSpeedMultiplier(onset, REACTIVITY_AMOUNT);
    const nextSpeed = Math.min(MAX_SPEED, Math.max(MIN_SPEED, baseline.speed * multiplier));
    useAppStore.getState().setSpeed(nextSpeed);
  }
}

function startAnalysis(mediaStream: MediaStream, mode: CaptureMode): void {
  const Ctor = globalThis.AudioContext ?? (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) throw new Error('Web Audio API is not available in this environment');
  ctx = new Ctor();
  source = ctx.createMediaStreamSource(mediaStream);
  analyser = ctx.createAnalyser();
  analyser.fftSize = FFT_SIZE;
  analyser.smoothingTimeConstant = 0.6;
  source.connect(analyser);
  // Deliberately NOT connected to `ctx.destination` — this graph exists only
  // to analyse, never to play back captured audio (which would also risk a
  // feedback loop with system-audio capture).
  timeData = new Uint8Array(analyser.fftSize);
  freqData = new Uint8Array(analyser.frequencyBinCount);
  stream = mediaStream;

  const settings = useAudioSettingsStore.getState();
  baseline = {
    density: settings.density,
    filterMinHz: settings.droneFilterMinHz,
    filterMaxHz: settings.droneFilterMaxHz,
    speed: useAppStore.getState().speed,
  };
  onsetDetector.reset();
  smoothedLevel = 0;
  smoothedCentroid = 0.5;

  // Stop cleanly if the user revokes access from the browser's own capture
  // indicator/UI, rather than leaving a zombie "active" state.
  for (const track of mediaStream.getTracks()) {
    track.addEventListener('ended', () => { if (useCaptureStore.getState().mode === mode) stop(); });
  }

  intervalHandle = setInterval(tick, TICK_MS);
  useCaptureStore.setState({ state: 'active', mode, errorMessage: null });
}

/**
 * Capture system/tab audio via `getDisplayMedia`. Chrome requires a video
 * constraint to be present for the audio-capture picker to appear at all in
 * most configurations; the video track is stopped immediately (never
 * rendered, never sent anywhere) since only audio is used. Must be called
 * from a user gesture (a button click) and only after the panel has shown
 * the user what this will ask their OS/browser to share.
 */
export async function startSystemCapture(): Promise<void> {
  if (typeof navigator === 'undefined' || typeof navigator.mediaDevices?.getDisplayMedia !== 'function') {
    useCaptureStore.setState({ state: 'unsupported', errorMessage: 'This browser cannot capture system/tab audio (getDisplayMedia is unavailable).' });
    return;
  }
  useCaptureStore.setState({ state: 'requesting', errorMessage: null });
  try {
    const raw = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    const videoTracks = raw.getVideoTracks();
    for (const t of videoTracks) { t.stop(); raw.removeTrack(t); }
    if (raw.getAudioTracks().length === 0) {
      for (const t of raw.getTracks()) t.stop();
      useCaptureStore.setState({ state: 'error', errorMessage: 'The shared source had no audio track — pick "Chrome Tab" (or similar) and check "Share audio".' });
      return;
    }
    startAnalysis(raw, 'system');
  } catch (err) {
    useCaptureStore.setState({ state: 'error', errorMessage: describeCaptureError(err) });
  }
}

/** Microphone fallback via `getUserMedia`, for browsers/OSes that can't
 * capture system audio at all (notably Safari, and Firefox on most
 * platforms). Same consent/teardown discipline as `startSystemCapture`. */
export async function startMicCapture(): Promise<void> {
  if (typeof navigator === 'undefined' || typeof navigator.mediaDevices?.getUserMedia !== 'function') {
    useCaptureStore.setState({ state: 'unsupported', errorMessage: 'This browser cannot capture microphone audio.' });
    return;
  }
  useCaptureStore.setState({ state: 'requesting', errorMessage: null });
  try {
    const raw = await navigator.mediaDevices.getUserMedia({ audio: true });
    startAnalysis(raw, 'mic');
  } catch (err) {
    useCaptureStore.setState({ state: 'error', errorMessage: describeCaptureError(err) });
  }
}

function describeCaptureError(err: unknown): string {
  if (err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
    return 'Permission was denied. Allow audio capture in the browser prompt (or site settings) to use this.';
  }
  return `Could not start capture: ${(err as Error).message}`;
}

/** Stop capture, release every media track, tear down the analysis graph,
 * and restore whatever the manual sliders were set to before reactivity
 * took over. Idempotent — safe to call when nothing is active. */
export function stop(): void {
  const wasActive = useCaptureStore.getState().state === 'active';
  teardownMediaGraph();
  if (wasActive) restoreBaseline();
  useCaptureStore.setState({ state: 'idle', mode: null, level: 0, onset: false, bands: { bass: 0, mid: 0, treble: 0 } });
}

export function setReactDensity(on: boolean): void {
  useCaptureStore.setState({ reactDensity: on });
  if (!on && baseline) useAudioSettingsStore.getState().update({ density: baseline.density });
}

export function setReactFilter(on: boolean): void {
  useCaptureStore.setState({ reactFilter: on });
  if (!on && baseline) useAudioSettingsStore.getState().update({ droneFilterMinHz: baseline.filterMinHz, droneFilterMaxHz: baseline.filterMaxHz });
}

export function setReactTempo(on: boolean): void {
  useCaptureStore.setState({ reactTempo: on });
  if (!on && baseline) useAppStore.getState().setSpeed(baseline.speed);
}

// Defense in depth: never leave a live capture (mic or system audio) running
// past the page's lifetime.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => stop());
}
