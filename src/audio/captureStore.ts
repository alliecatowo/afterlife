/**
 * UI-facing state for system/mic audio-reactivity capture. `capture.ts` is
 * the only module that writes here (it owns the real `MediaStream`); the
 * panel only reads it and calls `capture.ts`'s functions.
 */
import { create } from 'zustand';
import type { Bands } from './reactivity';

export type CaptureState = 'idle' | 'requesting' | 'active' | 'error' | 'unsupported';
export type CaptureMode = 'system' | 'mic' | null;

interface CaptureStoreState {
  state: CaptureState;
  mode: CaptureMode;
  errorMessage: string | null;
  level: number;
  bands: Bands;
  centroid: number;
  onset: boolean;
  /** Master toggle: capture can be active while none of these apply yet. */
  reactDensity: boolean;
  reactFilter: boolean;
  reactTempo: boolean;
}

export const useCaptureStore = create<CaptureStoreState>(() => ({
  state: 'idle',
  mode: null,
  errorMessage: null,
  level: 0,
  bands: { bass: 0, mid: 0, treble: 0 },
  centroid: 0.5,
  onset: false,
  reactDensity: false,
  reactFilter: false,
  reactTempo: false,
}));
