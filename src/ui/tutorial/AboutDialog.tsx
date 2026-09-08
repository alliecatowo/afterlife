/**
 * The "What is this?" entry point — reachable at any time (a HUD affordance
 * next to the shortcuts sheet mounts this), independent of whether the
 * guided tour has ever run. A real `Dialog` (unlike the tour's own coach
 * marks): this one genuinely is a self-contained, modal explanation, not
 * something anchored to a place in the live world.
 */
import { Dialog, Button, Divider } from '@/ui/primitives';
import { useTourStore } from './tourStore';
import { ABOUT_CONTENT } from '@/content/tour';

export function AboutDialog() {
  const open = useTourStore((s) => s.aboutOpen);
  const setOpen = useTourStore((s) => s.setAboutOpen);
  const startTour = useTourStore((s) => s.start);

  return (
    <Dialog open={open} onOpenChange={setOpen} title={ABOUT_CONTENT.title} width={440}>
      <div className="flex flex-col gap-3">
        {ABOUT_CONTENT.paragraphs.map((p, i) => (
          <p key={i} className="text-sm text-ivory-200">{p}</p>
        ))}
        <Divider />
        <div className="flex flex-wrap justify-end gap-2">
          {/* The site agent's landing page + 8-page wiki (`site/guide/**`,
              served at `/afterlife/guide/`) had nothing in the app linking to
              it — see INTEGRATION-NOTES.md's "guide" entry for the exact diff
              this applies. `import.meta.env.BASE_URL` (not a hardcoded
              `/afterlife/guide/`) so this keeps working under `vite dev`
              (base `/`, aliased to the guide by `guideDevAliasPlugin`) and
              under any future base change, not just the current deploy. A
              real `<a>`, not a `Button` (which renders a `<button>`), so
              right-click / open-in-new-tab / middle-click all work. */}
          <a
            href={`${import.meta.env.BASE_URL}guide/`}
            className="inline-flex h-7 items-center justify-center rounded-sm border border-line px-3 text-xs text-ivory-200 hover:bg-ink-700 hover:text-ivory-100 focus-ring"
          >
            Read the guide
          </a>
          <Button
            variant="solid"
            size="sm"
            onClick={() => { setOpen(false); startTour(true); }}
          >
            Take the guided tour
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
