import { renderWikiArticle } from './content.mjs';

export function renderHowItWorks() {
  const bodyHtml = `
          <h2 id="the-world">The world</h2>
          <p>
            The shipped world is a <strong>256×160 grid</strong>, running standard
            <strong>B3/S23</strong>, with <strong>toroidal wrap</strong>: the top edge
            connects to the bottom, the left to the right, so every cell has exactly 8
            neighbours with no special-cased edges. A glider that exits the right side
            re-enters on the left and keeps going. This also means a snapshot of the
            world is always the same fixed size — a 256×160 buffer, one byte per cell
            — which is what makes keyframes cheap and two branches diffable
            cell-for-cell without any alignment logic.
          </p>

          <h2 id="history">Deterministic replay, not stored snapshots</h2>
          <p>
            The history ribbon does not store a full snapshot of every generation —
            that would be enormous. Instead it stores a <strong>keyframe</strong> (a
            full snapshot) every <strong>64 generations</strong>, plus the sparse list
            of edits you made at each generation in between. Scrubbing to any
            generation restores the nearest keyframe at or before it and replays
            forward deterministically, reapplying your edits at the exact generations
            you made them. Because the rule is exact and edits are absolute (a cell is
            set alive or dead, never merely "toggled"), replaying the same history
            twice — even out of order — produces bit-identical results every time.
            That's what lets scrubbing feel instantaneous while still being the real
            recorded history rather than an approximation of it.
          </p>
          <p>
            Only the most recent <strong>4096 generations</strong> are kept in memory
            at once; older keyframes and edits are dropped as new history accumulates.
            That's a deliberate budget — enough history to dwarf what the Time
            Sculpture can show in one view (256 slices), while keeping a browser tab
            comfortable. Scrubbing past the retained window surfaces a message rather
            than failing silently.
          </p>

          <h2 id="why-not-reverse">Why you can't just run the rule backward</h2>
          <p>
            It would be convenient if rewinding meant literally reversing the B3/S23
            rule — running it backward instead of forward. That doesn't work, because
            <strong>Conway's Game of Life is not reversible</strong>. The rule is
            many-to-one: multiple different past generations can produce the exact
            same next generation (a dying cell with 0, 1, 4, 5, 6, 7 or 8 neighbours
            all just die — the rule doesn't record which), so going from a single
            present state back to "the" previous state is ambiguous in general, and
            for most patterns there simply is no valid predecessor at all. This is a
            structural fact about the rule, true for any implementation, not a
            limitation specific to AFTERLIFE.
          </p>
          <p>
            That's the actual reason the ribbon works the way it does: rather than
            trying to compute the past from the present, AFTERLIFE keeps a real record
            of the past (keyframes plus edits, as above) and replays it forward on
            demand. Scrubbing "backward" is really just asking for an earlier point in
            a forward-only recording — the only approach that's actually correct for a
            rule that can't be run in reverse.
          </p>

          <h2 id="edits">Edits commit at a generation boundary</h2>
          <p>
            A single pointer drag while drawing accumulates into one batch of cell
            changes; nothing is recorded until you release, at which point the whole
            batch is committed as one edit at the current generation, applied at the
            very start of that generation, before the step that produces the next one.
            One gesture equals one undoable, replayable unit. Committing an edit at a
            generation before the present normally truncates that branch's future —
            unless you ask to <a href="../features/#branching-and-compare">branch</a>
            instead, which is the entire mechanism behind "alternate futures."
          </p>
`;

  return renderWikiArticle({
    slug: 'how-it-works',
    title: 'How it works',
    description: 'The toroidal 256×160 world, deterministic replay from keyframes and sparse edits, the 4096-generation history window, and why Life cannot be reverse-simulated.',
    bodyHtml,
  });
}
