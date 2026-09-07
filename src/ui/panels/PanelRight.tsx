/**
 * The right panel host: slides in only when a tool needs it (per DESIGN's
 * "panels are tools the user temporarily brings to the experiment" rule).
 * Selection lives in `@/ui/uiState` (`rightPanel`), driven by the HUD's
 * icon buttons.
 */
import { useUIState } from '@/ui/uiState';
import { IconButton } from '@/ui/primitives';
import { CloseIcon, BranchIcon, ColumnsIcon, SlidersIcon, BookIcon } from '@/ui/icons';
import { BranchesPanel } from './BranchesPanel';
import { ComparePanel } from './ComparePanel';
import { SettingsPanel } from './SettingsPanel';
import { FieldGuidePanel } from './FieldGuidePanel';

const TITLES = {
  branches: { label: 'Branches', icon: <BranchIcon /> },
  compare: { label: 'Compare', icon: <ColumnsIcon /> },
  settings: { label: 'Settings', icon: <SlidersIcon /> },
  guide: { label: 'Field guide', icon: <BookIcon /> },
} as const;

export function PanelRight() {
  const rightPanel = useUIState((s) => s.rightPanel);
  const setRightPanel = useUIState((s) => s.setRightPanel);

  if (!rightPanel) return null;

  const meta = TITLES[rightPanel];

  return (
    <div
      className="flex h-full flex-col animate-[panel-in-right_var(--duration-base)_var(--ease-entrance)]"
    >
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <span className="flex items-center gap-2 text-micro uppercase tracking-[0.18em] text-ivory-300">
          {meta.icon} {meta.label}
        </span>
        <IconButton label="Close panel" icon={<CloseIcon />} onClick={() => setRightPanel(null)} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {rightPanel === 'branches' && <BranchesPanel />}
        {rightPanel === 'compare' && <ComparePanel />}
        {rightPanel === 'settings' && <SettingsPanel />}
        {rightPanel === 'guide' && <FieldGuidePanel />}
      </div>
    </div>
  );
}
