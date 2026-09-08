/**
 * Ephemeral UI-only state that does not belong in the frozen `@/ui/store`
 * (which is reserved for app/domain state other modules read). This store is
 * owned entirely by the `ui` agent: which right-panel tab is showing, dialog
 * visibility, the one-time title-plate dismissal, and the in-progress stamp
 * selection (pattern id + transform) driven by the drawer.
 *
 * Written at most a few times per second, in response to user action — same
 * discipline as `@/ui/store`.
 */
import { create } from 'zustand';
import { IDENTITY_TRANSFORM, type StampTransform } from '@/core/types';

export type RightPanelId = 'branches' | 'compare' | 'settings' | 'guide' | 'experiments' | 'save' | 'audio' | null;

interface UILocalState {
  rightPanel: RightPanelId;
  setRightPanel: (panel: RightPanelId) => void;
  toggleRightPanel: (panel: Exclude<RightPanelId, null>) => void;

  shortcutsOpen: boolean;
  setShortcutsOpen: (open: boolean) => void;

  titleDismissed: boolean;
  dismissTitle: () => void;

  /** True once the user has directly interacted with the world canvas. */
  worldTouched: boolean;
  setWorldTouched: () => void;

  selectedPatternId: string | null;
  stampTransform: StampTransform;
  setSelectedPattern: (id: string | null) => void;
  rotateStamp: () => void;
  flipStamp: (axis: 'flipX' | 'flipY') => void;
}

export const useUIState = create<UILocalState>((set, get) => ({
  rightPanel: null,
  setRightPanel: (rightPanel) => set({ rightPanel }),
  toggleRightPanel: (panel) => set({ rightPanel: get().rightPanel === panel ? null : panel }),

  shortcutsOpen: false,
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),

  titleDismissed: false,
  dismissTitle: () => set({ titleDismissed: true }),

  worldTouched: false,
  setWorldTouched: () => set((s) => (s.worldTouched ? s : { worldTouched: true })),

  selectedPatternId: null,
  stampTransform: IDENTITY_TRANSFORM,
  setSelectedPattern: (selectedPatternId) => set({ selectedPatternId, stampTransform: IDENTITY_TRANSFORM }),
  rotateStamp: () =>
    set((s) => ({ stampTransform: { ...s.stampTransform, rotate: ((s.stampTransform.rotate + 1) % 4) as 0 | 1 | 2 | 3 } })),
  flipStamp: (axis) => set((s) => ({ stampTransform: { ...s.stampTransform, [axis]: !s.stampTransform[axis] } })),
}));
