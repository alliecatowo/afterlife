/**
 * FROZEN FILE (architect-owned).
 *
 * Zustand store for LOW-FREQUENCY app state: things React legitimately
 * re-renders on (mode, lens, selection, branch list, playback flags, panels).
 * Nothing here may be written more than a few times per second. Per-generation
 * data (gen index, population) travels on the event bus and is rendered by
 * imperative subscribers — see `@/ui/hooks/useSimulationReadout`.
 */
import { create } from 'zustand';
import type { BranchId, BranchMeta, Rect, RenderLens } from '@/core/types';

export type Tool = 'draw' | 'erase' | 'pan' | 'select' | 'stamp';

export interface AppState {
  /* transport (flags only — the generation counter is NOT here) */
  playing: boolean;
  /** Target generations per second. UI presets: 1, 4, 12, 30, 60. */
  speed: number;
  scrubbing: boolean;

  /* view */
  lens: RenderLens;
  tool: Tool;
  showGrid: boolean;

  /* selection + branching */
  selection: Rect | null;
  activeBranch: BranchId;
  branches: BranchMeta[];
  compareWith: BranchId | null;

  /* chrome */
  sculptureOpen: boolean;
  drawerOpen: boolean;
  panelOpen: boolean;
  presentation: boolean;

  /* audio */
  muted: boolean;
  volume: number;

  /* actions */
  setPlaying: (playing: boolean) => void;
  setSpeed: (speed: number) => void;
  setScrubbing: (scrubbing: boolean) => void;
  setLens: (lens: RenderLens) => void;
  setTool: (tool: Tool) => void;
  setShowGrid: (showGrid: boolean) => void;
  setSelection: (selection: Rect | null) => void;
  setActiveBranch: (id: BranchId) => void;
  setBranches: (branches: BranchMeta[]) => void;
  setCompareWith: (id: BranchId | null) => void;
  setSculptureOpen: (open: boolean) => void;
  setDrawerOpen: (open: boolean) => void;
  setPanelOpen: (open: boolean) => void;
  setPresentation: (on: boolean) => void;
  setMuted: (muted: boolean) => void;
  setVolume: (volume: number) => void;
}

export const useAppStore = create<AppState>((set) => ({
  playing: false,
  speed: 12,
  scrubbing: false,
  lens: 'life',
  tool: 'draw',
  showGrid: true,
  selection: null,
  activeBranch: 'root',
  branches: [],
  compareWith: null,
  sculptureOpen: false,
  drawerOpen: true,
  panelOpen: true,
  presentation: false,
  muted: true,
  volume: 0.6,

  setPlaying: (playing) => set({ playing }),
  setSpeed: (speed) => set({ speed }),
  setScrubbing: (scrubbing) => set({ scrubbing }),
  setLens: (lens) => set({ lens }),
  setTool: (tool) => set({ tool }),
  setShowGrid: (showGrid) => set({ showGrid }),
  setSelection: (selection) => set({ selection }),
  setActiveBranch: (activeBranch) => set({ activeBranch }),
  setBranches: (branches) => set({ branches }),
  setCompareWith: (compareWith) => set({ compareWith }),
  setSculptureOpen: (sculptureOpen) => set({ sculptureOpen }),
  setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
  setPanelOpen: (panelOpen) => set({ panelOpen }),
  setPresentation: (presentation) => set({ presentation }),
  setMuted: (muted) => set({ muted }),
  setVolume: (volume) => set({ volume }),
}));

/** Non-reactive read, for imperative code (the sim loop, renderers). */
export const readState = (): AppState => useAppStore.getState();
