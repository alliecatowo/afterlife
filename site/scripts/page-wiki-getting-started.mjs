import { renderWikiArticle } from './content.mjs';

export function renderGettingStarted() {
  const bodyHtml = `
          <h2>The one-minute tour</h2>
          <p>
            Open the app and watch — you don't need to do anything yet. Something is
            always alive somewhere on the grid: a glider drifting, a gun firing, a
            cluster of oscillators ticking in place.
          </p>
          <ol class="steps">
            <li>
              <h3>Follow a traveller</h3>
              <p>
                Two gliders are converging from opposite corners of the default scene.
                Use the pan tool (<kbd>P</kbd>, or drag) to follow one. Give it a
                minute and they collide — the wreckage blooms into a small chaotic
                reaction before settling into blinkers and blocks. The
                <a href="../features/#field-guide">field guide</a> is quietly logging
                it as it happens.
              </p>
            </li>
            <li>
              <h3>Scrub backward and change one cell</h3>
              <p>
                Drag the history ribbon at the bottom back past the moment of contact,
                then draw or erase a single cell near one of the travellers. Let it
                play again. It's a different future — sometimes subtly, sometimes
                completely: one flipped cell can be the entire difference between a
                bustling wreck and an empty grid.
              </p>
            </li>
            <li>
              <h3>Branch instead of overwriting</h3>
              <p>
                Editing the past normally overwrites everything after it. Branch
                instead, and both futures — the one you had and the one you made —
                keep playing, comparable side by side. See
                <a href="../features/#branching-and-compare">branching &amp; compare</a>.
              </p>
            </li>
            <li>
              <h3>Lift history into the Time Sculpture</h3>
              <p>
                Select the stretch of history that mattered and open the
                <a href="../features/#time-sculpture">Time Sculpture</a> — a 3D stack
                of every one of those generations, one slice per frame, orbitable and
                sliceable.
              </p>
            </li>
          </ol>
          <p>
            The app also runs a first-run guided tour automatically, with a real
            spotlight on whatever it's teaching — replay it any time from
            <kbd>?</kbd> or the compass icon if you skipped it.
          </p>
          <h2>Where to go next</h2>
          <ul>
            <li><a href="../fundamentals/">Life fundamentals</a> — if the rules themselves aren't clear yet.</li>
            <li><a href="../shortcuts/">Keyboard shortcuts</a> — everything is also reachable from <kbd>?</kbd> in-app.</li>
            <li><a href="../features/">Features</a> — the full rundown of lenses, branching, the field guide, the achievements logbook, audio, and cinematic mode.</li>
          </ul>
`;

  return renderWikiArticle({
    slug: 'getting-started',
    title: 'Getting started',
    description: 'The one-minute tour of the app: what to watch, what to try, and where the deeper features live.',
    bodyHtml,
  });
}
