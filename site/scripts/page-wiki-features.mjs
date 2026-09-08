import { renderWikiArticle } from './content.mjs';

export function renderFeatures() {
  const bodyHtml = `
          <h2 id="lenses">Lenses</h2>
          <p>
            The same live cells can be recoloured to answer different questions,
            without ever changing the simulation underneath. Colour in AFTERLIFE is
            <strong>read-only</strong>: it rides along with each cell, but B3/S23 —
            birth, survival, death — can never see it. That's not just a design
            promise; a test seeds colour state, actively poisons it, and confirms the
            resulting live/dead bits come out byte-identical to a run with no colour
            reasoning applied at all. Switch lenses with <kbd>1</kbd>–<kbd>8</kbd>, or
            the drawer, and every lens shows a short legend explaining what its colour
            means.
          </p>
          <ul>
            <li><strong>Life</strong> — the plain view: alive or dead, one accent colour.</li>
            <li><strong>Age</strong> — a spectral ramp from young to long-lived, so structures that have persisted for a long time visually separate from freshly-born cells.</li>
            <li><strong>Activity</strong> — a spectral ramp over recent change and churn, highlighting where the world is currently doing something.</li>
            <li><strong>Lineage</strong> — heritage colour. A newborn cell's hue is the <em>circular mean</em> of its exactly-three parents' hues (birth in B3/S23 always has exactly three parents, so this is never ambiguous). Two colliding populations visibly interbreed at their border instead of one colour simply overwriting the other.</li>
            <li><strong>Immigration</strong> — the classic two-colour Life variant: a newborn takes the majority colour among its three parents; a three-way tie is resolved by the rule below. Exactly B3/S23 underneath — this is a coarser, 2-colour view of the same data QuadLife shows in full.</li>
            <li><strong>QuadLife</strong> — the four-colour variant. Same majority-of-three birth rule; when all three parents are pairwise distinct, the newborn takes the one colour <em>not</em> represented among them, rather than picking arbitrarily.</li>
            <li><strong>Velocity</strong> — hue from each cell's local directional bias, a proxy for which way a structure is advancing. Grey where direction isn't well-defined.</li>
            <li><strong>Neighbors</strong> — a 9-step spectral ramp over live-neighbour count, cool for sparse and hot for crowded, sweeping through the accent colour right at the birth/survival band (2–3 neighbours) — a way to see the rule itself, not just its results.</li>
          </ul>
          <p>
            A colourblind-safe palette (the standard Okabe-Ito swatches, verified
            distinguishable under protanopia, deuteranopia and tritanopia) is a toggle
            in Settings, applied to the discrete Immigration/QuadLife lenses.
          </p>

          <h2 id="history-ribbon">The history ribbon</h2>
          <p>
            A ribbon along the bottom of the screen is not a scrollbar bolted onto a
            simulation — it's the actual recorded history, scrubbable in both
            directions. Dragging it calls the same <code>goto(generation)</code> the
            engine uses internally, restoring the nearest keyframe and replaying
            forward deterministically, so what you see at generation 4,000 is the real
            generation 4,000, including every edit — and every cell's colour — you made
            along the way. See <a href="../how-it-works/#history">How it works</a> for
            the mechanism.
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

          <h2 id="field-guide">The field guide and the logbook</h2>
          <p>
            A recognition pass watches the grid for known specimens — still lifes,
            oscillators, spaceships, guns — as they appear, and logs each one as a
            discovery you can follow, rename, and jump back to later. It's how the
            catalogue in <a href="../specimens/">Specimen catalogue</a> connects to
            what's actually happening in your own universe, not just a static
            reference list.
          </p>
          <p>
            A separate 14-entry <strong>achievements logbook</strong> (HUD icon, or
            <kbd>L</kbd>) keeps a naturalist's-log record of what you've actually
            witnessed — your first glider, your first fork, watching a collision or an
            extinction, finishing an experiment. Every entry is wired to a real
            simulation event or session-state change; nothing unlocks on a timer or for
            merely opening a panel.
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
            silent visualisation. It ships with 9 synthesised timbres (mallet, glass,
            pad and accent from the original soundscape, plus pluck, bell, bow, breath
            and perc) arranged into <strong>4 presets</strong>: <em>Observatory</em>
            (the original default — restrained mallet and glass over a soft filtered
            drone), <em>Glass</em> (bright pluck/bell/glass, lifted and shimmering),
            <em>Deep</em> (slow, dark, bowed pads and breath tones), and <em>Chime</em>
            (quick, bell-like, an ambiguous whole-tone shimmer). A slow harmonic drift,
            on by default, tracks a short- and long-run average of the population and
            shifts register at most once per 60 seconds when the two diverge — a
            deliberately rare, unhurried musical gesture, never a per-generation
            twitch. Generative percussion, derived from real (heavily rate-limited)
            event rates, is available as an opt-in texture.
          </p>
          <p>
            Notes can also be routed to a real external synthesiser or DAW over
            <strong>Web MIDI</strong> — port and channel selection, optional mapping of
            event classes to separate channels, guaranteed note-offs (every note-on
            schedules its own matching note-off, and retriggering the same note always
            sends an immediate note-off first), and an all-notes-off panic control that
            fires automatically on mute, on switching ports, and when the tab closes,
            so nothing is ever left ringing on real hardware.
          </p>
          <p>
            The soundscape can also react to <strong>system or microphone audio</strong>
            (via <code>getDisplayMedia</code>/<code>getUserMedia</code>, each starting
            only from an explicit button press with the capture target named up front).
            This is structurally limited to presentation and tempo — it can nudge note
            density, the drone's filter sweep, and playback speed, and has no code path
            into the simulation engine at all, so it cannot corrupt or influence cell
            state no matter how it's driven.
          </p>

          <h2 id="cinematic-mode">Cinematic mode</h2>
          <p>
            Hand the camera to the app: an auto-pan choreographer scores regions of the
            grid by real activity, density and confirmed travellers, picks a subject,
            holds on it for a while, and moves on — hands-off and full-screen. When a
            tracked traveller dies, it lingers on the aftermath rather than cutting away
            immediately; it also pulls back to a wider view periodically so you don't
            spend the whole session zoomed into one corner. Any real pointer, keyboard
            or touch input pauses it immediately without exiting, so a stray click
            doesn't kick you out of a mode you just settled into — it resumes on its own
            after a short idle period, or <kbd>Esc</kbd> leaves it entirely. Toggle with
            <kbd>C</kbd>; presentation mode (<kbd>V</kbd>) similarly hides all chrome
            without taking over the camera.
          </p>

          <h2 id="guided-tour">The guided tour</h2>
          <p>
            A first-run guided tour walks through the app's core mechanics using a real
            spotlight — it dims the interface and cuts a live hole over the actual
            control or patch of world being taught, tracking world coordinates through
            the camera so a step anchored to something happening <em>in the
            simulation</em> (like the opening encounter) still highlights the right
            place if you pan or zoom mid-step. Steps complete on the real action they
            teach, not a timer or a synthetic click — draw a cell, open the drawer,
            scrub the timeline — and each has a "show me" for anyone who'd rather watch
            the app do it once. It only runs automatically on a fresh profile; replay it
            any time from the compass icon or the shortcuts sheet (<kbd>?</kbd>).
          </p>
`;

  return renderWikiArticle({
    slug: 'features',
    title: 'Features',
    description: 'The 8 colour lenses, the history ribbon, the Time Sculpture, branching and compare, the field guide and achievements logbook, experiments, the audio instrument (timbres, presets, MIDI, reactivity), cinematic mode, and the guided tour.',
    bodyHtml,
  });
}
