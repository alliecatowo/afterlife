import { renderWikiArticle } from './content.mjs';

// Transcribed verbatim from `src/ui/dialogs/ShortcutsDialog.tsx`'s `GROUPS` —
// keep this in sync with that file; it is also reachable in-app under `?`.
const GROUPS = [
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
      ['R', 'Rotate stamp (or the selection’s contents, if one is active)'],
      ['F', 'Flip stamp (or the selection’s contents, if one is active)'],
      ['Z', 'Undo last edit'],
    ],
  },
  {
    title: 'View',
    rows: [
      ['1 / 2 / 3', 'Life / age / activity lens'],
      ['V', 'Presentation mode'],
      ['C', 'Cinematic mode — auto-pan, full-screen, hands-off (any input pauses it; Esc exits)'],
      ['?', 'This sheet'],
      ['Esc', 'Close dialog / panel / presentation, or cancel the current selection / armed stamp'],
    ],
  },
  {
    title: 'Help',
    rows: [
      ['Compass icon', 'What is this? — a short explanation, and the tour'],
      ['Replay tour', 'Walks through every feature again, from the button below'],
    ],
  },
];

export function renderShortcuts() {
  const groupsHtml = GROUPS.map(
    (g) => `
          <h2>${g.title}</h2>
          <table class="shortcuts-table">
            <thead>
              <tr><th scope="col">Keys</th><th scope="col">Does</th></tr>
            </thead>
            <tbody>
              ${g.rows
                .map(
                  ([key, desc]) => `<tr><td><kbd>${key}</kbd></td><td>${desc}</td></tr>`,
                )
                .join('\n              ')}
            </tbody>
          </table>`,
  ).join('\n');

  const bodyHtml = `
          <p>
            Every binding below is also available in-app under <kbd>?</kbd> — this page
            mirrors that sheet exactly.
          </p>
${groupsHtml}
`;

  return renderWikiArticle({
    slug: 'shortcuts',
    title: 'Keyboard shortcuts',
    description: 'Every AFTERLIFE keyboard binding — transport, timeline, world, view and help — matching the in-app shortcuts sheet exactly.',
    bodyHtml,
  });
}
