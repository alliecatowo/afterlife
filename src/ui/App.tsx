/**
 * The shell. Owned by the `ui` agent from here on.
 *
 * Layout contract — these element ids are ANCHORS other agents mount into.
 * Do not rename them:
 *   #world-canvas      the simulation canvas (render agent)
 *   #sculpture-canvas  the R3F Time Sculpture host (sculpture agent)
 *   #hud-top           top status/transport bar
 *   #timeline          bottom scrubber + branch track
 *   #drawer-left       tools, patterns, lenses
 *   #panel-right       inspector, branches, discoveries
 *   #toast-layer       transient notices
 *   #compare-canvas    side-by-side branch diff canvas
 *
 * Composition rule: the world dominates; chrome holds a slim perimeter.
 */
export function App() {
  return (
    <div className="grid h-full w-full grid-rows-[var(--size-hud)_1fr_var(--size-timeline)] bg-ink-900 text-ivory-200">
      <header
        id="hud-top"
        className="flex items-center justify-between border-b border-line px-4"
      >
        <span className="display-face text-lg text-ivory-100">AFTERLIFE</span>
        <span className="tabular text-micro uppercase tracking-[0.18em] text-ivory-300">
          a playable observatory for tiny universes
        </span>
      </header>

      <main className="relative grid min-h-0 grid-cols-[var(--size-drawer)_1fr_var(--size-panel)]">
        <aside id="drawer-left" className="min-h-0 overflow-y-auto border-r border-line" />

        <section className="relative min-h-0 min-w-0">
          <canvas id="world-canvas" className="absolute inset-0 h-full w-full" />
          <canvas id="compare-canvas" className="absolute inset-0 hidden h-full w-full" />
          <div
            id="sculpture-canvas"
            className="absolute inset-0 hidden"
            aria-hidden="true"
          />
        </section>

        <aside id="panel-right" className="min-h-0 overflow-y-auto border-l border-line" />
      </main>

      <footer id="timeline" className="border-t border-line px-4" />

      <div
        id="toast-layer"
        className="pointer-events-none fixed bottom-[calc(var(--size-timeline)+var(--spacing)*4)] left-1/2 z-[var(--z-toast)] -translate-x-1/2"
        role="status"
        aria-live="polite"
      />
    </div>
  );
}
