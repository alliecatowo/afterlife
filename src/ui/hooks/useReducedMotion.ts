/**
 * `prefers-reduced-motion` as a React hook. New file — not the frozen
 * `useSimulationReadout.ts`. Every `motion` animation in this codebase must
 * check this (or render its end-state directly) per DESIGN.md § Motion.
 */
import { useSyncExternalStore } from 'react';

const query = () => window.matchMedia('(prefers-reduced-motion: reduce)');

function subscribe(cb: () => void): () => void {
  const mql = query();
  mql.addEventListener('change', cb);
  return () => mql.removeEventListener('change', cb);
}

function getSnapshot(): boolean {
  return query().matches;
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
