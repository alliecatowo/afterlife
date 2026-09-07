/**
 * The left specimen drawer: tools, the pattern library, and grid visibility.
 * Collapsible — a slim rail when closed, per DESIGN's "controls hold a slim
 * perimeter" rule. `PATTERNS` is populated by the `content` agent
 * (`@/content/patterns`); until then this renders a genuine, designed empty
 * state rather than a placeholder list.
 */
import { useAppStore } from '@/ui/store';
import { useUIState } from '@/ui/uiState';
import { PATTERNS } from '@/content/patterns';
import { Panel, Toggle, IconButton, Tooltip } from '@/ui/primitives';
import {
  PencilIcon, EraserIcon, HandIcon, MarqueeIcon, StampIcon, GridIcon, ChevronIcon,
} from '@/ui/icons';
import type { Tool } from '@/ui/store';

const TOOLS: { value: Tool; label: string; icon: React.ReactNode }[] = [
  { value: 'draw', label: 'Draw', icon: <PencilIcon /> },
  { value: 'erase', label: 'Erase', icon: <EraserIcon /> },
  { value: 'pan', label: 'Pan', icon: <HandIcon /> },
  { value: 'select', label: 'Select', icon: <MarqueeIcon /> },
  { value: 'stamp', label: 'Stamp', icon: <StampIcon /> },
];

export function Drawer() {
  const drawerOpen = useAppStore((s) => s.drawerOpen);
  const setDrawerOpen = useAppStore((s) => s.setDrawerOpen);
  const tool = useAppStore((s) => s.tool);
  const setTool = useAppStore((s) => s.setTool);
  const showGrid = useAppStore((s) => s.showGrid);
  const setShowGrid = useAppStore((s) => s.setShowGrid);
  const selectedPatternId = useUIState((s) => s.selectedPatternId);
  const setSelectedPattern = useUIState((s) => s.setSelectedPattern);

  if (!drawerOpen) {
    // Below `md` the closed drawer is a full slide-over sheet translated
    // off-screen (see `App.tsx`), so this collapsed-rail content isn't
    // visible or reachable there — only hidden here (`hidden md:flex`), not
    // just invisible, so it drops out of the tab order too. The HUD's own
    // drawer toggle is the sole "open the drawer" control on mobile. On
    // desktop this rail IS the visible, persistent "slim rail when closed"
    // (see the module doc) — named "Expand drawer" rather than "Open drawer"
    // so it's distinguishable by name from the HUD's separate toggle button,
    // which is also visible at the same time.
    return (
      <div className="hidden h-full flex-col items-center gap-2 py-3 md:flex">
        <IconButton label="Expand drawer" icon={<ChevronIcon direction="right" />} onClick={() => setDrawerOpen(true)} />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <span className="text-micro uppercase tracking-[0.18em] text-ivory-300">Specimen drawer</span>
        <IconButton label="Collapse drawer" icon={<ChevronIcon direction="left" />} onClick={() => setDrawerOpen(false)} />
      </div>

      <Panel title="Tool" collapsible={false}>
        <Toggle
          aria-label="Editing tool"
          options={TOOLS}
          value={tool}
          onChange={setTool}
          className="flex-wrap"
        />
        <label className="mt-3 flex items-center gap-2 text-xs text-ivory-300">
          <input
            type="checkbox"
            checked={showGrid}
            onChange={(e) => setShowGrid(e.target.checked)}
            className="h-3.5 w-3.5 accent-[var(--color-ivory-100)]"
          />
          <GridIcon className="text-ivory-300" />
          Show grid
        </label>
      </Panel>

      <Panel title="Patterns" className="min-h-0 flex-1 overflow-y-auto">
        {PATTERNS.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <p className="display-face-tight text-lg text-ivory-200">The library is quiet.</p>
            <p className="max-w-[18ch] text-xs text-ivory-300">
              No specimens catalogued yet. Draw directly on the world with the pencil, or check back
              once the field guide is stocked.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {PATTERNS.map((p) => (
              <li key={p.id}>
                <Tooltip content={p.note} side="right">
                  <button
                    type="button"
                    onClick={() => { setSelectedPattern(p.id); setTool('stamp'); }}
                    aria-pressed={selectedPatternId === p.id}
                    className={
                      'flex w-full items-center justify-between rounded-sm border px-2.5 py-1.5 text-left text-xs ' +
                      'transition-colors duration-[var(--duration-instant)] focus-visible:focus-ring outline-none ' +
                      (selectedPatternId === p.id
                        ? 'border-line-strong bg-ink-700 text-ivory-100'
                        : 'border-transparent text-ivory-300 hover:bg-ink-800 hover:text-ivory-100')
                    }
                  >
                    <span>{p.name}</span>
                    <span className="text-micro uppercase tracking-[0.12em] text-ivory-300">{p.category}</span>
                  </button>
                </Tooltip>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
