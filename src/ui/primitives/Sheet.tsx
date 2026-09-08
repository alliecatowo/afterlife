import * as RadixDialog from '@radix-ui/react-dialog';
import { useRef, useState, type ReactNode } from 'react';
import { CloseIcon } from '@/ui/icons';
import { IconButton } from './IconButton';

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
}

/** Drag-down distance (CSS px) past which releasing closes the sheet, same
 *  register as a native iOS/Android bottom sheet's "flick to dismiss". */
const DISMISS_THRESHOLD_PX = 80;

/**
 * A bottom-anchored slide-up sheet — the mobile counterpart to `Dialog`
 * (which stays a centred card; fine for infrequent, deliberate choices like
 * shortcuts, but wrong for something opened one-handed, mid-gesture, from a
 * thumb-reachable bottom bar). Built on the same Radix Dialog primitive for
 * focus trapping / Escape / `aria-modal`, so it's exactly as accessible.
 *
 * Dismissible three ways, per the mobile-pass brief: the explicit close
 * button, a backdrop tap (Radix's default outside-press behaviour), and a
 * drag-down on the handle/header (a plain pointer-capture drag, not a
 * physics library — this app already avoids scale-bounce/spring motion, see
 * DESIGN.md § Motion, so a simple threshold-based release reads as
 * consistent with everything else rather than an outlier).
 */
export function Sheet({ open, onOpenChange, title, children }: SheetProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [dragY, setDragY] = useState(0);
  const dragging = useRef(false);
  const startY = useRef(0);

  const onGrabberPointerDown = (e: React.PointerEvent) => {
    dragging.current = true;
    startY.current = e.clientY;
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const onGrabberPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    const dy = Math.max(0, e.clientY - startY.current);
    setDragY(dy);
  };
  const endDrag = () => {
    if (!dragging.current) return;
    dragging.current = false;
    if (dragY > DISMISS_THRESHOLD_PX) onOpenChange(false);
    setDragY(0);
  };

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay
          className="fixed inset-0 z-[var(--z-overlay)] bg-ink-900/70 data-[state=open]:animate-[overlay-in_var(--duration-base)_var(--ease-entrance)] data-[state=closed]:animate-[overlay-out_var(--duration-fast)_var(--ease-exit)]"
        />
        <RadixDialog.Content
          ref={contentRef}
          style={{ transform: dragY ? `translateY(${dragY}px)` : undefined, transition: dragging.current ? 'none' : undefined }}
          className={
            'fixed inset-x-0 bottom-0 z-[var(--z-overlay)] flex max-h-[85vh] flex-col overflow-hidden ' +
            'rounded-t-lg border-t border-x border-line bg-surface-raised shadow-[var(--shadow-float)] ' +
            'pb-[env(safe-area-inset-bottom)] ' +
            'data-[state=open]:animate-[sheet-in_var(--duration-base)_var(--ease-entrance)] ' +
            'data-[state=closed]:animate-[sheet-out_var(--duration-fast)_var(--ease-exit)] focus:outline-none'
          }
          onPointerMove={onGrabberPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <div
            className="flex shrink-0 cursor-grab touch-none flex-col items-center gap-2 pb-1 pt-2.5 active:cursor-grabbing"
            onPointerDown={onGrabberPointerDown}
          >
            <span aria-hidden="true" className="h-1 w-9 rounded-full bg-ink-600" />
            <div className="flex w-full items-center justify-between px-4">
              <RadixDialog.Title className="display-face-tight text-base text-ivory-100">{title}</RadixDialog.Title>
              <RadixDialog.Close asChild>
                <IconButton label="Close" icon={<CloseIcon />} />
              </RadixDialog.Close>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3">{children}</div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
