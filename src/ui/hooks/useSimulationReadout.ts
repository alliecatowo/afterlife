/**
 * FROZEN FILE (architect-owned) — the sanctioned bridge between the
 * high-frequency simulation and React.
 *
 * `simulationReadout` is an external store fed by the `gen:changed` bus event.
 * It coalesces writes to at most `READOUT_HZ` notifications per second, so a
 * 60 gen/s simulation causes at most 10 React renders per second, and only in
 * components that actually subscribe.
 *
 * If you only need to PAINT a number, prefer `subscribeReadout` and write to a
 * DOM ref — that costs zero renders.
 */
import { useSyncExternalStore } from 'react';
import { bus } from '@/ui/bus';
import type { Generation } from '@/core/types';

export const READOUT_HZ = 10;

export interface SimulationReadout {
  gen: Generation;
  population: number;
}

let latest: SimulationReadout = { gen: 0, population: 0 };
let published: SimulationReadout = latest;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

bus.on('gen:changed', (p) => { latest = { gen: p.gen, population: p.population }; });

function flush(): void {
  if (latest.gen === published.gen && latest.population === published.population) return;
  published = latest;
  for (const fn of [...listeners]) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  timer ??= setInterval(flush, 1000 / READOUT_HZ);
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0 && timer !== null) { clearInterval(timer); timer = null; }
  };
}

/** Throttled (<= 10 Hz) React view of the simulation counters. */
export function useSimulationReadout(): SimulationReadout {
  return useSyncExternalStore(subscribe, () => published, () => published);
}

/** Zero-render access for imperative DOM writers. Returns an unsubscribe fn. */
export function subscribeReadout(fn: (r: SimulationReadout) => void): () => void {
  return bus.on('gen:changed', (p) => fn({ gen: p.gen, population: p.population })).dispose;
}
