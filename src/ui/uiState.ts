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
import type { PaletteMode } from '@/render/color';

export type RightPanelId = 'branches' | 'compare' | 'settings' | 'guide' | 'experiments' | 'save' | 'audio' | 'theme' | null;

interface UILocalState {
  rightPanel: RightPanelId;
  setRightPanel: (panel: RightPanelId) => void;
  toggleRightPanel: (panel: Exclude<RightPanelId, null>) => void;

  shortcutsOpen: boolean;
  setShortcutsOpen: (open: boolean) => void;

  /** The achievements/naturalist's-log dialog (`@/ui/achievements`). Lives
   *  here rather than a self-mounted DOM root now that this integration pass
   *  has full write access to `Hud.tsx`/`HudMoreSheet.tsx` — see
   *  INTEGRATION-NOTES.md's achievements entries for why it didn't start
   *  here (a concurrent mobile-layout pass owned those files at the time). */
  logbookOpen: boolean;
  setLogbookOpen: (open: boolean) => void;

  /** The mobile HUD's "More" sheet — everything that doesn't fit a 390px
   *  toolbar row (lens, speed, branches, compare, ...). Desktop (`lg` and
   *  up) never opens this; those controls render inline there instead. */
  moreOpen: boolean;
  setMoreOpen: (open: boolean) => void;

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

  /** Colourblind-safe (Okabe-Ito) swatches for the discrete species lenses
   *  (quadlife/immigration) — see `@/render/color`'s `PaletteMode`. Purely a
   *  display preference; the renderer call lives at the setting's call site
   *  (`SettingsPanel`) so this store stays session/render-agnostic. */
  paletteMode: PaletteMode;
  setPaletteMode: (mode: PaletteMode) => void;
}

export const useUIState = create<UILocalState>((set, get) => ({
  rightPanel: null,
  setRightPanel: (rightPanel) => set({ rightPanel }),
  toggleRightPanel: (panel) => set({ rightPanel: get().rightPanel === panel ? null : panel }),

  shortcutsOpen: false,
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),

  logbookOpen: false,
  setLogbookOpen: (logbookOpen) => set({ logbookOpen }),

  moreOpen: false,
  setMoreOpen: (moreOpen) => set({ moreOpen }),

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

  paletteMode: 'default',
  setPaletteMode: (paletteMode) => set({ paletteMode }),
}));
