/**
 * The right panel host: slides in only when a tool needs it (per DESIGN's
 * "panels are tools the user temporarily brings to the experiment" rule).
 * Selection lives in `@/ui/uiState` (`rightPanel`), driven by the HUD's
 * icon buttons.
 */
import { useUIState } from '@/ui/uiState';
import { useDiscoveries } from '@/ui/discoveries';
import { useAppStore } from '@/ui/store';
import { getSession } from '@/ui/session';
import { toFieldGuideEntry } from '@/content/discoveries';
import { IconButton } from '@/ui/primitives';
import { CloseIcon, BranchIcon, ColumnsIcon, SlidersIcon, BookIcon, FlaskIcon, SaveIcon, WaveformIcon } from '@/ui/icons';
import { BranchesPanel } from './BranchesPanel';
import { ComparePanel } from './ComparePanel';
import { SettingsPanel } from './SettingsPanel';
import { FieldGuidePanel } from './FieldGuidePanel';
import { ExperimentsPanel } from './ExperimentsPanel';
import { PersistPanel } from './PersistPanel';
import { AudioPanel } from './AudioPanel';

const TITLES = {
  branches: { label: 'Branches', icon: <BranchIcon /> },
  compare: { label: 'Compare', icon: <ColumnsIcon /> },
  settings: { label: 'Settings', icon: <SlidersIcon /> },
  guide: { label: 'Field guide', icon: <BookIcon /> },
  experiments: { label: 'Experiments', icon: <FlaskIcon /> },
  save: { label: 'Save & export', icon: <SaveIcon /> },
  audio: { label: 'Instrument', icon: <WaveformIcon /> },
} as const;

export function PanelRight() {
  const rightPanel = useUIState((s) => s.rightPanel);
  const setRightPanel = useUIState((s) => s.setRightPanel);
  const items = useDiscoveries((s) => s.items);
  const rename = useDiscoveries((s) => s.rename);
  const toggleFollow = useDiscoveries((s) => s.toggleFollow);
  const goTo = useDiscoveries((s) => s.goTo);
  const scanRect = useDiscoveries((s) => s.scanRect);
  const selection = useAppStore((s) => s.selection);

  if (!rightPanel) return null;

  const meta = TITLES[rightPanel];

  const scanHere = (): void => {
    const session = getSession();
    if (!session) return;
    const rect = selection ?? {
      x: Math.floor(session.camera.camera.x - 24),
      y: Math.floor(session.camera.camera.y - 24),
      w: 48,
      h: 48,
    };
    scanRect(rect);
  };

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
        {rightPanel === 'experiments' && <ExperimentsPanel />}
        {rightPanel === 'save' && <PersistPanel />}
        {rightPanel === 'audio' && <AudioPanel />}
        {rightPanel === 'guide' && (
          <FieldGuidePanel
            entries={items.map((d) => ({ ...toFieldGuideEntry(d), following: d.following, lost: d.lost }))}
            onScanHere={scanHere}
            onRename={rename}
            onToggleFollow={toggleFollow}
            onGoTo={goTo}
          />
        )}
      </div>
    </div>
  );
}
