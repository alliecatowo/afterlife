import * as RadixDialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';
import { CloseIcon } from '@/ui/icons';
import { IconButton } from './IconButton';

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Constrains width; dialogs stay small and instrument-like, never full-bleed. */
  width?: number;
}

export function Dialog({ open, onOpenChange, title, description, children, footer, width = 420 }: DialogProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay
          className="fixed inset-0 z-[var(--z-overlay)] bg-ink-900/70 data-[state=open]:animate-[overlay-in_var(--duration-base)_var(--ease-entrance)] data-[state=closed]:animate-[overlay-out_var(--duration-fast)_var(--ease-exit)]"
        />
        <RadixDialog.Content
          style={{ width }}
          className={
            'fixed left-1/2 top-1/2 z-[var(--z-overlay)] max-h-[80vh] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 ' +
            'overflow-y-auto rounded-lg border border-line bg-surface-raised shadow-[var(--shadow-float)] ' +
            'data-[state=open]:animate-[dialog-in_var(--duration-base)_var(--ease-entrance)] ' +
            'data-[state=closed]:animate-[dialog-out_var(--duration-fast)_var(--ease-exit)] focus:outline-none'
          }
        >
          <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div>
              <RadixDialog.Title className="display-face-tight text-lg text-ivory-100">{title}</RadixDialog.Title>
              {description ? (
                <RadixDialog.Description className="mt-1 text-xs text-ivory-300">{description}</RadixDialog.Description>
              ) : null}
            </div>
            <RadixDialog.Close asChild>
              <IconButton label="Close" icon={<CloseIcon />} />
            </RadixDialog.Close>
          </header>
          <div className="px-5 py-4">{children}</div>
          {footer ? <footer className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer> : null}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
