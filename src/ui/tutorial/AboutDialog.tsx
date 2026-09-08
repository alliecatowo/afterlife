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
