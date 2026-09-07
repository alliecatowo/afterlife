/**
 * Real recorded history, accumulated from the bus as the simulation actually
 * runs. Never synthesised — the ribbon in `Timeline.tsx` only ever draws
 * generations this session has genuinely observed via `gen:changed`.
 *
 * A plain ring buffer, written imperatively from a bus handler (module-level
 * singleton, subscribed once at import time). No React state anywhere in this
 * file — `Timeline.tsx` reads `historyRing.snapshot()` from its own rAF loop.
 */
import { bus } from '@/ui/bus';
import { HISTORY_WINDOW } from '@/core/history';
import type { Generation } from '@/core/types';

export interface HistorySnapshot {
  /** Ascending generation numbers actually observed this session. */
  gens: Generation[];
  pops: number[];
  /** abs(delta population) between consecutive observed generations, same length as gens. */
  activity: number[];
  minGen: number;
  maxGen: number;
  maxPopulation: number;
  /** Bumped on every push; cheap change-detection for the draw loop. */
  version: number;
}

const CAP = HISTORY_WINDOW;

class HistoryRing {
  private gens: number[] = [];
  private pops: number[] = [];
  private activity: number[] = [];
  private maxPopulation = 0;
  private lastPop: number | null = null;
  version = 0;

  push(gen: Generation, population: number): void {
    // A restored/loaded/branch-switched session can move gen backward or
    // sideways relative to the last push; start a fresh trace rather than
    // drawing a nonsensical connecting line.
    const lastGen = this.gens.at(-1);
    if (lastGen !== undefined && gen <= lastGen) {
      this.gens = [];
      this.pops = [];
      this.activity = [];
      this.lastPop = null;
    }

    const delta = this.lastPop === null ? 0 : Math.abs(population - this.lastPop);
    this.lastPop = population;

    this.gens.push(gen);
    this.pops.push(population);
    this.activity.push(delta);
    if (population > this.maxPopulation) this.maxPopulation = population;

    if (this.gens.length > CAP) {
      const drop = this.gens.length - CAP;
      this.gens.splice(0, drop);
      this.pops.splice(0, drop);
      this.activity.splice(0, drop);
    }
    this.version++;
  }

  reset(): void {
    this.gens = [];
    this.pops = [];
    this.activity = [];
    this.maxPopulation = 0;
    this.lastPop = null;
    this.version++;
  }

  snapshot(): HistorySnapshot {
    return {
      gens: this.gens,
      pops: this.pops,
      activity: this.activity,
      minGen: this.gens[0] ?? 0,
      maxGen: this.gens.at(-1) ?? 0,
      maxPopulation: this.maxPopulation,
      version: this.version,
    };
  }
}

export const historyRing = new HistoryRing();

bus.on('gen:changed', (p) => historyRing.push(p.gen, p.population));
