import { useUIState } from '@/ui/uiState';
import { Dialog, Divider } from '@/ui/primitives';

const GROUPS: { title: string; rows: [string, string][] }[] = [
  {
    title: 'Transport',
    rows: [
      ['Space', 'Play / pause'],
      ['.', 'Step forward one generation'],
      ['[ / ]', 'Speed down / up'],
    ],
  },
  {
    title: 'Timeline (ribbon focused)',
    rows: [
      ['← / →', 'Move one generation'],
      ['Shift + ← / →', 'Jump one keyframe interval (64 gens)'],
      ['Home / End', 'Jump to window start / present'],
    ],
  },
  {
    title: 'World',
    rows: [
      ['← ↑ → ↓', 'Pan the camera'],
      ['+ / −', 'Zoom in / out'],
      ['Scroll / pinch', 'Zoom at pointer'],
      ['D / E / P / S', 'Draw / erase / pan / select tool'],
      ['G', 'Toggle grid'],
      ['R', 'Rotate stamp'],
      ['F', 'Flip stamp'],
      ['Z', 'Undo last edit'],
    ],
  },
  {
    title: 'View',
    rows: [
      ['1 / 2 / 3', 'Life / age / activity lens'],
      ['V', 'Presentation mode'],
      ['?', 'This sheet'],
      ['Esc', 'Close dialog / panel / presentation'],
    ],
  },
];

export function ShortcutsDialog() {
  const open = useUIState((s) => s.shortcutsOpen);
  const setOpen = useUIState((s) => s.setShortcutsOpen);

  return (
    <Dialog open={open} onOpenChange={setOpen} title="Keyboard shortcuts" width={480}>
      <div className="flex flex-col gap-4">
        {GROUPS.map((g, i) => (
          <div key={g.title}>
            {i > 0 && <Divider className="mb-4" />}
            <h4 className="mb-2 text-micro uppercase tracking-[0.18em] text-ivory-300">{g.title}</h4>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
              {g.rows.map(([key, desc]) => (
                <div key={key} className="contents">
                  <dt className="tabular rounded-xs border border-line bg-ink-800 px-1.5 py-0.5 text-center text-xs text-ivory-100">
                    {key}
                  </dt>
                  <dd className="text-xs text-ivory-200">{desc}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
