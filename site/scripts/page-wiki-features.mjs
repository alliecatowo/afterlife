import { renderWikiArticle } from './content.mjs';

export function renderFeatures() {
  const bodyHtml = `
          <h2 id="lenses">Lenses</h2>
          <p>
            The same live cells can be recoloured to answer different questions,
            without changing the simulation underneath:
          </p>
          <ul>
            <li><strong>Life</strong> — the plain view: alive or dead.</li>
            <li><strong>Age</strong> — how long each live cell has persisted, so long-lived structures visually separate from freshly-born ones.</li>
            <li><strong>Activity</strong> — recent change and churn, highlighting where the world is currently doing something.</li>
          </ul>
          <p>Switch with <kbd>1</kbd> / <kbd>2</kbd> / <kbd>3</kbd>, or the drawer.</p>

          <h2 id="history-ribbon">The history ribbon</h2>
          <p>
            A ribbon along the bottom of the screen is not a scrollbar bolted onto a
            simulation — it's the actual recorded history, scrubbable in both
            directions. Dragging it calls the same <code>goto(generation)</code> the
            engine uses internally, restoring the nearest keyframe and replaying
            forward deterministically, so what you see at generation 4,000 is the real
            generation 4,000, including every edit you made along the way. See
            <a href="../how-it-works/#history">How it works</a> for the mechanism.
          </p>

          <h2 id="time-sculpture">The Time Sculpture</h2>
          <p>
            Select a range on the ribbon and lift it into a 3D view where the third
            axis is time. Every slice is a real recorded generation, stacked in order
            — a still life becomes a vertical column, a travelling glider becomes an
            inclined beam, and a collision becomes a shape you can orbit and read from
            any angle. A plane lets you slice through the stack to inspect a single
            moment in context. It's lazily loaded as its own bundle, so it costs
            nothing until you open it.
          </p>

          <h2 id="branching-and-compare">Branching and compare</h2>
          <p>
            Editing a cell at a past generation would normally overwrite everything
            that happened after it — the obvious default, and still what happens if
            you don't ask for anything else. Branching instead forks the timeline: the
            original future keeps playing untouched on its own branch, your edited
            future plays on a new one, and a compare view diffs the two cell-for-cell,
            frame-for-frame. Up to 8 branches are kept at once; a 9th evicts the
            least-recently-used one, unless it's been renamed or is the branch you're
            currently on.
          </p>

          <h2 id="field-guide">The field guide</h2>
          <p>
            A recognition pass watches the grid for known specimens — still lifes,
            oscillators, spaceships, guns — as they appear, and logs each one as a
            discovery you can follow, rename, and jump back to later. It's how the
            catalogue in <a href="../specimens/">Specimen catalogue</a> connects to
            what's actually happening in your own universe, not just a static
            reference list.
          </p>

          <h2 id="experiments">Experiments</h2>
          <p>
            Three small, authored puzzles built on the same mechanics as everything
            else — change something, watch what happens, get an honest verdict
            instead of a badge:
          </p>
          <ul>
            <li><strong>One Cell</strong> — flip a single dead-to-alive cell before a collision, and the outcome flips from a 221-cell debris field to total extinction by generation 54.</li>
            <li><strong>First Contact</strong> — a glider and a lightweight spaceship are on a collision course; intervene or don't.</li>
            <li><strong>Keep Something Alive</strong> — the baseline activity dies out at generation 85; find an edit, within a budget of 3, that keeps something moving to generation 150.</li>
          </ul>
          <p>Exact verified numbers for each are in <a href="../verification/">Verification</a>.</p>

          <h2 id="audio">The audio instrument</h2>
          <p>
            A WebAudio soundscape maps what's happening on the grid — population,
            births, deaths, activity — onto pitched, scheduled notes on a fixed tonal
            centre, turning the simulation into an ambient instrument rather than a
            silent visualisation. Notes can also be routed to a real external
            synthesiser or DAW over <strong>Web MIDI</strong>, if your browser and
            hardware support it, turning the same events into note-on/note-off pairs
            on a MIDI output port of your choosing.
          </p>

          <h2 id="cinematic-mode">Cinematic mode</h2>
          <p>
            Hand the camera to the app: an auto-pan choreographer picks a point of
            interest — a traveller, a cluster of activity — holds on it, and moves on,
            hands-off and full-screen. Any real pointer, keyboard or touch input pauses
            it immediately without exiting, so a stray click doesn't kick you out of a
            mode you just settled into. Toggle with <kbd>C</kbd>; presentation mode
            (<kbd>V</kbd>) similarly hides all chrome without taking over the camera.
          </p>
`;

  return renderWikiArticle({
    slug: 'features',
    title: 'Features',
    description: 'Lenses, the history ribbon, the Time Sculpture, branching and compare, the field guide, experiments, the audio instrument (including MIDI), and cinematic mode.',
    bodyHtml,
  });
}
