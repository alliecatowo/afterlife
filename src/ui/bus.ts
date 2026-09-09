/**
 * FROZEN FILE (architect-owned).
 *
 * The typed event bus: the transport for HIGH-FREQUENCY simulation signals
 * (generation ticks, population, camera motion). Subscribers must write to DOM
 * refs imperatively — calling React `setState` or a Zustand setter from a
 * per-generation handler is a BUG. Low-frequency app state lives in
 * `@/ui/store` (Zustand). See ARCHITECTURE.md § The React boundary.
 */
import type {
  BranchId, CellCoord, DiscoveryEvent, Disposable, Generation, Rect, RenderLens,
} from '@/core/types';

export interface AppEvents {
  /* playback transport */
  'playback:play': void;
  'playback:pause': void;
  'playback:step': { by: number };
  'playback:speed': { speed: number };
  /** `synthetic: true` marks a scrub performed on the user's behalf (e.g. the
   *  tutorial's "Show me"), not a real drag/keyboard interaction — listeners
   *  that award credit for the user's own action (achievements) must ignore
   *  it. Omitted/false for genuine input from `@/ui/timeline/Timeline`. */
  'playback:scrub': { gen: Generation; done: boolean; synthetic?: boolean };
  /* camera */
  'camera:changed': { x: number; y: number; scale: number };
  'camera:follow': { x: number; y: number } | null;
  /* view + editing */
  'lens:changed': { lens: RenderLens };
  'selection:changed': { rect: Rect | null };
  'edit:committed': { gen: Generation; cellCount: number };
  /* simulation — HIGH FREQUENCY, once per generation. Never setState here. */
  'gen:changed': { gen: Generation; population: number };
  /* branching */
  'branch:created': { id: BranchId; fromGen: Generation; name: string };
  'branch:switched': { id: BranchId };
  'branch:renamed': { id: BranchId; name: string };
  /* time sculpture */
  'sculpture:open': { rect: Rect; fromGen: Generation; toGen: Generation };
  'sculpture:close': void;
  'sculpture:sliceSelected': { gen: Generation };
  /* content */
  'discovery:made': DiscoveryEvent;
  'experiment:started': { id: string; title: string };
  'experiment:succeeded': { id: string; gen: Generation };
  /* audio + presentation */
  'audio:toggle': { muted: boolean };
  'audio:volume': { volume: number };
  'presentation:toggle': { on: boolean };
  /* editing */
  /** Requests the caller owning the TimelineStore pop and record the most
   *  recent local undo entry (see `InputController.undo()`). Emitted by the
   *  `z` shortcut in `@/interact/input.ts`, handled by `@/ui/session`. */
  'history:undo': void;
  /* chrome */
  'toast': { message: string; tone?: 'info' | 'warn' | 'success'; ms?: number };
  /**
   * A quiet, world-anchored scene beat label (see `@/content/scenes`'
   * `SceneBeat`). `null` clears it. Never a modal — a small marker positioned
   * at `at` by `@/ui/SceneAnnotation`.
   */
  'scene:annotate': { at: CellCoord; label: string } | null;
}

export type AppEventName = keyof AppEvents;
export type Handler<K extends AppEventName> = (payload: AppEvents[K]) => void;

class EventBus {
  #map = new Map<AppEventName, Set<(p: never) => void>>();

  on<K extends AppEventName>(name: K, fn: Handler<K>): Disposable {
    let set = this.#map.get(name);
    if (!set) { set = new Set(); this.#map.set(name, set); }
    set.add(fn as (p: never) => void);
    return { dispose: () => this.off(name, fn) };
  }

  once<K extends AppEventName>(name: K, fn: Handler<K>): Disposable {
    const sub = this.on(name, (p) => { sub.dispose(); fn(p); });
    return sub;
  }

  off<K extends AppEventName>(name: K, fn: Handler<K>): void {
    this.#map.get(name)?.delete(fn as (p: never) => void);
  }

  emit<K extends AppEventName>(name: K, payload: AppEvents[K]): void {
    const set = this.#map.get(name);
    if (!set) return;
    for (const fn of [...set]) {
      try { (fn as Handler<K>)(payload); }
      catch (err) { console.error(`[bus] handler for "${String(name)}" threw`, err); }
    }
  }

  /** Test/teardown only. */
  clear(): void { this.#map.clear(); }
}

/** Process-wide singleton. */
export const bus = new EventBus();
export type { EventBus };
